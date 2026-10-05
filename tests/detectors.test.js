import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, redact, restore } from '../src/core/redaction.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
import { RULES } from '../src/core/detectors/rules.js';
import {
  luhn,
  validIban,
  validSsn,
  validIpv4,
  validIpv6,
} from '../src/core/detectors/validators.js';

const policy = {
  ...DEFAULT_POLICY,
  redactBankAccounts: true,
  redactSecrets: true,
  redactNames: true,
  redactAddresses: true,
  redactNetwork: false,
  sensitiveTerms: [],
  blockTerms: [],
};
const values = (text, overrides = {}) =>
  scan(text, { ...policy, ...overrides }).findings.map((f) => f.value);

test('all catalog rules have unique IDs and complete explanatory metadata', () => {
  assert.ok(RULES.length >= 40);
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES)
    for (const field of ['id', 'title', 'kind', 'category', 'policyGroup', 'method', 'description'])
      assert.equal(typeof r[field], 'string');
});
test('recognizes normal, obfuscated, Unicode and labeled internal email addresses', () => {
  const text =
    'jane@example.com; alex [at] example [dot] org; zoë@exämple.org; email: ops@intranet';
  assert.deepEqual(values(text), [
    'jane@example.com',
    'alex [at] example [dot] org',
    'zoë@exämple.org',
    'ops@intranet',
  ]);
});
test('uses international numbering metadata and preserves Unicode separator spans', () => {
  for (const number of [
    '+1 202 555 0101',
    '+44 20 7946 0001',
    '+49 30 23125 000',
    '+33 1 99 00 00 01',
    '+61 2 5550 0001',
    '+1\u2009212\u2009555\u20090100',
  ]) {
    assert.deepEqual(values(`Call ${number}`), [number], number);
  }
  assert.deepEqual(
    values('Phone: 06 39 98 00 01; Mobile: 2025550101; Tel: (202) 555-0101 ext. 42'),
    ['06 39 98 00 01', '2025550101', '(202) 555-0101 ext. 42'],
  );
  assert.deepEqual(values('Use the reserved drama mobile +44 7700 900000'), ['+44 7700 900000']);
  assert.equal(scan('+44 7700 900000', policy).findings[0].validation, 'possible-length');
});
test('does not classify dates, versions, orders or IP addresses as unmarked phones', () => {
  for (const text of [
    '2026-10-04',
    'version 1.2.3',
    '192.0.2.1',
    'order 2025550101',
    'reference 12345678901234567890',
    '900-00-0000',
    'amount 42.20',
    'value 1.6600000000000001',
  ])
    assert.deepEqual(values(text), [], text);
});
test('validates payment card Luhn and IBAN MOD-97 while protecting malformed labeled fields', () => {
  assert.deepEqual(
    values('4242 4242 4242 4242; GB29 NWBK 6016 1331 9268 19; DE89370400440532013000'),
    ['4242 4242 4242 4242', 'GB29 NWBK 6016 1331 9268 19', 'DE89370400440532013000'],
  );
  assert.deepEqual(values('4242424242424243; GB30NWBK60161331926819'), []);
  assert.deepEqual(
    values(
      'Card: 4242424242424243; CVV: 123; PIN: 1234; Account number: 000123456789; Sort code: 12-34-56',
    ),
    ['4242424242424243', '123', '1234', '000123456789', '12-34-56'],
  );
  assert.equal(luhn('4242424242424242'), true);
  assert.equal(luhn('4242424242424243'), false);
  assert.equal(validIban('GB29 NWBK 6016 1331 9268 19'), true);
  assert.equal(validIban('GB30 NWBK 6016 1331 9268 19'), false);
});
test('protects personal identifiers in labels without masking unrelated numeric IDs', () => {
  const text =
    'SSN: 999-00-0001; Passport: TEST-1234567; SIN: 000-000-000; Aadhaar: 0000 0000 0000; INN: 0000000000; NHS number: 0000000000';
  assert.deepEqual(values(text), [
    '999-00-0001',
    'TEST-1234567',
    '000-000-000',
    '0000 0000 0000',
    '0000000000',
    '0000000000',
  ]);
  assert.equal(validSsn('666-01-0001'), false);
  assert.equal(validSsn('123-45-6789'), true);
});
test('protects service-specific credential shapes, JSON passwords and authorization tokens', () => {
  // Assemble invented credential shapes locally; keep complete tokens out of source control.
  const credentials = [
    ['sk-proj-', 'TESTONLYabcdefghijklmnop'],
    ['AKIA', 'TESTONLY00000001'],
    ['ghp_', 'TESTONLYabcdefghijklmnopqrstuvwx'],
    ['glpat-', 'TESTONLYabcdefghijklmnop'],
    ['AIza', 'TESTONLYabcdefghijklmnopqrstuvwxy'],
    ['sk_test_', 'TESTONLYabcdefghijklmnop'],
    ['xoxb-', '123456789012-123456789012-', 'TESTONLYfixture'],
    ['npm_', 'TESTONLYabcdefghijklmnop'],
    ['hf_', 'TESTONLYabcdefghijklmnop'],
    ['shpat_', '0123456789abcdef0123456789abcdef'],
    ['SK', '0123456789abcdef0123456789abcdef'],
    ['SG.', 'TESTONLYabcdefghijklmnop.', 'TESTONLYabcdefghijklmnopqrstuvwx'],
  ].map((parts) => parts.join(''));
  for (const credential of credentials)
    assert.deepEqual(values(credential), [credential], credential);
  const text =
    '{"password":"TESTONLY\\"quoted\\"secret", "api_key":"TESTONLY_fixture"}\nAuthorization: Bearer TESTONLY_token_123456';
  assert.deepEqual(values(text), [
    'TESTONLY\\"quoted\\"secret',
    'TESTONLY_fixture',
    'TESTONLY_token_123456',
  ]);
});
test('recognizes JWT JSON structure and protects complete and incomplete private keys', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'fixture-user', exp: 9999999999 })).toString(
    'base64url',
  );
  const jwt = `${header}.${payload}.TESTONLY_signature_0123456789`;
  assert.deepEqual(values(jwt), [jwt]);
  assert.deepEqual(values('aaaaaaaa.bbbbbbbb.cccccccc'), []);
  const pem = '-----BEGIN PRIVATE KEY-----\nTESTONLY_not_a_real_key\n-----END PRIVATE KEY-----';
  assert.deepEqual(values(pem), [pem]);
  const incomplete = '-----BEGIN OPENSSH PRIVATE KEY-----\nTESTONLY_not_a_real_key';
  assert.deepEqual(values(incomplete), [incomplete]);
});
test('preserves URL hosts and ordinary query parameters around credentials', () => {
  assert.deepEqual(values('https://fixture:TESTONLYpass@example.com/private'), [
    'fixture:TESTONLYpass',
  ]);
  assert.deepEqual(values('https://example.com/path?api_key=TESTONLYquery&mode=fixture'), [
    'TESTONLYquery',
  ]);
  assert.deepEqual(values('https://example.com/path?mode=fixture&date=2026-10-04'), []);
});
test('protects labeled Unicode names and addresses and ignores redacted placeholders', () => {
  const text =
    'Name: Mira Testerton; Employee name: Zoë O’Fixture\nAddress: 812 Synthetic Way, Exampletown\n{"name":"Иван Примеров","address":"ул. Тестовая 42, Примерск"}';
  assert.deepEqual(values(text), [
    'Mira Testerton',
    'Zoë O’Fixture',
    '812 Synthetic Way, Exampletown',
    'Иван Примеров',
    'ул. Тестовая 42, Примерск',
  ]);
  assert.deepEqual(values('Name: [REDACTED]\nAddress: [MASKED]\nPassword: <redacted>'), []);
});
test('protects birth-date fields while leaving ordinary dates available', () => {
  assert.deepEqual(
    values(
      'DOB: 1980-01-01; Date of birth: 09/02/1990; Birth date: February 9, 1980\n{"date_of_birth":"2000-04-20"}',
    ),
    ['1980-01-01', '09/02/1990', 'February 9, 1980', '2000-04-20'],
  );
  assert.deepEqual(values('Meeting date: 2026-10-04'), []);
});
test('network protection is optional and validates address ranges', () => {
  assert.deepEqual(values('192.0.2.1 and 2001:db8::42'), []);
  assert.deepEqual(values('192.0.2.1. 2001:db8::42; 02:00:00:00:00:01', { redactNetwork: true }), [
    '192.0.2.1',
    '2001:db8::42',
    '02:00:00:00:00:01',
  ]);
  assert.deepEqual(values('999.10.20.30', { redactNetwork: true }), []);
  assert.equal(validIpv4('192.0.2.1'), true);
  assert.equal(validIpv4('256.0.2.1'), false);
  assert.equal(validIpv6('2001:db8::42'), true);
  assert.equal(validIpv6('2001:::42'), false);
});
test('rule selection and independent policy groups gate only their own detectors', () => {
  assert.deepEqual(
    values('a@example.com +1 202 555 0101', { enabledRuleIds: ['email.standard'] }),
    ['a@example.com'],
  );
  assert.deepEqual(values('a@example.com', { redactEmails: false }), []);
  assert.deepEqual(values('GB29NWBK60161331926819 4242424242424242', { redactCards: false }), [
    'GB29NWBK60161331926819',
  ]);
  assert.deepEqual(
    values('Passport: TEST-123456; password: TESTONLY', { redactIdentifiers: false }),
    ['TESTONLY'],
  );
  assert.deepEqual(values('password: TESTONLY', { redactSecrets: false }), []);
});
test('masking structured fields round trips without altered JSON structure', () => {
  const text = '{"name":"Mira Testerton","phone":"+1 202 555 0101","password":"TESTONLY_fixture"}';
  const vault = {};
  const r = redact(text, policy, vault, 'json');
  assert.equal(r.findings.length, 3);
  assert.doesNotThrow(() => JSON.parse(r.text));
  assert.equal(restore(r.text, vault), text);
});
test('long token and malformed PEM prefixes finish scanning without truncation', () => {
  const token = 'sk-proj-' + 'A'.repeat(100_000);
  assert.deepEqual(values(token), [token]);
  assert.deepEqual(values('-----BEGIN ' + 'A'.repeat(100_000)), []);
});
