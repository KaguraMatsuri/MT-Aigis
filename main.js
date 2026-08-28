const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  clipboard,
  ipcMain,
  shell,
  nativeTheme,
} = require('electron');
const log = require('electron-log/main');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SecureConfigStore, defaultConfig } = require('./lib/secure-config');
const { PlainVault, emptyVault } = require('./lib/plain-vault');
const {
  getAutofillSuggestion,
  getAutofillValues,
  isTrustedAutofillUrl,
} = require('./lib/autofill');
const {
  DEFAULT_URL,
  isAdaptedPage,
  isWebUrl,
  normalizeCustomUrl,
} = require('./lib/navigation');
const {
  getUpdateSeed,
  matchesSha512,
  normalizeGithubRelease,
  resolveUpdateAssetUrl,
} = require('./lib/update-notification');
const {
  buildGameNewsDiskCache,
  GAME_NEWS_LIST_URL,
  latestGameNewsItems,
  normalizeGameNewsDiskCache,
  parseGameNewsDetail,
  parseGameNewsList,
  pruneGameNewsDetailCache,
  trustedGameNewsUrl,
} = require('./lib/game-news');
const {
  createAnonymousUsageClient,
  createInstallationId,
  isValidInstallationId,
} = require('./lib/anonymous-usage');

const WINDOW_W = 1320;
const WINDOW_H = 760;
const TOP_BAR_H = 48;
const BOTTOM_BAR_H = 52;
const MIN_WINDOW_W = 900;
const MIN_WINDOW_H = 620;
const SIDEBAR_OPEN_WIDTH = 360;
const SIDEBAR_CLOSED_WIDTH = 44;
const VIEW_PARTITION = 'persist:mt-aigis-view';
const CHROME_VERSION = process.versions.chrome || '144.0.0.0';
const CHROME_UA = `Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const GAME_URL = DEFAULT_URL;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.5;
const APP_DISPLAY_VERSION = '1.2.0';
const AUTHOR_NAME = 'No.zomu';
const CONTACT_EMAIL = 'SeaRoach@proton.me';
const QQ_GROUP = '1283962190';
const GITHUB_REPO = 'https://github.com/KaguraMatsuri/MT-Aigis';
const GITHUB_RELEASE_API_URL = 'https://api.github.com/repos/KaguraMatsuri/MT-Aigis/releases/latest';
const UPDATE_MANIFEST_URL = `${GITHUB_REPO}/releases/latest/download/latest-mac.yml`;
const GAME_NEWS_CACHE_MS = 30 * 60 * 1000;
const GAME_NEWS_LIMIT = 3;
const TELEMETRY_ENDPOINT = process.env.MT_AIGIS_TELEMETRY_ENDPOINT ||
  'https://mt-aigis-telemetry.mt-aigis-telemetry-worker.workers.dev';
const TELEMETRY_START_FALLBACK_MS = 20_000;
const THEME_COLORS = {
  dark: '#101011',
  light: '#f2f2f7',
  ringDark: 'rgba(255,255,255,0.16)',
  ringLight: 'rgba(60,60,67,0.20)',
};
const NETWORK_TARGETS = {
  proton: { label: 'proton.me', url: 'https://proton.me/' },
  google: { label: 'google.com', url: 'https://www.google.com/' },
  dmm: {
    label: 'dmm.com',
    probes: [
      'https://www.dmm.com/favicon.ico',
      'https://play.games.dmm.com/favicon.ico',
      'https://accounts.dmm.com/favicon.ico',
    ],
  },
  bilibili: { label: 'bilibili.com', url: 'https://www.bilibili.com/' },
};
const ALLOWED_HOST_PARTS = [
  'dmm.com',
  'dmm.co.jp',
  'games.dmm.com',
  'activate.games.dmm.com',
  'personal.games.dmm.com',
  'cloudfront.net',
  'millennium-war.net',
];
const TRACKER_RULES = [
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googleadservices.com/*',
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.facebook.net/*',
  '*://*.facebook.com/tr/*',
  '*://*.criteo.com/*',
  '*://*.hotjar.com/*',
];
const GAME_AUXILIARY_FRAME_RULES = [
  'https://drc1bk94f7rq8.cloudfront.net/00/html/main.htm',
  'https://drc1bk94f7rq8.cloudfront.net/00/html/main_all.htm',
];
const CACHE_STATS_TTL_MS = 15_000;
const APP_TEXT = {
  zh: {
    aboutMenu: '关于 MT-Aigis',
    quitMenu: '退出 MT-Aigis',
    aboutTitle: '关于 MT-Aigis',
    subtitle: '千年战争Aigis macOS Client',
    contact: '联系方式',
    qq: 'QQ',
    copyright: `作者 ${AUTHOR_NAME}`,
    ready: '准备就绪',
    updateChecking: '检查中',
    updateAvailable: '发现新版本 {version}',
    updateDownloadingPercent: '正在下载 {percent}%...',
    updateCurrent: '未检测到更新',
    updateDeferred: '已暂缓本次更新',
    updateOpening: '正在打开安装器',
    updateOpened: '安装器已打开',
    updateFailed: '更新失败',
    updatePromptKicker: '下个版本',
    updatePromptDownload: '下载更新',
    updatePromptLater: '稍后',
    updateSeedShown: '已显示 Seed 更新通知',
    updateSeedDownload: '已验证 Seed 下载操作（开发版未下载安装）',
  },
  en: {
    aboutMenu: 'About MT-Aigis',
    quitMenu: 'Quit MT-Aigis',
    aboutTitle: 'About MT-Aigis',
    subtitle: '千年戦争アイギス macOS Client',
    contact: 'Contact',
    qq: 'QQ',
    copyright: `Author ${AUTHOR_NAME}`,
    ready: 'Ready',
    updateChecking: 'Checking',
    updateAvailable: 'Version {version} is available',
    updateDownloadingPercent: 'Downloading {percent}%...',
    updateCurrent: 'No update found',
    updateDeferred: 'Update postponed for this launch',
    updateOpening: 'Opening installer',
    updateOpened: 'Installer opened',
    updateFailed: 'Update failed',
    updatePromptKicker: 'Next Version',
    updatePromptDownload: 'Download Update',
    updatePromptLater: 'Later',
    updateSeedShown: 'Seed update notice shown',
    updateSeedDownload: 'Seed download action verified (nothing was downloaded in development)',
  },
  ja: {
    aboutMenu: 'MT-Aigis について',
    quitMenu: 'MT-Aigis を終了',
    aboutTitle: 'MT-Aigis について',
    subtitle: '千年戦争アイギス macOS Client',
    contact: '連絡先',
    qq: 'QQ',
    copyright: `作者 ${AUTHOR_NAME}`,
    ready: '準備完了',
    updateChecking: '確認中',
    updateAvailable: '新しいバージョン {version} があります',
    updateDownloadingPercent: 'ダウンロード中 {percent}%...',
    updateCurrent: '更新はありません',
    updateDeferred: '今回の更新を延期しました',
    updateOpening: 'インストーラを開いています',
    updateOpened: 'インストーラを開きました',
    updateFailed: '更新に失敗しました',
    updatePromptKicker: '次のバージョン',
    updatePromptDownload: 'アップデートをダウンロード',
    updatePromptLater: '後で',
    updateSeedShown: 'Seed 更新通知を表示しました',
    updateSeedDownload: 'Seed のダウンロード操作を確認しました（開発版では未実行）',
  },
};

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-translate');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features',
  'ChromeWhatsNewUI,TranslateUI,MediaRouter,PrivacySandboxSettings4,' +
  'SafeBrowsing,OptimizationHints,NetworkTimeServiceQuerying,' +
  'AutofillServerCommunication,PasswordLeakDetection,' +
  'LookalikeUrlNavigationSuggestions,MediaFeeds,InterestCohortAPI,' +
  'Fledge,Topics,SharedStorageAPI,PrivateAggregationAPI,AttributionReporting,' +
  'HttpsUpgrades,OmniboxDocumentProvider,DnsOverHttps,CalculateNativeWinOcclusion,' +
  'GlobalMediaControls,CastMediaRouteProvider,WebRtcHideLocalIpsWithMdns,' +
  'TracingServiceInProcess,BackgroundTracing,CertificateTransparencyAuditing'
);
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disk-cache-size', String(1024 * 1024 * 1024));
app.commandLine.appendSwitch('media-cache-size', String(256 * 1024 * 1024));

app.setName('MT-Aigis');
app.name = 'MT-Aigis';
const LEGACY_USER_DATA = path.join(__dirname, '.user-data');
const SYS_USER_DATA = path.join(app.getPath('appData'), 'MT-Aigis');
const USER_DATA = SYS_USER_DATA;
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);
const LOG_DIR = path.join(USER_DATA, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const DEBUG_LOG = path.join(LOG_DIR, 'debug.log');
const GAME_NEWS_CACHE_FILE = path.join(USER_DATA, 'cache', 'game-news.json');

const store = new SecureConfigStore(path.join(USER_DATA, 'secure'));
const vault = new PlainVault(path.join(USER_DATA, 'secure', 'vault.json'));
let currentConfig = normalizeConfig(store.load());
let mainWindow = null;
let gameView = null;
let overlayView = null;
let overlayReady = null;
let overlayState = null;
let aboutWindow = null;
let focusSource = '';
let scrollSource = '';
let containerFocusSource = '';
let navigationMode = 'boot';
let sessionFlushTimer = null;
let gameContentReady = false;
let gameViewLoadingMasked = true;
let gameViewFallbackHidden = normalizeTelemetryConsent(currentConfig.telemetry.consent) === null;
let quitAfterFlush = false;
let sidebarCollapsed = !!currentConfig.view.sidebarCollapsed;
let layoutPending = false;
let layoutPresentationTimer = null;
let sidebarTransitionActive = false;
let cacheStatsCache = null;
let cacheStatsAt = 0;
let cacheStatsTask = null;
let cacheClearTask = null;
let gameViewAttached = false;
let updateState = {
  status: 'idle',
  message: '',
  version: '',
  error: '',
};
let updateDownloadTask = null;
let updatePrompt = null;
let telemetryStartFallbackTimer = null;
const telemetryConsentWaiters = new Set();
let gameNewsCache = { items: [], fetchedAt: 0 };
let gameNewsTask = null;
const gameNewsDetailCache = new Map();
const gameNewsDetailTasks = new Map();
let gameNewsDetailUrls = new Set();

const anonymousUsage = createAnonymousUsageClient({
  endpoint: TELEMETRY_ENDPOINT,
  getInstallationId: () => currentConfig.telemetry.installationId,
  onState: (state) => sendToRenderer('telemetry:state', getPublicTelemetryState(state)),
});

log.initialize();
loadGameNewsDiskCache();

function debugLog(...parts) {
  try {
    if (fs.existsSync(DEBUG_LOG) && fs.statSync(DEBUG_LOG).size > 2 * 1024 * 1024) {
      fs.renameSync(DEBUG_LOG, `${DEBUG_LOG}.1`);
    }
  } catch {}
  const line = `[${new Date().toISOString()}] ${parts.map((part) => {
    if (typeof part === 'string') return part;
    try { return JSON.stringify(part); } catch { return String(part); }
  }).join(' ')}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG, line);
  } catch {}
  console.log('[MT-Aigis]', ...parts);
}

function loadGameNewsDiskCache() {
  try {
    if (!fs.existsSync(GAME_NEWS_CACHE_FILE)) return;
    const cached = normalizeGameNewsDiskCache(
      JSON.parse(fs.readFileSync(GAME_NEWS_CACHE_FILE, 'utf8'))
    );
    if (!cached) {
      debugLog('game-news-cache-invalid');
      return;
    }
    gameNewsCache = { items: cached.items, fetchedAt: cached.fetchedAt };
    cached.details.forEach((detail) => gameNewsDetailCache.set(detail.url, detail));
    gameNewsDetailUrls = pruneGameNewsDetailCache(
      gameNewsDetailCache,
      cached.items,
      GAME_NEWS_LIMIT
    );
    debugLog('game-news-cache-loaded', {
      items: cached.items.length,
      details: gameNewsDetailCache.size,
    });
  } catch (error) {
    debugLog('game-news-cache-read-error', error && error.message ? error.message : String(error));
  }
}

function saveGameNewsDiskCache() {
  try {
    const payload = buildGameNewsDiskCache(
      gameNewsCache.items,
      gameNewsCache.fetchedAt,
      gameNewsDetailCache,
      GAME_NEWS_LIMIT
    );
    const directory = path.dirname(GAME_NEWS_CACHE_FILE);
    const temporaryFile = `${GAME_NEWS_CACHE_FILE}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryFile, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryFile, GAME_NEWS_CACHE_FILE);
  } catch (error) {
    debugLog('game-news-cache-write-error', error && error.message ? error.message : String(error));
  }
}

function loadResource(name) {
  try {
    return fs.readFileSync(path.join(__dirname, 'resources', name), 'utf8');
  } catch {
    return '';
  }
}

function currentScheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function gameFillColor() {
  return THEME_COLORS[currentScheme()];
}

function gameRingColor() {
  return currentScheme() === 'dark' ? THEME_COLORS.ringDark : THEME_COLORS.ringLight;
}

function updateNativeAppearance() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(gameFillColor());
  }
  if (gameView && !gameView.webContents.isDestroyed()) {
    gameView.setBackgroundColor(gameFillColor());
    applyGamePresentation();
  }
}

function configureAboutPanel() {
  if (process.platform !== 'darwin') return;
  const lang = effectiveLanguage();
  app.setAboutPanelOptions({
    applicationName: 'MT-Aigis',
    applicationVersion: APP_DISPLAY_VERSION,
    version: APP_DISPLAY_VERSION,
    copyright: appText('copyright', {}, lang),
    authors: [AUTHOR_NAME],
    website: GITHUB_REPO,
    iconPath: path.join(__dirname, 'resources', 'icon.png'),
    credits: [
      appText('subtitle', {}, lang),
      `${appText('contact', {}, lang)}: ${CONTACT_EMAIL}`,
      `${appText('qq', {}, lang)}: ${QQ_GROUP}`,
    ].join('\n'),
  });
}

function showAboutDialog() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 460,
    height: 520,
    minWidth: 460,
    maxWidth: 460,
    minHeight: 520,
    maxHeight: 520,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    title: appText('aboutTitle'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 14 },
    backgroundColor: gameFillColor(),
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aboutWindow.setMenu(null);
  aboutWindow.once('ready-to-show', () => aboutWindow.show());
  aboutWindow.on('closed', () => { aboutWindow = null; });
  aboutWindow.loadFile(path.join(__dirname, 'ui', 'about.html'), {
    query: {
      lang: effectiveLanguage(),
      scheme: currentScheme(),
      version: APP_DISPLAY_VERSION,
      author: AUTHOR_NAME,
      contact: CONTACT_EMAIL,
      qq: QQ_GROUP,
    },
  }).catch((error) => {
    debugLog('about-window-error', error && error.message ? error.message : String(error));
  });
}

function buildAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'MT-Aigis',
      submenu: [
        { label: appText('aboutMenu'), click: showAboutDialog },
        { type: 'separator' },
        { role: 'quit', label: appText('quitMenu') },
      ],
    },
  ]);
}

function appText(key, values = {}, language = effectiveLanguage()) {
  const table = APP_TEXT[language] || APP_TEXT.en;
  const template = table[key] || APP_TEXT.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : ''
  );
}

function setUpdateState(status, message, extra = {}) {
  updateState = {
    ...updateState,
    status,
    message,
    error: '',
    ...extra,
  };
  sendToRenderer('update:state', updateState);
  debugLog('update-state', updateState);
}

function formatUpdateError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (/releases\.atom|latest-mac\.yml|\b404\b|missing dmg|invalid manifest/i.test(message)) {
    return appText('updateCurrent');
  }
  return appText('updateFailed');
}

function parseLatestManifest(source) {
  const manifest = {
    version: '',
    files: [],
  };
  let currentFile = null;
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    let match = line.match(/^version:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      manifest.version = match[1].trim();
      continue;
    }
    match = line.match(/^\s*-\s+url:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      currentFile = { url: match[1].trim(), sha512: '', size: 0 };
      manifest.files.push(currentFile);
      continue;
    }
    if (!currentFile) continue;
    match = line.match(/^\s+sha512:\s*['"]?(.+?)['"]?\s*$/);
    if (match) {
      currentFile.sha512 = match[1].trim();
      continue;
    }
    match = line.match(/^\s+size:\s*(\d+)\s*$/);
    if (match) {
      currentFile.size = Number.parseInt(match[1], 10) || 0;
    }
  }
  return manifest;
}

function compareVersions(a, b) {
  const left = String(a || '').split('.').map((item) => Number.parseInt(item, 10) || 0);
  const right = String(b || '').split('.').map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

async function fetchTextWithMeta(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': CHROME_UA,
      accept: 'text/plain, text/yaml, */*',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    text: await response.text(),
    url: response.url || url,
  };
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': CHROME_UA,
      accept: 'application/octet-stream,*/*',
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status || 0}`);
  }
  return response;
}

function appVersionValue() {
  return app.getVersion ? app.getVersion() : '0.0.0';
}

function pickDmgAsset(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return null;
  return manifest.files.find((item) => /\.dmg$/i.test(item.url || '')) || null;
}

async function readLatestManifest() {
  const result = await fetchTextWithMeta(UPDATE_MANIFEST_URL);
  const manifest = parseLatestManifest(result.text);
  const dmg = pickDmgAsset(manifest);
  if (!manifest.version) throw new Error('invalid manifest');
  if (!dmg) throw new Error('missing dmg');
  const downloadUrl = resolveUpdateAssetUrl(dmg.url);
  if (!downloadUrl) throw new Error('invalid dmg URL');
  return {
    ...manifest,
    manifestUrl: result.url,
    dmg: {
      ...dmg,
      downloadUrl,
    },
  };
}

async function readLatestGithubRelease(manifestVersion = '') {
  const response = await fetch(GITHUB_RELEASE_API_URL, {
    redirect: 'follow',
    headers: {
      'user-agent': CHROME_UA,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release HTTP ${response.status}`);
  }
  return normalizeGithubRelease(await response.json(), manifestVersion, effectiveLanguage());
}

async function showUpdateNotification(release) {
  const canContinue = await waitForTelemetryConsent();
  if (!canContinue) return 'later';
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve('later');
  return new Promise((resolve) => {
    updatePrompt = { release, resolve, surface: 'overlay' };
    showOverlay({
      kind: 'app-update',
      language: effectiveLanguage(),
      kicker: appText('updatePromptKicker'),
      title: release.title || 'MT-Aigis',
      date: release.displayVersion || release.version || '',
      body: release.notes || '',
      closeLabel: appText('updatePromptLater'),
      visitLabel: appText('updatePromptDownload'),
    }).catch((error) => {
      debugLog('update-overlay-error', error && error.message ? error.message : String(error));
      return false;
    }).then((opened) => {
      if (opened || !updatePrompt || updatePrompt.release !== release) return;
      updatePrompt.surface = 'renderer';
      gameViewFallbackHidden = true;
      syncGameViewVisibility();
      sendToRenderer('update:prompt', release);
    });
  });
}

async function showSeedUpdateNotification() {
  try {
    await readLatestGithubRelease();
  } catch (error) {
    debugLog('github-release-check-error', error && error.message ? error.message : String(error));
  }
  const seed = getUpdateSeed(effectiveLanguage());
  setUpdateState('seed', appText('updateAvailable', { version: seed.displayVersion }), {
    version: seed.version,
    release: seed,
  });
  const action = await showUpdateNotification(seed);
  setUpdateState('dev', appText(action === 'install' ? 'updateSeedDownload' : 'updateSeedShown'), {
    version: seed.version,
    release: seed,
  });
  return updateState;
}

async function downloadUpdateDmg(manifest) {
  const version = manifest.version || 'latest';
  const updateDir = path.join(app.getPath('downloads') || path.join(os.homedir(), 'Downloads'), 'MT-Aigis Updates');
  const finalPath = path.join(updateDir, `MT-Aigis-${version}.dmg`);
  const tempPath = `${finalPath}.download`;
  fs.mkdirSync(updateDir, { recursive: true });
  const response = await fetchBinary(manifest.dmg.downloadUrl);
  const total = Number.parseInt(response.headers.get('content-length') || '', 10) || manifest.dmg.size || 0;
  const reader = response.body.getReader();
  const stream = fs.createWriteStream(tempPath);
  const digest = crypto.createHash('sha512');
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const chunk = Buffer.from(value);
      digest.update(chunk);
      stream.write(chunk);
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
      setUpdateState('downloading', appText('updateDownloadingPercent', { percent }), { version });
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    if (!matchesSha512(digest.digest('base64'), manifest.dmg.sha512)) {
      throw new Error('update checksum mismatch');
    }
    fs.renameSync(tempPath, finalPath);
    return finalPath;
  } catch (error) {
    try { stream.destroy(); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function openInstallerAndQuit(installerPath) {
  setUpdateState('opening', appText('updateOpening'));
  return shell.openPath(installerPath).then((result) => {
    if (result) throw new Error(result);
    setUpdateState('opened', appText('updateOpened'));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    setTimeout(() => app.quit(), 600);
    return updateState;
  });
}

function setupAutoUpdater() {
  return true;
}

function checkForUpdates() {
  if (updateDownloadTask) return updateDownloadTask;
  setUpdateState('checking', appText('updateChecking'), { version: '', release: null });
  if (!app.isPackaged) {
    updateDownloadTask = showSeedUpdateNotification()
      .finally(() => {
        updateDownloadTask = null;
      });
    return updateDownloadTask;
  }

  updateDownloadTask = Promise.all([
    readLatestManifest(),
    readLatestGithubRelease().catch((error) => {
      debugLog('github-release-check-error', error && error.message ? error.message : String(error));
      return null;
    }),
  ])
    .then(async ([manifest, githubRelease]) => {
      if (compareVersions(manifest.version, appVersionValue()) <= 0) {
        setUpdateState('current', appText('updateCurrent'), { version: '', release: null });
        return updateState;
      }
      const release = githubRelease && compareVersions(githubRelease.version, manifest.version) === 0
        ? { ...githubRelease, version: manifest.version }
        : normalizeGithubRelease({}, manifest.version);
      setUpdateState('available', appText('updateAvailable', { version: release.displayVersion }), {
        version: manifest.version,
        release,
      });
      const action = await showUpdateNotification(release);
      if (action === 'install') {
        return downloadUpdateDmg(manifest).then(openInstallerAndQuit);
      }
      setUpdateState('deferred', appText('updateDeferred'), {
        version: manifest.version,
        release,
      });
      return updateState;
    })
    .catch((error) => {
      const message = formatUpdateError(error);
      const status = message === appText('updateCurrent') ? 'current' : 'error';
      setUpdateState(status, message, {
        version: '',
        release: null,
        error: status === 'error' ? message : '',
      });
      return updateState;
    })
    .finally(() => {
      updateDownloadTask = null;
    });
  return updateDownloadTask;
}

function isGameContentFrame(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === 'osapi.dmm.com' ||
      host === 'osapi.dmm.co.jp' ||
      host === 'drc1bk94f7rq8.cloudfront.net' ||
      host.endsWith('.millennium-war.net') ||
      host === 'millennium-war.net'
    );
  } catch {
    return false;
  }
}

function isPlayableGameFrame(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    return (
      (
        host === 'drc1bk94f7rq8.cloudfront.net' ||
        host.endsWith('.millennium-war.net') ||
        host === 'millennium-war.net'
      ) &&
      /\/aigis(?:_[a-z0-9-]+)?\.html?$/.test(pathname)
    );
  } catch {
    return false;
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  gameContentReady = false;
  gameViewFallbackHidden = normalizeTelemetryConsent(currentConfig.telemetry.consent) === null;
  layoutPending = false;
  debugLog('runtime', {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    arch: process.arch,
  });
  mainWindow = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    minWidth: MIN_WINDOW_W,
    minHeight: MIN_WINDOW_H,
    title: 'MT-Aigis',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    backgroundColor: gameFillColor(),
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  mainWindow.setAlwaysOnTop(!!currentConfig.view.alwaysOnTop);

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    updateLayout(false);
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('resize', updateLayout);
  for (const eventName of [
    'resized',
    'maximize',
    'unmaximize',
    'restore',
    'show',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    mainWindow.on(eventName, () => updateLayout(false));
  }
  mainWindow.webContents.on('before-input-event', (event, input) => {
    forwardNativeEditShortcut(mainWindow.webContents, input);
  });
  mainWindow.on('closed', () => {
    stopAnonymousUsageForWindow();
    resolveTelemetryConsentWaiters(false);
    gameContentReady = false;
    layoutPending = false;
    if (layoutPresentationTimer) clearTimeout(layoutPresentationTimer);
    layoutPresentationTimer = null;
    gameViewAttached = false;
    if (updatePrompt) {
      updatePrompt.resolve('later');
      updatePrompt = null;
    }
    if (gameView && !gameView.webContents.isDestroyed()) {
      gameView.webContents.close();
    }
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.close();
    }
    mainWindow = null;
    gameView = null;
    overlayView = null;
    overlayReady = null;
    overlayState = null;
  });

  createGameView();
  ensureOverlayView();
  prepareAnonymousUsageForWindow();
}

function createGameView() {
  gameView = new WebContentsView({
    webPreferences: {
      partition: VIEW_PARTITION,
      preload: path.join(__dirname, 'resources', 'dmm-autofill-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  focusSource = loadResource('game-focus.js');
  scrollSource = loadResource('game-scroll.js');
  containerFocusSource = loadResource('game-container-focus.js');

  mainWindow.contentView.addChildView(gameView);
  gameViewAttached = true;
  syncGameViewVisibility();
  gameView.webContents.setUserAgent(CHROME_UA);
  gameView.webContents.setBackgroundThrottling(false);
  gameView.setBackgroundColor(gameFillColor());
  gameView.webContents.insertCSS(`
    :not(input):not(textarea):not([contenteditable="true"]) {
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-touch-callout: none !important;
    }
    input,
    textarea,
    [contenteditable="true"] {
      user-select: text !important;
      -webkit-user-select: text !important;
      -webkit-touch-callout: default !important;
    }
    ::selection { background: Highlight !important; color: HighlightText !important; }
  `);

  gameView.webContents.on('did-frame-finish-load', (event, isMainFrame, frameProcessId, frameRoutingId) => {
    try {
      const frames = [
        gameView.webContents.mainFrame,
        ...gameView.webContents.mainFrame.framesInSubtree,
      ];
      const frame = isMainFrame
        ? gameView.webContents.mainFrame
        : frames.find((candidate) =>
          candidate.processId === frameProcessId && candidate.routingId === frameRoutingId
        );
      const adapterTask = installGameFrameAdapter(frame);
      if (frame && isPlayableGameFrame(frame.url)) {
        adapterTask.finally(markGameContentReady);
      }
    } catch (_) {}
  });

  gameView.webContents.on('did-start-navigation', (_, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    gameContentReady = false;
    gameViewLoadingMasked = isGameUrl(url);
    syncGameViewVisibility();
  });

  gameView.webContents.setZoomFactor(1);
  const gameSession = gameView.webContents.session;
  gameSession.setUserAgent(CHROME_UA, 'ja');
  gameSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  gameSession.webRequest.onBeforeRequest(
    { urls: [...TRACKER_RULES, ...GAME_AUXILIARY_FRAME_RULES] },
    (_, callback) => callback({ cancel: true })
  );
  gameSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    details.requestHeaders['Accept-Language'] = 'ja,en-US;q=0.9,en;q=0.8';
    delete details.requestHeaders['X-Requested-With'];
    callback({ requestHeaders: details.requestHeaders });
  });
  const sessionLogUrls = [
    'https://play.games.dmm.com/*',
    'https://play.games.dmm.co.jp/*',
    'https://artemis.games.dmm.com/*',
    'https://artemis.games.dmm.co.jp/*',
    'https://accounts.dmm.com/*',
    'https://accounts.dmm.co.jp/*',
  ];
  gameSession.webRequest.onCompleted({ urls: sessionLogUrls }, (details) => {
    if (details.resourceType === 'mainFrame' || details.url.includes('artemis.games.dmm.')) {
      debugLog('request-completed', {
        statusCode: details.statusCode,
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
      });
    }
    if (
      details.statusCode === 200 &&
      details.url.includes('/member/pc/init-game-frame/aigis')
    ) {
      navigationMode = 'game';
      scheduleSessionFlush('game-ready');
    }
  });
  gameSession.webRequest.onErrorOccurred({ urls: sessionLogUrls }, (details) => {
    debugLog('request-error', {
      error: details.error,
      method: details.method,
      url: details.url,
      resourceType: details.resourceType,
    });
  });
  gameSession.cookies.on('changed', () => scheduleSessionFlush('cookie-change'));
  gameSession.getCacheSize()
    .then((bytes) => debugLog('cache-ready', { bytes, path: USER_DATA }))
    .catch(() => {});

  attachNavigationHandlers();
  gameView.webContents.on('before-input-event', (event, input) => {
    forwardNativeEditShortcut(gameView.webContents, input);
    handleBeforeInputEvent(event, input);
  });
  updateLayout(false);
  initializeGameSession();
}

async function initializeGameSession() {
  try {
    await applyProxySettings();
  } catch (error) {
    debugLog('proxy-init-error', error && error.message ? error.message : String(error));
  }
  preconnectGameOrigins();
  await restoreAuthCookies();
  loadDirectGame('startup');
}

function preconnectGameOrigins() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const targetUrl = getHomeUrl();
  if (!isGameUrl(targetUrl)) return;

  const target = new URL(targetUrl);
  const dmmDomain = target.hostname.endsWith('.dmm.co.jp') ? 'dmm.co.jp' : 'dmm.com';
  const origins = [
    target.origin,
    `https://accounts.${dmmDomain}`,
    `https://artemis.games.${dmmDomain}`,
    `https://osapi.${dmmDomain}`,
    'https://drc1bk94f7rq8.cloudfront.net',
  ];

  for (const url of origins) {
    try {
      gameView.webContents.session.preconnect({ url, numSockets: 1 });
    } catch (error) {
      debugLog('game-preconnect-error', {
        url,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  debugLog('game-preconnect', { origins });
}

function normalizeTelemetryConsent(value) {
  return typeof value === 'boolean' ? value : null;
}

function getPublicTelemetryState(clientState = anonymousUsage.getState()) {
  const consent = normalizeTelemetryConsent(currentConfig.telemetry.consent);
  return {
    consent,
    configured: !!clientState.configured,
    status: consent === null
      ? 'pending'
      : consent
        ? clientState.status
        : 'disabled',
    stats: consent && clientState.stats ? { ...clientState.stats } : null,
  };
}

function ensureTelemetryInstallationId() {
  if (isValidInstallationId(currentConfig.telemetry.installationId)) return false;
  currentConfig.telemetry.installationId = createInstallationId();
  return true;
}

function clearTelemetryStartFallback() {
  if (telemetryStartFallbackTimer) clearTimeout(telemetryStartFallbackTimer);
  telemetryStartFallbackTimer = null;
}

function startAnonymousUsage(initialDelayMs = 0) {
  if (
    currentConfig.telemetry.consent !== true ||
    !mainWindow ||
    mainWindow.isDestroyed()
  ) return anonymousUsage.getState();
  if (ensureTelemetryInstallationId()) store.save(currentConfig);
  clearTelemetryStartFallback();
  return anonymousUsage.start(initialDelayMs);
}

function prepareAnonymousUsageForWindow() {
  clearTelemetryStartFallback();
  if (currentConfig.telemetry.consent !== true) {
    anonymousUsage.stop();
    return;
  }
  if (gameContentReady) {
    startAnonymousUsage(0);
    return;
  }
  telemetryStartFallbackTimer = setTimeout(() => {
    telemetryStartFallbackTimer = null;
    startAnonymousUsage(0);
  }, TELEMETRY_START_FALLBACK_MS);
  if (typeof telemetryStartFallbackTimer.unref === 'function') {
    telemetryStartFallbackTimer.unref();
  }
}

function stopAnonymousUsageForWindow() {
  clearTelemetryStartFallback();
  anonymousUsage.stop();
}

function waitForTelemetryConsent() {
  if (normalizeTelemetryConsent(currentConfig.telemetry.consent) !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => telemetryConsentWaiters.add(resolve));
}

function resolveTelemetryConsentWaiters(canContinue = true) {
  for (const resolve of telemetryConsentWaiters) resolve(canContinue);
  telemetryConsentWaiters.clear();
}

function setTelemetryConsent(allowed) {
  currentConfig.telemetry.consent = allowed === true;
  if (currentConfig.telemetry.consent) {
    ensureTelemetryInstallationId();
  }
  store.save(currentConfig);
  if (currentConfig.telemetry.consent) prepareAnonymousUsageForWindow();
  else stopAnonymousUsageForWindow();
  gameViewFallbackHidden = false;
  syncGameViewVisibility();
  resolveTelemetryConsentWaiters(true);
  const state = getPublicTelemetryState();
  sendToRenderer('telemetry:state', state);
  return state;
}

function normalizeConfig(rawConfig) {
  const base = defaultConfig();
  const source = rawConfig || {};
  const cleanSource = { ...source };
  delete cleanSource.launchUrl;
  delete cleanSource.storage;
  return {
    ...base,
    ...cleanSource,
    proxy: {
      ...base.proxy,
      ...(source.proxy || {}),
    },
    view: {
      ...(base.view || {}),
      ...(source.view || {}),
      zoomFactor: normalizeZoomFactor(source.view && source.view.zoomFactor),
      scrollLevel: normalizeScrollLevel(source.view && source.view.scrollLevel),
      language: normalizeLanguage(source.view && source.view.language),
      customUrl: normalizeCustomUrl(source.view && source.view.customUrl) || '',
      alwaysOnTop: !!(source.view && source.view.alwaysOnTop),
    },
    session: {
      ...base.session,
      ...(source.session || {}),
      cookies: Array.isArray(source.session && source.session.cookies)
        ? source.session.cookies
        : [],
    },
    telemetry: {
      ...base.telemetry,
      ...(source.telemetry || {}),
      consent: normalizeTelemetryConsent(source.telemetry && source.telemetry.consent),
      installationId: isValidInstallationId(source.telemetry && source.telemetry.installationId)
        ? source.telemetry.installationId
        : '',
    },
  };
}

function normalizeZoomFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(numeric.toFixed(2))));
}

function normalizeScrollLevel(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return 5;
  return Math.min(5, Math.max(1, numeric));
}

function normalizeLanguage(value) {
  return ['auto', 'zh', 'en', 'ja'].includes(value) ? value : 'auto';
}

function effectiveLanguage() {
  const configured = normalizeLanguage(currentConfig.view && currentConfig.view.language);
  if (configured !== 'auto') return configured;
  const locale = (app.getLocale() || '').toLowerCase();
  if (locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('zh')) return 'zh';
  return 'en';
}

function normalizeOverlayState(payload, previous) {
  const source = payload || {};
  const kind = source.kind || (previous && previous.kind) || '';
  if (!['game-news', 'app-update'].includes(kind)) return null;
  const base = previous && previous.kind === kind ? previous : {};
  const text = (key, limit) => String(
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : base[key] || ''
  ).slice(0, limit);
  return {
    kind,
    language: ['zh', 'en', 'ja'].includes(source.language) ? source.language : base.language || 'zh',
    kicker: text('kicker', 80),
    title: text('title', 500),
    date: text('date', 80),
    body: text('body', 12000),
    closeLabel: text('closeLabel', 80),
    visitLabel: text('visitLabel', 80),
    url: kind === 'game-news' ? trustedGameNewsUrl(
      Object.prototype.hasOwnProperty.call(source, 'url') ? source.url : base.url
    ) : '',
  };
}

function applyOverlayBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || !overlayView) return false;
  const size = mainWindow.getContentSize();
  overlayView.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
  return true;
}

function ensureOverlayView() {
  if (overlayView && !overlayView.webContents.isDestroyed()) {
    return overlayReady || Promise.resolve(true);
  }
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'resources', 'native-overlay-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlayView.setBackgroundColor('#00000000');
  mainWindow.contentView.addChildView(overlayView);
  applyOverlayBounds();
  overlayView.setVisible(false);
  overlayView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayView.webContents.on('will-navigate', (event) => event.preventDefault());
  overlayReady = overlayView.webContents
    .loadFile(path.join(__dirname, 'ui', 'native-overlay.html'))
    .then(() => true)
    .catch((error) => {
      debugLog('native-overlay-load-error', error && error.message ? error.message : String(error));
      return false;
    });
  return overlayReady;
}

async function showOverlay(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const nextState = normalizeOverlayState(payload, null);
  if (!nextState) return false;
  const ready = await ensureOverlayView();
  if (!ready || !overlayView || overlayView.webContents.isDestroyed()) return false;
  overlayState = nextState;
  mainWindow.contentView.addChildView(overlayView);
  applyOverlayBounds();
  overlayView.setVisible(true);
  overlayView.webContents.send('native-overlay:state', overlayState);
  overlayView.webContents.focus();
  return true;
}

function updateOverlay(payload) {
  if (!overlayView || overlayView.webContents.isDestroyed() || !overlayState) return false;
  const nextState = normalizeOverlayState(payload, overlayState);
  if (!nextState) return false;
  overlayState = nextState;
  overlayView.webContents.send('native-overlay:state', overlayState);
  return true;
}

function closeOverlay() {
  if (!mainWindow || mainWindow.isDestroyed() || !overlayView) return false;
  const kind = overlayState && overlayState.kind;
  overlayView.setVisible(false);
  overlayState = null;
  sendToRenderer('native-overlay:closed', { kind });
  mainWindow.webContents.focus();
  return true;
}

function resolveUpdatePrompt(action) {
  if (!updatePrompt) return false;
  const response = action === 'install' ? 'install' : 'later';
  const pending = updatePrompt;
  updatePrompt = null;
  if (pending.surface === 'overlay') closeOverlay();
  if (pending.surface === 'renderer') {
    gameViewFallbackHidden = false;
    syncGameViewVisibility();
  }
  pending.resolve(response);
  return true;
}

function updateLayout(debounce) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (debounce !== false && layoutPending) return;
  layoutPending = true;
  var apply = function () {
    layoutPending = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (overlayState) applyOverlayBounds();
    if (!gameView || !gameViewAttached) return;
    applyGameViewBounds();
    if (layoutPresentationTimer) clearTimeout(layoutPresentationTimer);
    layoutPresentationTimer = setTimeout(() => {
      layoutPresentationTimer = null;
      applyGamePresentation();
    }, debounce === false ? 20 : 90);
  };
  if (debounce === false) { apply(); }
  else { setImmediate(apply); }
}

function applyGameViewBounds(sidebarWidth) {
  if (!mainWindow || !gameView || gameView.webContents.isDestroyed()) return false;
  var size = mainWindow.getContentSize();
  var width = size[0], height = size[1];
  var sidebarW = Math.round(Number.isFinite(sidebarWidth)
    ? Math.min(SIDEBAR_OPEN_WIDTH, Math.max(SIDEBAR_CLOSED_WIDTH, sidebarWidth))
    : sidebarCollapsed ? SIDEBAR_CLOSED_WIDTH : SIDEBAR_OPEN_WIDTH);
  var viewWidth = Math.max(1, width - sidebarW);
  var viewHeight = Math.max(1, height - TOP_BAR_H - BOTTOM_BAR_H);
  gameView.setBounds({
    x: 0,
    y: TOP_BAR_H,
    width: viewWidth,
    height: viewHeight,
  });
  return true;
}

function attachNavigationHandlers() {
  gameView.webContents.on('page-title-updated', (_, title) => {
    debugLog('page-title', title);
    sendToRenderer('browser:title', title);
  });

  gameView.webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeUrl(url);
    if (isInternalUrl(normalized)) {
      setImmediate(() => gameView.webContents.loadURL(normalized).catch(() => {}));
    } else {
      shell.openExternal(normalized).catch(() => {});
    }
    return { action: 'deny' };
  });

  gameView.webContents.on('will-navigate', (event, url) => {
    const normalized = normalizeUrl(url);
    if (normalized !== url) {
      event.preventDefault();
      gameView.webContents.loadURL(normalized).catch(() => {});
      return;
    }
    if (isInternalUrl(url) || (currentConfig.view.customUrl && isWebUrl(url))) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  gameView.webContents.on('did-navigate', (_, url) => {
    gameContentReady = false;
    gameViewLoadingMasked = isGameUrl(url);
    syncGameViewVisibility();
    debugLog('did-navigate', url);
    handleMainFrameNavigation(url);
  });

  gameView.webContents.on('did-finish-load', () => {
    const currentUrl = gameView.webContents.getURL();
    debugLog('did-finish-load', currentUrl);
    handleMainFrameNavigation(currentUrl);
    scheduleSessionFlush('page-finished');
    runPageAdapters();
  });

  gameView.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    debugLog('did-fail-load', { errorCode, errorDescription, validatedURL });
    if (errorCode === -3) return;
    gameViewLoadingMasked = false;
    syncGameViewVisibility();
    sendToRenderer('browser:error', `${errorDescription} (${errorCode})`);
  });
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return GAME_URL;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' && isInternalUrl(rawUrl)) {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
}

function isInternalUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ALLOWED_HOST_PARTS.some((part) => host === part || host.endsWith(`.${part}`));
  } catch {
    return false;
  }
}

function isLoginUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname;
    return hostname === 'accounts.dmm.com' || hostname === 'accounts.dmm.co.jp';
  } catch {
    return false;
  }
}

function isGameUrl(rawUrl) {
  return isAdaptedPage(rawUrl);
}

function handleMainFrameNavigation(rawUrl) {
  if (!rawUrl || rawUrl.startsWith('chrome-error://')) return;
  if (isLoginUrl(rawUrl)) {
    navigationMode = 'auth';
    return;
  }
  if (isGameUrl(rawUrl)) {
    navigationMode = 'game';
    return;
  }
  navigationMode = 'custom';
}

function getHomeUrl() {
  return currentConfig.view.customUrl || GAME_URL;
}

function loadGameHome() {
  loadDirectGame('home');
}

function loadDirectGame(reason) {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const targetUrl = getHomeUrl();
  gameContentReady = false;
  gameViewLoadingMasked = isGameUrl(targetUrl);
  syncGameViewVisibility();
  navigationMode = isGameUrl(targetUrl) ? 'game' : 'custom';
  debugLog('load-game', { reason, url: targetUrl });
  gameView.webContents.loadURL(targetUrl).catch((error) => {
    debugLog('load-game-error', error && error.message ? error.message : String(error));
    sendToRenderer('browser:error', error && error.message ? error.message : String(error));
  });
}

function scheduleSessionFlush(reason) {
  if (sessionFlushTimer) clearTimeout(sessionFlushTimer);
  sessionFlushTimer = setTimeout(() => {
    sessionFlushTimer = null;
    flushSessionData(reason);
  }, 1500);
}

function handleBeforeInputEvent(event, input) {
  if (!input || (!input.control && !input.meta)) return;
  const key = (input.key || '').toLowerCase();
  if (key === '+' || key === '=' || key === 'add') {
    event.preventDefault();
    adjustZoom(ZOOM_STEP);
  } else if (key === '-' || key === '_' || key === 'subtract') {
    event.preventDefault();
    adjustZoom(-ZOOM_STEP);
  } else if (key === '0') {
    event.preventDefault();
    setZoomFactor(1);
  }
}

function forwardNativeEditShortcut(targetWebContents, input) {
  if (!targetWebContents || targetWebContents.isDestroyed()) return;
  if (!input || input.type !== 'keyDown' || (!input.control && !input.meta)) return;
  const key = (input.key || '').toLowerCase();
  if (key === 'v') {
    targetWebContents.paste();
  } else if (key === 'c') {
    targetWebContents.copy();
  } else if (key === 'x') {
    targetWebContents.cut();
  } else if (key === 'a') {
    targetWebContents.selectAll();
  } else if (key === 'z') {
    if (input.shift) targetWebContents.redo();
    else targetWebContents.undo();
  }
}

async function flushSessionData(reason) {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const gameSession = gameView.webContents.session;
  try {
    await persistAuthCookies();
    gameSession.flushStorageData();
    await gameSession.cookies.flushStore();
    debugLog('session-flushed', reason || '');
  } catch (error) {
    debugLog('session-flush-error', error && error.message ? error.message : String(error));
  }
}

function isDmmCookie(cookie) {
  const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();
  return (
    domain === 'dmm.com' ||
    domain.endsWith('.dmm.com') ||
    domain === 'dmm.co.jp' ||
    domain.endsWith('.dmm.co.jp')
  );
}

function serializeCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || '',
    path: cookie.path || '/',
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    hostOnly: !!cookie.hostOnly,
    sameSite: cookie.sameSite || 'unspecified',
    expirationDate: cookie.expirationDate || null,
  };
}

async function persistAuthCookies() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const cookies = await gameView.webContents.session.cookies.get({});
  const dmmCookies = cookies.filter(isDmmCookie).map(serializeCookie);
  currentConfig.session.cookies = dmmCookies;
  store.save(currentConfig);
  debugLog('auth-cookies-saved', { count: dmmCookies.length });
}

async function restoreAuthCookies() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const savedCookies = currentConfig.session.cookies || [];
  if (!savedCookies.length) {
    debugLog('auth-cookies-restore', { count: 0 });
    return;
  }
  const now = Date.now() / 1000;
  let restored = 0;
  for (const cookie of savedCookies) {
    if (cookie.expirationDate && cookie.expirationDate <= now) continue;
    const host = (cookie.domain || '').replace(/^\./, '');
    if (!host || !isDmmCookie(cookie)) continue;
    const details = {
      url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: !!cookie.secure,
      httpOnly: !!cookie.httpOnly,
      sameSite: cookie.sameSite || 'unspecified',
    };
    if (!cookie.hostOnly) details.domain = cookie.domain;
    if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
    try {
      await gameView.webContents.session.cookies.set(details);
      restored += 1;
    } catch (error) {
      debugLog('auth-cookie-restore-error', {
        name: cookie.name,
        domain: cookie.domain,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  await gameView.webContents.session.cookies.flushStore().catch(() => {});
  debugLog('auth-cookies-restore', { count: restored });
}

function getZoomFactor() {
  return normalizeZoomFactor(currentConfig.view && currentConfig.view.zoomFactor);
}

function setZoomFactor(value) {
  const zoomFactor = normalizeZoomFactor(value);
  currentConfig.view.zoomFactor = zoomFactor;
  store.save(currentConfig);
  applyGamePresentation({ animateScale: true, duration: 180 });
  return zoomFactor;
}

function adjustZoom(delta) {
  return setZoomFactor(getZoomFactor() + delta);
}

function setLanguage(value) {
  currentConfig.view.language = normalizeLanguage(value);
  store.save(currentConfig);
  configureAboutPanel();
  Menu.setApplicationMenu(buildAppMenu());
  return getPublicConfig().view;
}

function getScrollLevel() {
  return normalizeScrollLevel(currentConfig.view && currentConfig.view.scrollLevel);
}

function getPublicConfig() {
  return {
    proxy: {
      ...currentConfig.proxy,
    },
    view: {
      ...currentConfig.view,
      scrollLevel: getScrollLevel(),
      language: normalizeLanguage(currentConfig.view && currentConfig.view.language),
      effectiveLanguage: effectiveLanguage(),
    },
    storage: store.getStatus(),
    telemetry: getPublicTelemetryState(),
    app: {
      version: APP_DISPLAY_VERSION,
      author: AUTHOR_NAME,
      contact: CONTACT_EMAIL,
      qqGroup: QQ_GROUP,
      repository: GITHUB_REPO,
    },
  };
}

function setScrollLevel(value) {
  const level = normalizeScrollLevel(value);
  currentConfig.view.scrollLevel = level;
  store.save(currentConfig);
  installAllGameFrameAdapters();
  return level;
}

async function fetchThroughGameSession(url, options = {}) {
  if (!gameView || gameView.webContents.isDestroyed()) {
    throw new Error('Game session is not ready.');
  }
  return gameView.webContents.session.fetch(url, {
    method: options.method || 'GET',
    redirect: options.redirect || 'follow',
    cache: options.cache || 'no-store',
    signal: options.signal,
    headers: {
      'User-Agent': CHROME_UA,
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      ...(options.headers || {}),
    },
  });
}

async function getGameNews(force = false) {
  const cacheAge = Date.now() - gameNewsCache.fetchedAt;
  if (!force && gameNewsCache.items.length && cacheAge < GAME_NEWS_CACHE_MS) {
    await primeGameNewsDetails(gameNewsCache.items);
    return { ...gameNewsCache, stale: false, error: false };
  }
  if (gameNewsTask) return gameNewsTask;

  gameNewsTask = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchThroughGameSession(GAME_NEWS_LIST_URL, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`Game news HTTP ${response.status}`);
      const parsedItems = parseGameNewsList(await response.text(), 30);
      if (!parsedItems.length) throw new Error('No valid game news entries were found.');
      const items = latestGameNewsItems(parsedItems, GAME_NEWS_LIMIT);
      gameNewsCache = { items, fetchedAt: Date.now() };
      await primeGameNewsDetails(items);
      return { ...gameNewsCache, stale: false, error: false };
    } catch (error) {
      debugLog('game-news-error', error && error.message ? error.message : String(error));
      return {
        ...gameNewsCache,
        stale: gameNewsCache.items.length > 0,
        error: true,
      };
    } finally {
      clearTimeout(timeout);
      gameNewsTask = null;
    }
  })();
  return gameNewsTask;
}

async function getGameNewsDetail(rawUrl) {
  const url = trustedGameNewsUrl(rawUrl);
  if (!url) throw new Error('Invalid game news URL.');
  if (gameNewsDetailCache.has(url)) return gameNewsDetailCache.get(url);
  if (gameNewsDetailTasks.has(url)) return gameNewsDetailTasks.get(url);

  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchThroughGameSession(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`Game news detail HTTP ${response.status}`);
      const detail = parseGameNewsDetail(await response.text(), url);
      if (!detail) throw new Error('Game news detail could not be parsed.');
      if (gameNewsDetailUrls.has(url)) gameNewsDetailCache.set(url, detail);
      return detail;
    } finally {
      clearTimeout(timeout);
      gameNewsDetailTasks.delete(url);
    }
  })();
  gameNewsDetailTasks.set(url, task);
  return task;
}

async function primeGameNewsDetails(items) {
  gameNewsDetailUrls = pruneGameNewsDetailCache(
    gameNewsDetailCache,
    items,
    GAME_NEWS_LIMIT
  );
  await Promise.allSettled(items.map((item) => getGameNewsDetail(item.url)));
  saveGameNewsDiskCache();
}

async function pingTarget(targetKey) {
  const target = NETWORK_TARGETS[targetKey];
  if (!target) return { ok: false, error: 'Unknown target.' };
  const started = Date.now();
  const probes = target.probes || [target.url];
  let lastError = '';
  for (const probe of probes) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchThroughGameSession(probe, {
        method: 'GET',
        signal: controller.signal,
        headers: { Range: 'bytes=0-0' },
      });
      clearTimeout(timeout);
      return {
        ok: response.status > 0 && response.status < 600,
        label: target.label,
        ms: Date.now() - started,
        status: response.status,
        error: '',
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error && error.message ? error.message : String(error);
    }
  }
  return {
    ok: false,
    label: target.label,
    ms: Date.now() - started,
    status: 0,
    error: lastError || 'No response.',
  };
}

async function getNetworkStatus() {
  const snapshot = {
    ip: '',
    country: '',
    countryCode: '',
    city: '',
    provider: '',
    userAgent: CHROME_UA,
    error: '',
  };
  try {
    const res = await fetchThroughGameSession('https://api.ipify.org?format=json');
    const data = await res.json();
    snapshot.ip = data.ip || '';
  } catch (error) {
    snapshot.error = error && error.message ? error.message : String(error);
  }
  if (snapshot.ip) {
    try {
      const geoRes = await fetchThroughGameSession(`https://ipwho.is/${encodeURIComponent(snapshot.ip)}`);
      const geo = await geoRes.json();
      if (geo && geo.success) {
        snapshot.country = geo.country || '';
        snapshot.countryCode = geo.country_code || '';
        snapshot.city = geo.city || '';
        snapshot.provider = geo.connection && (geo.connection.org || geo.connection.isp) || '';
      }
    } catch {}
  }
  return snapshot;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runPageAdapters() {
  if (gameView && isGameUrl(gameView.webContents.getURL())) {
    injectGameFocus();
    installAllGameFrameAdapters();
  }
}

function markGameContentReady() {
  if (gameContentReady) return;
  gameContentReady = true;
  if (currentConfig.telemetry.consent === true) startAnonymousUsage(0);
  Promise.all([applyGamePresentation(), focusAllGameContainers()]).finally(() => {
    if (!gameContentReady) return;
    gameViewLoadingMasked = false;
    syncGameViewVisibility();
  });
}

function syncGameViewVisibility() {
  if (!gameView || gameView.webContents.isDestroyed()) return false;
  gameView.setVisible(!gameViewLoadingMasked && !gameViewFallbackHidden);
  return true;
}

function isGameContainerFrame(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'osapi.dmm.com' || host === 'osapi.dmm.co.jp';
  } catch {
    return false;
  }
}

function focusGameContainer(frame) {
  if (!containerFocusSource || !frame || !isGameContainerFrame(frame.url)) {
    return Promise.resolve(null);
  }
  return frame.executeJavaScript(containerFocusSource)
    .then((result) => {
      if (result && result.fresh) debugLog('game-container-focus-installed', result);
      return result;
    })
    .catch((error) => {
      debugLog('game-container-focus-error', {
        url: frame.url,
        error: error && error.message ? error.message : String(error),
      });
      return null;
    });
}

function installGameFrameAdapter(frame) {
  if (!frame || !isGameContentFrame(frame.url)) return Promise.resolve(null);
  return Promise.all([
    focusGameContainer(frame),
    frame.executeJavaScript(scrollSource)
    .then((installResult) => {
      return frame.executeJavaScript(
        `window.__MT_AIGIS_SCROLL__ ? window.__MT_AIGIS_SCROLL__.setLevel(${getScrollLevel()}) : null`
      ).then((result) => {
        if (installResult && installResult.fresh) debugLog('game-frame-adapter', result);
        return result;
      });
    }),
  ]).catch((error) => {
    debugLog('game-frame-adapter-error', {
      url: frame.url,
      error: error && error.message ? error.message : String(error),
    });
    return null;
  });
}

function focusAllGameContainers() {
  if (!containerFocusSource || !gameView || gameView.webContents.isDestroyed()) {
    return Promise.resolve([]);
  }
  try {
    const root = gameView.webContents.mainFrame;
    return Promise.all(
      [root, ...root.framesInSubtree]
        .filter((frame) => isGameContainerFrame(frame.url))
        .map((frame) => focusGameContainer(frame))
    );
  } catch (_) {
    return Promise.resolve([]);
  }
}

function installAllGameFrameAdapters() {
  if ((!scrollSource && !containerFocusSource) || !gameView || gameView.webContents.isDestroyed()) return;
  try {
    const root = gameView.webContents.mainFrame;
    for (const frame of [root, ...root.framesInSubtree]) {
      installGameFrameAdapter(frame);
    }
  } catch (_) {}
}

function applyGamePresentation(options) {
  if (!gameView || gameView.webContents.isDestroyed()) return Promise.resolve(null);
  if (!isGameUrl(gameView.webContents.getURL())) return Promise.resolve(null);
  const zoomFactor = getZoomFactor();
  const presentationOptions = options || {};
  return gameView.webContents.executeJavaScript(
    `(() => {
      if (!window.__MT_GAME_FOCUS__) return null;
      return window.__MT_GAME_FOCUS__.configure(${JSON.stringify({
        contentReady: gameContentReady,
        fill: gameFillColor(),
        ring: gameRingColor(),
        userScale: zoomFactor,
        animateScale: !!presentationOptions.animateScale,
        duration: presentationOptions.duration,
      })});
    })()`
  ).then((result) => {
    if (result && result.ok) debugLog('game-layout', result);
    return result;
  }).catch(() => null);
}

function injectGameFocus() {
  if (!focusSource || !gameView || gameView.webContents.isDestroyed()) return;
  if (!isGameUrl(gameView.webContents.getURL())) return;
  gameView.webContents.executeJavaScript(
    `${focusSource}\n;(() => {
      if (!window.__MT_GAME_FOCUS__) return null;
      return window.__MT_GAME_FOCUS__.configure(${JSON.stringify({
        contentReady: gameContentReady,
        fill: gameFillColor(),
        ring: gameRingColor(),
        userScale: getZoomFactor(),
      })});
    })()`
  ).then((result) => {
    debugLog('focus-result', result);
  }).catch(() => {});
}

async function applyProxySettings() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  const proxy = currentConfig.proxy || {};
  if (proxy.enabled && proxy.host && proxy.port) {
    const hostPort = `${proxy.host}:${proxy.port}`;
    const proxyRules = proxy.scheme === 'socks5'
      ? `socks5://${hostPort}`
      : `${proxy.scheme}=${hostPort};https=${hostPort}`;
    await gameView.webContents.session.setProxy({
      mode: 'fixed_servers',
      proxyRules,
      proxyBypassRules: '<-loopback>',
    });
  } else {
    await gameView.webContents.session.setProxy({ mode: 'system' });
  }
  await gameView.webContents.session.closeAllConnections();
}

ipcMain.handle('browser:navigate', async (_, action) => {
  if (!gameView || gameView.webContents.isDestroyed()) return false;
  if (action === 'back' && gameView.webContents.navigationHistory.canGoBack()) gameView.webContents.goBack();
  if (action === 'forward' && gameView.webContents.navigationHistory.canGoForward()) gameView.webContents.goForward();
  if (action === 'reload') gameView.webContents.reload();
  if (action === 'home') loadGameHome();
  if (action === 'focus') injectGameFocus();
  if (action === 'zoom-in') adjustZoom(ZOOM_STEP);
  if (action === 'zoom-out') adjustZoom(-ZOOM_STEP);
  if (action === 'zoom-reset') setZoomFactor(1);
  if (action === 'mute-toggle') {
    gameView.webContents.setAudioMuted(!gameView.webContents.isAudioMuted());
  }
  return true;
});

ipcMain.handle('window:titlebar-toggle', (event) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    mainWindow.isFullScreen()
  ) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return true;
});

ipcMain.handle('window:always-on-top:set', (event, enabled) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) return { alwaysOnTop: false };
  mainWindow.setAlwaysOnTop(!!enabled);
  currentConfig.view.alwaysOnTop = mainWindow.isAlwaysOnTop();
  store.save(currentConfig);
  return { alwaysOnTop: currentConfig.view.alwaysOnTop };
});

ipcMain.handle('browser:custom-url:set', (event, rawUrl) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) throw new Error('This setting is only available in the main window.');
  const customUrl = normalizeCustomUrl(rawUrl);
  if (customUrl === null) throw new Error('Invalid web address.');
  currentConfig.view.customUrl = customUrl;
  store.save(currentConfig);
  loadDirectGame('custom-url');
  return {
    customUrl,
    homeUrl: getHomeUrl(),
  };
});

ipcMain.handle('browser:state', async () => {
  if (!gameView || gameView.webContents.isDestroyed()) {
    return {
      title: '',
      url: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      lastError: '',
      zoomFactor: 1,
      userAgent: CHROME_UA,
      audioMuted: false,
      sidebarCollapsed,
      scrollLevel: getScrollLevel(),
      customUrl: currentConfig.view.customUrl || '',
      homeUrl: getHomeUrl(),
    };
  }
  return {
    title: gameView.webContents.getTitle(),
    url: gameView.webContents.getURL(),
    loading: gameView.webContents.isLoading(),
    canGoBack: gameView.webContents.navigationHistory.canGoBack(),
    canGoForward: gameView.webContents.navigationHistory.canGoForward(),
    lastError: '',
    zoomFactor: getZoomFactor(),
    userAgent: CHROME_UA,
    audioMuted: gameView.webContents.isAudioMuted(),
    sidebarCollapsed,
    scrollLevel: getScrollLevel(),
    customUrl: currentConfig.view.customUrl || '',
    homeUrl: getHomeUrl(),
  };
});

ipcMain.handle('network:status', async () => {
  return getNetworkStatus();
});

ipcMain.handle('network:ping', async (_, target) => {
  return pingTarget(target);
});

ipcMain.handle('game-news:list', (_, force) => {
  return getGameNews(Boolean(force));
});

ipcMain.handle('game-news:detail', (event, rawUrl) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) throw new Error('Game news is only available in the main window.');
  return getGameNewsDetail(rawUrl);
});

ipcMain.handle('native-overlay:open', (event, payload) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) return false;
  return showOverlay(payload);
});

ipcMain.handle('native-overlay:update', (event, payload) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) return false;
  return updateOverlay(payload);
});

ipcMain.handle('native-overlay:close', (event) => {
  if (
    !overlayView ||
    overlayView.webContents.isDestroyed() ||
    event.sender.id !== overlayView.webContents.id
  ) return false;
  return closeOverlay();
});

ipcMain.handle('native-overlay:open-external', (event, rawUrl) => {
  if (
    !overlayView ||
    overlayView.webContents.isDestroyed() ||
    event.sender.id !== overlayView.webContents.id
  ) return false;
  const url = trustedGameNewsUrl(rawUrl);
  if (!url) return false;
  return shell.openExternal(url).then(() => true);
});

ipcMain.handle('native-overlay:update-respond', (event, action) => {
  if (
    !overlayView ||
    overlayView.webContents.isDestroyed() ||
    event.sender.id !== overlayView.webContents.id ||
    !overlayState ||
    overlayState.kind !== 'app-update'
  ) return false;
  return resolveUpdatePrompt(action);
});

ipcMain.handle('sidebar:transition-start', async (event, state) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    !gameView ||
    gameView.webContents.isDestroyed() ||
    !gameViewAttached
  ) return false;
  const targetSidebarWidth = state === 'collapse' ? SIDEBAR_CLOSED_WIDTH : SIDEBAR_OPEN_WIDTH;
  const size = mainWindow.getContentSize();
  sidebarTransitionActive = true;
  await gameView.webContents.executeJavaScript(
    'window.__MT_GAME_FOCUS__ ? window.__MT_GAME_FOCUS__.prepareViewportTransition() : null'
  ).catch(() => null);
  applyGameViewBounds(targetSidebarWidth);
  await gameView.webContents.executeJavaScript(
    `window.__MT_GAME_FOCUS__ ? window.__MT_GAME_FOCUS__.beginViewportTransition(${JSON.stringify({
      width: Math.max(1, size[0] - targetSidebarWidth),
      height: Math.max(1, size[1] - TOP_BAR_H - BOTTOM_BAR_H),
      duration: 200,
    })}) : null`
  ).catch(() => null);
  return true;
});

ipcMain.handle('scroll:set-level', (_, level) => {
  return { level: setScrollLevel(level) };
});

ipcMain.handle('language:set', (_, language) => {
  return setLanguage(language);
});

ipcMain.handle('telemetry:consent', (event, allowed) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    typeof allowed !== 'boolean'
  ) return getPublicTelemetryState();
  return setTelemetryConsent(allowed);
});

ipcMain.handle('telemetry:state', (event) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) return null;
  return getPublicTelemetryState();
});

ipcMain.handle('update:check', () => {
  return checkForUpdates();
});

ipcMain.handle('update:state', () => updateState);

ipcMain.handle('update:respond', (event, action) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    !updatePrompt
  ) return false;
  return resolveUpdatePrompt(action);
});

ipcMain.handle('copy:text', (_, value) => {
  clipboard.writeText(String(value || ''));
  return true;
});

ipcMain.handle('config:get', () => {
  return getPublicConfig();
});

ipcMain.handle('config:save', async (_, nextConfig) => {
  currentConfig = normalizeConfig({
    proxy: nextConfig && nextConfig.proxy ? nextConfig.proxy : currentConfig.proxy,
    view: currentConfig.view,
    session: currentConfig.session,
    telemetry: currentConfig.telemetry,
  });
  store.save(currentConfig);
  await applyProxySettings();
  return { ok: true };
});

const LEGACY_CREDENTIAL_FILES = [
  path.join(LEGACY_USER_DATA, 'credentials.json'),
  path.join(USER_DATA, 'credentials.json'),
];

function existingLegacyCredentialFiles() {
  return LEGACY_CREDENTIAL_FILES.filter((filePath) => fs.existsSync(filePath));
}

function readLegacyCredentials() {
  for (const filePath of existingLegacyCredentialFiles()) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        email: String(data.email || '').trim(),
        password: String(data.password || ''),
        twofa: String(data.twofa || data.twoFactorCode || '').trim(),
      };
    } catch {}
  }
  return emptyVault();
}

function maskSecret(value, length = 8) {
  if (!value) return '-';
  return '\u2022'.repeat(Math.max(length, Math.min(16, String(value).length)));
}

function vaultViewModel() {
  const status = vault.status();
  const data = status.exists && !status.error ? vault.load() : emptyVault();
  return {
    exists: status.exists,
    updatedAt: status.updatedAt,
    error: status.error,
    hasLegacyData: existingLegacyCredentialFiles().length > 0,
    fields: {
      email: data.email || '-',
      password: data.password ? maskSecret(data.password, 10) : '-',
      twofa: data.twofa ? currentTotp(data.twofa) : '-',
    },
  };
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const raw = String(secret || '').trim();
  if (/^\d{6}$/.test(raw)) return raw;
  if (!/^[A-Z2-7\s-]{16,}$/i.test(raw)) return raw;
  const key = decodeBase32(secret);
  if (!key.length) return raw;
  const counter = Math.floor(Date.now() / 30000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  ) % 1000000;
  return String(code).padStart(6, '0');
}

ipcMain.handle('vault:status', () => vaultViewModel());

ipcMain.handle('vault:edit-data', () => {
  return vault.load();
});

ipcMain.handle('vault:save', (_, payload) => {
  vault.save(payload || emptyVault());
  return vaultViewModel();
});

ipcMain.handle('vault:migrate-plaintext', () => {
  const legacy = readLegacyCredentials();
  vault.save(legacy);
  return vaultViewModel();
});

ipcMain.handle('vault:copy', (_, field) => {
  const data = vault.load();
  let value = '';
  if (field === 'email') value = data.email;
  else if (field === 'password') value = data.password;
  else if (field === 'twofa') value = currentTotp(data.twofa);
  else throw new Error('Unknown vault field.');
  clipboard.writeText(String(value || ''));
  return true;
});

function assertTrustedAutofillFrame(event) {
  if (
    !gameView ||
    gameView.webContents.isDestroyed() ||
    event.sender.id !== gameView.webContents.id
  ) {
    throw new Error('Autofill is only available in the game browser.');
  }
  const frameUrl = event.senderFrame && event.senderFrame.url || '';
  if (!isTrustedAutofillUrl(frameUrl)) {
    throw new Error('Autofill is not available on this page.');
  }
}

ipcMain.handle('autofill:suggestion', (event) => {
  assertTrustedAutofillFrame(event);
  const status = vault.status();
  if (!status.exists || status.error) {
    return {
      available: false,
      label: '',
      fields: { username: false, password: false, totp: false },
    };
  }
  return getAutofillSuggestion(vault.load());
});

ipcMain.handle('autofill:fill', (event, payload) => {
  assertTrustedAutofillFrame(event);
  const kind = payload && payload.kind;
  const values = getAutofillValues(vault.load(), kind, currentTotp);
  return { ok: Object.values(values).some(Boolean), values };
});

ipcMain.handle('clipboard:write', (_, value) => {
  clipboard.writeText(value || '');
  return true;
});

ipcMain.handle('sidebar:toggle', async (_, state) => {
  if (!mainWindow || !gameView) return;
  sidebarCollapsed = state === 'collapse';
  currentConfig.view.sidebarCollapsed = sidebarCollapsed;
  store.save(currentConfig);
  sendToRenderer('sidebar:state', { collapsed: sidebarCollapsed });
  applyGameViewBounds();
  if (sidebarTransitionActive) {
    sidebarTransitionActive = false;
    await gameView.webContents.executeJavaScript(
      'window.__MT_GAME_FOCUS__ ? window.__MT_GAME_FOCUS__.endViewportTransition() : null'
    ).catch(() => null);
  } else {
    await applyGamePresentation();
  }
  return { collapsed: sidebarCollapsed };
});

ipcMain.handle('cache:clear-cookies', async () => {
  if (!gameView || gameView.webContents.isDestroyed()) return false;
  try {
    const session = gameView.webContents.session;
    await session.clearStorageData({ storages: ['cookies'] });
    await session.cookies.flushStore();
    currentConfig.session.cookies = [];
    store.save(currentConfig);
    debugLog('cache-clear-cookies', 'ok');
    return true;
  } catch (e) {
    debugLog('cache-clear-cookies-error', e && e.message ? e.message : String(e));
    return false;
  }
});

async function getCacheStats(force = false) {
  if (cacheClearTask) await cacheClearTask.catch(() => null);
  if (!force && cacheStatsCache && Date.now() - cacheStatsAt < CACHE_STATS_TTL_MS) {
    return cacheStatsCache;
  }
  if (cacheStatsTask) return cacheStatsTask;
  const task = (async () => {
    const session = gameView && !gameView.webContents.isDestroyed()
      ? gameView.webContents.session
      : null;
    const cacheBytes = session ? await session.getCacheSize().catch(() => 0) : 0;
    cacheStatsCache = {
      httpBytes: cacheBytes,
      diskBytes: cacheBytes,
    };
    cacheStatsAt = Date.now();
    return cacheStatsCache;
  })();
  cacheStatsTask = task;
  try {
    return await task;
  } finally {
    if (cacheStatsTask === task) cacheStatsTask = null;
  }
}

ipcMain.handle('cache:clear-cache', async () => {
  try {
    if (cacheClearTask) {
      await cacheClearTask;
    } else {
      const task = (async () => {
        if (cacheStatsTask) await cacheStatsTask.catch(() => null);
        if (gameView && !gameView.webContents.isDestroyed()) {
          const session = gameView.webContents.session;
          await session.clearCache();
          await session.clearCodeCaches({}).catch(() => {});
          await session.clearStorageData({
            storages: ['serviceworkers', 'cachestorage', 'shadercache'],
          });
          await session.closeAllConnections();
        }
        cacheStatsCache = null;
        cacheStatsAt = 0;
      })();
      cacheClearTask = task;
      try {
        await task;
      } finally {
        if (cacheClearTask === task) cacheClearTask = null;
      }
    }
    debugLog('cache-clear-all', 'ok');
    return { ok: true, stats: await getCacheStats(true) };
  } catch (e) {
    debugLog('cache-clear-all-error', e && e.message ? e.message : String(e));
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('cache:stats', async (_, force) => {
  return getCacheStats(!!force);
});

app.whenReady().then(() => {
  configureAboutPanel();
  setupAutoUpdater();
  Menu.setApplicationMenu(buildAppMenu());
  updateNativeAppearance();
  nativeTheme.on('updated', updateNativeAppearance);
  createWindow();
  setTimeout(() => checkForUpdates(), 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  stopAnonymousUsageForWindow();
  if (quitAfterFlush || !gameView || gameView.webContents.isDestroyed()) return;
  event.preventDefault();
  quitAfterFlush = true;
  flushSessionData('before-quit').finally(() => app.quit());
});
