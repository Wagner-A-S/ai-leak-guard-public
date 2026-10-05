#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const defaultDirectory = fileURLToPath(new URL('../data/', import.meta.url));
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
const policyFlags = [
  'redactEmails',
  'redactPhones',
  'redactCards',
  'redactBankAccounts',
  'redactIdentifiers',
  'redactSecrets',
  'redactNames',
  'redactAddresses',
  'redactNetwork',
];
const fileDefinitions = [
  { name: 'positives', filename: 'positives.json', countKey: 'positiveCount', positive: true },
  { name: 'negatives', filename: 'negatives.json', countKey: 'negativeCount', positive: false },
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const country = (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value);

export class DataIntegrityError extends Error {
  constructor(message) {
    super(`Local sample data verification failed: ${message}`);
    this.name = 'DataIntegrityError';
    this.code = 'DATA_INTEGRITY_FAILED';
  }
}

function requireData(condition, message) {
  if (!condition) throw new DataIntegrityError(message);
}

async function readData(directory, filename) {
  try {
    return await readFile(path.join(directory, filename));
  } catch {
    throw new DataIntegrityError(`${filename} is missing or unreadable.`);
  }
}

function parseData(buffer, filename) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new DataIntegrityError(`${filename} is not valid JSON.`);
  }
}

function verifyPolicy(policy, label) {
  requireData(object(policy), `${label} must be an object.`);
  for (const flag of policyFlags)
    requireData(typeof policy[flag] === 'boolean', `${label}.${flag} must be a boolean.`);
  for (const key of ['sensitiveTerms', 'blockTerms']) {
    requireData(
      Array.isArray(policy[key]) && policy[key].every(string),
      `${label}.${key} must contain nonempty strings.`,
    );
  }
  requireData(country(policy.defaultCountry), `${label}.defaultCountry must be a country code.`);
}

function verifySources(sources, label) {
  requireData(
    object(sources) && Object.keys(sources).length > 0,
    `${label} must declare source provenance.`,
  );
  for (const [id, value] of Object.entries(sources)) {
    requireData(
      /^[a-z][a-z0-9_-]*$/.test(id) && string(value),
      `${label} has an invalid source entry.`,
    );
    if (id === 'synthetic') continue;
    let url;
    try {
      url = new URL(value);
    } catch {}
    requireData(
      url?.protocol === 'https:' && !url.username && !url.password,
      `${label}.${id} must reference a public HTTPS source.`,
    );
  }
  requireData(string(sources.synthetic), `${label} must document synthetic fixtures.`);
}

function verifyManifest(manifest, seeds, provenance) {
  requireData(object(manifest), 'manifest.json must contain an object.');
  requireData(manifest.schemaVersion === 1, 'manifest.json has an unsupported schemaVersion.');
  requireData(
    manifest.synthetic === true,
    'manifest.json must declare a synthetic regression corpus.',
  );
  requireData(string(manifest.version), 'manifest.json must declare a version.');
  for (const key of [
    'total',
    'positiveCount',
    'negativeCount',
    'uniqueSensitiveValues',
    'seedCount',
  ]) {
    requireData(integer(manifest[key]), `manifest.json.${key} must be a nonnegative integer.`);
  }
  requireData(
    manifest.total > 0 && manifest.total === manifest.positiveCount + manifest.negativeCount,
    'manifest.json total and positive/negative counts disagree.',
  );
  requireData(
    manifest.provenance === 'SOURCES.md',
    'manifest.json must reference the bundled SOURCES.md provenance.',
  );
  requireData(string(provenance), 'SOURCES.md must not be empty.');
  verifySources(manifest.sources, 'manifest.json.sources');
  verifyPolicy(manifest.policy, 'manifest.json.policy');
  requireData(
    Array.isArray(manifest.limitations) &&
      manifest.limitations.length > 0 &&
      manifest.limitations.every(string),
    'manifest.json must document corpus limitations.',
  );
  requireData(
    Array.isArray(manifest.countries) &&
      manifest.countries.every(country) &&
      new Set(manifest.countries).size === manifest.countries.length,
    'manifest.json.countries must contain unique country codes.',
  );

  requireData(
    object(seeds) && seeds.schemaVersion === 1,
    'seeds.json has an unsupported schemaVersion.',
  );
  requireData(seeds.version === manifest.version, 'seeds.json version differs from manifest.json.');
  verifySources(seeds.sources, 'seeds.json.sources');
  const sourceIds = Object.keys(manifest.sources);
  requireData(
    Object.keys(seeds.sources).length === sourceIds.length &&
      sourceIds.every((id) => seeds.sources[id] === manifest.sources[id]),
    'seeds.json and manifest.json source provenance disagree.',
  );
  for (const id of sourceIds) {
    if (id !== 'synthetic')
      requireData(
        provenance.includes(manifest.sources[id]),
        `SOURCES.md does not document source ${id}.`,
      );
  }
  if (manifest.curatedSeedCounts !== undefined) {
    requireData(
      object(manifest.curatedSeedCounts),
      'manifest.json.curatedSeedCounts must be an object.',
    );
    for (const count of Object.values(manifest.curatedSeedCounts))
      requireData(
        integer(count),
        'manifest.json.curatedSeedCounts must contain nonnegative integers.',
      );
    for (const key of [
      'cards',
      'ibans',
      'bankAccounts',
      'syntheticNames',
      'syntheticStreets',
      'syntheticTowns',
    ])
      requireData(Array.isArray(seeds[key]), `seeds.json.${key} must be an array.`);
    requireData(object(seeds.phones), 'seeds.json.phones must contain reserved phone seeds.');
    for (const key of [
      'nanpAreaCodes',
      'ukGeographic',
      'auGeographic',
      'auMobile',
      'deGeographic',
      'deMobile',
      'frPrefixes',
    ])
      requireData(Array.isArray(seeds.phones[key]), `seeds.json.phones.${key} must be an array.`);
    const counts = {
      paymentCardNumbers: seeds.cards.length,
      ibanNumbers: seeds.ibans.length,
      bankAccountFields: seeds.bankAccounts.length,
      individuallyReservedPhoneNumbers: seeds.phones.auMobile.length + seeds.phones.deMobile.length,
      reservedPhoneRangeDefinitions:
        seeds.phones.nanpAreaCodes.length +
        seeds.phones.ukGeographic.length +
        1 +
        seeds.phones.auGeographic.length +
        seeds.phones.deGeographic.length +
        2 +
        seeds.phones.frPrefixes.length,
      syntheticNameSeeds: seeds.syntheticNames.length,
      syntheticStreetSeeds: seeds.syntheticStreets.length,
      syntheticTownSeeds: seeds.syntheticTowns.length,
    };
    for (const [key, count] of Object.entries(counts))
      requireData(
        manifest.curatedSeedCounts[key] === count,
        `Curated seed count ${key} differs from seeds.json.`,
      );
  }

  requireData(
    object(manifest.files) && Object.keys(manifest.files).length === fileDefinitions.length,
    'manifest.json must declare exactly the two corpus files.',
  );
  for (const definition of fileDefinitions) {
    const file = manifest.files[definition.name];
    requireData(object(file), `manifest.json.files.${definition.name} is missing.`);
    requireData(
      file.path === definition.filename,
      `manifest.json.files.${definition.name}.path must reference its bundled corpus file.`,
    );
    requireData(
      integer(file.count) && file.count === manifest[definition.countKey],
      `manifest.json.files.${definition.name}.count disagrees with the catalog count.`,
    );
    requireData(
      typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256),
      `manifest.json.files.${definition.name}.sha256 is invalid.`,
    );
  }

  requireData(
    Array.isArray(manifest.categories) && manifest.categories.length > 0,
    'manifest.json.categories must be a nonempty array.',
  );
  const categories = new Map();
  for (const category of manifest.categories) {
    requireData(
      object(category) && string(category.id) && string(category.label),
      'manifest.json has an invalid category.',
    );
    requireData(!categories.has(category.id), 'manifest.json has duplicate category IDs.');
    for (const key of ['count', 'positiveCount', 'negativeCount', 'seedCount'])
      requireData(
        integer(category[key]),
        `Category ${category.id}.${key} must be a nonnegative integer.`,
      );
    requireData(
      category.count > 0 && category.count === category.positiveCount + category.negativeCount,
      `Category ${category.id} counts disagree.`,
    );
    categories.set(category.id, {
      definition: category,
      count: 0,
      positiveCount: 0,
      negativeCount: 0,
      seeds: new Set(),
    });
  }
  return categories;
}

function verifySample(sample, label, positive, manifest, categories, state) {
  requireData(object(sample), `${label} must be an object.`);
  for (const key of ['id', 'category', 'text', 'source', 'seed'])
    requireData(string(sample[key]), `${label}.${key} must be a nonempty string.`);
  requireData(!state.ids.has(sample.id), `${label} duplicates a sample ID.`);
  requireData(!state.texts.has(sample.text), `${label} duplicates sample text.`);
  state.ids.add(sample.id);
  state.texts.add(sample.text);
  requireData(categories.has(sample.category), `${label} references an undeclared category.`);
  requireData(
    Object.hasOwn(manifest.sources, sample.source),
    `${label} references undeclared source provenance.`,
  );
  if (sample.country !== undefined) {
    requireData(
      country(sample.country) && manifest.countries.includes(sample.country),
      `${label}.country is not declared in manifest.json.`,
    );
    state.countries.add(sample.country);
  }
  requireData(Array.isArray(sample.expected), `${label}.expected must be an array.`);
  requireData(
    positive ? sample.expected.length > 0 : sample.expected.length === 0,
    `${label} is in the wrong positive/negative corpus file.`,
  );
  let end = 0;
  for (const [index, finding] of sample.expected.entries()) {
    requireData(
      object(finding) && kinds.has(finding.kind) && string(finding.value),
      `${label}.expected[${index}] has an invalid finding schema.`,
    );
    const start = sample.text.indexOf(finding.value, end);
    requireData(
      start >= 0,
      `${label}.expected[${index}] is absent or out of order in the fixture text.`,
    );
    end = start + finding.value.length;
    state.values.add(finding.value);
  }
  const category = categories.get(sample.category);
  category.count++;
  category[positive ? 'positiveCount' : 'negativeCount']++;
  category.seeds.add(sample.seed);
  state.seeds.add(sample.seed);
}

/** Read-only verification of the bundled synthetic catalog. No scanner or browser API is imported. */
export async function verifyData(directory = defaultDirectory) {
  if (directory instanceof URL) {
    requireData(directory.protocol === 'file:', 'Data directory must be a local file URL.');
    directory = fileURLToPath(directory);
  }
  requireData(string(directory), 'Data directory must be a local filesystem path.');
  const [manifestBuffer, seedsBuffer, provenanceBuffer] = await Promise.all([
    readData(directory, 'manifest.json'),
    readData(directory, 'seeds.json'),
    readData(directory, 'SOURCES.md'),
  ]);
  const manifest = parseData(manifestBuffer, 'manifest.json');
  const seeds = parseData(seedsBuffer, 'seeds.json');
  const categories = verifyManifest(manifest, seeds, provenanceBuffer.toString('utf8'));
  const buffers = await Promise.all(
    fileDefinitions.map((definition) => readData(directory, definition.filename)),
  );
  const state = {
    ids: new Set(),
    texts: new Set(),
    seeds: new Set(),
    values: new Set(),
    countries: new Set(),
  };
  for (const [index, definition] of fileDefinitions.entries()) {
    const file = manifest.files[definition.name];
    const buffer = buffers[index];
    const checksum = createHash('sha256').update(buffer).digest('hex');
    requireData(
      checksum === file.sha256,
      `${definition.filename} SHA-256 does not match manifest.json.`,
    );
    const samples = parseData(buffer, definition.filename);
    requireData(Array.isArray(samples), `${definition.filename} must contain an array.`);
    requireData(
      samples.length === file.count,
      `${definition.filename} count does not match manifest.json.`,
    );
    for (const [sampleIndex, sample] of samples.entries())
      verifySample(
        sample,
        `${definition.filename}[${sampleIndex}]`,
        definition.positive,
        manifest,
        categories,
        state,
      );
  }
  requireData(
    state.ids.size === manifest.total,
    'Verified record total does not match manifest.json.',
  );
  requireData(
    state.values.size === manifest.uniqueSensitiveValues,
    'Unique sensitive-value count does not match manifest.json.',
  );
  requireData(
    state.seeds.size === manifest.seedCount,
    'Unique seed count does not match manifest.json.',
  );
  requireData(
    state.countries.size === manifest.countries.length,
    'Manifest country coverage differs from the fixtures.',
  );
  for (const [id, category] of categories) {
    for (const key of ['count', 'positiveCount', 'negativeCount'])
      requireData(
        category[key] === category.definition[key],
        `Category ${id}.${key} differs from the fixtures.`,
      );
    requireData(
      category.seeds.size === category.definition.seedCount,
      `Category ${id}.seedCount differs from the fixtures.`,
    );
  }
  return Object.freeze({
    total: manifest.total,
    positiveCount: manifest.positiveCount,
    negativeCount: manifest.negativeCount,
    categoryCount: categories.size,
    version: manifest.version,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const summary = await verifyData(process.argv[2] || defaultDirectory);
  console.log(
    `Verified ${summary.total} local synthetic samples across ${summary.categoryCount} categories (${summary.version}).`,
  );
}
