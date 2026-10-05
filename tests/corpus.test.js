import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildCorpus, luhnValid, ibanValid } from '../scripts/generate-samples.mjs';
import { scan, redact, restore } from '../src/core/redaction.js';
import { DEFAULT_POLICY } from '../src/core/policy.js';

const readJSON = async (filename) =>
  JSON.parse(await readFile(new URL(`../data/${filename}`, import.meta.url), 'utf8'));
const [manifest, positives, negatives, seeds] = await Promise.all([
  readJSON('manifest.json'),
  readJSON('positives.json'),
  readJSON('negatives.json'),
  readJSON('seeds.json'),
]);
const all = [...positives, ...negatives];
const policy = { ...DEFAULT_POLICY, ...manifest.policy, enabledRuleIds: undefined };

test('local corpus counts, categories, provenance and expected spans agree', () => {
  assert.ok(manifest.synthetic);
  assert.ok(
    manifest.total >= 10000,
    'Meaningful corpus must contain at least ten thousand records.',
  );
  assert.equal(manifest.total, all.length);
  assert.equal(manifest.positiveCount, positives.length);
  assert.equal(manifest.negativeCount, negatives.length);
  assert.equal(new Set(all.map((sample) => sample.id)).size, all.length, 'Sample ids are unique.');
  assert.equal(
    new Set(all.map((sample) => sample.text)).size,
    all.length,
    'Samples must have distinct text.',
  );
  const kinds = new Set([
    'EMAIL',
    'PHONE',
    'CARD',
    'IBAN',
    'BANK',
    'ID',
    'SECRET',
    'PERSON',
    'ADDRESS',
    'IP',
  ]);
  const categories = new Set(manifest.categories.map((category) => category.id));
  for (const sample of all) {
    assert.ok(categories.has(sample.category), sample.id);
    assert.equal(typeof sample.text, 'string', sample.id);
    assert.ok(Object.hasOwn(seeds.sources, sample.source), sample.id);
    assert.equal(typeof sample.seed, 'string', sample.id);
    let end = 0;
    for (const finding of sample.expected) {
      assert.ok(kinds.has(finding.kind), sample.id);
      assert.ok(finding.value.length, sample.id);
      const start = sample.text.indexOf(finding.value, end);
      assert.ok(start >= 0, `${sample.id}: expected values appear in text order.`);
      end = start + finding.value.length;
    }
  }
  for (const category of manifest.categories) {
    const records = all.filter((sample) => sample.category === category.id);
    assert.equal(category.count, records.length, category.id);
    assert.equal(
      category.seedCount,
      new Set(records.map((sample) => sample.seed)).size,
      category.id,
    );
    assert.equal(
      category.positiveCount,
      records.filter((sample) => sample.expected.length).length,
      category.id,
    );
  }
  assert.ok(negatives.every((sample) => sample.expected.length === 0));
  assert.ok(positives.every((sample) => sample.expected.length > 0));
  assert.ok(
    manifest.countries.includes('US') &&
      manifest.countries.includes('GB') &&
      manifest.countries.includes('AU'),
  );
});

test('corpus regenerates deterministically offline and matches saved checksums', async () => {
  const regenerated = await buildCorpus();
  assert.deepEqual(regenerated.manifest, manifest);
  assert.deepEqual(regenerated.positives, positives);
  assert.deepEqual(regenerated.negatives, negatives);
  for (const file of Object.values(manifest.files)) {
    const content = await readFile(new URL(`../data/${file.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, file.path);
  }
});

test('curated financial seeds validate and phone/email fixtures use safe sources', () => {
  assert.ok(seeds.cards.length >= 80, 'Curated payment card seed diversity.');
  assert.ok(seeds.ibans.length >= 25, 'Curated banking seed diversity.');
  for (const card of seeds.cards) assert.ok(luhnValid(card.number), card.number);
  for (const iban of seeds.ibans) assert.ok(ibanValid(iban.number), iban.number);
  for (const sample of positives.filter((sample) => sample.category === 'id.ssn')) {
    const digits = sample.expected[0].value.replace(/\D/g, '');
    assert.ok(Number(digits.slice(0, 3)) >= 900 || digits.startsWith('666'), sample.id);
  }
  for (const sample of positives.filter((sample) => sample.category.startsWith('phone.'))) {
    assert.ok(
      ['nanpa', 'ofcom', 'acma', 'bnetza', 'arcep', 'synthetic'].includes(sample.source),
      sample.id,
    );
    if (sample.source === 'nanpa') {
      const digits = sample.expected[0].value
        .split(/ext\./i)[0]
        .replace(/\D/g, '')
        .replace(/^1(?=\d{10}$)/, '');
      assert.match(digits, /^\d{3}55501\d{2}$/, sample.id);
    }
  }
  for (const sample of positives.filter(
    (sample) => sample.category === 'email.reserved' || sample.category === 'email.unicode',
  )) {
    assert.match(
      sample.expected[0].value,
      /@(?:[a-z]+\.)?example\.(?:com|net|org|test)$/i,
      sample.id,
    );
  }
});

test('every positive fixture has its expected sensitive values protected', () => {
  const failures = [];
  for (const sample of positives) {
    const result = scan(sample.text, { ...policy, ...sample.policy });
    const actual = result.findings.map(({ kind, value }) => ({ kind, value }));
    if (result.blocked || JSON.stringify(actual) !== JSON.stringify(sample.expected)) {
      failures.push({ id: sample.id, text: sample.text, expected: sample.expected, actual });
    }
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length} positive fixture mismatches. First failures:\n${JSON.stringify(failures.slice(0, 12), null, 2)}`,
  );
});

test('negative fixtures pass without substituting ordinary prose and references', () => {
  const failures = [];
  for (const sample of negatives) {
    const result = scan(sample.text, { ...policy, ...sample.policy });
    if (result.blocked || result.findings.length)
      failures.push({
        id: sample.id,
        text: sample.text,
        actual: result.findings.map(({ kind, value }) => ({ kind, value })),
      });
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length} negative fixture mismatches. First failures:\n${JSON.stringify(failures.slice(0, 12), null, 2)}`,
  );
});

test('international phone fixtures are recognized without a field label', () => {
  const values = new Set(
    positives
      .filter((sample) => sample.category.startsWith('phone.'))
      .flatMap((sample) => sample.expected.map((finding) => finding.value))
      .filter((value) => value.startsWith('+')),
  );
  const failures = [];
  for (const value of values) {
    const actual = scan(value, policy).findings.map(({ kind, value }) => ({ kind, value }));
    if (JSON.stringify(actual) !== JSON.stringify([{ kind: 'PHONE', value }]))
      failures.push({ value, actual });
  }
  assert.ok(
    values.size >= 1500,
    'International format diversity should also exercise validation without labels.',
  );
  assert.equal(
    failures.length,
    0,
    `${failures.length} international phone misses. First failures:\n${JSON.stringify(failures.slice(0, 12), null, 2)}`,
  );
});

test('redaction round trips every corpus category and repeated/Unicode records', () => {
  const selected = new Map();
  for (const sample of positives) {
    if (!selected.has(sample.category)) selected.set(sample.category, sample);
    if (sample.expected.length > 1 || sample.text.includes('\u202f') || sample.text.startsWith('{'))
      selected.set(sample.id, sample);
  }
  for (const sample of selected.values()) {
    const vault = {};
    const result = redact(sample.text, { ...policy, ...sample.policy }, vault, 'corpus');
    assert.equal(result.blocked, false, sample.id);
    assert.equal(restore(result.text, vault), sample.text, sample.id);
    for (const finding of sample.expected)
      assert.ok(!result.text.includes(finding.value), `${sample.id} leaked ${finding.kind}`);
    assert.ok(Object.keys(vault).length, sample.id);
  }
});
