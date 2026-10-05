import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function sources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(file)));
    else if (file.endsWith('.js')) files.push(file);
  }
  return files;
}
test('domain core imports only the core and pinned local vendor library', async () => {
  const core = path.join(root, 'src/core'),
    vendor = path.join(root, 'vendor');
  for (const file of await sources(core)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(
        match[1].startsWith('.'),
        `${path.relative(root, file)} cannot import platform packages.`,
      );
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(
        target.startsWith(core + path.sep) || target.startsWith(vendor + path.sep),
        `${path.relative(root, file)} crossed its domain boundary.`,
      );
    }
    assert.ok(
      !/\b(?:window|document|chrome|browser)\s*\./.test(text),
      `${path.relative(root, file)} uses a browser-specific API.`,
    );
  }
});
test('production scanner and domain do not import regression fixture data or tooling', async () => {
  for (const file of [
    ...(await sources(path.join(root, 'src/core'))),
    path.join(root, 'src/extension/scanner-worker.js'),
  ]) {
    const text = await readFile(file, 'utf8');
    assert.ok(
      !/from\s*['"][^'"]*(?:scripts\/|data\/|tests\/)/.test(text),
      `${path.relative(root, file)} depends on build/test data.`,
    );
  }
});

test('runtime UI and guards contain no CSS discovery or native browser dialogs', async () => {
  for (const file of await sources(path.join(root, 'src'))) {
    const text = await readFile(file, 'utf8');
    assert.ok(
      !/\.(?:querySelector(?:All)?|closest|matches)\s*\(/.test(text),
      `${path.relative(root, file)} executes CSS discovery.`,
    );
    assert.ok(
      !/\b(?:alert|confirm|prompt)\s*\(/.test(text),
      `${path.relative(root, file)} opens a native browser dialog.`,
    );
  }
});
