import { build } from 'esbuild';
import { archiveDirectory, writeReleaseChecksums } from './packaging.mjs';
import { verifyData } from './verify-data.mjs';
import { writeSourceRelease } from './source-release.mjs';
import { EDITION } from '../src/core/edition.js';
import { DEFAULT_SITES } from '../src/core/providers.js';
import { mkdir, readFile, writeFile, cp, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getCountries } from 'libphonenumber-js/max';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== EDITION.slug || packageJson.license !== 'MIT')
  throw new Error('Invalid open-source edition metadata.');
await verifyData(path.join(root, 'data'));
await mkdir(path.join(root, 'vendor'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/phone-entry.js'],
  outfile: 'vendor/libphonenumber.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
await copyFile(
  path.join(root, 'node_modules/libphonenumber-js/LICENSE'),
  path.join(root, 'vendor/libphonenumber.LICENSE'),
);
const phonePackage = JSON.parse(
  await readFile(path.join(root, 'node_modules/libphonenumber-js/package.json'), 'utf8'),
);
const phoneMetadata = await readFile(
  path.join(root, 'node_modules/libphonenumber-js/metadata.max.json'),
);
const googleLicense = await readFile(path.join(root, 'vendor/libphonenumber-google.LICENSE'));
if (!googleLicense.toString().includes('Apache License'))
  throw new Error('The upstream phone metadata license is missing or invalid.');
await writeFile(
  path.join(root, 'vendor/metadata-manifest.json'),
  JSON.stringify(
    {
      library: 'libphonenumber-js',
      version: phonePackage.version,
      metadata: 'max',
      countryCount: getCountries().length,
      countries: getCountries().sort(),
      metadataSha256: createHash('sha256').update(phoneMetadata).digest('hex'),
      upstreamLicense: 'Apache-2.0',
      upstreamLicenseSha256: createHash('sha256').update(googleLicense).digest('hex'),
      source: 'https://github.com/catamphetamine/libphonenumber-js',
    },
    null,
    2,
  ) + '\n',
);
const base = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (!EDITION.customSites) {
  const matches = DEFAULT_SITES.map(({ host }) => `https://${host}/*`);
  base.host_permissions = matches;
  for (const entry of base.content_scripts) entry.matches = matches;
}
const assets = [
  'README.md',
  'NOTICE.md',
  'LICENSE',
  'docs',
  'src',
  'managed-schema.json',
  'assets',
  'vendor',
  'data',
];
await mkdir(path.join(root, 'releases'), { recursive: true });
for (const browser of ['chromium', 'firefox', 'safari']) {
  const folder = path.join(root, 'dist', browser);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  for (const asset of assets)
    await cp(path.join(root, asset), path.join(folder, asset), {
      recursive: true,
      filter: (source) => !['.DS_Store', 'Thumbs.db'].includes(path.basename(source)),
    });
  const manifest = structuredClone(base);
  if (!manifest.permissions.includes('scripting')) manifest.permissions.push('scripting');
  await build({
    absWorkingDir: root,
    entryPoints: ['src/extension/content-script.js'],
    outfile: path.join(folder, 'content.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
  if (browser === 'firefox') {
    manifest.background = { scripts: ['background.bundle.js'] };
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: `${EDITION.slug}@local.example`,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['personalCommunications', 'websiteContent'] },
      },
    };
    manifest.browser_specific_settings.gecko_android = { strict_min_version: '142.0' };
    delete manifest.storage; // Firefox enterprise storage uses native managed-storage manifests.
    await build({
      absWorkingDir: root,
      entryPoints: ['src/extension/background.js'],
      outfile: path.join(folder, 'background.bundle.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
    });
  }
  if (browser === 'safari') {
    manifest.background = { scripts: ['background.bundle.js'] };
    delete manifest.minimum_chrome_version;
    delete manifest.storage;
    await build({
      absWorkingDir: root,
      entryPoints: ['src/extension/background.js'],
      outfile: path.join(folder, 'background.bundle.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
    });
  }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(
    path.join(folder, 'INSTALL.txt'),
    browser === 'chromium'
      ? 'Open chrome://extensions (or your browser equivalent), enable Developer mode, Load unpacked, select this directory.\n'
      : browser === 'firefox'
        ? 'Open about:debugging#/runtime/this-firefox, Load Temporary Add-on, select manifest.json. Unsigned development package; distribution requires Mozilla signing.\n'
        : 'Safari source: run npm run build:safari from the project root to generate the Apple app project. Build and sign with Xcode.\n',
  );
  const archive = path.join(root, 'releases', `${EDITION.slug}-${browser}-${base.version}.zip`);
  await archiveDirectory(folder, archive);
  console.log(`${browser}: ${path.relative(root, archive)}`);
}

await writeSourceRelease(root);
await writeReleaseChecksums(path.join(root, 'releases'));
