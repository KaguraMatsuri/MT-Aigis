const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  clipboard,
  ipcMain,
  shell,
  nativeImage,
  nativeTheme,
  dialog,
} = require('electron');
const log = require('electron-log/main');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SecureConfigStore, defaultConfig } = require('./lib/secure-config');
const { PlainVault, emptyVault } = require('./lib/plain-vault');

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
const GAME_URL = 'https://play.games.dmm.com/game/aigisc';
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.5;
const APP_DISPLAY_VERSION = '1.0.0.0';
const AUTHOR_NAME = 'No.zomu';
const CONTACT_EMAIL = 'SeaRoach@proton.me';
const QQ_GROUP = '1022215649';
const GITHUB_REPO = 'https://github.com/KaguraMatsuri/MT-Aigis';
const UPDATE_MANIFEST_URL = `${GITHUB_REPO}/releases/latest/download/latest-mac.yml`;
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
const CACHE_DIRECTORIES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Service Worker',
  'Shared Dictionary',
  'blob_storage',
];
const APP_TEXT = {
  zh: {
    aboutMenu: '关于 MT-Aigis',
    quitMenu: '退出 MT-Aigis',
    aboutTitle: '关于 MT-Aigis',
    subtitle: '千年战争Aigis macOS Client',
    contact: '联系方式',
    qq: '腾讯 QQ 群',
    copyright: `作者 ${AUTHOR_NAME}`,
    ready: '准备就绪',
    updateChecking: '检查中',
    updateAvailable: '检测到更新，正在下载',
    updateDownloadingPercent: '正在下载 {percent}%...',
    updateCurrent: '未检测到更新',
    updateOpening: '正在打开安装器',
    updateOpened: '安装器已打开',
    updateFailed: '更新失败',
    updateDev: '当前版本不检查更新',
  },
  en: {
    aboutMenu: 'About MT-Aigis',
    quitMenu: 'Quit MT-Aigis',
    aboutTitle: 'About MT-Aigis',
    subtitle: '千年戦争アイギス macOS Client',
    contact: 'Contact',
    qq: 'Tencent QQ Server',
    copyright: `Author ${AUTHOR_NAME}`,
    ready: 'Ready',
    updateChecking: 'Checking',
    updateAvailable: 'Update found. Downloading',
    updateDownloadingPercent: 'Downloading {percent}%...',
    updateCurrent: 'No update found',
    updateOpening: 'Opening installer',
    updateOpened: 'Installer opened',
    updateFailed: 'Update failed',
    updateDev: 'Updates are disabled here',
  },
  ja: {
    aboutMenu: 'MT-Aigis について',
    quitMenu: 'MT-Aigis を終了',
    aboutTitle: 'MT-Aigis について',
    subtitle: '千年戦争アイギス macOS Client',
    contact: '連絡先',
    qq: 'Tencent QQ Server',
    copyright: `作者 ${AUTHOR_NAME}`,
    ready: '準備完了',
    updateChecking: '確認中',
    updateAvailable: '更新を検出。ダウンロード中',
    updateDownloadingPercent: 'ダウンロード中 {percent}%...',
    updateCurrent: '更新はありません',
    updateOpening: 'インストーラを開いています',
    updateOpened: 'インストーラを開きました',
    updateFailed: '更新に失敗しました',
    updateDev: 'この環境では更新を確認しません',
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

const store = new SecureConfigStore(path.join(USER_DATA, 'secure'));
const vault = new PlainVault(path.join(USER_DATA, 'secure', 'vault.json'));
let currentConfig = normalizeConfig(store.load());
let mainWindow = null;
let gameView = null;
let aboutWindow = null;
let focusSource = '';
let scrollSource = '';
let navigationMode = 'boot';
let sessionFlushTimer = null;
let focusTimers = [];
let quitAfterFlush = false;
let sidebarCollapsed = !!currentConfig.view.sidebarCollapsed;
let layoutPending = false;
let resourceStats = createResourceStats();
let cacheStatsCache = null;
let cacheStatsAt = 0;
let updateState = {
  status: 'idle',
  message: '',
  version: '',
  error: '',
};
let updateDownloadTask = null;

log.initialize();

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
  return {
    ...manifest,
    manifestUrl: result.url,
    dmg: {
      ...dmg,
      downloadUrl: new URL(dmg.url, result.url).toString(),
    },
  };
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
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      stream.write(Buffer.from(value));
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
      setUpdateState('downloading', appText('updateDownloadingPercent', { percent }), { version });
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
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

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    setUpdateState('dev', appText('updateDev'));
    return Promise.resolve(updateState);
  }
  if (updateDownloadTask) return updateDownloadTask;
  setUpdateState('checking', appText('updateChecking'));
  updateDownloadTask = readLatestManifest()
    .then((manifest) => {
      if (compareVersions(manifest.version, appVersionValue()) <= 0) {
        setUpdateState('current', appText('updateCurrent'));
        return updateState;
      }
      setUpdateState('available', appText('updateAvailable'), { version: manifest.version });
      return downloadUpdateDmg(manifest).then(openInstallerAndQuit);
    })
    .catch((error) => {
      const message = formatUpdateError(error);
      const status = message === appText('updateCurrent') ? 'current' : 'error';
      setUpdateState(status, message, { error: message });
      if (manual && status === 'error') {
        dialog.showErrorBox('MT-Aigis', message);
      }
      return updateState;
    })
    .finally(() => {
      updateDownloadTask = null;
    });
  return updateDownloadTask;
}

function createResourceStats() {
  return {
    completed: 0,
    fromCache: 0,
    networkBytes: 0,
  };
}

function getResponseContentLength(headers) {
  if (!headers) return 0;
  for (const [name, values] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'content-length') continue;
    const value = Array.isArray(values) ? values[0] : values;
    return Number.parseInt(value, 10) || 0;
  }
  return 0;
}

function isGameContentFrame(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === 'osapi.dmm.com' ||
      host === 'drc1bk94f7rq8.cloudfront.net' ||
      host.endsWith('.millennium-war.net') ||
      host === 'millennium-war.net'
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
  layoutPending = false;
  clearFocusTimers();
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

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    updateLayout(false);
    mainWindow.show();
    mainWindow.focus();
  });
  for (const eventName of [
    'resize',
    'maximize',
    'unmaximize',
    'restore',
    'show',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    mainWindow.on(eventName, updateLayout);
  }
  mainWindow.webContents.on('before-input-event', handleBeforeInputEvent);
  mainWindow.webContents.on('context-menu', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    clearFocusTimers();
    layoutPending = false;
    if (gameView && !gameView.webContents.isDestroyed()) {
      gameView.webContents.close();
    }
    mainWindow = null;
    gameView = null;
  });

  createGameView();
}

function createGameView() {
  gameView = new BrowserView({
    webPreferences: {
      partition: VIEW_PARTITION,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  focusSource = loadResource('game-focus.js');
  scrollSource = loadResource('game-scroll.js');

  mainWindow.setBrowserView(gameView);
  gameView.setAutoResize({ width: false, height: false });
  gameView.webContents.setUserAgent(CHROME_UA);
  gameView.webContents.setBackgroundThrottling(false);
  gameView.setBackgroundColor(gameFillColor());
  gameView.webContents.insertCSS('*{user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important}::selection{background:transparent}');

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
      installGameFrameAdapter(frame);
      installAllGameFrameAdapters();
    } catch (_) {}
  });

  gameView.webContents.setZoomFactor(1);
  const gameSession = gameView.webContents.session;
  gameSession.setUserAgent(CHROME_UA, 'ja');
  gameSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  gameSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, function (details) {
    resourceStats.completed += 1;
    if (details.fromCache) resourceStats.fromCache += 1;
    else resourceStats.networkBytes += getResponseContentLength(details.responseHeaders);
    sendToRenderer('resource:count', { ...resourceStats });
  });
  gameSession.webRequest.onBeforeRequest({ urls: TRACKER_RULES }, (_, callback) => callback({ cancel: true }));
  gameSession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    details.requestHeaders['Accept-Language'] = 'ja,en-US;q=0.9,en;q=0.8';
    delete details.requestHeaders['X-Requested-With'];
    callback({ requestHeaders: details.requestHeaders });
  });
  gameSession.webRequest.onCompleted({ urls: ['https://play.games.dmm.com/*', 'https://artemis.games.dmm.com/*', 'https://accounts.dmm.com/*'] }, (details) => {
    if (details.resourceType === 'mainFrame' || details.url.includes('artemis.games.dmm.com/')) {
      debugLog('request-completed', {
        statusCode: details.statusCode,
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
      });
    }
    if (
      details.statusCode === 200 &&
      details.url.includes('artemis.games.dmm.com/member/pc/init-game-frame/aigisc')
    ) {
      navigationMode = 'game';
      scheduleSessionFlush('game-ready');
      [250, 700, 1400, 2800, 5000].forEach((delay) => {
        setTimeout(() => {
          dumpPageState().catch(() => {});
          injectGameFocus();
        }, delay);
      });
    }
  });
  gameSession.webRequest.onErrorOccurred({ urls: ['https://play.games.dmm.com/*', 'https://artemis.games.dmm.com/*', 'https://accounts.dmm.com/*'] }, (details) => {
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
  gameView.webContents.on('before-input-event', handleBeforeInputEvent);
  gameView.webContents.on('context-menu', (event) => event.preventDefault());
  updateLayout(false);
  initializeGameSession();
}

async function initializeGameSession() {
  try {
    await applyProxySettings();
  } catch (error) {
    debugLog('proxy-init-error', error && error.message ? error.message : String(error));
  }
  await restoreAuthCookies();
  loadDirectGame('startup');
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
    },
    session: {
      ...base.session,
      ...(source.session || {}),
      cookies: Array.isArray(source.session && source.session.cookies)
        ? source.session.cookies
        : [],
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

function updateLayout(debounce) {
  if (!mainWindow || !gameView) return;
  if (debounce !== false && layoutPending) return;
  layoutPending = true;
  var apply = function () {
    layoutPending = false;
    if (!mainWindow || !gameView) return;
    var size = mainWindow.getContentSize();
    var width = size[0], height = size[1];
    var sidebarW = sidebarCollapsed ? SIDEBAR_CLOSED_WIDTH : SIDEBAR_OPEN_WIDTH;
    var viewWidth = Math.max(1, width - sidebarW);
    var viewHeight = Math.max(1, height - TOP_BAR_H - BOTTOM_BAR_H);
    gameView.setBounds({
      x: 0,
      y: TOP_BAR_H,
      width: viewWidth,
      height: viewHeight,
    });
    setTimeout(applyGamePresentation, 20);
  };
  if (debounce === false) { apply(); }
  else { setImmediate(apply); }
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
    clearFocusTimers();
    const normalized = normalizeUrl(url);
    if (normalized !== url) {
      event.preventDefault();
      gameView.webContents.loadURL(normalized).catch(() => {});
      return;
    }
    if (isInternalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  gameView.webContents.on('did-navigate', (_, url) => {
    resourceStats = createResourceStats();
    sendToRenderer('resource:count', { ...resourceStats });
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
    return new URL(rawUrl).hostname === 'accounts.dmm.com';
  } catch {
    return false;
  }
}

function isGameUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === 'play.games.dmm.com' && parsed.pathname === '/game/aigisc';
  } catch {
    return false;
  }
}

function handleMainFrameNavigation(rawUrl) {
  if (!rawUrl || rawUrl.startsWith('chrome-error://')) return;
  if (isLoginUrl(rawUrl)) {
    navigationMode = 'auth';
    return;
  }
  if (isGameUrl(rawUrl)) {
    navigationMode = 'game';
  }
}

function loadGameHome() {
  loadDirectGame('home');
}

function loadDirectGame(reason) {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  navigationMode = 'game';
  debugLog('load-game', { reason, url: GAME_URL });
  gameView.webContents.loadURL(GAME_URL).catch((error) => {
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
  applyGamePresentation();
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
  dumpPageState().catch(() => {});
}

function installGameFrameAdapter(frame) {
  if (!frame || !isGameContentFrame(frame.url)) return;
  frame.executeJavaScript(scrollSource)
    .then((installResult) => {
      return frame.executeJavaScript(
        `window.__MT_AIGIS_SCROLL__ ? window.__MT_AIGIS_SCROLL__.setLevel(${getScrollLevel()}) : null`
      ).then((result) => {
        if (installResult && installResult.fresh) debugLog('game-frame-adapter', result);
      });
    })
    .catch((error) => debugLog('game-frame-adapter-error', {
      url: frame.url,
      error: error && error.message ? error.message : String(error),
    }));
}

function installAllGameFrameAdapters() {
  if (!scrollSource || !gameView || gameView.webContents.isDestroyed()) return;
  try {
    const root = gameView.webContents.mainFrame;
    for (const frame of [root, ...root.framesInSubtree]) {
      installGameFrameAdapter(frame);
    }
  } catch (_) {}
}

function applyGamePresentation() {
  if (!gameView || gameView.webContents.isDestroyed()) return;
  if (!isGameUrl(gameView.webContents.getURL())) return;
  const zoomFactor = getZoomFactor();
  gameView.webContents.executeJavaScript(
    `(() => {
      if (!window.__MT_GAME_FOCUS__) return null;
      window.__MT_GAME_FOCUS__.setTheme(${JSON.stringify({ fill: gameFillColor(), ring: gameRingColor() })});
      return window.__MT_GAME_FOCUS__.setUserScale(${JSON.stringify(zoomFactor)});
    })()`
  ).then((result) => {
    if (result && result.ok) debugLog('game-layout', result);
  }).catch(() => {});
}

function injectGameFocus() {
  if (!focusSource || !gameView || gameView.webContents.isDestroyed()) return;
  if (!isGameUrl(gameView.webContents.getURL())) return;
  clearFocusTimers();
  gameView.webContents.executeJavaScript(focusSource).then(() => {
    return gameView.webContents.executeJavaScript(
      `(() => {
        if (!window.__MT_GAME_FOCUS__) return null;
        window.__MT_GAME_FOCUS__.setTheme(${JSON.stringify({ fill: gameFillColor(), ring: gameRingColor() })});
        return window.__MT_GAME_FOCUS__.setUserScale(${JSON.stringify(getZoomFactor())});
      })()`
    ).then((result) => {
      debugLog('focus-result', result);
      return result;
    }).catch(() => {});
  }).catch(() => {});
  focusTimers = [250, 700, 1400, 2400, 4200, 6200].map((delay) => {
    return setTimeout(() => {
      if (!gameView || gameView.webContents.isDestroyed()) return;
      if (!isGameUrl(gameView.webContents.getURL())) return;
      installAllGameFrameAdapters();
      gameView.webContents.executeJavaScript(
        `(() => {
          if (!window.__MT_GAME_FOCUS__) return null;
          window.__MT_GAME_FOCUS__.setTheme(${JSON.stringify({ fill: gameFillColor(), ring: gameRingColor() })});
          return window.__MT_GAME_FOCUS__.setUserScale(${JSON.stringify(getZoomFactor())});
        })()`
      ).catch(() => {});
    }, delay);
  });
}

function clearFocusTimers() {
  for (const timer of focusTimers) clearTimeout(timer);
  focusTimers = [];
}

function dumpPageState() {
  if (!gameView || gameView.webContents.isDestroyed()) return Promise.resolve(null);
  const script = `
    (() => {
      const text = (document.body && document.body.innerText || '').trim().split('\\n').map(v => v.trim()).filter(Boolean).slice(0, 12);
      const frame = document.getElementById('game_frame');
      const iframeList = [...document.querySelectorAll('iframe')].slice(0, 6).map((el) => ({
        id: el.id,
        src: el.src,
        width: el.offsetWidth,
        height: el.offsetHeight
      }));
      return {
        href: location.href,
        title: document.title,
        hasGameFrame: !!frame,
        gameFrameSrc: frame ? frame.src : '',
        text,
        iframeList
      };
    })();
  `;
  return gameView.webContents.executeJavaScript(script).then((result) => {
    debugLog('page-state', result);
    return result;
  }).catch((error) => {
    debugLog('page-state-error', error && error.message ? error.message : String(error));
    return null;
  });
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
  };
});

ipcMain.handle('network:status', async () => {
  return getNetworkStatus();
});

ipcMain.handle('network:ping', async (_, target) => {
  return pingTarget(target);
});

ipcMain.handle('scroll:set-level', (_, level) => {
  return { level: setScrollLevel(level) };
});

ipcMain.handle('language:set', (_, language) => {
  return setLanguage(language);
});

ipcMain.handle('update:check', () => {
  return checkForUpdates(true);
});

ipcMain.handle('update:state', () => updateState);

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

ipcMain.handle('clipboard:write', (_, value) => {
  clipboard.writeText(value || '');
  return true;
});

ipcMain.handle('sidebar:toggle', (_, state) => {
  if (!mainWindow || !gameView) return;
  sidebarCollapsed = state === 'collapse';
  currentConfig.view.sidebarCollapsed = sidebarCollapsed;
  store.save(currentConfig);
  sendToRenderer('sidebar:state', { collapsed: sidebarCollapsed });
  updateLayout(false);
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

async function directorySize(directory) {
  let total = 0;
  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      try {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) total += await directorySize(filePath);
        else if (entry.isFile()) total += (await fs.promises.stat(filePath)).size;
      } catch {}
    }));
  } catch {}
  return total;
}

function gamePartitionPath() {
  return path.join(USER_DATA, 'Partitions', VIEW_PARTITION.replace('persist:', ''));
}

async function getCacheStats(force = false) {
  if (!force && cacheStatsCache && Date.now() - cacheStatsAt < 5000) {
    return cacheStatsCache;
  }
  const session = gameView && !gameView.webContents.isDestroyed()
    ? gameView.webContents.session
    : null;
  const httpBytes = session ? await session.getCacheSize().catch(() => 0) : 0;
  const partition = gamePartitionPath();
  const diskBytes = (await Promise.all(
    CACHE_DIRECTORIES.map((name) => directorySize(path.join(partition, name)))
  )).reduce((sum, value) => sum + value, 0);
  cacheStatsCache = {
    httpBytes,
    diskBytes: Math.max(httpBytes, diskBytes),
    resources: { ...resourceStats },
  };
  cacheStatsAt = Date.now();
  return cacheStatsCache;
}

ipcMain.handle('cache:clear-cache', async () => {
  try {
    if (gameView && !gameView.webContents.isDestroyed()) {
      const session = gameView.webContents.session;
      await session.clearCache();
      await session.clearCodeCaches({}).catch(() => {});
      await session.clearStorageData({
        storages: ['serviceworkers', 'cachestorage', 'shadercache'],
      });
      await session.closeAllConnections();
    }
    resourceStats = createResourceStats();
    cacheStatsCache = null;
    cacheStatsAt = 0;
    sendToRenderer('resource:count', { ...resourceStats });
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
  setTimeout(() => checkForUpdates(false), 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitAfterFlush || !gameView || gameView.webContents.isDestroyed()) return;
  event.preventDefault();
  quitAfterFlush = true;
  flushSessionData('before-quit').finally(() => app.quit());
});
