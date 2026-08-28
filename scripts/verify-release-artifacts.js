const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/';

function parseReleaseManifest(source) {
  const manifest = { version: '', files: [], path: '', sha512: '' };
  let currentFile = null;
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    let match = rawLine.match(/^version:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      manifest.version = match[1].trim();
      continue;
    }
    match = rawLine.match(/^path:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      manifest.path = match[1].trim();
      continue;
    }
    match = rawLine.match(/^sha512:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      manifest.sha512 = match[1].trim();
      continue;
    }
    match = rawLine.match(/^\s*-\s+url:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      currentFile = { url: match[1].trim(), sha512: '', size: 0 };
      manifest.files.push(currentFile);
      continue;
    }
    if (!currentFile) continue;
    match = rawLine.match(/^\s+sha512:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      currentFile.sha512 = match[1].trim();
      continue;
    }
    match = rawLine.match(/^\s+size:\s*(\d+)\s*$/);
    if (match) currentFile.size = Number.parseInt(match[1], 10) || 0;
  }
  return manifest;
}

function releaseFileName(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value.startsWith(RELEASE_DOWNLOAD_PREFIX)) return '';
  try {
    const parsed = new URL(value);
    const name = decodeURIComponent(path.posix.basename(parsed.pathname));
    return name && path.basename(name) === name ? name : '';
  } catch {
    return '';
  }
}

function sha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function requireRegularFile(filePath, name) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${name} is not a regular file`);
  if (stat.size === 0) throw new Error(`${name} is empty`);
  return stat;
}

function verifyBlockmap(filePath, name) {
  let blockmap;
  try {
    blockmap = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
  } catch {
    throw new Error(`${name} is not a valid gzip-compressed JSON blockmap`);
  }
  const files = Array.isArray(blockmap.files) ? blockmap.files : [];
  const valid = String(blockmap.version) === '2' && files.length > 0 && files.every((file) => (
    typeof file.name === 'string' && file.name.length > 0 &&
    Number.isInteger(file.offset) && file.offset >= 0 &&
    Array.isArray(file.checksums) && file.checksums.length > 0 &&
    Array.isArray(file.sizes) && file.sizes.length === file.checksums.length &&
    file.sizes.every((size) => Number.isInteger(size) && size > 0)
  ));
  if (!valid) throw new Error(`${name} contains an invalid blockmap structure`);
}

function verifyReleaseArtifacts(manifestPath, outputDirectory, expectedVersion) {
  if (path.basename(manifestPath) !== 'latest-mac.yml') {
    throw new Error('release manifest must be named latest-mac.yml');
  }
  const manifest = parseReleaseManifest(fs.readFileSync(manifestPath, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('release manifest contains an invalid version');
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`release manifest version ${manifest.version} does not match package version ${expectedVersion}`);
  }

  const manifestNames = [
    `MT-Aigis-${manifest.version}-arm64.zip`,
    `MT-Aigis-${manifest.version}-arm64.dmg`,
  ];
  const entries = manifest.files.map((file) => ({ ...file, name: releaseFileName(file.url) }));
  if (entries.length !== manifestNames.length ||
      entries.some((entry, index) => entry.name !== manifestNames[index])) {
    throw new Error(`release manifest must contain exactly: ${manifestNames.join(', ')}`);
  }

  for (const entry of entries) {
    const filePath = path.join(outputDirectory, entry.name);
    const stat = requireRegularFile(filePath, entry.name);
    if (stat.size !== entry.size) throw new Error(`${entry.name} size does not match the manifest`);
    if (sha512(filePath) !== entry.sha512) {
      throw new Error(`${entry.name} SHA-512 does not match the manifest`);
    }
  }

  const zipEntry = entries[0];
  if (manifest.path !== zipEntry.name) {
    throw new Error('release manifest top-level path must point to the ZIP artifact');
  }
  if (manifest.sha512 !== zipEntry.sha512) {
    throw new Error('release manifest top-level SHA-512 must match the ZIP artifact');
  }

  const releaseNames = [
    manifestNames[0],
    `${manifestNames[0]}.blockmap`,
    manifestNames[1],
    `${manifestNames[1]}.blockmap`,
    'latest-mac.yml',
  ];
  for (const name of releaseNames) {
    requireRegularFile(path.join(outputDirectory, name), name);
  }
  for (const name of releaseNames.filter((item) => item.endsWith('.blockmap'))) {
    verifyBlockmap(path.join(outputDirectory, name), name);
  }

  return { version: manifest.version, files: releaseNames };
}

if (require.main === module) {
  const manifestPath = process.argv[2] || 'dist/latest-mac.yml';
  const outputDirectory = process.argv[3] || path.dirname(manifestPath);
  const expectedVersion = process.argv[4] || require('../package.json').version;
  const result = verifyReleaseArtifacts(manifestPath, outputDirectory, expectedVersion);
  process.stdout.write(`Verified ${result.files.length} release artifacts for v${result.version}.\n`);
}

module.exports = {
  parseReleaseManifest,
  verifyReleaseArtifacts,
};
