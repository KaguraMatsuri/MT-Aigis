const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('uses the official compiled macOS Icon asset', () => {
  const packageJson = JSON.parse(read('package.json'));
  const afterPack = read('scripts/after-pack.js');
  const assetInfo = JSON.parse(execFileSync(
    '/usr/bin/assetutil',
    ['--info', path.join(root, 'resources', 'Assets.car')],
    { encoding: 'utf8' },
  ));

  assert.equal(packageJson.build.mac.icon, 'resources/MT-Aigis.icon');
  assert.equal(packageJson.build.dmg.icon, undefined);
  assert.ok(fs.existsSync(path.join(root, 'resources', 'MT-Aigis.icon', 'icon.json')));
  assert.ok(fs.existsSync(path.join(root, 'resources', 'Assets.car')));
  assert.ok(assetInfo.some((asset) => asset.Name === 'Icon' && asset['AssetType'] === 'Icon Image'));
  assert.match(afterPack, /fs\.copyFileSync\(fallbackAssets, bundledAssets\)/);
  assert.match(afterPack, /CFBundleIconName', '-string', 'Icon'/);
});

test('keeps the 1.2.0 display and bundle version aligned', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.version, '1.2.0');
  assert.equal(packageJson.build.mac.bundleVersion, '1.2.0');
  assert.match(read('main.js'), /APP_DISPLAY_VERSION = '1\.2\.0'/);
  assert.match(read('ui/index.html'), /about-version">1\.2\.0</);
  assert.match(read('ui/about.html'), /version-value">1\.2\.0</);
});

test('keeps the QQ contact aligned across both about views', () => {
  assert.match(read('main.js'), /QQ_GROUP = '1283962190'/);
  assert.match(read('ui/index.html'), /data-copy="1283962190"/);
  assert.match(read('ui/about.html'), /qq-value">1283962190</);
});

test('builds releases without requiring an unavailable Xcode 26 actool', () => {
  const packageJson = JSON.parse(read('package.json'));
  const releaseWorkflow = read('.github/workflows/release.yml');
  const targets = packageJson.build.mac.target.map((entry) => ({
    target: entry.target,
    arch: entry.arch,
  }));

  assert.deepEqual(targets, [
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] },
  ]);
  assert.match(releaseWorkflow, /-c\.mac\.icon=resources\/icon\.png/);
  assert.match(releaseWorkflow, /dist\/\*\.dmg/);
  assert.match(releaseWorkflow, /dist\/\*\.zip/);
  assert.match(releaseWorkflow, /dist\/latest-mac\.yml/);
  assert.match(read('main.js'), /matchesSha512\(digest\.digest\('base64'\), manifest\.dmg\.sha512\)/);
});

test('publishes an absolute update URL for legacy clients', () => {
  const packageJson = JSON.parse(read('package.json'));
  const releaseWorkflow = read('.github/workflows/release.yml');
  const prepareManifest = require('../scripts/prepare-release-manifest');
  const relativeManifest = [
    'version: 1.1.0',
    'files:',
    '  - url: MT-Aigis-1.1.0-arm64.dmg',
    '    sha512: digest',
    '  - url: MT-Aigis-1.1.0-arm64.zip',
    '    sha512: digest',
    'path: MT-Aigis-1.1.0-arm64.zip',
    '',
  ].join('\n');
  const prepared = prepareManifest(relativeManifest);

  assert.equal(packageJson.scripts['release:manifest'], 'node scripts/prepare-release-manifest.js dist/latest-mac.yml');
  assert.match(releaseWorkflow, /npm run release:manifest/);
  assert.match(releaseWorkflow, /--publish never/);
  assert.match(releaseWorkflow, /gh release upload "\$GITHUB_REF_NAME" dist\/\*\.dmg dist\/\*\.zip dist\/\*\.blockmap dist\/latest-mac\.yml --clobber/);
  assert.match(prepared, /url: https:\/\/github\.com\/KaguraMatsuri\/MT-Aigis\/releases\/latest\/download\/MT-Aigis-1\.1\.0-arm64\.dmg/);
  assert.match(prepared, /url: https:\/\/github\.com\/KaguraMatsuri\/MT-Aigis\/releases\/latest\/download\/MT-Aigis-1\.1\.0-arm64\.zip/);
  assert.match(prepared, /path: MT-Aigis-1\.1\.0-arm64\.zip/);
  assert.equal(prepareManifest(prepared), prepared);
});
