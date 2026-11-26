const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { createMiniWindowControls } = require('../lib/mini-window');
const { isAdaptedPage, DEFAULT_URL } = require('../lib/navigation');
const { defaultConfig, SecureConfigStore } = require('../lib/secure-config');

class TestWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.bounds = { x: 100, y: 200, width: 480, height: 368, ...options };
    this.visible = options.show !== false;
    this.minimized = false;
    this.destroyed = false;
    this.reveals = 0;
    this.opacityChanges = [];
    this.messages = [];
    this.webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      focus() {},
      setWindowOpenHandler() {},
      send: (channel, state) => this.messages.push({ channel, state }),
    });
    const children = [];
    this.contentView = {
      children,
      addChildView(view) {
        assert.ok(!view.parent || view.parent === this);
        this.removeChildView(view);
        children.push(view);
        view.parent = this;
      },
      removeChildView(view) {
        const index = children.indexOf(view);
        if (index === -1) return;
        children.splice(index, 1);
        view.parent = null;
      },
    };
  }
  getBounds() { return this.bounds; }
  getContentSize() { return [this.bounds.width, this.bounds.height]; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  isDestroyed() { return this.destroyed; }
  isAlwaysOnTop() { return !!this.pinned; }
  setAlwaysOnTop(value) { this.pinned = value; }
  setOpacity(value) { this.opacityChanges.push(value); }
  show() { this.visible = true; this.emit('show'); }
  showInactive() { this.reveals++; this.show(); }
  hide() { this.visible = false; this.emit('hide'); }
  destroy() {
    for (const child of [...this.contentView.children]) this.contentView.removeChildView(child);
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }
  close() {
    let prevented = false;
    this.emit('close', { preventDefault() { prevented = true; } });
    if (!prevented && !this.destroyed) this.destroy();
  }
}

test('samples only when hover reveal is enabled and restores without focusing', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const window = new TestWindow();
  let point = { x: 10, y: 20 }, samples = 0;
  const controls = createMiniWindowControls(window, {
    getCursorScreenPoint() { samples++; return point; },
  });
  t.after(() => controls.dispose());
  assert.deepEqual(controls.update(), { opacity: 100, revealOnHover: false });
  t.mock.timers.tick(400);
  assert.equal(samples, 0);

  assert.equal(controls.update({ opacity: 55 }).opacity, 55);
  assert.equal(controls.update({ opacity: 55 }).opacity, 55);
  assert.equal(controls.update({ opacity: 5 }).opacity, 20);
  assert.equal(controls.update({ opacity: NaN }).opacity, 20);
  assert.deepEqual(window.opacityChanges, [0.55, 0.2]);
  controls.update({ revealOnHover: true });
  t.mock.timers.tick(80);
  assert.equal(window.visible, false);
  point = { x: 150, y: 250 };
  t.mock.timers.tick(80);
  assert.equal(window.visible, true);
  assert.equal(window.reveals, 1);

  point = { x: 0, y: 0 };
  t.mock.timers.tick(80);
  assert.equal(window.visible, false);
  controls.update({ revealOnHover: false });
  assert.equal(window.visible, true);
  const before = samples;
  t.mock.timers.tick(400);
  assert.equal(samples, before);
});

test('keeps the mini window visible during opacity drags and native resizing, and respects minimization', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const window = new TestWindow();
  let samples = 0;
  const controls = createMiniWindowControls(window, {
    getCursorScreenPoint() { samples++; return { x: 10, y: 20 }; },
  });
  t.after(() => controls.dispose());
  controls.update({ revealOnHover: true, draggingOpacity: true });
  t.mock.timers.tick(240);
  assert.equal(window.visible, true);
  assert.equal(samples, 0);
  controls.update({ draggingOpacity: false });
  window.emit('will-resize');
  t.mock.timers.tick(240);
  assert.equal(window.visible, true);
  window.emit('resized');
  t.mock.timers.tick(240);
  assert.equal(window.visible, false);
  window.minimized = true;
  window.emit('minimize');
  const before = samples;
  t.mock.timers.tick(400);
  assert.equal(samples, before);
  controls.dispose();
  assert.equal(window.listenerCount('move'), 0);
});

test('shows a new mini window with stealth enabled and hides only after the pointer has entered', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const window = new TestWindow({ show: false });
  let point = { x: 10, y: 20 };
  const controls = createMiniWindowControls(window, { getCursorScreenPoint: () => point }, true);
  t.after(() => controls.dispose());
  window.show();
  assert.equal(controls.update().revealOnHover, true);
  t.mock.timers.tick(400);
  assert.equal(window.visible, true);
  point = { x: 150, y: 250 };
  t.mock.timers.tick(80);
  point = { x: 10, y: 20 };
  t.mock.timers.tick(80);
  assert.equal(window.visible, false);
});

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function hostFixture(loadFile = async () => {}, config = defaultConfig(), store = { save() {} }) {
  const mainWindow = new TestWindow({ width: 1320, height: 760 });
  mainWindow.webContents.mainFrame.url = pathToFileURL(path.join(root, 'ui', 'index.html')).href;
  const gameView = { webContents: { isDestroyed: () => false, getURL: () => DEFAULT_URL, focus() {} } };
  const overlayView = { webContents: { isDestroyed: () => false, focus() {} } };
  mainWindow.pinned = true;
  mainWindow.contentView.addChildView(gameView);
  mainWindow.contentView.addChildView(overlayView);
  const windows = [], activityHosts = [], handlers = new Map();
  const context = vm.createContext({
    path, pathToFileURL, __dirname: root, process: { platform: 'darwin' }, TOP_BAR_H: 48,
    mainWindow, gameView, overlayView,
    currentConfig: config, store,
    miniWindow: null, miniWindowTask: null, gameBackgroundActivity: null,
    gameContentReady: true, gameContentSize: { width: 960, height: 640 }, gameContentEpoch: 0,
    gameViewLoadingMasked: false, gameViewFallbackHidden: false,
    overlayState: null, updatePrompt: null, clickerWarningTask: null, sidebarTransitionActive: false, quitAfterFlush: false,
    screen: {
      getDisplayMatching() { return { workArea: { x: 0, y: 24, width: 1024, height: 740 } }; },
      getCursorScreenPoint() { return { x: 0, y: 0 }; },
    },
    isGameUrl: isAdaptedPage, createMiniWindowControls,
    gameFillColor: () => '#101011',
    installGameBackgroundActivity(host, contents) {
      assert.equal(contents, gameView.webContents);
      const activity = { host, active: true, dispose() { this.active = false; } };
      activityHosts.push(activity);
      return activity;
    },
    stopGameClicker() {}, syncGameClicker() {}, updateLayout() {}, debugLog() {},
    BrowserWindow: class extends TestWindow {
      constructor(options) { super(options); windows.push(this); }
      loadFile(file) {
        this.webContents.mainFrame.url = pathToFileURL(file).href;
        return loadFile(file);
      }
    },
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
  });
  vm.runInContext([
    section('function gameHostWindow(', 'function createGameView('),
    section('function isWindowControlSender(', "ipcMain.handle('browser:custom-url:set'"),
  ].join('\n'), context);
  const eventFor = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { context, mainWindow, gameView, overlayView, windows, activityHosts, handlers, eventFor };
}

test('opens one resizable mini window with the live game and moves both views back on close', async () => {
  const h = hostFixture(), open = h.handlers.get('window:mini:open');
  const origin = h.eventFor(h.mainWindow);
  assert.equal(open({ ...origin, senderFrame: {} }), false);
  const trustedURL = origin.senderFrame.url;
  origin.senderFrame.url = 'https://example.test/';
  assert.equal(open(origin), false);
  origin.senderFrame.url = trustedURL;
  const first = open(origin), second = open(origin);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.windows.length, 1);
  const mini = h.windows[0];
  assert.deepEqual(mini.contentView.children, [h.gameView, h.overlayView]);
  assert.deepEqual(mini.getContentSize(), [480, 368]);
  assert.equal(mini.pinned, true);
  assert.equal(mini.options.resizable, true);
  assert.equal(h.mainWindow.visible, false);
  const controls = h.handlers.get('window:mini:controls');
  assert.equal(controls(origin, { opacity: 30 }), null);
  assert.equal(controls(h.eventFor(mini), { opacity: 30 }).opacity, 30);
  assert.deepEqual(mini.opacityChanges, [0.3]);
  mini.close();
  assert.equal(mini.destroyed, true);
  assert.equal(h.context.miniWindow, null);
  assert.equal(h.mainWindow.visible, true);
  assert.deepEqual(h.mainWindow.contentView.children, [h.gameView, h.overlayView]);
  assert.deepEqual(h.activityHosts.map(a => a.active), [false, true]);
  assert.equal(h.activityHosts.at(-1).host, h.mainWindow);
});

test('opens one mini window while the same view is still loading the game', async (t) => {
  const h = hostFixture();
  const open = h.handlers.get('window:mini:open');
  const origin = h.eventFor(h.mainWindow);
  h.context.gameContentReady = false;
  h.context.gameContentSize = null;
  h.context.gameViewLoadingMasked = true;
  h.gameView.webContents.getURL = () => '';
  h.context.gameViewFallbackHidden = true;
  assert.equal(await open(origin), false);
  h.context.gameViewFallbackHidden = false;

  const opening = open(origin);
  h.context.gameContentEpoch++;
  h.gameView.webContents.getURL = () => DEFAULT_URL;
  assert.equal(await opening, true);
  const mini = h.windows[0];
  t.after(() => mini.close());
  assert.deepEqual(mini.contentView.children, [h.gameView, h.overlayView]);
  assert.deepEqual(mini.getContentSize(), [480, 368]);
  assert.equal(h.context.gameViewLoadingMasked, true);
  assert.equal(h.mainWindow.visible, false);
});

test('keeps the main window visible if the mini shell fails or the view leaves the game during opening', async () => {
  for (const changedPage of [false, true]) {
    const h = hostFixture(async () => {
      if (!changedPage) throw new Error('fixture load error');
      h.context.gameContentEpoch++;
      h.context.gameContentReady = false;
      h.context.gameViewLoadingMasked = false;
      h.gameView.webContents.getURL = () => 'https://accounts.dmm.com/';
    });
    assert.equal(await h.handlers.get('window:mini:open')(h.eventFor(h.mainWindow)), false);
    assert.equal(h.context.miniWindow, null);
    assert.equal(h.mainWindow.visible, true);
    assert.equal(h.windows[0].destroyed, true);
    assert.deepEqual(h.mainWindow.contentView.children, [h.gameView, h.overlayView]);
  }
});

test('persists only changes to the stealth preference and restores it from encrypted storage', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-aigis-mini-preference-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const createStore = () => {
    const store = new SecureConfigStore(folder);
    store.getOrCreateKey = () => Buffer.alloc(32, 15);
    return store;
  };
  const store = createStore();
  let writes = 0;
  const h = hostFixture(undefined, store.load(), {
    save(config) { writes++; return store.save(config); },
  });
  const open = h.handlers.get('window:mini:open');
  assert.equal(await open(h.eventFor(h.mainWindow)), true);
  const mini = h.windows[0];
  t.after(() => { if (!mini.destroyed) mini.close(); });
  assert.equal(mini.messages[0].channel, 'window:mini:state');
  assert.equal(mini.messages[0].state.revealOnHover, true);
  const update = h.handlers.get('window:mini:controls');
  const event = h.eventFor(mini);
  update(event, { opacity: 42 });
  update(event, { revealOnHover: true });
  assert.equal(writes, 0);
  assert.equal(update(event, { revealOnHover: false }).revealOnHover, false);
  update(event, { revealOnHover: false });
  assert.equal(writes, 1);
  mini.close();

  const restarted = hostFixture(undefined, createStore().load());
  assert.equal(await restarted.handlers.get('window:mini:open')(restarted.eventFor(restarted.mainWindow)), true);
  const next = restarted.windows[0];
  t.after(() => { if (!next.destroyed) next.close(); });
  assert.equal(next.messages[0].state.revealOnHover, false);
  assert.equal(next.messages[0].state.opacity, 100);
});

test('keeps the visible stealth setting when encrypted storage refuses the change', async (t) => {
  const h = hostFixture(undefined, defaultConfig(), {
    save() { throw new Error('fixture denied write'); },
  });
  assert.equal(await h.handlers.get('window:mini:open')(h.eventFor(h.mainWindow)), true);
  const mini = h.windows[0];
  t.after(() => mini.close());
  const update = h.handlers.get('window:mini:controls');
  const event = h.eventFor(mini);
  assert.throws(() => update(event, { revealOnHover: false }), /fixture denied write/);
  assert.equal(update(event).revealOnHover, true);
  assert.equal(h.context.currentConfig.view.miniWindowRevealOnHover, true);
});
