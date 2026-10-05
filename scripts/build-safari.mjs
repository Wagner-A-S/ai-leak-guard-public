import { archiveDirectory, writeReleaseChecksums } from './packaging.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EDITION } from '../src/core/edition.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appName = EDITION.title;
const bundleIdentifier = 'com.example.' + EDITION.slug.replaceAll('-', '');
if (process.platform !== 'darwin')
  throw new Error(
    'Safari app conversion requires macOS with Xcode. The source zip can also be packaged through App Store Connect.',
  );
execFileSync(
  'xcrun',
  [
    'safari-web-extension-converter',
    path.join(root, 'dist/safari'),
    '--project-location',
    path.join(root, 'safari'),
    '--app-name',
    appName,
    '--bundle-identifier',
    bundleIdentifier,
    '--swift',
    '--macos-only',
    '--copy-resources',
    '--no-open',
    '--no-prompt',
    '--force',
  ],
  { stdio: 'inherit' },
);
// Apple's converter can leave its default app ID while setting the extension ID.
const project = path.join(root, 'safari', appName, `${appName}.xcodeproj/project.pbxproj`);
const generatedAppId = 'com.example.' + appName.replaceAll(' ', '-');
const replacement = `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};`;
const config = readFileSync(project, 'utf8')
  .replaceAll(`PRODUCT_BUNDLE_IDENTIFIER = "${generatedAppId}";`, replacement)
  .replaceAll(`PRODUCT_BUNDLE_IDENTIFIER = ${generatedAppId};`, replacement);
writeFileSync(project, config);
console.log(
  'Safari Xcode project generated under safari/. Change the bundle identifier and configure signing before distribution.',
);

const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
await archiveDirectory(
  path.join(root, 'safari', appName),
  path.join(root, 'releases', `${EDITION.slug}-safari-xcode-${version}.zip`),
  { prefix: appName },
);
await writeReleaseChecksums(path.join(root, 'releases'));
