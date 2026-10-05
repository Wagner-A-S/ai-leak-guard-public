import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, redact, restore, restoreResponse } from '../src/core/redaction.js';
import { DEFAULT_POLICY, validatePolicy } from '../src/core/policy.js';
import { MAX_FINDINGS, MAX_SCAN_LENGTH } from '../src/core/limits.js';
const policy = {
  ...DEFAULT_POLICY,
  sensitiveTerms: ['Jane Smith', 'Acme (private)'],
  blockTerms: ['DO NOT SEND'],
};
test('redacts and reverses sensitive values without changing surrounding text', () => {
  const text =
    'Jane Smith: jane@example.com, +1 415 555 2671, 123-45-6789, 4111 1111 1111 1111, Acme (private)';
  const vault = {};
  const result = redact(text, policy, vault, 'test');
  assert.equal(result.blocked, false);
  for (const value of [
    'Jane Smith',
    'jane@example.com',
    '415 555',
    '123-45-6789',
    '4111 1111',
    'Acme (private)',
  ])
    assert.ok(!result.text.includes(value));
  assert.equal(restore(result.text, vault), text);
});
test('blocks prohibited terms before creating any vault entries', () => {
  const vault = {};
  const r = redact('jane@example.com: do not send', policy, vault, 'test');
  assert.equal(r.blocked, true);
  assert.deepEqual(vault, {});
  assert.equal(r.text, undefined);
});
test('reuses tokens and keeps unknown response tokens intact', () => {
  const vault = {};
  const a = redact('jane@example.com', policy, vault, 'test');
  const b = redact('jane@example.com', policy, vault, 'test');
  assert.equal(a.text, b.text);
  assert.equal(Object.keys(vault).length, 1);
  assert.equal(restore('[[LG_other_EMAIL_1]]', vault), '[[LG_other_EMAIL_1]]');
});
test('restoration does not recursively interpret recovered values', () => {
  assert.equal(
    restore('[[LG_a_PRIVATE_1]]', {
      '[[LG_a_PRIVATE_1]]': '[[LG_b_PRIVATE_2]]',
      '[[LG_b_PRIVATE_2]]': 'secret',
    }),
    '[[LG_b_PRIVATE_2]]',
  );
});
test('pasted response restores repeated values and reports unknown session tokens', () => {
  const token = '[[LG_current_PERSON_1]]';
  const unknown = '[[LG_other_PERSON_1]]';
  const original = 'Иван Примеров 🧑';
  assert.deepEqual(
    restoreResponse(`**${token}**\nAgain: ${token}\nUnchanged: ${unknown}`, { [token]: original }),
    {
      text: `**${original}**\nAgain: ${original}\nUnchanged: ${unknown}`,
      restoredCount: 2,
      unresolvedCount: 1,
    },
  );
  assert.deepEqual(restoreResponse('An ordinary answer.', {}), {
    text: 'An ordinary answer.',
    restoredCount: 0,
    unresolvedCount: 0,
  });
});
test('restoration rejects nontext responses and oversized input without disclosing values', () => {
  for (const input of [null, 42, {}, ['answer']])
    assert.throws(() => restoreResponse(input, {}), /must be text/);
  assert.throws(
    () => restoreResponse('x'.repeat(MAX_SCAN_LENGTH + 1), {}),
    /local restoration limit/,
  );
  assert.equal(restoreResponse('x'.repeat(MAX_SCAN_LENGTH), {}).text.length, MAX_SCAN_LENGTH);
});
test('restoration bounds repeated expansion and trailing prose before constructing output', () => {
  const token = '[[LG_current_PRIVATE_1]]';
  const value = 'SYNTHETIC_PRIVATE_'.repeat(600);
  assert.throws(
    () => restoreResponse(token.repeat(200), { [token]: value }),
    (error) => /local restoration limit/.test(error.message) && !error.message.includes(value),
  );
  assert.throws(
    () => restoreResponse(token + 'x'.repeat(MAX_SCAN_LENGTH - token.length), { [token]: value }),
    /local restoration limit/,
  );
  assert.equal(
    restoreResponse(token, { [token]: 'x'.repeat(MAX_SCAN_LENGTH) }).text.length,
    MAX_SCAN_LENGTH,
  );
});
test('handles overlaps and detects API credentials', () => {
  const r = redact(
    'jane@example.com sk-abcdefghijklmnop12345678',
    { ...policy, sensitiveTerms: ['example.com'] },
    {},
    'test',
  );
  assert.equal(r.findings.length, 2);
  assert.ok(!r.text.includes('sk-'));
});
test('clean text passes without substitutions', () =>
  assert.deepEqual(scan('Explain recursion', policy), { blocked: false, findings: [] }));
test('rejects malformed policies and wildcard hosts', () => {
  assert.throws(() =>
    validatePolicy({ ...policy, sites: [{ ...policy.sites[0], host: '*.example.com' }] }),
  );
  assert.throws(() => validatePolicy({ ...policy, sensitiveTerms: [''] }));
  assert.equal(validatePolicy(policy), policy);
});
test('merges partial and chained overlaps without exposing a sensitive suffix', () => {
  const local = {
    ...policy,
    redactEmails: false,
    sensitiveTerms: ['alpha-beta', 'beta-gamma', 'gamma-delta'],
  };
  const text = 'prefix alpha-beta-gamma-delta suffix';
  const vault = {};
  const r = redact(text, local, vault, 'overlap');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].value, 'alpha-beta-gamma-delta');
  assert.equal(restore(r.text, vault), text);
  assert.ok(!r.text.includes('delta'));
});
test('protects overlapping repeated occurrences of one custom literal', () => {
  const text = '🙂ababa🙂';
  const vault = {};
  const r = redact(text, { enabledRuleIds: [], sensitiveTerms: ['aba'] }, vault, 'repeat');
  assert.equal(r.findings[0].value, 'ababa');
  assert.equal(restore(r.text, vault), text);
});
test('escapes literal custom terms and retains exact Unicode offsets', () => {
  const text = '🙂 A+B (private) İpek Åsa';
  const r = scan(text, { enabledRuleIds: [], sensitiveTerms: ['A+B (private)', 'İpek', 'Åsa'] });
  assert.deepEqual(
    r.findings.map((f) => f.value),
    ['A+B (private)', 'İpek', 'Åsa'],
  );
  for (const f of r.findings) assert.equal(text.slice(f.start, f.end), f.value);
});
test('keeps custom prohibited terms active when built-in detection is disabled', () => {
  assert.equal(
    scan('The restricted text', { enabledRuleIds: [], blockTerms: ['restricted'] }).blocked,
    true,
  );
});
test('preserves input tokens by avoiding placeholder collisions', () => {
  const text = '[[LG_test_EMAIL_1]] jane@example.com';
  const vault = {};
  const r = redact(text, policy, vault, 'test');
  assert.equal(Object.keys(vault)[0], '[[LG_test_EMAIL_2]]');
  assert.equal(restore(r.text, vault), text);
});
test('does not partially scan oversized input', () => {
  assert.throws(() => scan('x'.repeat(1_000_001), policy), /scanner limit/);
});
test('fails closed before creating vault entries when raw finding budget is exhausted', () => {
  const vault = {};
  assert.throws(
    () =>
      redact(
        'a'.repeat(MAX_FINDINGS + 1),
        { enabledRuleIds: [], sensitiveTerms: ['a'] },
        vault,
        'limit',
      ),
    /match limit/,
  );
  assert.deepEqual(vault, {});
});
test('rejects invalid scanner options instead of silently omitting protection', () => {
  assert.throws(() => scan('(202) 555-0101', { defaultCountry: 'ZZ' }), /region code/);
  assert.throws(
    () => scan('a@example.com', { enabledRuleIds: ['email.typo'] }),
    /known local detector/,
  );
  assert.throws(() => scan('a@example.com', { redactEmails: 'true' }), /Invalid redactEmails/);
});
test('email-only rule selection protects URL userinfo when URL protection is disabled', () => {
  assert.equal(
    scan('https://jane@example.com/private', { enabledRuleIds: ['email.standard'] }).findings[0]
      .value,
    'jane@example.com',
  );
});
