const crypto = require('node:crypto');

const RELEASES_URL = 'https://github.com/KaguraMatsuri/MT-Aigis/releases';
const MAX_RELEASE_NOTES_LENGTH = 4000;

const UPDATE_SEEDS = {
  zh: {
    displayVersion: 'v1.1.0',
    title: 'MT-Aigis 1.1.0 更新',
    notes: [
      '[功能] 现在 账户 / 密码 / 2FA 均可进行一键填充.',
      '[功能] 增加官方游戏公告, 将显示最近三条, 支持在MT-Aigis中预览与跳转.',
      '[功能] 现在允许自定义游戏链接.',
      '[优化] 优化游戏页面裁切, 修复了旧版本的黑边.',
    ].join('\n'),
  },
  en: {
    displayVersion: 'v1.1.0',
    title: 'MT-Aigis 1.1.0 Update',
    notes: [
      '[Feature] Account, password, and 2FA can now be filled with one click.',
      '[Feature] Added official game notices. The latest three are shown and can be previewed in MT-Aigis or opened on the official page.',
      '[Feature] Custom game URLs are now supported.',
      '[Improvement] Improved game page cropping and fixed the black borders found in older versions.',
    ].join('\n'),
  },
  ja: {
    displayVersion: 'v1.1.0',
    title: 'MT-Aigis 1.1.0 アップデート',
    notes: [
      '[機能] アカウント / パスワード / 2FA をワンクリックで入力可能.',
      '[機能] 公式ゲームのお知らせを追加. 最新三件を表示し, MT-Aigis 内でのプレビューと公式ページへの移動に対応.',
      '[機能] カスタムゲーム URL に対応.',
      '[改善] ゲームページの表示範囲を最適化し, 旧バージョンの黒帯を修正.',
    ].join('\n'),
  },
};

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v(?=\d)/i, '');
}

function matchesSha512(actualDigest, expectedDigest) {
  try {
    const actual = Buffer.from(String(actualDigest || ''), 'base64');
    const expected = Buffer.from(String(expectedDigest || ''), 'base64');
    return actual.length === 64 &&
      expected.length === 64 &&
      crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function formatReleaseNotes(markdown) {
  const text = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= MAX_RELEASE_NOTES_LENGTH) return text;
  return `${text.slice(0, MAX_RELEASE_NOTES_LENGTH - 1).trimEnd()}…`;
}

function trustedReleaseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      (
        parsed.pathname === '/KaguraMatsuri/MT-Aigis/releases' ||
        parsed.pathname.startsWith('/KaguraMatsuri/MT-Aigis/releases/')
      )
    ) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeGithubRelease(payload, manifestVersion) {
  const source = payload || {};
  const fallbackVersion = cleanVersion(manifestVersion);
  const tagVersion = cleanVersion(source.tag_name);
  return {
    version: fallbackVersion || tagVersion,
    displayVersion: String(source.tag_name || fallbackVersion || '').trim(),
    title: String(source.name || '').trim(),
    notes: formatReleaseNotes(source.body),
    url: trustedReleaseUrl(source.html_url),
    publishedAt: String(source.published_at || ''),
    seed: false,
  };
}

function getUpdateSeed(language) {
  const source = UPDATE_SEEDS[language] || UPDATE_SEEDS.en;
  return {
    version: '1.1.0',
    displayVersion: source.displayVersion,
    title: source.title,
    notes: source.notes,
    url: RELEASES_URL,
    publishedAt: '',
    seed: true,
  };
}

module.exports = {
  formatReleaseNotes,
  getUpdateSeed,
  matchesSha512,
  normalizeGithubRelease,
  trustedReleaseUrl,
};
