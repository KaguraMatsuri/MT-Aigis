const crypto = require('node:crypto');

const RELEASES_URL = 'https://github.com/KaguraMatsuri/MT-Aigis/releases';
const RELEASE_DOWNLOAD_URL = `${RELEASES_URL}/latest/download/`;
const MAX_RELEASE_NOTES_LENGTH = 4000;

const UPDATE_SEEDS = {
  zh: {
    displayVersion: 'v1.2.0',
    title: 'MT-Aigis 1.2.0 更新',
    notes: [
      '[功能] 新增窗口置顶功能，可从标题栏快速切换并记住设置。',
      '[功能] 新增可选的匿名使用人数统计，并在首次启动时明确征求同意。',
      '[体验] 公告和更新提示迁移到原生浮层，游戏会在提示期间继续加载和运行。',
      '[体验] 侧栏、窗口大小和游戏画面现在会实时同步调整。',
      '[优化] 重构 DMM / FANZA 启动流程，只在真实游戏内容就绪后显示画面。',
      '[性能] 优化游戏域名预连接、缓存读取和侧栏滚动期间的后台刷新。',
      '[外观] 统一深色模式界面，并修正加载占位尺寸。',
    ].join('\n'),
  },
  en: {
    displayVersion: 'v1.2.0',
    title: 'MT-Aigis 1.2.0 Update',
    notes: [
      '[Feature] Added a persistent always-on-top control in the title bar.',
      '[Feature] Added optional anonymous usage counts with explicit first-launch consent.',
      '[Experience] Moved notices and update prompts to a native overlay so the game keeps loading and running.',
      '[Experience] Synchronized sidebar transitions, window resizing, and the live game viewport.',
      '[Improvement] Reworked DMM / FANZA startup so only the playable game content is shown.',
      '[Performance] Improved game-origin preconnection, cache reads, and background refresh behavior while scrolling.',
      '[Appearance] Unified dark-mode surfaces and corrected the loading placeholder geometry.',
    ].join('\n'),
  },
  ja: {
    displayVersion: 'v1.2.0',
    title: 'MT-Aigis 1.2.0 アップデート',
    notes: [
      '[機能] タイトルバーに設定を記憶する最前面表示ボタンを追加しました。',
      '[機能] 初回起動時に明示的な同意を求める、任意参加の匿名利用数統計を追加しました。',
      '[操作性] お知らせと更新案内をネイティブオーバーレイへ移し、表示中もゲームの読み込みと実行を継続します。',
      '[操作性] サイドバー、ウインドウサイズ、ゲーム画面の変化をリアルタイムで同期しました。',
      '[改善] DMM / FANZA の起動処理を見直し、実際のゲーム内容だけを表示するようにしました。',
      '[性能] ゲーム接続先の事前接続、キャッシュ読み取り、スクロール中のバックグラウンド更新を最適化しました。',
      '[外観] ダークモードの表示面を統一し、読み込みプレースホルダーのサイズを修正しました。',
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

function localizedReleaseNotes(markdown, language) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n');
  const sections = {};
  const headingPattern = /^##\s+(中文|English)\s*$/gmi;
  const headings = [...source.matchAll(headingPattern)];
  headings.forEach((heading, index) => {
    const key = heading[1].toLowerCase() === 'english' ? 'en' : 'zh';
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : source.length;
    sections[key] = source.slice(start, end).trim();
  });
  if (Object.keys(sections).length === 0) return formatReleaseNotes(source);
  const preferred = language === 'zh' ? 'zh' : 'en';
  return formatReleaseNotes(sections[preferred] || sections.en || sections.zh || '');
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

function resolveUpdateAssetUrl(rawUrl) {
  try {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    const parsed = new URL(value, RELEASE_DOWNLOAD_URL);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      parsed.pathname.startsWith('/KaguraMatsuri/MT-Aigis/releases/')
    ) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeGithubRelease(payload, manifestVersion, language = 'en') {
  const source = payload || {};
  const fallbackVersion = cleanVersion(manifestVersion);
  const tagVersion = cleanVersion(source.tag_name);
  return {
    version: fallbackVersion || tagVersion,
    displayVersion: String(source.tag_name || fallbackVersion || '').trim(),
    title: String(source.name || '').trim(),
    notes: localizedReleaseNotes(source.body, language),
    url: trustedReleaseUrl(source.html_url),
    publishedAt: String(source.published_at || ''),
    seed: false,
  };
}

function getUpdateSeed(language) {
  const source = UPDATE_SEEDS[language] || UPDATE_SEEDS.en;
  return {
    version: '1.2.0',
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
  localizedReleaseNotes,
  matchesSha512,
  normalizeGithubRelease,
  resolveUpdateAssetUrl,
  trustedReleaseUrl,
};
