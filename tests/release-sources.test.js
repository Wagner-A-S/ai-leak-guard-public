import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSourceFile } from '../scripts/source-release.mjs';
import { checkRuntimeCode } from '../scripts/check-release.mjs';

test('source submission allows rebuild inputs while excluding secrets, databases and generated artifacts', () => {
  for (const name of [
    'package-lock.json',
    'scripts/build.mjs',
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'src/core/edition.js',
    'vendor/libphonenumber-google.LICENSE',
    'tests/browser/rich-editors.spec.js',
    '.github/workflows/verify.yml',
  ])
    assert.equal(isAllowedSourceFile(name), true, name);
  for (const name of [
    'service/.env',
    'service/state/keys.json',
    'service/private-key.pem',
    'service/production.sqlite',
    'service/secrets.json',
    'service/output/license.json',
    'service/company-activation.json',
    'service/issuer-public.jwk.json',
    'src/../credentials.json',
    'src/runtime.js/../../secret.json',
    'node_modules/package/index.js',
    '.aws/credentials',
    '.github/credentials.json',
    '.github/workflows/.env',
    'dist/chromium/content.bundle.js',
    'releases/archive.zip',
  ])
    assert.equal(isAllowedSourceFile(name), false, name);
});

test('release verification distinguishes executable downloads from documented provenance', () => {
  const code = (name, text) => ({ [name]: new TextEncoder().encode(text) });
  assert.doesNotThrow(() =>
    checkRuntimeCode(
      code('src/core/providers.js', "export const source = 'https://example.com/docs';"),
    ),
  );
  for (const [name, text] of [
    ['src/ui/page.html', '<script src="https://example.com/remote.js"></script>'],
    ['src/extension/module.js', "import fn from 'https://example.com/remote.js';"],
    ['src/extension/worker.js', "importScripts('https://example.com/remote.js')"],
    ['src/ui/styles.css', '@import "https://example.com/styles.css";'],
  ])
    assert.throws(() => checkRuntimeCode(code(name, text)), /Remote/);
});
