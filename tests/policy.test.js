import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, validatePolicy } from '../src/core/policy.js';
import { COUNTRY_CODES, isSupportedCountryCode } from '../src/core/country-codes.js';
import {
  MAX_SITES,
  MAX_LABELS_PER_ROLE,
  MAX_LABEL_LENGTH,
  MAX_TERMS,
  MAX_TERM_LENGTH,
} from '../src/core/limits.js';
import { getCountries } from '../vendor/libphonenumber.js';

const policy = (overrides) => ({ ...structuredClone(DEFAULT_POLICY), ...overrides });
test('pure policy validation returns the original valid object without mutations', () => {
  const value = policy();
  const before = structuredClone(value);
  assert.equal(validatePolicy(value), value);
  assert.deepEqual(value, before);
  assert.equal(validatePolicy(DEFAULT_POLICY), DEFAULT_POLICY);
  assert.ok(Object.isFrozen(DEFAULT_POLICY.sites[0]));
});
test('supports legacy optional groups while rejecting malformed booleans', () => {
  const value = policy();
  for (const key of [
    'redactBankAccounts',
    'redactSecrets',
    'redactNames',
    'redactAddresses',
    'redactNetwork',
    'defaultCountry',
  ])
    delete value[key];
  assert.equal(validatePolicy(value), value);
  for (const key of [
    'redactEmails',
    'redactPhones',
    'redactCards',
    'redactIdentifiers',
    'redactBankAccounts',
    'redactSecrets',
    'redactNames',
    'redactAddresses',
    'redactNetwork',
  ])
    assert.throws(() => validatePolicy(policy({ [key]: 'true' })), /Invalid/);
});
test('rejects unknown fields and non-object policy/site records', () => {
  for (const value of [null, [], new Date(), 42, 'policy'])
    assert.throws(() => validatePolicy(value));
  assert.throws(() => validatePolicy(policy({ redactPhoness: true })), /Unknown policy field/);
  assert.throws(
    () => validatePolicy(policy({ sites: [{ ...DEFAULT_POLICY.sites[0], wildcard: true }] })),
    /Unknown site field/,
  );
  assert.throws(() => validatePolicy(policy({ sites: [null] })), /site must/);
});
test('accepts exact canonical domains and rejects ambiguous site authorization', () => {
  for (const host of ['ai.example.com', 'ai-tools.example.com', 'xn--e1afmkfd.xn--p1ai'])
    assert.doesNotThrow(() =>
      validatePolicy(policy({ sites: [{ ...DEFAULT_POLICY.sites[0], host }] })),
    );
  for (const host of [
    'ChatGPT.com',
    'https://chatgpt.com',
    '*.example.com',
    'example.com.',
    'example.com:443',
    'user@example.com',
    'example..com',
    '-ai.example.com',
    'ai-.example.com',
    'xn--a.com',
    'a'.repeat(64) + '.example.com',
  ])
    assert.throws(
      () => validatePolicy(policy({ sites: [{ ...DEFAULT_POLICY.sites[0], host }] })),
      /hostname/,
    );
  assert.throws(
    () => validatePolicy(policy({ sites: [DEFAULT_POLICY.sites[0], DEFAULT_POLICY.sites[0]] })),
    /Duplicate site/,
  );
  assert.throws(() => validatePolicy(policy({ sites: [] })));
  assert.throws(() =>
    validatePolicy(
      policy({
        sites: Array.from({ length: MAX_SITES + 1 }, (_, i) => ({
          ...DEFAULT_POLICY.sites[0],
          host: `ai${i}.example.com`,
        })),
      }),
    ),
  );
});
test('decoded IDNA values reject controls, malformed Punycode and noncanonical Unicode across URL runtimes', () => {
  for (const host of [
    'xn--a.com', // U+0080: accepted by Node 24's ASCII URL fast path.
    'xn--fa.com', // U+0085, a C1 control.
    'xn--5a.com', // U+009F, a C1 control.
    'xn--ib9b.com', // A surrogate rather than a Unicode scalar value.
    'xn--266c.com', // U+FDD0, a noncharacter.
    'xn--zn7c.com', // U+FFFD, a replacement character.
    'xn--lsa.com', // A leading combining mark.
    'xn--e-xbb.com', // Decomposed e + acute instead of required NFC.
    'xn--a-qgn.com', // A zero-width character that Unicode URL processing ignores.
    'xn--kba.com', // A soft hyphen that Unicode URL processing ignores.
    'xn--ab-r13a.com', // An encoded fullwidth dot must not add a host label.
    'xn--a--b-uv63c.com', // An astral character precedes hyphens at codepoint positions 3/4.
    'xn--9.com', // An incomplete generalized integer.
    `xn--${'9'.repeat(59)}.com`, // Oversized decoding arithmetic in a DNS-sized label.
  ])
    assert.throws(() => validatePolicy(policy({ sites: [{ host }] })), /hostname/);
  for (const host of [
    'xn--bcher-kva.de',
    'xn--9ca.com',
    'xn--e1afmkfd.xn--p1ai',
    'xn--ls8h.com',
    'xn----ab-uv63c.com',
  ])
    assert.doesNotThrow(() => validatePolicy(policy({ sites: [{ host }] })));
});
test('defaults and submitted sites use hosts and optional literal labels without selectors', () => {
  for (const site of DEFAULT_POLICY.sites) assert.deepEqual(Object.keys(site), ['host']);
  const value = policy({
    sites: [
      {
        host: 'ai.example.com',
        labels: {
          composer: ['Message', 'Ваш вопрос'],
          send: ['Send', 'Submit message'],
          response: ['Assistant response'],
        },
      },
    ],
  });
  assert.equal(validatePolicy(value), value);
  assert.doesNotThrow(() =>
    validatePolicy(policy({ sites: [{ host: 'ai.example.com', labels: {} }] })),
  );
  for (const role of ['composer', 'send', 'response'])
    assert.throws(
      () => validatePolicy(policy({ sites: [{ host: 'ai.example.com', [role]: 'button.send' }] })),
      /Unknown site field/,
    );
});
test('validates literal label arrays, lengths, roles and duplicate hints', () => {
  for (const labels of [
    null,
    [],
    'Send',
    { query: ['Send'] },
    { send: 'Send' },
    { send: [''] },
    { send: [' Send '] },
    { send: [null] },
    { send: ['\u0000Send'] },
    { send: ['a'.repeat(MAX_LABEL_LENGTH + 1)] },
    { send: Array.from({ length: MAX_LABELS_PER_ROLE + 1 }, (_, i) => `Send ${i}`) },
    { send: ['Send', 'send'] },
  ])
    assert.throws(
      () => validatePolicy(policy({ sites: [{ host: 'ai.example.com', labels }] })),
      /labels|literal text hints/,
    );
  assert.doesNotThrow(() =>
    validatePolicy(policy({ sites: [{ host: 'ai.example.com', labels: { send: [] } }] })),
  );
});
test('accepts real region codes from the exact bundled numbering metadata', () => {
  assert.deepEqual(COUNTRY_CODES, [...getCountries()].sort());
  for (const code of ['US', 'GB', 'RU', 'FR', 'DE', 'AU', 'XK'])
    assert.equal(isSupportedCountryCode(code), true);
  for (const code of ['ZZ', 'AA', 'us', 'USA', ''])
    assert.throws(() => validatePolicy(policy({ defaultCountry: code })), /region code/);
});
test('rejects unknown/duplicate rule IDs while allowing explicitly empty selection', () => {
  assert.doesNotThrow(() => validatePolicy(policy({ enabledRuleIds: [] })));
  assert.doesNotThrow(() =>
    validatePolicy(policy({ enabledRuleIds: ['email.standard', 'phone.international'] })),
  );
  for (const ids of [['email.typo'], ['constructor'], ['email.standard', 'email.standard'], [null]])
    assert.throws(() => validatePolicy(policy({ enabledRuleIds: ids })), /detector/);
});
test('validates custom-term budgets before a policy can be saved or loaded', () => {
  for (const key of ['sensitiveTerms', 'blockTerms']) {
    assert.throws(() => validatePolicy(policy({ [key]: [''] })), /nonempty/);
    assert.throws(() => validatePolicy(policy({ [key]: [null] })), /nonempty/);
    assert.throws(
      () => validatePolicy(policy({ [key]: ['x'.repeat(MAX_TERM_LENGTH + 1)] })),
      /nonempty/,
    );
    assert.throws(
      () =>
        validatePolicy(
          policy({ [key]: Array.from({ length: MAX_TERMS + 1 }, (_, i) => `fixture-${i}`) }),
        ),
      /at most/,
    );
    assert.throws(
      () => validatePolicy(policy({ [key]: ['Fixture', 'Fixture'] })),
      /Duplicate terms/,
    );
  }
});
