const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const { verifyReleaseArtifacts } = require('../scripts/verify-release-artifacts');

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
  assert.match(releaseWorkflow, /dist\/MT-Aigis-\$\{\{ steps\.release_metadata\.outputs\.version \}\}-arm64\.dmg/);
  assert.match(releaseWorkflow, /dist\/MT-Aigis-\$\{\{ steps\.release_metadata\.outputs\.version \}\}-arm64\.zip/);
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
  assert.match(releaseWorkflow, /dmg="dist\/MT-Aigis-\$\{PACKAGE_VERSION\}-arm64\.dmg"/);
  assert.match(releaseWorkflow, /"\$\{dmg\}\.blockmap"/);
  assert.match(releaseWorkflow, /"\$\{zip\}\.blockmap"/);
  assert.doesNotMatch(releaseWorkflow, /dist\/\*\.(?:dmg|zip|blockmap)/);
  assert.match(prepared, /url: https:\/\/github\.com\/KaguraMatsuri\/MT-Aigis\/releases\/latest\/download\/MT-Aigis-1\.1\.0-arm64\.dmg/);
  assert.match(prepared, /url: https:\/\/github\.com\/KaguraMatsuri\/MT-Aigis\/releases\/latest\/download\/MT-Aigis-1\.1\.0-arm64\.zip/);
  assert.match(prepared, /path: MT-Aigis-1\.1\.0-arm64\.zip/);
  assert.equal(prepareManifest(prepared), prepared);
});

test('publishes only a complete release for the package-matched tag', () => {
  const releaseWorkflow = read('.github/workflows/release.yml');
  const createDraft = 'gh release create "$GITHUB_REF_NAME"';
  const uploadAssets = 'gh release upload "$GITHUB_REF_NAME"';
  const archiveArtifacts = 'uses: actions/upload-artifact@v4';
  const publishRelease = '- name: Publish complete release';

  assert.match(releaseWorkflow, /concurrency:\n  group: release\n  cancel-in-progress: false/);
  assert.match(releaseWorkflow, /fetch-depth: 0/);
  assert.match(releaseWorkflow, /"\$GITHUB_EVENT_NAME" == "workflow_dispatch"/);
  assert.match(releaseWorkflow, /"\$GITHUB_REF_TYPE" != "tag" \|\| "\$GITHUB_REF_NAME" != v\*/);
  assert.match(releaseWorkflow, /git fetch --no-tags origin "\+refs\/heads\/\$\{DEFAULT_BRANCH\}:refs\/remotes\/origin\/\$\{DEFAULT_BRANCH\}"/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor "\$GITHUB_SHA" "refs\/remotes\/origin\/\$\{DEFAULT_BRANCH\}"/);
  assert.match(releaseWorkflow, /must point to a commit already contained in origin/);
  assert.match(releaseWorkflow, /package_version="\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/);
  assert.match(releaseWorkflow, /expected_tag="v\$\{package_version\}"/);
  assert.match(releaseWorkflow, /"\$GITHUB_REF_NAME" != "\$expected_tag"/);
  assert.match(releaseWorkflow, /release_notes_path="\.github\/release-notes\/\$\{GITHUB_REF_NAME\}\.md"/);
  assert.match(releaseWorkflow, /Missing bilingual release notes/);
  assert.match(releaseWorkflow, /for heading in "## 中文" "## English"/);
  assert.match(releaseWorkflow, /- name: Test\n\s+run: npm test/);
  assert.match(releaseWorkflow, /--notes-file "\$RELEASE_NOTES_PATH"/);
  assert.match(releaseWorkflow, /--draft \\\n\s+--prerelease=false \\\n\s+--verify-tag/);
  assert.match(releaseWorkflow, /gh api --paginate "repos\/\$\{GITHUB_REPOSITORY\}\/releases\?per_page=100"/);
  assert.doesNotMatch(releaseWorkflow, /--paginate --slurp[\s\S]*?--jq/);
  assert.doesNotMatch(releaseWorkflow, /releases\/tags\/\$\{GITHUB_REF_NAME\}/);
  assert.doesNotMatch(releaseWorkflow, /\|\| true/);
  assert.match(releaseWorkflow, /is already published or could not be resolved as a draft/);
  assert.match(releaseWorkflow, /--prerelease=false/);
  assert.ok((releaseWorkflow.match(/git merge-base --is-ancestor/g) || []).length >= 4);
  assert.ok((releaseWorkflow.match(/must still be a non-prerelease draft/g) || []).length >= 2);
  assert.match(releaseWorkflow, /releases\/\$\{release_id\}\/assets\?per_page=100/);
  assert.match(releaseWorkflow, /Release assets do not match the exact verified five-file set/);
  assert.match(releaseWorkflow, /npm run release:verify/);
  assert.match(releaseWorkflow, /hdiutil verify/);
  assert.match(releaseWorkflow, /unzip -tq/);
  assert.match(releaseWorkflow, /\[\.id, \.draft, \.prerelease\] \| @tsv/);
  assert.match(releaseWorkflow, /-F draft=false/);
  assert.match(releaseWorkflow, /-F prerelease=false/);
  assert.match(releaseWorkflow, /-f make_latest=legacy/);
  const createIndex = releaseWorkflow.indexOf(createDraft);
  const uploadIndex = releaseWorkflow.indexOf(uploadAssets);
  const archiveIndex = releaseWorkflow.indexOf(archiveArtifacts);
  const publishIndex = releaseWorkflow.indexOf(publishRelease);
  assert.ok(createIndex >= 0);
  assert.ok(uploadIndex > createIndex);
  assert.ok(archiveIndex > uploadIndex);
  assert.ok(publishIndex > archiveIndex);
});

test('verifies the exact release files against manifest sizes and SHA-512 digests', (context) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-aigis-release-'));
  context.after(() => fs.rmSync(tempDirectory, { force: true, recursive: true }));
  const version = '9.8.7';
  const zipName = `MT-Aigis-${version}-arm64.zip`;
  const dmgName = `MT-Aigis-${version}-arm64.dmg`;
  const zipBlockmapName = `${zipName}.blockmap`;
  const dmgBlockmapName = `${dmgName}.blockmap`;
  const zip = Buffer.from('zip artifact');
  const dmg = Buffer.from('dmg artifact');
  const digest = (buffer) => require('node:crypto').createHash('sha512').update(buffer).digest('base64');
  const blockmap = zlib.gzipSync(Buffer.from(JSON.stringify({
    version: '2',
    files: [{ name: 'file', offset: 0, checksums: ['digest'], sizes: [1] }],
  })));
  fs.writeFileSync(path.join(tempDirectory, zipName), zip);
  fs.writeFileSync(path.join(tempDirectory, dmgName), dmg);
  fs.writeFileSync(path.join(tempDirectory, zipBlockmapName), blockmap);
  fs.writeFileSync(path.join(tempDirectory, dmgBlockmapName), blockmap);
  const manifestPath = path.join(tempDirectory, 'latest-mac.yml');
  fs.writeFileSync(manifestPath, [
    `version: ${version}`,
    'files:',
    `  - url: https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/${zipName}`,
    `    sha512: ${digest(zip)}`,
    `    size: ${zip.length}`,
    `  - url: https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/${dmgName}`,
    `    sha512: ${digest(dmg)}`,
    `    size: ${dmg.length}`,
    `path: ${zipName}`,
    `sha512: ${digest(zip)}`,
    '',
  ].join('\n'));

  assert.deepEqual(verifyReleaseArtifacts(manifestPath, tempDirectory, version), {
    version,
    files: [zipName, zipBlockmapName, dmgName, dmgBlockmapName, 'latest-mac.yml'],
  });
  assert.throws(
    () => verifyReleaseArtifacts(manifestPath, tempDirectory, '9.8.8'),
    /does not match package version/,
  );
  const validManifest = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(
    manifestPath,
    validManifest.replace(`\nsha512: ${digest(zip)}\n`, '\nsha512: invalid-top-level-digest\n'),
  );
  assert.throws(
    () => verifyReleaseArtifacts(manifestPath, tempDirectory, version),
    /top-level SHA-512 must match/,
  );
  fs.writeFileSync(
    manifestPath,
    validManifest.replace(`path: ${zipName}`, `path: ${dmgName}`),
  );
  assert.throws(
    () => verifyReleaseArtifacts(manifestPath, tempDirectory, version),
    /top-level path must point to the ZIP/,
  );
  fs.writeFileSync(manifestPath, validManifest);
  fs.writeFileSync(path.join(tempDirectory, zipBlockmapName), 'not a blockmap');
  assert.throws(
    () => verifyReleaseArtifacts(manifestPath, tempDirectory, version),
    /not a valid gzip-compressed JSON blockmap/,
  );
  fs.writeFileSync(path.join(tempDirectory, zipBlockmapName), blockmap);
  fs.appendFileSync(path.join(tempDirectory, dmgName), 'corrupt');
  assert.throws(
    () => verifyReleaseArtifacts(manifestPath, tempDirectory, version),
    /size does not match the manifest/,
  );
});
