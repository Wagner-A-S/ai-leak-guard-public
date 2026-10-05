import { findPhoneNumbersInText } from '../../vendor/libphonenumber.js';
import { RULES, RULES_BY_ID } from './detectors/rules.js';
import { SECRET_PATTERNS, LABEL_PATTERNS } from './detectors/patterns.js';
import { scanRegional } from './detectors/regional.js';
import {
  IBAN_LENGTHS,
  luhn,
  validIban,
  validSsn,
  validSnils,
  validSpanishId,
  validCodiceFiscale,
  validAadhaar,
  validIpv4,
  validIpv6,
} from './detectors/validators.js';
import { validateDetectionOptions } from './policy.js';
import { MAX_SCAN_LENGTH, MAX_FINDINGS } from './limits.js';

export { RULES, RULES_BY_ID } from './detectors/rules.js';
export { MAX_SCAN_LENGTH } from './limits.js';
const nextField = new RegExp(
  `^[ \\t]+(?:${Object.values(LABEL_PATTERNS)
    .map((expression) => expression.source)
    .join('|')})`,
  'iu',
);

function enabledRule(rule, policy, selection) {
  let enabled = policy[rule.policyGroup];
  // Older policies controlled credentials with identifiers and banks with cards.
  if (enabled === undefined && rule.policyGroup === 'redactSecrets')
    enabled = policy.redactIdentifiers;
  if (enabled === undefined && rule.policyGroup === 'redactBankAccounts')
    enabled = policy.redactCards;
  if (enabled === undefined) enabled = rule.policyGroup !== 'redactNetwork';
  return enabled !== false && (!selection || selection.has(rule.id));
}

function eachMatch(text, regex, callback) {
  // Fresh expression: global lastIndex cannot leak between scans.
  for (const match of text.matchAll(new RegExp(regex.source, regex.flags))) callback(match);
}

function labeledValue(text, match, stopAtComma = true) {
  const start = match.index + match[0].length;
  if (start >= text.length) return null;
  const quote = /["']$/.test(match[0]) ? match[0].at(-1) : null;
  let end = start;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
    const character = text[end];
    // Keep adjacent named fields separate, with a bounded lookahead rather than
    // rescanning the remainder of a long line for every label.
    if (!quote && (character === ' ' || character === '\t')) {
      let following = end + 1;
      while (text[following] === ' ' || text[following] === '\t') following++;
      if (nextField.test(` ${text.slice(following, following + 180)}`)) break;
      end = following;
      continue;
    }
    if (quote && character === '\\' && end + 1 < text.length) {
      end += 2;
      continue;
    }
    if (quote ? character === quote : character === ';' || (stopAtComma && character === ','))
      break;
    end++;
  }
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end > start ? { start, end, value: text.slice(start, end) } : null;
}

function decodeJsonPart(value) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const object = JSON.parse(decoded);
    return object && typeof object === 'object' && !Array.isArray(object) ? object : null;
  } catch {
    return null;
  }
}

function mergeOverlaps(text, findings) {
  findings.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  for (const finding of findings) {
    const last = selected.at(-1);
    if (!last || finding.start >= last.end) {
      selected.push({ ...finding, ruleIds: [finding.ruleId], kinds: [finding.kind] });
      continue;
    }
    // Merge the complete union, including chained/partially overlapping matches.
    // Dropping a shorter overlap can expose a sensitive suffix or prefix.
    last.end = Math.max(last.end, finding.end);
    last.value = text.slice(last.start, last.end);
    if (!last.ruleIds.includes(finding.ruleId)) last.ruleIds.push(finding.ruleId);
    if (!last.kinds.includes(finding.kind)) last.kinds.push(finding.kind);
  }
  return selected;
}

/**
 * Scan local text with partial detection options or a complete validated policy.
 * Findings contain original values and UTF-16 offsets; keep them in trusted local
 * code. Invalid options, metadata failures and exceeded budgets throw so callers
 * can block transmission instead of accepting a partial scan.
 */
export function scan(input, policy = {}) {
  validateDetectionOptions(policy);
  const text = String(input ?? '');
  if (text.length > MAX_SCAN_LENGTH)
    throw new Error(
      `Text exceeds the local scanner limit of ${MAX_SCAN_LENGTH.toLocaleString('en-US')} characters.`,
    );
  const findings = [];
  const append = (finding) => {
    if (findings.length >= MAX_FINDINGS)
      throw new Error(
        `Local scanner match limit (${MAX_FINDINGS}) exceeded. Shorten the input or narrow the custom terms.`,
      );
    findings.push(finding);
  };
  const selection = Array.isArray(policy.enabledRuleIds) ? new Set(policy.enabledRuleIds) : null;
  const isEnabled = (id) => enabledRule(RULES_BY_ID[id], policy, selection);
  const add = (id, start, end, details = {}) => {
    if (end <= start || !isEnabled(id)) return;
    const rule = RULES_BY_ID[id];
    append({
      kind: rule.kind,
      ruleId: id,
      category: rule.category,
      title: rule.title,
      method: rule.method,
      start,
      end,
      value: text.slice(start, end),
      ...details,
    });
  };
  const pattern = (id, regex, validator = () => true) => {
    if (isEnabled(id))
      eachMatch(text, regex, (match) => {
        if (validator(match[0])) add(id, match.index, match.index + match[0].length);
      });
  };
  const literal = (terms, kind) => {
    if (!Array.isArray(terms)) return;
    // Unicode-aware case folding may change a string's length. An escaped regex
    // retains exact original UTF-16 offsets used by the DOM.
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // A lookahead also finds overlapping occurrences of the same literal.
      eachMatch(text, new RegExp(`(?=(${escaped}))`, 'giu'), (m) =>
        append({
          kind,
          ruleId: kind === 'BLOCK' ? 'custom.block' : 'custom.sensitive',
          category: 'custom',
          title: kind === 'BLOCK' ? 'Prohibited term' : 'Sensitive term',
          method: 'literal',
          start: m.index,
          end: m.index + m[1].length,
          value: m[1],
        }),
      );
    }
  };
  literal(policy.blockTerms, 'BLOCK');
  literal(policy.sensitiveTerms, 'PRIVATE');
  scanRegional(text, isEnabled, add);

  if (isEnabled('email.standard'))
    eachMatch(
      text,
      /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}\p{N}]{2,}(?![\p{L}\p{N}-])/giu,
      (m) => {
        // user:password@host is URL userinfo, not password@host as an email address.
        // The URL detector protects the userinfo without masking the destination host.
        const prefix = text.slice(Math.max(0, m.index - 2048), m.index);
        if (
          isEnabled('secret.url_credentials') &&
          prefix.includes('://') &&
          /[a-z][a-z0-9+.-]*:\/\/[^\s/<>"']*$/i.test(prefix)
        )
          return;
        add('email.standard', m.index, m.index + m[0].length);
      },
    );
  pattern(
    'email.obfuscated',
    /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+[ \t]*(?:\[at\]|\(at\))[ \t]*[\p{L}\p{N}-]+(?:(?:[ \t]*(?:\[dot\]|\(dot\))[ \t]*|\.)[\p{L}\p{N}-]+)+(?![\p{L}\p{N}-])/giu,
  );

  if (isEnabled('phone.international')) {
    const defaultCountry = policy.defaultCountry || policy.phoneDefaultCountry || 'US';
    // Normalize one-code-unit Unicode spaces without changing original offsets.
    const phoneText = text.replace(/[\u00a0\u202f\u2000-\u200a\u3000]/g, ' ');
    for (const match of findPhoneNumbersInText(phoneText, { defaultCountry, extended: true })) {
      const value = text.slice(match.startsAt, match.endsAt);
      const valid = match.number.isValid();
      // Explicit international prefixes also protect possible-length numbers
      // in reserved/new allocations which full metadata marks unassigned.
      if (!valid && !(value.startsWith('+') && match.number.isPossible())) continue;
      const digits = value.replace(/\D/g, '');
      // Unmarked compact integers are ambiguous with order IDs. International
      // '+' or conventional punctuation is required outside labeled fields.
      if (!value.startsWith('+') && !/[\s().-]/.test(value)) continue;
      if (
        digits.length < 7 ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) ||
        /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(value)
      )
        continue;
      add('phone.international', match.startsAt, match.endsAt, {
        validation: valid ? 'valid-format' : 'possible-length',
      });
    }
  }
  pattern('card.payment', /(?<![\w.])\d(?:[ -]?\d){12,18}(?![ -]?\d|\w|\.\d)/g, (value) => {
    const digits = value.replace(/\D/g, '');
    return /^[2-6]/.test(digits) && luhn(value);
  });
  if (isEnabled('bank.iban'))
    eachMatch(text, /\b[A-Z]{2}\d{2}/gi, (m) => {
      const length = IBAN_LENGTHS[m[0].slice(0, 2).toUpperCase()];
      if (!length) return;
      let end = m.index + 4,
        count = 4;
      while (end < text.length && count < length) {
        const c = text[end];
        if (/[A-Za-z0-9]/.test(c)) {
          count++;
          end++;
        } else if (/[ \t\u00a0-]/.test(c)) end++;
        else break;
      }
      if (
        count === length &&
        !/[A-Za-z0-9]/.test(text[end] || '') &&
        validIban(text.slice(m.index, end))
      )
        add('bank.iban', m.index, end);
    });

  pattern('id.us_ssn', /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, validSsn);
  pattern(
    'id.uk_nino',
    /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[ABCEGHJKLMNPRSTWXYZ][ABCEGHJKLMNPRSTWXYZ][ \t]?\d{2}[ \t]?\d{2}[ \t]?\d{2}[ \t]?[ABCD]\b/gi,
  );
  pattern('id.ru_snils', /(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)/g, validSnils);
  pattern('id.eu_tax', /\b(?:\d{8}|[XYZ]\d{7})[A-Z]\b/gi, validSpanishId);
  pattern(
    'id.eu_tax',
    /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi,
    validCodiceFiscale,
  );
  // Compact PESEL cannot reliably be distinguished from document/order numbers;
  // it is protected by its label, not scanned as an arbitrary eleven-digit ID.
  pattern('id.india_aadhaar', /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d)/g, validAadhaar);

  for (const [id, expressions] of Object.entries(SECRET_PATTERNS))
    for (const expression of expressions) pattern(id, expression);
  pattern(
    'secret.jwt',
    /(?<![\w-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![\w-])/g,
    (value) => {
      const [header, payload] = value.split('.');
      const jsonHeader = decodeJsonPart(header);
      return Boolean(jsonHeader && typeof jsonHeader.alg === 'string' && decodeJsonPart(payload));
    },
  );
  if (isEnabled('secret.private_key'))
    eachMatch(
      text,
      /-----BEGIN (?:(?:ENCRYPTED|RSA|DSA|EC|OPENSSH|PGP) )?PRIVATE KEY(?: BLOCK)?-----/g,
      (m) => {
        const keyType = m[0].slice('-----BEGIN '.length, -5);
        const marker = `-----END ${keyType}-----`;
        const closing = text.indexOf(marker, m.index + m[0].length);
        // Incomplete private keys protect the complete available material too.
        add('secret.private_key', m.index, closing === -1 ? text.length : closing + marker.length);
      },
    );
  if (isEnabled('secret.url_credentials')) {
    eachMatch(text, /\b[a-z][a-z0-9+.-]*:\/\/([^\s/<>"']+)@/gi, (m) => {
      const start = m.index + m[0].indexOf('://') + 3;
      add('secret.url_credentials', start, start + m[1].length);
    });
    eachMatch(
      text,
      /[?&](?:api_?key|access_?token|refresh_?token|auth_?token|token|secret|password|passwd|client_?secret|signature|sig)=([^&#\s"']+)/gi,
      (m) => {
        const start = m.index + m[0].indexOf('=') + 1;
        add('secret.url_credentials', start, start + m[1].length);
      },
    );
  }
  // Bearer headers in prose/logs often omit "Authorization:".
  if (isEnabled('secret.bearer'))
    eachMatch(text, /\b(?:Bearer|Basic)[ \t]+([A-Za-z0-9+/_=.-]{8,})/gi, (m) => {
      const start = m.index + m[0].length - m[1].length;
      add('secret.bearer', start, start + m[1].length);
    });

  for (const [id, expression] of Object.entries(LABEL_PATTERNS)) {
    if (!isEnabled(id)) continue;
    let coveredUntil = -1;
    eachMatch(text, expression, (m) => {
      if (m.index < coveredUntil) return;
      const field = labeledValue(
        text,
        m,
        !['address.labeled', 'secret.bearer', 'id.birth_date'].includes(id),
      );
      if (!field) return;
      coveredUntil = field.end;
      let value = field.value;
      if (
        /^(?:\[(?:redacted|masked|removed|hidden)\]|<(?:redacted|masked|removed|hidden)>|redacted|masked|\*+)$/i.test(
          value,
        )
      )
        return;
      if (id === 'email.labeled') {
        const email = /^[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/u.exec(value);
        if (email) add(id, field.start, field.start + email[0].length);
      } else if (id === 'phone.labeled') {
        const phone =
          /^\+?\d[\d \t\u00a0\u202f\u2000-\u200a\u3000().-]*(?:(?:[ \t\u00a0\u202f\u2000-\u200a\u3000]*(?:ext\.?|extension|x|#))[ \t\u00a0\u202f\u2000-\u200a\u3000]*\d+)?/i.exec(
            value,
          ) ||
          /^\(\d{2,4}\)[\d \t\u00a0\u202f\u2000-\u200a\u3000().-]*(?:(?:[ \t\u00a0\u202f\u2000-\u200a\u3000]*(?:ext\.?|extension|x|#))[ \t\u00a0\u202f\u2000-\u200a\u3000]*\d+)?/i.exec(
            value,
          );
        if (phone) {
          value = phone[0].trimEnd();
          if (value.replace(/\D/g, '').length >= 5)
            add(id, field.start, field.start + value.length);
        }
      } else if (id === 'card.contextual') {
        const card = /^\d[\d -]*/.exec(value);
        if (card) {
          value = card[0].trimEnd();
          const count = value.replace(/\D/g, '').length;
          if (
            (count >= 12 && count <= 19) ||
            (/(?:cvv|cvc|pin)/i.test(m[0]) && count >= 3 && count <= 8)
          )
            add(id, field.start, field.start + value.length);
        }
      } else if (id === 'person.name') {
        if (value.length <= 160 && /\p{L}/u.test(value) && !/[@/={}<>]/.test(value))
          add(id, field.start, field.end);
      } else if (id === 'address.labeled') {
        if (value.length >= 4 && !/^https?:\/\//i.test(value)) add(id, field.start, field.end);
      } else if (id === 'id.birth_date') {
        if (value.length >= 4 && value.length <= 100 && /\d/.test(value))
          add(id, field.start, field.end);
      } else if (id === 'secret.assignment') {
        if (/[?&]/.test(text[m.index - 1] || '')) {
          const separator = value.search(/[&#]/);
          if (separator !== -1) {
            value = value.slice(0, separator);
            field.end = field.start + value.length;
          }
        }
        if (
          value.length >= 1 &&
          !/^(?:null|undefined|true|false|none|<redacted>|\[redacted\])$/i.test(value)
        )
          add(id, field.start, field.end);
      } else if (id === 'secret.bearer') {
        const prefix = /^(?:Bearer|Basic)[ \t]+/i.exec(value);
        const start = field.start + (prefix ? prefix[0].length : 0);
        if (field.end > start) add(id, start, field.end);
      } else {
        const identifier = /^[\p{L}\p{N}][\p{L}\p{N} .\/-]*/u.exec(value);
        if (identifier) {
          value = identifier[0].trimEnd();
          // Labels protect malformed identifiers, but ordinary prose is not an ID.
          if (/\d/.test(value) && value.length >= 3 && value.length <= 100)
            add(id, field.start, field.start + value.length);
        }
      }
    });
  }

  pattern('network.ip_address', /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/g, validIpv4);
  pattern(
    'network.ip_address',
    /(?<![\w:])(?:[A-Fa-f0-9]{0,4}:){2,7}(?:[A-Fa-f0-9]{0,4}|(?:\d{1,3}\.){3}\d{1,3})(?:%[\w.-]{1,32})?(?![\w:])/g,
    validIpv6,
  );
  pattern('network.ip_address', /\b(?:[A-Fa-f0-9]{2}[:-]){5}[A-Fa-f0-9]{2}\b/g);

  if (findings.some((f) => f.kind === 'BLOCK'))
    return { blocked: true, findings: mergeOverlaps(text, findings) };
  return { blocked: false, findings: mergeOverlaps(text, findings) };
}

/** Replace findings with session tokens; a failed scan leaves the vault intact. */
export function redact(text, policy, vault, nonce) {
  const result = scan(text, policy);
  if (result.blocked) return result;
  const existing = new Map(Object.entries(vault).map(([token, value]) => [value, token]));
  const inputTokens = new Set(text.match(/\[\[LG_[a-zA-Z0-9_-]+\]\]/g) || []);
  let sequence = Object.keys(vault).length + 1;
  let output = '',
    offset = 0;
  for (const finding of result.findings) {
    let token = existing.get(finding.value);
    if (!token) {
      do {
        token = `[[LG_${nonce}_${finding.kind}_${sequence++}]]`;
      } while (Object.hasOwn(vault, token) || inputTokens.has(token));
      vault[token] = finding.value;
      existing.set(finding.value, token);
    }
    output += text.slice(offset, finding.start) + token;
    offset = finding.end;
  }
  return { ...result, text: output + text.slice(offset) };
}

/** Restore known session tokens exactly once inside a trusted private surface. */
export function restore(text, vault) {
  return restoreResponse(text, vault).text;
}

/** Return restoration counts without exposing the private mapping. */
export function restoreResponse(text, vault) {
  if (typeof text !== 'string') throw new Error('The AI response must be text.');
  const limitMessage = `Response exceeds the local restoration limit of ${MAX_SCAN_LENGTH.toLocaleString('en-US')} characters. Restore a shorter section.`;
  if (text.length > MAX_SCAN_LENGTH) throw new Error(limitMessage);
  const chunks = [];
  let offset = 0,
    outputLength = 0,
    restoredCount = 0,
    unresolvedCount = 0;
  // Single pass: recovered values cannot cause recursive token substitution.
  for (const match of text.matchAll(/\[\[LG_[a-zA-Z0-9_-]+\]\]/g)) {
    const token = match[0];
    const known = Object.hasOwn(vault, token);
    const value = known ? vault[token] : token;
    if (typeof value !== 'string') throw new Error('The private restoration mapping is invalid.');
    outputLength += match.index - offset + value.length;
    // Check expansion before appending a private value or allocating the joined result.
    if (outputLength > MAX_SCAN_LENGTH) throw new Error(limitMessage);
    chunks.push(text.slice(offset, match.index), value);
    offset = match.index + token.length;
    if (known) restoredCount++;
    else unresolvedCount++;
  }
  outputLength += text.length - offset;
  if (outputLength > MAX_SCAN_LENGTH) throw new Error(limitMessage);
  chunks.push(text.slice(offset));
  return { text: chunks.join(''), restoredCount, unresolvedCount };
}
