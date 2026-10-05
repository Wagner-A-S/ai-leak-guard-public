import { RULES_BY_ID } from './detectors/rules.js';
import { isSupportedCountryCode } from './country-codes.js';
import { DEFAULT_SITES } from './providers.js';
import {
  MAX_SITES,
  MAX_LABELS_PER_ROLE,
  MAX_LABEL_LENGTH,
  MAX_TERMS,
  MAX_TERM_LENGTH,
} from './limits.js';

export const DEFAULT_POLICY = Object.freeze({
  sites: DEFAULT_SITES,
  redactEmails: true,
  redactPhones: true,
  redactCards: true,
  redactIdentifiers: true,
  redactBankAccounts: true,
  redactSecrets: true,
  redactNames: true,
  redactAddresses: true,
  redactNetwork: false,
  defaultCountry: 'US',
  sensitiveTerms: Object.freeze([]),
  blockTerms: Object.freeze([]),
});

const REQUIRED_FLAGS = ['redactEmails', 'redactPhones', 'redactCards', 'redactIdentifiers'];
const OPTIONAL_FLAGS = [
  'redactBankAccounts',
  'redactSecrets',
  'redactNames',
  'redactAddresses',
  'redactNetwork',
];
const POLICY_FIELDS = new Set([
  'sites',
  ...REQUIRED_FLAGS,
  ...OPTIONAL_FLAGS,
  'defaultCountry',
  'enabledRuleIds',
  'sensitiveTerms',
  'blockTerms',
]);
const DETECTION_FIELDS = new Set([...POLICY_FIELDS, 'phoneDefaultCountry']);
const SITE_FIELDS = new Set(['host', 'labels']);
const LABEL_ROLES = new Set(['composer', 'send', 'response']);

function plainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function knownFields(object, fields, label) {
  for (const key of Object.keys(object))
    if (!fields.has(key)) throw new Error(`Unknown ${label} field: ${key}.`);
}
// Decode ACE labels before URL processing. Some URL implementations accept an
// ASCII xn-- label without checking its decoded IDNA value. RFC 3492 decoding is
// bounded by the DNS label's 63-character limit, with explicit overflow checks.
// https://www.rfc-editor.org/rfc/rfc3492#section-6.2
function decodeAceLabel(label) {
  const input = label.slice(4);
  const separator = input.lastIndexOf('-');
  const output =
    separator < 0 ? [] : Array.from(input.slice(0, separator), (char) => char.charCodeAt(0));
  let cursor = separator < 0 ? 0 : separator + 1;
  let codePoint = 128,
    index = 0,
    bias = 72;
  if (cursor === input.length) return null;
  while (cursor < input.length) {
    const previous = index;
    let weight = 1;
    for (let position = 36; ; position += 36) {
      if (cursor === input.length) return null;
      const char = input.charCodeAt(cursor++);
      const digit =
        char >= 97 && char <= 122 ? char - 97 : char >= 48 && char <= 57 ? char - 22 : -1;
      if (digit < 0 || index > Number.MAX_SAFE_INTEGER - digit * weight) return null;
      index += digit * weight;
      const threshold = position <= bias ? 1 : position >= bias + 26 ? 26 : position - bias;
      if (digit < threshold) break;
      const factor = 36 - threshold;
      if (weight > Math.floor(Number.MAX_SAFE_INTEGER / factor)) return null;
      weight *= factor;
    }
    const count = output.length + 1;
    let delta = Math.floor((index - previous) / (previous === 0 ? 700 : 2));
    delta += Math.floor(delta / count);
    let adjustment = 0;
    while (delta > 455) {
      delta = Math.floor(delta / 35);
      adjustment += 36;
    }
    bias = adjustment + Math.floor((36 * delta) / (delta + 38));
    codePoint += Math.floor(index / count);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    index %= count;
    output.splice(index++, 0, codePoint);
  }
  return String.fromCodePoint(...output);
}
function validDecodedLabel(label) {
  // UTS #46 requires decoded ACE labels to be non-ASCII, NFC, and not begin
  // with a combining mark. Reject controls/noncharacters explicitly; roundtrip
  // the Unicode spelling below so ignored/mapped/disallowed values cannot hide
  // behind the runtime's ASCII ACE fast path.
  // https://www.unicode.org/reports/tr46/#Validity_Criteria
  if (!label) return false;
  const characters = Array.from(label);
  return Boolean(
    /[^\x00-\x7f]/u.test(label) &&
    label.normalize('NFC') === label &&
    !/^[\p{M}-]|-$|[\x00-\x20\x7f-\x9f\ufffd]/u.test(label) &&
    characters.slice(2, 4).join('') !== '--' &&
    characters.every((char) => {
      const point = char.codePointAt(0);
      return !(point >= 0xfdd0 && point <= 0xfdef) && (point & 0xffff) < 0xfffe;
    }),
  );
}
function validHost(host) {
  if (
    typeof host !== 'string' ||
    host.length > 253 ||
    host !== host.toLowerCase() ||
    !/^[a-z0-9.-]+$/.test(host)
  )
    return false;
  const labels = host.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  )
    return false;
  const suffix = labels.at(-1);
  if (!/^[a-z]{2,63}$/.test(suffix) && !/^xn--[a-z0-9-]+$/.test(suffix)) return false;
  const unicodeLabels = labels.map((label) =>
    label.startsWith('xn--') ? decodeAceLabel(label) : label,
  );
  if (
    unicodeLabels.some(
      (label, index) => labels[index].startsWith('xn--') && !validDecodedLabel(label),
    )
  )
    return false;
  try {
    return new URL(`https://${unicodeLabels.join('.')}`).hostname === host;
  } catch {
    return false;
  }
}

function validateLabels(labels) {
  if (!plainObject(labels)) throw new Error('Site labels must be an object of literal text hints.');
  knownFields(labels, LABEL_ROLES, 'site labels');
  for (const [role, hints] of Object.entries(labels)) {
    if (
      !Array.isArray(hints) ||
      hints.length > MAX_LABELS_PER_ROLE ||
      hints.some(
        (hint) =>
          typeof hint !== 'string' ||
          !hint ||
          hint !== hint.trim() ||
          hint.length > MAX_LABEL_LENGTH ||
          /[\u0000-\u001f\u007f]/.test(hint),
      )
    )
      throw new Error(
        `${role} labels must contain at most ${MAX_LABELS_PER_ROLE} nonempty literal text hints of up to ${MAX_LABEL_LENGTH} characters.`,
      );
    const canonicalHints = hints.map((hint) => hint.normalize('NFKC').toLowerCase());
    if (new Set(canonicalHints).size !== canonicalHints.length)
      throw new Error(`Duplicate literal text hints in ${role} labels.`);
  }
}

function validateRuleSelection(ids) {
  if (ids === undefined) return;
  if (
    !Array.isArray(ids) ||
    ids.length > Object.keys(RULES_BY_ID).length ||
    ids.some((id) => typeof id !== 'string' || !Object.hasOwn(RULES_BY_ID, id))
  )
    throw new Error('enabledRuleIds must contain known local detector IDs.');
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate detector IDs in enabledRuleIds.');
}
function validateTerms(terms, key, required) {
  if (terms === undefined && !required) return;
  if (
    !Array.isArray(terms) ||
    terms.length > MAX_TERMS ||
    terms.some((term) => typeof term !== 'string' || !term.trim() || term.length > MAX_TERM_LENGTH)
  )
    throw new Error(
      `${key} must contain at most ${MAX_TERMS} nonempty strings of up to ${MAX_TERM_LENGTH} characters.`,
    );
  if (new Set(terms).size !== terms.length) throw new Error(`Duplicate terms in ${key}.`);
}

// The scanner also supports partial detection options for local previews and
// focused rule checks. It never requires browser/provider configuration.
export function validateDetectionOptions(options) {
  if (!plainObject(options)) throw new Error('Detection options must be a plain object.');
  knownFields(options, DETECTION_FIELDS, 'detection option');
  for (const key of [...REQUIRED_FLAGS, ...OPTIONAL_FLAGS])
    if (options[key] !== undefined && typeof options[key] !== 'boolean')
      throw new Error(`Invalid ${key}.`);
  for (const key of ['defaultCountry', 'phoneDefaultCountry'])
    if (options[key] !== undefined && !isSupportedCountryCode(options[key]))
      throw new Error('Default country must be a supported uppercase two-letter region code.');
  validateRuleSelection(options.enabledRuleIds);
  for (const key of ['sensitiveTerms', 'blockTerms']) validateTerms(options[key], key, false);
  return options;
}

export function validatePolicy(policy) {
  if (!plainObject(policy)) throw new Error('Policy must be a plain object.');
  knownFields(policy, POLICY_FIELDS, 'policy');
  if (!Array.isArray(policy.sites) || !policy.sites.length || policy.sites.length > MAX_SITES)
    throw new Error(`Configure between 1 and ${MAX_SITES} sites.`);
  const hosts = new Set();
  for (const site of policy.sites) {
    if (!plainObject(site)) throw new Error('Each site must be an object.');
    knownFields(site, SITE_FIELDS, 'site');
    if (!validHost(site.host))
      throw new Error(
        'Use an exact lowercase hostname, without a URL, wildcard, port or trailing dot.',
      );
    if (hosts.has(site.host)) throw new Error(`Duplicate site hostname: ${site.host}.`);
    hosts.add(site.host);
    if (Object.hasOwn(site, 'labels')) validateLabels(site.labels);
  }
  for (const key of REQUIRED_FLAGS)
    if (!Object.hasOwn(policy, key) || typeof policy[key] !== 'boolean')
      throw new Error(`Invalid ${key}.`);
  // These fields are optional for compatibility with policies from version 0.1.
  validateDetectionOptions(policy);
  for (const key of ['sensitiveTerms', 'blockTerms']) validateTerms(policy[key], key, true);
  // Validation is deliberately side-effect-free and preserves the caller's object.
  return policy;
}
