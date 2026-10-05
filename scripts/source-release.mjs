import { mkdir, mkdtemp, readdir, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveDirectory, writeReleaseChecksums } from './packaging.mjs';

const directories = new Set([
  'src',
  'scripts',
  'tests',
  'assets',
  'data',
  'vendor',
  'docs',
  '.github',
]);
const rootFiles = new Set([
  'package.json',
  'package-lock.json',
  'manifest.json',
  'README.md',
  'NOTICE.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'LICENSE.md',
  'managed-schema.json',
  'playwright.config.js',
  '.prettierrc.json',
  '.prettierignore',
  '.gitignore',
]);
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'releases',
  'safari',
  '.git',
  '.aws',
  '.codex',
  '.agents',
  'test-results',
  'playwright-report',
  '__pycache__',
  'coverage',
  'state',
  'secrets',
]);
const extensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.csv',
  '.py',
  '.sh',
  '.yml',
  '.yaml',
  '.license',
]);

export function isAllowedSourceFile(name) {
  const parts = name.split('/');
  if (name.includes('\\') || parts.some((part) => !part || part === '..')) return false;
  if (parts.length === 1) return rootFiles.has(name);
  if (!directories.has(parts[0])) return false;
  if (parts[0] === '.github' && (parts[1] !== 'workflows' || parts.length !== 3)) return false;
  if (parts.some((part) => excludedDirectories.has(part))) return false;
  const basename = parts.at(-1);
  if (
    parts.some((part, index) => part.startsWith('.') && !(index === 0 && part === '.github')) &&
    basename !== '.env.example'
  )
    return false;
  if (/^(?:credentials|secrets)\.(?:json|ya?ml)$/i.test(basename)) return false;
  if (/^(?:company-|issuer-public\.jwk|admin-token)/i.test(basename)) return false;
  return (
    basename === '.env.example' ||
    basename === 'LICENSE' ||
    extensions.has(path.extname(basename).toLowerCase())
  );
}

async function collect(folder, prefix = '') {
  const files = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (
        (!prefix && !directories.has(entry.name)) ||
        excludedDirectories.has(entry.name) ||
        (entry.name.startsWith('.') && !(entry.name === '.github' && !prefix))
      )
        continue;
      files.push(...(await collect(path.join(folder, entry.name), relative)));
    } else if (entry.isFile() && isAllowedSourceFile(relative)) files.push(relative);
    // Symlinks are deliberately omitted: they can point outside the reviewed tree.
  }
  return files;
}

export async function writeSourceRelease(root) {
  const { version } = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const { name: slug } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug))
    throw new Error('Invalid source edition.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid source release version.');
  const staging = await mkdtemp(path.join(tmpdir(), `${slug}-source-`));
  const destination = path.join(root, 'releases', `${slug}-source-${version}.zip`);
  try {
    for (const relative of await collect(root)) {
      const target = path.join(staging, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, relative), target);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await archiveDirectory(staging, destination);
    await writeReleaseChecksums(path.dirname(destination));
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    await writeSourceRelease(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')),
  );
}
