import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scan, redact, restore } from '../src/core/redaction.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';
import { GIVEN_NAMES } from '../src/core/detectors/regional.js';
import { parsePhoneNumberFromString } from '../vendor/libphonenumber.js';
const policy = { ...DEFAULT_POLICY, redactNetwork: false };
const regions = JSON.parse(
  await readFile(new URL('../data/regional-seeds.json', import.meta.url), 'utf8'),
).regions;
const actual = (text, overrides = {}) =>
  scan(text, { ...policy, ...overrides }).findings.map(({ kind, value }) => ({ kind, value }));

test('unlabeled German synthetic equivalents protect street, name and reserved phone', () => {
  const text = 'synthetische straße 42 Ferdinand Testfixturemann +49 30 23125 042';
  assert.deepEqual(actual(text), [
    { kind: 'ADDRESS', value: 'synthetische straße 42' },
    { kind: 'PERSON', value: 'Ferdinand Testfixturemann' },
    { kind: 'PHONE', value: '+49 30 23125 042' },
  ]);
  const vault = {};
  const r = redact(text, policy, vault, 'regional');
  assert.equal(restore(r.text, vault), text);
});
test('street heuristics require an explicit street marker and house number', () => {
  for (const value of [
    'Beispielstr.42a',
    'synthetische strasse 11-13',
    'ул. Синтетическая, д. 42, кв. 3',
    'вул. Синтетична 42',
    'Сынақ көшесі 42',
    'Sinov ko’chasi 42',
  ])
    assert.equal(actual(value)[0]?.value, value, value);
  for (const value of [
    'Die Straße ist gesperrt',
    'Der Weg zum Test',
    'Version 11.13',
    'Дата встречи: 2026-10-04',
    'Улица без номера',
  ])
    assert.deepEqual(actual(value), [], value);
});
test('names use packaged given tokens and capitalized surnames rather than arbitrary pairs', () => {
  assert.ok(GIVEN_NAMES.length >= 250);
  for (const value of [
    'Anna Testfixturemann',
    'ferdinand Testfixturemann',
    'Алексей Тестфикстуров',
    'Олексій Тестфікстуренко',
    'Данияр Сынақфикстуров',
    'Алексей Тестфикстуров Синтетикович',
  ])
    assert.equal(actual(value)[0]?.value, value, value);
  for (const value of [
    'Unknown Capitalized Words',
    'Mark Project roadmap',
    'Anna Report',
    'Ferdinand Version',
    'anna lowercase',
  ])
    assert.deepEqual(actual(value), [], value);
});
test('all twelve regions protect localized ID, name, address, birthdate and national phone labels', () => {
  assert.deepEqual(
    regions.map((region) => region.country),
    ['RU', 'BY', 'KZ', 'UA', 'MD', 'AM', 'AZ', 'GE', 'KG', 'TJ', 'TM', 'UZ'],
  );
  for (const region of regions) {
    const digits =
      region.country === 'TJ'
        ? '0'.repeat(region.nationalLength)
        : '0'.repeat(region.nationalLength - 4) + '0042';
    const values = [
      ['PHONE', region.phoneLabels[0], `0 ${digits}`],
      ['PERSON', region.nameLabels[0], region.name],
      ['ADDRESS', region.addressLabels[0], `${region.street} 42`],
      ['ID', region.idLabels[0], `TEST-${region.country}-0000042`],
      ['ID', region.birthLabel, '1980-01-01'],
    ];
    for (const [kind, label, value] of values)
      assert.deepEqual(
        actual(`${label}: ${value}`),
        [{ kind, value }],
        `${region.country}: ${label}`,
      );
    const international = `+${region.callingCode}${digits}`;
    // Tajik metadata accepts any possible-length mobile prefix; all-zero fixture
    // data avoids inventing individual subscriber values. Validity is not assignment.
    if (region.country !== 'TJ')
      assert.equal(
        parsePhoneNumberFromString(international).isValid(),
        false,
        'Fixture uses a deliberately invalid prefix',
      );
    else assert.match(digits, /^0+$/);
    assert.deepEqual(
      actual(international),
      [{ kind: 'PHONE', value: international }],
      region.country,
    );
  }
});
test('localized adjacent fields stay separate and JSON quote escapes stay inside values', () => {
  assert.deepEqual(
    actual('ФИО: Алексей Тестфикстуров ИИН: TEST-KZ-0000042 Телефон: +70000000042'),
    [
      { kind: 'PERSON', value: 'Алексей Тестфикстуров' },
      { kind: 'ID', value: 'TEST-KZ-0000042' },
      { kind: 'PHONE', value: '+70000000042' },
    ],
  );
  assert.deepEqual(actual('{"ПИНФЛ":"TEST-UZ-0000042","манзил":"Sinov ko\'chasi 42"}'), [
    { kind: 'ID', value: 'TEST-UZ-0000042' },
    { kind: 'ADDRESS', value: "Sinov ko'chasi 42" },
  ]);
});
test('new regional heuristics respect existing group switches and selected rule IDs', () => {
  const text = 'synthetische straße 42 Ferdinand Testfixturemann';
  assert.deepEqual(actual(text, { redactNames: false, redactAddresses: false }), []);
  assert.deepEqual(actual(text, { enabledRuleIds: ['person.lexicon'] }), [
    { kind: 'PERSON', value: 'Ferdinand Testfixturemann' },
  ]);
  assert.deepEqual(actual('ИИН: TEST-KZ-0000042', { redactIdentifiers: false }), []);
});
test('regional matching remains bounded on long malformed inputs', () => {
  for (const text of [
    'a'.repeat(100000),
    '-----BEGIN ' + 'A'.repeat(100000),
    'ул. ' + 'А'.repeat(100000),
    'имя: '.repeat(1000),
    'Name: A' + ' '.repeat(999900) + 'ordinary',
  ])
    assert.doesNotThrow(() => scan(text, policy));
});
