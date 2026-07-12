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
  assert.ok(fs.existsSync(path.join(root, 'resources', 'MT-Aigis.icon', 'icon.json')));
  assert.ok(fs.existsSync(path.join(root, 'resources', 'Assets.car')));
  assert.ok(assetInfo.some((asset) => asset.Name === 'Icon' && asset['AssetType'] === 'Icon Image'));
  assert.match(afterPack, /fs\.copyFileSync\(fallbackAssets, bundledAssets\)/);
  assert.match(afterPack, /CFBundleIconName', '-string', 'Icon'/);
});

test('keeps the 1.0.0.1 display and bundle version aligned', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.version, '1.0.1');
  assert.equal(packageJson.build.mac.bundleVersion, '1.0.0.1');
  assert.match(read('main.js'), /APP_DISPLAY_VERSION = '1\.0\.0\.1'/);
  assert.match(read('ui/index.html'), /about-version">1\.0\.0\.1</);
  assert.match(read('ui/about.html'), /version-value">1\.0\.0\.1</);
});
