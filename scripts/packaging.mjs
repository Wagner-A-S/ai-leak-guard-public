import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync } from 'fflate';
const ignored = new Set(['.DS_Store', 'Thumbs.db']);
async function archiveEntries(folder, prefix = '') {
  const entries = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) Object.assign(entries, await archiveEntries(file, name));
    else entries[name] = new Uint8Array(await readFile(file));
  }
  return entries;
}
export async function archiveDirectory(folder, destination, { prefix = '' } = {}) {
  await writeFile(
    destination,
    zipSync(await archiveEntries(folder, prefix), {
      level: 6,
      mtime: new Date('2000-01-01T00:00:00Z'),
    }),
  );
}
export async function writeReleaseChecksums(folder) {
  const files = (await readdir(folder)).filter((file) => file.endsWith('.zip')).sort();
  const lines = [];
  for (const file of files)
    lines.push(
      `${createHash('sha256')
        .update(await readFile(path.join(folder, file)))
        .digest('hex')}  ${file}`,
    );
  await writeFile(path.join(folder, 'SHA256SUMS'), lines.join('\n') + '\n');
}
