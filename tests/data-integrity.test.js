import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyData, DataIntegrityError } from '../scripts/verify-data.mjs';

const stringify = (value) => JSON.stringify(value, null, 2) + '\n';
const checksum = (text) => createHash('sha256').update(text).digest('hex');

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ai-leak-guard-catalog-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sources = {
    iana: 'https://www.iana.org/help/example-domains',
    synthetic: 'Locally invented regression fixture.',
  };
  const positive = {
    id: 'email.reserved.00001',
    category: 'email.reserved',
    text: 'fixture@example.com',
    expected: [{ kind: 'EMAIL', value: 'fixture@example.com' }],
    source: 'iana',
    seed: 'positive-email',
  };
  const negative = {
    id: 'negative.prose.00001',
    category: 'negative.prose',
    text: 'Explain recursion.',
    expected: [],
    source: 'synthetic',
    seed: 'negative-prose',
  };
  const positives = [positive],
    negatives = [negative];
  const manifest = {
    schemaVersion: 1,
    version: '2026.10.04',
    synthetic: true,
    total: 2,
    positiveCount: 1,
    negativeCount: 1,
    uniqueSensitiveValues: 1,
    seedCount: 2,
    categories: [
      {
        id: positive.category,
        label: 'Reserved email fixture',
        count: 1,
        positiveCount: 1,
        negativeCount: 0,
        seedCount: 1,
      },
      {
        id: negative.category,
        label: 'Clean prose fixture',
        count: 1,
        positiveCount: 0,
        negativeCount: 1,
        seedCount: 1,
      },
    ],
    countries: [],
    files: {
      positives: { path: 'positives.json', count: 1, sha256: checksum(stringify(positives)) },
      negatives: { path: 'negatives.json', count: 1, sha256: checksum(stringify(negatives)) },
    },
    policy: {
      redactEmails: true,
      redactPhones: true,
      redactCards: true,
      redactBankAccounts: true,
      redactIdentifiers: true,
      redactSecrets: true,
      redactNames: true,
      redactAddresses: true,
      redactNetwork: true,
      sensitiveTerms: [],
      blockTerms: [],
      defaultCountry: 'US',
    },
    provenance: 'SOURCES.md',
    sources,
    limitations: ['Synthetic regression fixtures do not establish real-world accuracy.'],
  };
  const seeds = { schemaVersion: 1, version: manifest.version, sources };
  await Promise.all([
    writeFile(path.join(directory, 'manifest.json'), stringify(manifest)),
    writeFile(path.join(directory, 'seeds.json'), stringify(seeds)),
    writeFile(path.join(directory, 'positives.json'), stringify(positives)),
    writeFile(path.join(directory, 'negatives.json'), stringify(negatives)),
    writeFile(
      path.join(directory, 'SOURCES.md'),
      'Synthetic fixtures. Source: https://www.iana.org/help/example-domains\n',
    ),
  ]);
  return { directory, manifest, seeds, positives, negatives };
}

async function saveManifest(data) {
  await writeFile(path.join(data.directory, 'manifest.json'), stringify(data.manifest));
}

async function saveCorpus(data, name) {
  const text = stringify(data[name]);
  data.manifest.files[name].sha256 = checksum(text);
  await writeFile(path.join(data.directory, `${name}.json`), text);
  await saveManifest(data);
}

const integrityError = (pattern) => (error) =>
  error instanceof DataIntegrityError &&
  error.code === 'DATA_INTEGRITY_FAILED' &&
  pattern.test(error.message);

test('build verification accepts the bundled catalog and local file URLs', async () => {
  const summary = await verifyData();
  assert.ok(summary.total >= 15240, 'the catalog must retain its original coverage');
  assert.equal(summary.positiveCount + summary.negativeCount, summary.total);
  assert.ok(summary.categoryCount >= 33, 'the catalog must retain its original categories');
  assert.ok(Object.isFrozen(summary));
  const directory = new URL('../data/', import.meta.url);
  assert.deepEqual(await verifyData(directory), summary);
});

test('minimal independent catalog fixture verifies without importing the scanner', async (t) => {
  const data = await fixture(t);
  assert.deepEqual(await verifyData(pathToFileURL(data.directory + path.sep)), {
    total: 2,
    positiveCount: 1,
    negativeCount: 1,
    categoryCount: 2,
    version: '2026.10.04',
  });
});

test('missing required data fails closed', async (t) => {
  for (const filename of [
    'manifest.json',
    'seeds.json',
    'SOURCES.md',
    'positives.json',
    'negatives.json',
  ])
    await t.test(filename, async (child) => {
      const data = await fixture(child);
      await rm(path.join(data.directory, filename));
      await assert.rejects(verifyData(data.directory), integrityError(/missing or unreadable/));
    });
});

test('altered bytes fail checksum verification even when record counts are unchanged', async (t) => {
  const data = await fixture(t);
  const file = path.join(data.directory, 'positives.json');
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace('fixture@example.com', 'changed@example.com'));
  await assert.rejects(verifyData(data.directory), integrityError(/positives\.json SHA-256/));
});

test('record and aggregate counts must agree independently of hashes', async (t) => {
  await t.test('file record count', async (child) => {
    const data = await fixture(child);
    data.positives.push({ ...data.positives[0], id: 'email.reserved.00002' });
    await saveCorpus(data, 'positives');
    await assert.rejects(verifyData(data.directory), integrityError(/positives\.json count/));
  });
  await t.test('manifest total', async (child) => {
    const data = await fixture(child);
    data.manifest.total = 3;
    await saveManifest(data);
    await assert.rejects(
      verifyData(data.directory),
      integrityError(/total and positive\/negative counts/),
    );
  });
  await t.test('category totals', async (child) => {
    const data = await fixture(child);
    Object.assign(data.manifest.categories[0], { count: 2, positiveCount: 2 });
    await saveManifest(data);
    await assert.rejects(
      verifyData(data.directory),
      integrityError(/Category email\.reserved\.count differs/),
    );
  });
});

test('invalid schemas, expected spans, and provenance are rejected after rehashing', async (t) => {
  const mutations = [
    [
      'schema version',
      (data) => {
        data.manifest.schemaVersion = 2;
      },
      /unsupported schemaVersion/,
    ],
    [
      'real-data marker',
      (data) => {
        data.manifest.synthetic = false;
      },
      /synthetic regression corpus/,
    ],
    [
      'unsafe file path',
      (data) => {
        data.manifest.files.positives.path = '../positives.json';
      },
      /bundled corpus file/,
    ],
    [
      'unknown finding kind',
      (data) => {
        data.positives[0].expected[0].kind = 'UNKNOWN';
      },
      /invalid finding schema/,
    ],
    [
      'absent expected span',
      (data) => {
        data.positives[0].expected[0].value = 'absent@example.com';
      },
      /absent or out of order/,
    ],
    [
      'undeclared source',
      (data) => {
        data.positives[0].source = 'unverified';
      },
      /undeclared source provenance/,
    ],
    [
      'category mismatch',
      (data) => {
        data.positives[0].category = 'unknown.category';
      },
      /undeclared category/,
    ],
    [
      'source map mismatch',
      (data) => {
        data.seeds.sources = { ...data.seeds.sources, iana: 'https://example.com/source' };
      },
      /source provenance disagree/,
    ],
    [
      'positive in negative corpus',
      (data) => {
        data.negatives[0].expected = [{ kind: 'EMAIL', value: 'fixture@example.com' }];
      },
      /wrong positive\/negative corpus file/,
    ],
  ];
  for (const [name, mutate, pattern] of mutations)
    await t.test(name, async (child) => {
      const data = await fixture(child);
      mutate(data);
      await saveCorpus(data, 'positives');
      await saveCorpus(data, 'negatives');
      await writeFile(path.join(data.directory, 'seeds.json'), stringify(data.seeds));
      await assert.rejects(verifyData(data.directory), integrityError(pattern));
    });
});

test('source documentation and unique counts are verified', async (t) => {
  await t.test('missing source citation', async (child) => {
    const data = await fixture(child);
    await writeFile(
      path.join(data.directory, 'SOURCES.md'),
      'Synthetic fixtures without a source citation.',
    );
    await assert.rejects(
      verifyData(data.directory),
      integrityError(/does not document source iana/),
    );
  });
  await t.test('sensitive value count', async (child) => {
    const data = await fixture(child);
    data.manifest.uniqueSensitiveValues = 2;
    await saveManifest(data);
    await assert.rejects(
      verifyData(data.directory),
      integrityError(/Unique sensitive-value count/),
    );
  });
  await t.test('seed count', async (child) => {
    const data = await fixture(child);
    data.manifest.seedCount = 1;
    await saveManifest(data);
    await assert.rejects(verifyData(data.directory), integrityError(/Unique seed count/));
  });
});

test('verification errors do not include fixture contents', async (t) => {
  const data = await fixture(t);
  data.positives[0].source = 'unverified';
  await saveCorpus(data, 'positives');
  await assert.rejects(verifyData(data.directory), (error) => {
    assert.ok(error instanceof DataIntegrityError);
    assert.ok(!error.message.includes('fixture@example.com'));
    return true;
  });
});
