const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const test = require('node:test');
const vm = require('node:vm');
const helpers = require('../lib/update-notification');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(__dirname, '..', 'ui', 'sidebar.js'), 'utf8');
const manifestUrl = 'https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/latest-mac.yml';
const releaseUrl = 'https://api.github.com/repos/KaguraMatsuri/MT-Aigis/releases/latest';
const installer = Buffer.from('fixture installer');

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function turn() {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

function manifestText(version = '1.3.0') {
  return `version: ${version}\nfiles:\n  - url: https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/MT-Aigis-1.3.0-arm64.dmg\n    sha512: ${crypto.createHash('sha512').update(installer).digest('base64')}\n    size: ${installer.length}\n`;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtaigis-update-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [], timers = [], handlers = new Map(), listeners = new Map();
  const counts = { manifest: 0, release: 0, download: 0, close: 0, quit: 0, save: 0, flush: 0, cookieFlush: 0 };
  const context = vm.createContext({
    URL, Buffer, Readable, pipeline, crypto, fs, path, os, AbortController, AbortSignal, Date,
    ...helpers,
    UPDATE_MANIFEST_URL: manifestUrl, GITHUB_RELEASE_API_URL: releaseUrl, CHROME_UA: 'fixture',
    updateState: {}, updateDownloadTask: null, updatePrompt: null, overlayState: null, overlayReady: null,
    gameViewFallbackHidden: false, gameViewAttached: true, sidebarTransitionActive: false,
    sidebarCollapsed: false, layoutPresentationTimer: null, quitAfterFlush: false,
    clickerWarningAbort: null, currentConfig: { view: { sidebarCollapsed: false }, session: { cookies: [] } },
    effectiveLanguage: () => 'en', appText: key => key, waitForTelemetryConsent: async () => true,
    ensureOverlayView: async () => true, applyOverlayBounds: () => true, syncGameClicker: async () => {},
    syncGameViewVisibility() {}, stopGameClicker() {}, stopAnonymousUsageForWindow() {},
    resolveTelemetryConsentWaiters() {}, resetGameContent() {}, debugLog() {}, trustedGameNewsUrl: url => url || '',
    sendToRenderer(channel, value) { events.push({ channel, value }); listeners.get(channel)?.(value); },
    setTimeout(callback, delay) { const timer = { callback, delay, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    async fetch(url) {
      if (url === manifestUrl) {
        counts.manifest++;
        return { ok: true, status: 200, url: manifestUrl, text: async () => manifestText() };
      }
      if (url === releaseUrl) {
        counts.release++;
        return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.3.0' }) };
      }
      assert.match(url, /\/releases\/download\/v1\.3\.0\/MT-Aigis-1\.3\.0-arm64\.dmg$/);
      counts.download++;
      return {
        ok: true, status: 200, headers: { get: () => String(installer.length) },
        body: new ReadableStream({ start(controller) { controller.enqueue(installer); controller.close(); } }),
      };
    },
  });
  context.app = {
    isPackaged: true, getVersion: () => '1.2.0', getPath: () => path.join(root, 'downloads'),
    quit() { counts.quit++; }, on(name, listener) { if (name === 'before-quit') context.beforeQuit = listener; },
  };
  context.mainWindow = {
    isDestroyed: () => false, webContents: { id: 1, focus() {} }, contentView: { addChildView() {} },
    close() { counts.close++; },
  };
  context.overlayView = {
    setVisible() {},
    webContents: { id: 2, isDestroyed: () => false, focus() {}, close() {},
      send(channel, value) { events.push({ channel, value }); } },
  };
  context.gameView = { webContents: { isDestroyed: () => false, close() { events.push({ channel: 'game-closed' }); },
    session: {
      flushStorageData() { counts.flush++; events.push({ channel: 'storage-flushed' }); },
      cookies: { async get() { return []; }, async flushStore() { counts.cookieFlush++; } },
    } } };
  context.store = { save() { counts.save++; events.push({ channel: 'config-saved' }); } };
  context.shell = { async openPath() { return ''; } };
  vm.runInContext(section(main, 'function setUpdateState(', 'function isGameContentFrame('), context);
  vm.runInContext(section(main, 'function normalizeOverlayState(', 'function applyOverlayBounds(') +
    section(main, 'async function showOverlay(', 'function updateLayout('), context);
  vm.runInContext(section(main, "ipcMain.handle('native-overlay:open',", "ipcMain.handle('native-overlay:clicker-respond',"), context);
  const closed = main.match(/mainWindow\.on\('closed', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(closed);
  vm.runInContext(`function closeHandler() {${closed[1]}}\n` +
    section(main, 'async function flushSessionData(', 'async function restoreAuthCookies(') +
    main.slice(main.indexOf("app.on('before-quit',")), context);
  return { context, root, counts, events, timers, handlers, listeners };
}

test('keeps the update prompt when a previously opened news request returns late', async t => {
  const h = fixture(t), c = h.context, news = deferred();
  c.currentGameNewsUrl = ''; c.currentLanguage = 'en'; c.t = key => key;
  c.api = {
    on(channel, listener) { h.listeners.set(channel, listener); },
    invoke(channel, payload) {
      if (channel === 'game-news:detail') return news.promise;
      return Promise.resolve(h.handlers.get(channel)({ sender: { id: 1 } }, payload));
    },
  };
  const closeListener = sidebar.match(/  api\.on\('native-overlay:closed',[^\n]+/);
  assert.ok(closeListener);
  vm.runInContext(section(sidebar, '  function showGameNewsDetail(', '  function refreshGameNews(') + closeListener[0], c);
  c.showGameNewsDetail({ url: 'https://fixture.invalid/news', title: 'fixture news' });
  await turn(); assert.equal(c.overlayState.kind, 'game-news');
  const pending = c.checkForUpdates(); await turn();
  assert.equal(c.overlayState.kind, 'app-update'); assert.equal(c.currentGameNewsUrl, '');
  news.resolve({ url: 'https://fixture.invalid/news', title: 'late news', body: 'fixture' }); await turn();
  assert.equal(c.overlayState.kind, 'app-update');
  assert.equal(h.handlers.get('native-overlay:update')({ sender: { id: 1 } }, { kind: 'game-news', body: 'late' }), false);
  assert.equal(await c.showOverlay({ kind: 'game-news' }), false);
  assert.equal(await c.showOverlay({ kind: 'clicker-consent' }), false);
  assert.equal(c.checkForUpdates(), pending); assert.equal(h.counts.manifest, 1);
  assert.equal(h.handlers.get('native-overlay:close')({ sender: { id: 2 } }), true);
  assert.equal((await pending).status, 'deferred'); assert.equal(c.updateDownloadTask, null); assert.equal(c.updatePrompt, null);
  assert.equal(await c.showOverlay({ kind: 'game-news' }), true);
  c.closeOverlay();
  const retried = c.checkForUpdates(); await turn();
  assert.equal(h.counts.manifest, 2); c.resolveUpdatePrompt('later'); await retried;
});

test('prevents an already loading news overlay from reclaiming the update prompt', async t => {
  const h = fixture(t), c = h.context, ready = deferred();
  c.ensureOverlayView = () => ready.promise;
  const news = c.showOverlay({ kind: 'game-news' });
  c.ensureOverlayView = async () => true;
  const pending = c.checkForUpdates(); await turn();
  assert.equal(c.overlayState.kind, 'app-update');
  ready.resolve(true); assert.equal(await news, false); assert.equal(c.overlayState.kind, 'app-update');
  c.resolveUpdatePrompt('later'); await pending;
});

test('locks the selected download to its version even if latest changes before confirmation', async t => {
  const h = fixture(t), c = h.context, fetch = c.fetch; let latest = '1.3.0', requested;
  c.fetch = async url => {
    if (url !== manifestUrl && url !== releaseUrl) {
      requested = url;
      if (url.includes('/latest/download/') && latest !== '1.3.0') return { ok: false, status: 404 };
    }
    return fetch(url);
  };
  c.showUpdateNotification = async () => { latest = '1.4.0'; return 'install'; };
  assert.equal((await c.checkForUpdates()).status, 'opened');
  assert.match(requested, /\/download\/v1\.3\.0\//);
  assert.equal(h.counts.download, 1); assert.equal(h.counts.quit, 0); assert.equal(h.counts.close, 0);
});

test('rejects malformed successful manifest responses without offering or downloading an update', async t => {
  for (const text of [
    'version: 1.3.0\nfiles: []\n', manifestText('nonsense'), manifestText('1.3.0/../../../outside'),
    manifestText().replace(/size: \d+/, 'size: 0'), manifestText().replace(/sha512: .+/, 'sha512: invalid'),
  ]) {
    const h = fixture(t), c = h.context, fetch = c.fetch;
    c.fetch = url => url === manifestUrl ? Promise.resolve({ ok: true, url: manifestUrl, text: async () => text }) : fetch(url);
    const result = await c.checkForUpdates();
    assert.equal(result.status, 'error'); assert.equal(result.message, 'updateFailed');
    assert.equal(h.counts.download, 0); assert.equal(h.counts.quit, 0); assert.equal(c.updatePrompt, null);
    assert.equal(c.updateDownloadTask, null); assert.equal(fs.existsSync(path.join(h.root, 'downloads')), false);
  }
});

test('retains the real missing-manifest 404 compatibility and releases the task for retry', async t => {
  const h = fixture(t), c = h.context, fetch = c.fetch; let missing = true;
  c.fetch = url => url === manifestUrl && missing ? Promise.resolve({ ok: false, status: 404 }) : fetch(url);
  assert.equal((await c.checkForUpdates()).status, 'current'); assert.equal(c.updateDownloadTask, null);
  missing = false; c.showUpdateNotification = async () => 'later';
  assert.equal((await c.checkForUpdates()).status, 'deferred');
});

test('release metadata rate limiting leaves manifest based detection available', async t => {
  const h = fixture(t), c = h.context, fetch = c.fetch;
  c.fetch = url => url === releaseUrl ? Promise.resolve({ ok: false, status: 403 }) : fetch(url);
  c.showUpdateNotification = async release => { assert.equal(release.version, '1.3.0'); return 'later'; };
  assert.equal((await c.checkForUpdates()).status, 'deferred'); assert.equal(c.updateDownloadTask, null);
});

test('blocks other overlays during the renderer fallback and restores visibility on later', async t => {
  const h = fixture(t), c = h.context; c.ensureOverlayView = async () => false;
  const pending = c.checkForUpdates(); await turn();
  assert.equal(c.updatePrompt.surface, 'renderer'); assert.equal(c.gameViewFallbackHidden, true);
  assert.ok(h.events.some(event => event.channel === 'update:prompt'));
  assert.equal(await c.showOverlay({ kind: 'game-news' }), false);
  c.resolveUpdatePrompt('later'); assert.equal((await pending).status, 'deferred');
  assert.equal(c.gameViewFallbackHidden, false); assert.equal(c.updateDownloadTask, null);
});

test('finishes cookie and session persistence before update shutdown destroys the game view', async t => {
  const h = fixture(t), c = h.context, flushed = deferred();
  c.gameView.webContents.session.cookies.flushStore = () => { h.counts.cookieFlush++; return flushed.promise; };
  c.app.quit = () => {
    h.counts.quit++; let prevented = false;
    c.beforeQuit({ preventDefault() { prevented = true; } });
    if (!prevented) { h.counts.close++; c.closeHandler(); }
  };
  await c.openInstallerAndQuit('/virtual/installer.dmg');
  assert.equal(h.counts.close, 0);
  h.timers.find(timer => timer.delay === 600).callback(); await turn();
  assert.equal(h.counts.save, 1); assert.equal(h.counts.flush, 1); assert.equal(h.counts.cookieFlush, 1);
  assert.notEqual(c.gameView, null); assert.equal(h.counts.close, 0);
  flushed.resolve(); await turn();
  assert.equal(c.gameView, null); assert.equal(h.counts.close, 1);
  assert.ok(h.events.findIndex(event => event.channel === 'config-saved') < h.events.findIndex(event => event.channel === 'game-closed'));
});

test('keeps the application running after installer open failure and permits a fresh update attempt', async t => {
  const h = fixture(t), c = h.context;
  c.showUpdateNotification = async () => 'install'; c.shell.openPath = async () => 'fixture open failure';
  assert.equal((await c.checkForUpdates()).status, 'error');
  assert.equal(h.counts.close, 0); assert.equal(h.counts.quit, 0); assert.equal(c.updateDownloadTask, null);
  assert.ok(!h.timers.some(timer => timer.delay === 600));
  c.shell.openPath = async () => '';
  assert.equal((await c.checkForUpdates()).status, 'opened');
  assert.equal(h.counts.manifest, 2); assert.equal(h.counts.release, 2); assert.equal(h.counts.download, 2);
});

test('defers a pending update when the owning window is closed', async t => {
  const h = fixture(t), c = h.context;
  const pending = c.checkForUpdates(); await turn();
  c.closeHandler(); assert.equal((await pending).status, 'deferred');
  assert.equal(c.updateDownloadTask, null); assert.equal(c.updatePrompt, null); assert.equal(h.counts.download, 0);
});
