const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatReleaseNotes,
  getUpdateSeed,
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
  assert.equal(localizedReleaseNotes(body, 'en'), '[Feature] English release notes.');
  assert.equal(localizedReleaseNotes(body, 'ja'), '[Feature] English release notes.');
  assert.equal(normalizeGithubRelease({ body }, '1.2.0', 'zh').notes, '[功能] 中文更新内容.');
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
