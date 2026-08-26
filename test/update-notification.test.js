const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatReleaseNotes,
  getUpdateSeed,
  matchesSha512,
  normalizeGithubRelease,
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

test('provides localized development seed content', () => {
  const seed = getUpdateSeed('zh');
  assert.equal(seed.seed, true);
  assert.equal(seed.displayVersion, 'v1.1.0');
  assert.deepEqual(seed.notes.split('\n'), [
    '[功能] 现在 账户 / 密码 / 2FA 均可进行一键填充.',
    '[功能] 增加官方游戏公告, 将显示最近三条, 支持在MT-Aigis中预览与跳转.',
    '[功能] 现在允许自定义游戏链接.',
    '[优化] 优化游戏页面裁切, 修复了旧版本的黑边.',
  ]);
  assert.equal(seed.url, 'https://github.com/KaguraMatsuri/MT-Aigis/releases');
});

test('validates the base64 SHA-512 used by release manifests', () => {
  const digest = Buffer.alloc(64, 7).toString('base64');
  assert.equal(matchesSha512(digest, digest), true);
  assert.equal(matchesSha512(digest, Buffer.alloc(64, 8).toString('base64')), false);
  assert.equal(matchesSha512('', digest), false);
});
