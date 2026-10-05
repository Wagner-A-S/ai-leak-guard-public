import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { isAllowedSourceFile } from './source-release.mjs';
import { EDITION } from '../src/core/edition.js';
import { DEFAULT_SITES } from '../src/core/providers.js';

const permittedPermissions = new Set(['storage', 'activeTab', 'scripting']);
const requiredLicenses = [
  'vendor/libphonenumber.LICENSE',
  'vendor/libphonenumber-google.LICENSE',
  'vendor/NOTICE.md',
];
function requireFile(files, name) {
  assert.ok(Object.hasOwn(files, name), `Release is missing ${name}.`);
  return strFromU8(files[name]);
}
function sourceVersion(files) {
  const version = requireFile(files, 'src/core/build-info.js').match(
    /EXTENSION_VERSION\s*=\s*['"]([^'"]+)['"]/,
  );
  assert.ok(version, 'Missing runtime version.');
  return version[1];
}
function checkLicenses(files) {
  assert.match(requireFile(files, 'LICENSE'), /MIT License/);
  for (const name of requiredLicenses) requireFile(files, name);
  assert.match(requireFile(files, requiredLicenses[0]), /MIT License/);
  assert.match(requireFile(files, requiredLicenses[1]), /Apache License/);
  assert.match(requireFile(files, requiredLicenses[2]), /Libphonenumber Authors/);
}
export function checkRuntimeCode(files) {
  for (const [name, bytes] of Object.entries(files)) {
    if (!/^(?:src\/|vendor\/|content\.bundle\.js$|background\.bundle\.js$)/.test(name)) continue;
    const text = strFromU8(bytes);
    if (/\.js$/.test(name)) {
      assert.ok(
        !/(?:\b(?:import|export)\s[^;\n]*?\bfrom\s*|\b(?:import|importScripts)\s*\(\s*|\bnew\s+(?:Worker|SharedWorker)\s*\(\s*)['"](?:https?:)?\/\//i.test(
          text,
        ),
        `Remote executable import in ${name}.`,
      );
      assert.ok(
        !/\b(?:src|importScripts)\s*=\s*['"](?:https?:)?\/\//i.test(text),
        `Remote script URL in ${name}.`,
      );
    }
    if (/\.html$/.test(name))
      assert.ok(
        !/<script\b[^>]*\bsrc\s*=\s*['"]?(?:https?:)?\/\//i.test(text),
        `Remote HTML script in ${name}.`,
      );
    if (/\.css$/.test(name))
      assert.ok(
        !/@import\s+(?:url\(\s*)?['"]?(?:https?:)?\/\//i.test(text),
        `Remote stylesheet in ${name}.`,
      );
  }
}
export function checkBrowserArchive(files, browser, version) {
  const manifest = JSON.parse(requireFile(files, 'manifest.json'));
  assert.equal(manifest.name, EDITION.title);
  const hosts = EDITION.customSites
    ? ['https://*/*']
    : DEFAULT_SITES.map(({ host }) => `https://${host}/*`);
  assert.deepEqual(manifest.host_permissions, hosts, 'Unexpected host permission scope.');
  for (const entry of manifest.content_scripts) assert.deepEqual(entry.matches, hosts);
  assert.equal(manifest.version, version, `${browser} manifest version differs.`);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(sourceVersion(files), version, `${browser} runtime version differs.`);
  assert.ok(
    manifest.permissions.every((permission) => permittedPermissions.has(permission)),
    'Unreviewed extension permission.',
  );
  assert.ok(manifest.permissions.includes('storage') && manifest.permissions.includes('scripting'));
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'(?:;|$)/);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'self'(?:;|$)/);
  assert.match(manifest.content_security_policy.extension_pages, /object-src 'none'(?:;|$)/);
  requireFile(files, 'content.bundle.js');
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes('content.bundle.js')));
  if (browser === 'chromium')
    assert.equal(manifest.background.service_worker, 'src/extension/background.js');
  else {
    requireFile(files, 'background.bundle.js');
    assert.deepEqual(manifest.background.scripts, ['background.bundle.js']);
  }
  checkLicenses(files);
  checkRuntimeCode(files);
}
function safeArchive(files) {
  for (const name of Object.keys(files))
    assert.ok(
      !name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'),
      `Unsafe archive entry: ${name}`,
    );
}
export async function checkRelease(root) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  assert.equal(packageJson.name, EDITION.slug);
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.version, version, 'Package and manifest versions differ.');
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, version, 'Lockfile version differs.');
  assert.equal(lock.packages[''].version, version, 'Lockfile root version differs.');
  const releaseFolder = path.join(root, 'releases');
  const checksums = new Map();
  for (const line of (await readFile(path.join(releaseFolder, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')) {
    const match = line.match(/^([a-f\d]{64})  ([\w.-]+\.zip)$/);
    assert.ok(match, 'Malformed release checksum entry.');
    assert.ok(!checksums.has(match[2]), 'Duplicate checksum entry.');
    checksums.set(match[2], match[1]);
  }
  for (const name of (await readdir(releaseFolder)).filter((entry) => entry.endsWith('.zip'))) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(releaseFolder, name)))
        .digest('hex'),
      checksums.get(name),
      `Checksum mismatch: ${name}`,
    );
  }
  const readArchive = async (name) => {
    assert.ok(checksums.has(name), `Missing archive checksum: ${name}`);
    const files = unzipSync(await readFile(path.join(releaseFolder, name)));
    safeArchive(files);
    return files;
  };
  for (const browser of ['chromium', 'firefox', 'safari']) {
    const files = await readArchive(`${EDITION.slug}-${browser}-${version}.zip`);
    checkBrowserArchive(files, browser, version);
    for (const [name, bytes] of Object.entries(files))
      assert.deepEqual(
        new Uint8Array(await readFile(path.join(root, 'dist', browser, name))),
        bytes,
        `${browser} ZIP differs from dist/${browser}/${name}.`,
      );
  }
  const sources = await readArchive(`${EDITION.slug}-source-${version}.zip`);
  for (const name of Object.keys(sources))
    assert.ok(isAllowedSourceFile(name), `Unexpected source archive entry: ${name}`);
  for (const name of [
    'package.json',
    'package-lock.json',
    'manifest.json',
    'README.md',
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'src/core/edition.js',
    'scripts/build.mjs',
    'scripts/source-release.mjs',
    'scripts/check-release.mjs',
    'scripts/packaging.mjs',
    'managed-schema.json',
    'playwright.config.js',
    '.github/workflows/verify.yml',
  ])
    requireFile(sources, name);
  assert.equal(JSON.parse(requireFile(sources, 'package.json')).version, version);
  assert.equal(JSON.parse(requireFile(sources, 'manifest.json')).version, version);
  assert.equal(sourceVersion(sources), version);
  checkLicenses(sources);
  return version;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = await checkRelease(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  console.log(
    `Release ${EDITION.slug} ${version}: browser/source archives, versions, permissions, runtime code and checksums passed.`,
  );
}
