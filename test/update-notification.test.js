const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatReleaseNotes,
  getUpdateSeed,
  isValidUpdateVersion,
  localizedReleaseNotes,
  matchesSha512,
  normalizeGithubRelease,
  resolveUpdateAssetUrl,
  trustedReleaseUrl,
} = require('../lib/update-notification');

test('normalizes GitHub release metadata into safe dialog content', () => {
  const release = normalizeGithubRelease({
    tag_name: 'v1.2.0',
    name: 'MT-Aigis 1.2.0',
    body: '## Changes\n\n- Fix the frame\n- Read the [notes](https://example.com)',
    html_url: 'https://github.com/KaguraMatsuri/MT-Aigis/releases/tag/v1.2.0',
    published_at: '2026-08-26T00:00:00Z',
  }, '1.2.0');

  assert.deepEqual(release, {
    version: '1.2.0',
    displayVersion: 'v1.2.0',
    title: 'MT-Aigis 1.2.0',
    notes: 'Changes\n\n• Fix the frame\n• Read the notes',
    url: 'https://github.com/KaguraMatsuri/MT-Aigis/releases/tag/v1.2.0',
    publishedAt: '2026-08-26T00:00:00Z',
    seed: false,
  });
});

test('limits release notes and rejects non-project release links', () => {
  assert.equal(formatReleaseNotes('x'.repeat(5000)).length, 4000);
  assert.equal(trustedReleaseUrl('https://example.com/fake-release'), '');
  assert.equal(trustedReleaseUrl('http://github.com/KaguraMatsuri/MT-Aigis/releases'), '');
});

test('selects the localized notes from a bilingual GitHub release', () => {
  const body = [
    '## 中文',
    '',
    '[功能] 中文更新内容.',
    '',
    '## English',
    '',
    '[Feature] English release notes.',
  ].join('\n');

  assert.equal(localizedReleaseNotes(body, 'zh'), '[功能] 中文更新内容.');
  assert.equal(localizedReleaseNotes(body, 'zh-Hant'), '[功能] 中文更新内容.');
  assert.equal(localizedReleaseNotes(body, 'en'), '[Feature] English release notes.');
  assert.equal(localizedReleaseNotes(body, 'ja'), '[Feature] English release notes.');
  assert.equal(normalizeGithubRelease({ body }, '1.2.0', 'zh').notes, '[功能] 中文更新内容.');
});

test('selects Traditional Chinese release notes while keeping other language sections separate', () => {
  const body = '## 中文\n\n简体说明\n\n## 繁體中文\n\n- 繁體說明\n\n## English\n\nEnglish notes';
  assert.equal(localizedReleaseNotes(body, 'zh-Hant'), '• 繁體說明');
  assert.equal(localizedReleaseNotes(body, 'zh'), '简体说明');
  assert.equal(localizedReleaseNotes(body, 'en'), 'English notes');
  assert.equal(localizedReleaseNotes(body, 'ja'), 'English notes');
  assert.equal(normalizeGithubRelease({ body }, '1.2.0', 'zh-Hant').notes, '• 繁體說明');
  assert.equal(localizedReleaseNotes('## English\nEnglish only', 'zh-Hant'), 'English only');
  assert.equal(localizedReleaseNotes('## 繁體中文\n繁體說明', 'zh-Hant'), '繁體說明');
  assert.equal(localizedReleaseNotes('Unsectioned notes', 'zh-Hant'), 'Unsectioned notes');
});

test('provides Traditional Chinese development seed content', () => {
  const seed = getUpdateSeed('zh-Hant');
  assert.equal(seed.seed, true);
  assert.equal(seed.title, 'MT-Aigis 1.2.0 更新');
  assert.equal(seed.notes.split('\n').length, 7);
  assert.match(seed.notes, /視窗置頂/);
  assert.match(seed.notes, /遊戲網域預先連線/);
  assert.equal(seed.version, getUpdateSeed('zh').version);
  assert.equal(seed.url, getUpdateSeed('zh').url);
});

test('provides localized development seed content', () => {
  const seed = getUpdateSeed('zh');
  assert.equal(seed.seed, true);
  assert.equal(seed.displayVersion, 'v1.2.0');
  assert.deepEqual(seed.notes.split('\n'), [
    '[功能] 新增窗口置顶功能，可从标题栏快速切换并记住设置。',
    '[功能] 新增可选的匿名使用人数统计，并在首次启动时明确征求同意。',
    '[体验] 公告和更新提示迁移到原生浮层，游戏会在提示期间继续加载和运行。',
    '[体验] 侧栏、窗口大小和游戏画面现在会实时同步调整。',
    '[优化] 重构 DMM / FANZA 启动流程，只在真实游戏内容就绪后显示画面。',
    '[性能] 优化游戏域名预连接、缓存读取和侧栏滚动期间的后台刷新。',
    '[外观] 统一深色模式界面，并修正加载占位尺寸。',
  ]);
  assert.equal(seed.url, 'https://github.com/KaguraMatsuri/MT-Aigis/releases');
});

test('validates the base64 SHA-512 used by release manifests', () => {
  const digest = Buffer.alloc(64, 7).toString('base64');
  assert.equal(matchesSha512(digest, digest), true);
  assert.equal(matchesSha512(digest, Buffer.alloc(64, 8).toString('base64')), false);
  assert.equal(matchesSha512('', digest), false);
});

test('resolves update assets against the stable GitHub Release URL', () => {
  assert.equal(
    resolveUpdateAssetUrl('MT-Aigis-1.1.0-arm64.dmg'),
    'https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/MT-Aigis-1.1.0-arm64.dmg',
  );
  assert.equal(
    resolveUpdateAssetUrl('https://github.com/KaguraMatsuri/MT-Aigis/releases/download/v1.1.0/MT-Aigis-1.1.0-arm64.dmg'),
    'https://github.com/KaguraMatsuri/MT-Aigis/releases/download/v1.1.0/MT-Aigis-1.1.0-arm64.dmg',
  );
  assert.equal(resolveUpdateAssetUrl('https://example.com/MT-Aigis.dmg'), '');
  assert.equal(resolveUpdateAssetUrl('http://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/MT-Aigis.dmg'), '');
});

test('locks relative and latest asset URLs to the selected release version', () => {
  const asset = 'MT-Aigis-1.3.0-arm64.dmg';
  const pinned = `https://github.com/KaguraMatsuri/MT-Aigis/releases/download/v1.3.0/${asset}`;
  for (const url of [asset, `https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/${asset}`, pinned]) {
    assert.equal(resolveUpdateAssetUrl(url, '1.3.0'), pinned);
  }
});

test('rejects mismatched release tags, nested files, credentials, and malformed pinned URLs', () => {
  const prefix = 'https://github.com/KaguraMatsuri/MT-Aigis/releases/';
  for (const url of [
    `${prefix}download/v1.4.0/MT-Aigis-1.3.0-arm64.dmg`,
    `${prefix}tag/v1.3.0`,
    `${prefix}latest/download/nested/file.dmg`,
    `${prefix}latest/download/nested%2Ffile.dmg`,
    `${prefix}latest/download/nested%5Cfile.dmg`,
    `${prefix}latest/download/file.dmg?query=1`,
    `${prefix}latest/download/file.dmg#fragment`,
    `${prefix}latest/download/%FF.dmg`,
    `${prefix}latest/download/file.dmg`.replace('github.com', 'github.com:8443'),
    `${prefix}latest/download/file.dmg`.replace('github.com', 'user:pass@github.com'),
  ]) assert.equal(resolveUpdateAssetUrl(url, '1.3.0'), '', url);
});

test('accepts stable three-part update versions and rejects unsafe path components', () => {
  for (const version of ['0.0.0', '1.3.0', '12.34.56']) assert.equal(isValidUpdateVersion(version), true);
  for (const version of [null, 13, '', 'v1.3.0', '1.3', '1.3.0.1', '01.3.0', '1.3.0-beta.1', '1.3.0/../../../outside', '9007199254740992.0.0']) {
    assert.equal(isValidUpdateVersion(version), false);
    assert.equal(resolveUpdateAssetUrl('file.dmg', version), '');
  }
});
