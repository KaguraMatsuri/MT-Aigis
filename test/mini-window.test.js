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
    const { x = 100, y = 200, width = 480, height = 368 } = options;
    this.bounds = { x, y, width, height };
    this.minimumSize = [options.minWidth ?? 0, options.minHeight ?? 0];
    this.opacity = 1;
    this.maximized = false;
    this.fullScreen = false;
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
  getBounds() { return { ...this.bounds }; }
  getNormalBounds() { return this.getBounds(); }
  setBounds(bounds) {
    this.bounds = { ...bounds };
    this.emit('move');
    this.emit('resize');
    this.emit('resized');
  }
  setContentBounds(bounds) { this.setBounds(bounds); }
  getContentSize() { return [this.bounds.width, this.bounds.height]; }
  getMinimumSize() { return this.minimumSize.slice(); }
  setMinimumSize(width, height) { this.minimumSize = [width, height]; }
  isFullScreen() { return this.fullScreen; }
  setFullScreen(enabled) {
    this.fullScreen = enabled;
    this.emit(enabled ? 'enter-full-screen' : 'leave-full-screen');
  }
  isMaximized() { return this.maximized; }
  maximize() { this.maximized = true; }
  unmaximize() { this.maximized = false; }
  isFocused() { return this.visible; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  isDestroyed() { return this.destroyed; }
  getOpacity() { return this.opacity; }
  setOpacity(value) { this.opacity = value; this.opacityChanges.push(value); }
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

test('checks the live window bounds before hiding during a titlebar move', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const window = new TestWindow();
  let point = { x: 150, y: 220 };
  const controls = createMiniWindowControls(window, { getCursorScreenPoint: () => point }, true);
  t.after(() => controls.dispose());
  t.mock.timers.tick(80);
  // The system geometry can already be updated when the JS move event is still queued.
  window.bounds.x = 500;
  point = { x: 700, y: 220 };
  t.mock.timers.tick(80);
  assert.equal(window.visible, true);
  window.emit('will-move');
  point = { x: 20, y: 20 };
  t.mock.timers.tick(80);
  assert.equal(window.visible, true);
  t.mock.timers.tick(80);
  assert.equal(window.visible, false);
});

test('keeps a game drag visible outside the mini window until mouse release or cancellation', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const window = new TestWindow();
  const gameContents = Object.assign(new EventEmitter(), { isFocused: () => true });
  const inside = { x: 150, y: 250 };
  const outside = { x: 10, y: 20 };
  let point = inside;
  const controls = createMiniWindowControls(window, { getCursorScreenPoint: () => point }, true, gameContents);
  t.after(() => controls.dispose());
  window.emit('show');
  t.mock.timers.tick(80);

  gameContents.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left' });
  point = outside;
  t.mock.timers.tick(240);
  assert.equal(window.visible, true);

  gameContents.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
  t.mock.timers.tick(79);
  assert.equal(window.visible, true);
  t.mock.timers.tick(1);
  assert.equal(window.visible, false);

  point = inside;
  t.mock.timers.tick(80);
  assert.equal(window.visible, true);
  gameContents.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left' });
  point = outside;
  gameContents.emit('blur');
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

function hostFixture(t, { config = defaultConfig(), store = { save() {} } } = {}) {
  const app = new EventEmitter();
  const mainWindow = new TestWindow({ width: 1320, height: 760, minWidth: 900, minHeight: 620 });
  mainWindow.webContents.mainFrame.url = pathToFileURL(path.join(root, 'ui', 'index.html')).href;
  const gameView = {
    setBounds(bounds) { this.bounds = bounds; },
    webContents: Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getURL: () => DEFAULT_URL,
      focused: false,
      focusCalls: 0,
      isFocused() { return this.focused; },
      focus() { this.focused = true; this.focusCalls++; },
    }),
  };
  const overlayView = { webContents: { isDestroyed: () => false, focus() {} } };
  mainWindow.pinned = true;
  mainWindow.contentView.addChildView(gameView);
  mainWindow.contentView.addChildView(overlayView);
  const handlers = new Map();
  const context = vm.createContext({
    path, pathToFileURL, __dirname: root, process: { platform: 'darwin' }, TOP_BAR_H: 48,
    BOTTOM_BAR_H: 52, SIDEBAR_OPEN_WIDTH: 360, SIDEBAR_CLOSED_WIDTH: 44, sidebarCollapsed: false,
    mainWindow, gameView, overlayView, currentConfig: config, store, setTimeout, clearTimeout,
    app, miniWindowMode: null, miniWindowTask: null, miniWindowOpacity: 100,
    gameContentReady: true, gameContentSize: { width: 960, height: 640 }, gameContentEpoch: 0,
    gameViewLoadingMasked: false, gameViewFallbackHidden: false,
    overlayState: null, updatePrompt: null, clickerWarningTask: null, sidebarTransitionActive: false, quitAfterFlush: false,
    screen: {
      getDisplayMatching() { return { workArea: { x: 0, y: 24, width: 1600, height: 900 } }; },
      getCursorScreenPoint() { return { x: 0, y: 0 }; },
    },
    isGameUrl: isAdaptedPage, createMiniWindowControls,
    sendToRenderer(channel, state) { mainWindow.webContents.send(channel, state); },
    stopGameClicker() {}, updateLayout() { context.applyGameViewBounds(); }, debugLog() {},
    BrowserWindow: class { constructor() { assert.fail('Compact mode must reuse the existing window'); } },
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
  });
  vm.runInContext([
    section('function canOpenMiniWindow(', 'function createGameView('),
    section('function applyGameViewBounds(', 'function attachNavigationHandlers('),
    section('function isWindowControlSender(', "ipcMain.handle('browser:custom-url:set'"),
    section("  mainWindow.on('close',", "  mainWindow.on('closed',"),
    section("  app.on('activate',", "\n});\n\napp.on('window-all-closed'"),
  ].join('\n'), context);
  t.after(() => context.miniWindowMode?.controls.dispose());
  const event = { sender: mainWindow.webContents, senderFrame: mainWindow.webContents.mainFrame };
  const open = () => handlers.get('window:mini:open')(event);
  const controls = (changes) => handlers.get('window:mini:controls')(event, changes);
  const close = () => {
    mainWindow.close();
    return context.miniWindowTask;
  };
  return { app, context, mainWindow, gameView, overlayView, open, controls, close, event, handlers };
}

test('resizes and restores the same window without moving the live game or overlay', async (t) => {
  const h = hostFixture(t);
  const { mainWindow: window, gameView, overlayView } = h;
  const bounds = window.getBounds();
  const minSize = window.getMinimumSize();
  const unauthorized = { ...h.event, senderFrame: {} };
  const open = h.handlers.get('window:mini:open');
  assert.equal(open(unauthorized), false);
  const trustedURL = h.event.senderFrame.url;
  h.event.senderFrame.url = 'https://example.test/';
  assert.equal(open(h.event), false);
  h.event.senderFrame.url = trustedURL;
  assert.equal(h.controls({ opacity: 30 }), null);

  window.contentView.addChildView = () => assert.fail('A view was added again during the switch');
  window.contentView.removeChildView = () => assert.fail('A view was removed during the switch');
  assert.deepEqual(await Promise.all([h.open(), h.open()]), [true, true]);
  assert.deepEqual(window.getContentSize(), [480, 368]);
  assert.deepEqual(window.getMinimumSize(), [320, 228]);
  assert.deepEqual([gameView.bounds.width, gameView.bounds.height], [480, 320]);
  assert.equal(window.pinned, true);
  assert.equal(window.visible, true);
  assert.equal(gameView.parent, window.contentView);
  assert.equal(overlayView.parent, window.contentView);
  assert.equal(gameView.webContents.listenerCount('before-mouse-event'), 1);
  assert.equal(h.handlers.get('window:mini:controls')(unauthorized, { opacity: 30 }), null);
  assert.equal(h.controls({ opacity: 30 }).opacity, 30);
  assert.equal(window.getOpacity(), 0.3);
  assert.equal(window.messages[0].channel, 'window:mini:state');
  assert.equal(window.messages[0].state.opacity, 100);

  window.hide();
  assert.equal(await h.close(), true);
  assert.equal(h.context.miniWindowMode, null);
  assert.equal(window.destroyed, false);
  assert.equal(window.visible, true);
  assert.deepEqual(window.getBounds(), bounds);
  assert.deepEqual(window.getMinimumSize(), minSize);
  assert.equal(window.getOpacity(), 1);
  assert.deepEqual([gameView.bounds.width, gameView.bounds.height], [960, 660]);
  assert.deepEqual(window.contentView.children, [gameView, overlayView]);
  assert.equal(gameView.webContents.listenerCount('before-mouse-event'), 0);
  assert.deepEqual(window.messages.at(-1), { channel: 'window:mini:state', state: null });
});

test('switches while the same game view is still loading', async (t) => {
  const h = hostFixture(t);
  const { context: c, gameView, mainWindow } = h;
  c.gameContentReady = false;
  c.gameContentSize = null;
  c.gameViewLoadingMasked = true;
  gameView.webContents.getURL = () => '';
  c.gameViewFallbackHidden = true;
  assert.equal(await h.open(), false);
  c.gameViewFallbackHidden = false;
  assert.equal(await h.open(), true);
  assert.equal(c.gameViewLoadingMasked, true);
  assert.equal(gameView.webContents.focusCalls, 0);
  assert.equal(gameView.parent, mainWindow.contentView);
  assert.deepEqual(mainWindow.getContentSize(), [480, 368]);
});

test('hands focus from the mini toolbar to the game on the first left press', async (t) => {
  const h = hostFixture(t);
  assert.equal(await h.open(), true);
  const contents = h.gameView.webContents;
  contents.focused = false;
  const priorCalls = contents.focusCalls;
  const event = { preventDefault: () => assert.fail('The original game input must be delivered') };

  h.mainWindow.showInactive();
  h.mainWindow.webContents.emit('before-mouse-event', event, { type: 'mouseDown', button: 'left' });
  contents.emit('before-mouse-event', event, { type: 'mouseMove', button: 'left' });
  assert.equal(contents.focusCalls, priorCalls);

  contents.emit('before-mouse-event', event, { type: 'mouseDown', button: 'left' });
  assert.equal(contents.isFocused(), true);
  assert.equal(contents.focusCalls, priorCalls + 1);
  contents.emit('before-mouse-event', event, { type: 'mouseUp', button: 'left' });
  contents.emit('before-mouse-event', event, { type: 'mouseDown', button: 'left' });
  assert.equal(contents.focusCalls, priorCalls + 1);
});

test('restores fullscreen after completing the native exit and entry transitions', async (t) => {
  const h = hostFixture(t);
  const window = h.mainWindow;
  const bounds = window.getBounds();
  window.fullScreen = true;
  const requests = [];
  window.setFullScreen = (enabled) => requests.push(enabled);
  const opening = h.open();
  await new Promise(setImmediate);
  assert.deepEqual(requests, [false]);
  assert.deepEqual(window.getBounds(), bounds);

  TestWindow.prototype.setFullScreen.call(window, false);
  assert.equal(await opening, true);
  assert.deepEqual(window.getContentSize(), [480, 368]);
  const closing = h.close();
  await new Promise(setImmediate);
  assert.deepEqual(requests, [false, true]);
  assert.deepEqual(window.getBounds(), bounds);

  TestWindow.prototype.setFullScreen.call(window, true);
  assert.equal(await closing, true);
  assert.equal(window.isFullScreen(), true);
  assert.equal(h.context.miniWindowMode, null);
  assert.equal(window.listenerCount('enter-full-screen'), 0);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
});

test('restores the original shape if resize fails or the game leaves during fullscreen exit', async (t) => {
  const h = hostFixture(t);
  const window = h.mainWindow;
  const bounds = window.getBounds();
  window.setContentBounds = (next) => {
    window.setBounds(next);
    throw new Error('fixture resize failure');
  };
  assert.equal(await h.open(), false);
  assert.deepEqual(window.getBounds(), bounds);
  assert.deepEqual(window.getMinimumSize(), [900, 620]);
  assert.equal(h.context.miniWindowMode, null);
  assert.equal(h.gameView.webContents.listenerCount('before-mouse-event'), 0);

  window.fullScreen = true;
  window.setFullScreen = (enabled) => {
    if (!enabled) {
      h.context.gameContentReady = false;
      h.gameView.webContents.getURL = () => 'https://accounts.dmm.com/';
    }
    TestWindow.prototype.setFullScreen.call(window, enabled);
  };
  assert.equal(await h.open(), false);
  assert.equal(window.isFullScreen(), true);
  assert.equal(window.visible, true);
  assert.equal(h.context.miniWindowMode, null);
  assert.deepEqual(window.contentView.children, [h.gameView, h.overlayView]);
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
  const h = hostFixture(t, {
    config: store.load(),
    store: { save(config) { writes++; return store.save(config); } },
  });
  assert.equal(await h.open(), true);
  assert.equal(h.mainWindow.messages[0].state.revealOnHover, true);
  h.controls({ opacity: 42 });
  h.controls({ revealOnHover: true });
  assert.equal(writes, 0);
  assert.equal(h.controls({ revealOnHover: false }).revealOnHover, false);
  h.controls({ revealOnHover: false });
  assert.equal(writes, 1);
  assert.equal(await h.close(), true);

  const restarted = hostFixture(t, { config: createStore().load() });
  assert.equal(await restarted.open(), true);
  assert.equal(restarted.mainWindow.messages[0].state.revealOnHover, false);
  assert.equal(restarted.mainWindow.messages[0].state.opacity, 100);
});

test('restores the mini opacity after Dock activation and resets it in a new app session', async (t) => {
  let writes = 0;
  const h = hostFixture(t, { store: { save() { writes++; } } });
  assert.equal(await h.open(), true);
  assert.equal(h.controls({ opacity: 42 }).opacity, 42);
  h.app.emit('activate');
  await h.context.miniWindowTask;
  assert.equal(h.mainWindow.getOpacity(), 1);
  assert.equal(await h.open(), true);
  assert.equal(h.mainWindow.getOpacity(), 0.42);
  assert.equal(h.mainWindow.messages.at(-1).state.opacity, 42);
  h.controls({ opacity: 100 });
  assert.equal(await h.close(), true);
  assert.equal(await h.open(), true);
  assert.equal(h.mainWindow.getOpacity(), 1);
  assert.equal(h.controls({ opacity: 67 }).opacity, 67);
  assert.equal(writes, 0);

  const restarted = hostFixture(t, { config: h.context.currentConfig });
  assert.equal(await restarted.open(), true);
  assert.equal(restarted.controls().opacity, 100);
});

test('keeps the visible stealth setting when encrypted storage refuses the change', async (t) => {
  const h = hostFixture(t, { store: { save() { throw new Error('fixture denied write'); } } });
  assert.equal(await h.open(), true);
  assert.throws(() => h.controls({ revealOnHover: false }), /fixture denied write/);
  assert.equal(h.controls().revealOnHover, true);
  assert.equal(h.context.currentConfig.view.miniWindowRevealOnHover, true);
});
