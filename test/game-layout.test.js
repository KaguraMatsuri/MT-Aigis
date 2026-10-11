const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const focus = fs.readFileSync(path.join(root, 'resources', 'game-focus.js'), 'utf8');

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function clock() {
  let now = 0, nextId = 0;
  const tasks = new Map();
  return {
    schedule(callback, delay = 0) { const id = ++nextId; tasks.set(id, { callback, at: now + delay }); return id; },
    cancel(id) { tasks.delete(id); },
    get pending() { return tasks.size; },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const candidate = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!candidate) break;
        tasks.delete(candidate[0]); now = candidate[1].at; candidate[1].callback(now);
      }
      now = end;
    },
  };
}

function game(width = 960, height = 660, options = {}) {
  const time = clock();
  let layouts = 0, framePresent = true;
  function element(id) {
    const attrs = new Map(), styles = new Map(), listeners = new Map();
    return {
      id, children: [], parentElement: null,
      style: {
        setProperty(key, value) { if (key === 'transform') layouts++; styles.set(key, value); },
        getPropertyValue(key) { return styles.get(key) || ''; },
      },
      hasAttribute(key) { return attrs.has(key); }, getAttribute(key) { return attrs.get(key) || ''; },
      setAttribute(key, value) { attrs.set(key, value); if (key === 'style' && !value) styles.clear(); },
      removeAttribute(key) { attrs.delete(key); },
      addEventListener(key, listener) { listeners.set(key, listener); }, removeEventListener(key) { listeners.delete(key); },
      get listenerCount() { return listeners.size; },
    };
  }
  const html = element('html'), body = element('body'), frame = element('game_frame');
  body.parentElement = html; html.children = [body]; frame.parentElement = body; body.children = [frame];
  frame.src = 'https://fixture.example/game';
  const resizeListeners = [];
  const window = {
    innerWidth: width, innerHeight: height,
    addEventListener(type, listener) { if (type === 'resize') resizeListeners.push(listener); },
    matchMedia() { return { matches: !!options.reducedMotion }; },
    getComputedStyle(node) { return { left: node.style.getPropertyValue('left'), top: node.style.getPropertyValue('top'), transform: node.style.getPropertyValue('transform') }; },
  };
  window.top = window;
  const context = vm.createContext({
    window,
    document: {
      body, documentElement: html,
      getElementById(id) { return id === 'game_frame' && framePresent ? frame : null; },
      querySelectorAll() { return [html, body, frame]; }, addEventListener() {},
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: time.schedule, clearTimeout: time.cancel,
    requestAnimationFrame: callback => time.schedule(callback, 16), cancelAnimationFrame: time.cancel,
    location: { href: 'https://play.games.dmm.com/game/aigisc' },
  });
  vm.runInContext(focus, context);
  const api = window.__MT_GAME_FOCUS__;
  api.configure({ contentReady: true, userScale: 1, gameSize: options.gameSize });
  return {
    api, context, frame, time,
    resize(w, h) {
      if (window.innerWidth === w && window.innerHeight === h) return;
      window.innerWidth = w; window.innerHeight = h; resizeListeners.forEach(listener => listener());
    },
    showFrame(value) { framePresent = value; },
    get layouts() { return layouts; },
    get scale() { return Number(frame.style.getPropertyValue('transform').match(/scale\(([^)]+)\)/)?.[1]); },
  };
}

function native(h, options = {}) {
  const handlers = new Map(), bounds = [], scripts = [];
  let size = [1320, 760], closed, destroyed = false, saves = 0;
  const context = vm.createContext({
    SIDEBAR_OPEN_WIDTH: 360, SIDEBAR_CLOSED_WIDTH: 44, TOP_BAR_H: 48, BOTTOM_BAR_H: 52,
    sidebarCollapsed: !!options.collapsed, sidebarTransitionActive: false, gameViewAttached: true,
    layoutPresentationTimer: null, overlayState: null, overlayView: null, overlayReady: null,
    gameContentReady: true, gameContentSize: options.gameSize || null, gameContentEpoch: 0, updatePrompt: null,
    currentConfig: { view: { sidebarCollapsed: !!options.collapsed } },
    mainWindow: {
      isDestroyed() { return destroyed; }, getContentSize() { return size; }, webContents: { id: 1 },
      on(_event, callback) { closed = callback; }, close() { closed(); destroyed = true; },
    },
    gameView: {
      setBounds(value) { bounds.push(value); h.resize(value.width, value.height); },
      webContents: {
        isDestroyed() { return destroyed; }, getURL() { return 'https://play.games.dmm.com/game/aigisc'; }, close() {},
        async executeJavaScript(code) {
          scripts.push(code);
          const result = vm.runInContext(code, h.context);
          if (options.prepareGate && code.includes('.prepareViewportTransition(')) await options.prepareGate;
          return result;
        },
      },
    },
    setImmediate: callback => h.time.schedule(callback, 0), setTimeout: h.time.schedule, clearTimeout: h.time.cancel,
    getZoomFactor() { return 1; }, gameFillColor() { return '#101011'; }, gameRingColor() { return 'rgba(255,255,255,0.16)'; },
    isGameUrl() { return true; }, debugLog() {}, sendToRenderer() {},
    store: { save() { saves++; } },
    stopAnonymousUsageForWindow() {}, resolveTelemetryConsentWaiters() {},
    ipcMain: { handle(name, callback) { handlers.set(name, callback); } },
  });
  vm.runInContext([
    section(main, 'function updateLayout(', 'function attachNavigationHandlers('),
    section(main, 'function applyGamePresentation(', 'function injectGameFocus('),
    section(main, 'function resetGameContent(', 'function markGameContentReady('),
    section(main, "ipcMain.handle('sidebar:transition-start'", "ipcMain.handle('scroll:set-level'"),
    section(main, "ipcMain.handle('sidebar:toggle'", "ipcMain.handle('cache:clear-cookies'"),
    section(main, "  mainWindow.on('closed'", '\n\n  createGameView();'),
  ].join('\n'), context);
  return { context, handlers, bounds, scripts, setSize(w, h) { size = [w, h]; }, get saves() { return saves; } };
}

function keyboard() {
  let saves = 0;
  const context = vm.createContext({
    ZOOM_STEP: 0.1, ZOOM_MIN: 0.7, ZOOM_MAX: 2.5,
    currentConfig: { view: { zoomFactor: 1 } }, store: { save() { saves++; } }, applyGamePresentation() {},
  });
  vm.runInContext([
    section(main, 'function normalizeZoomFactor(', 'function normalizeScrollLevel('),
    section(main, 'function getZoomFactor(', 'function setLanguage('),
    section(main, 'function handleBeforeInputEvent(', 'function forwardNativeEditShortcut('),
  ].join('\n'), context);
  return { context, get saves() { return saves; } };
}

test('handles zoom shortcuts once per press and keeps keyDown repeats', () => {
  for (const [key, expected] of [['+', 1.1], ['-', 0.9], ['0', 1]]) {
    const h = keyboard();
    for (const type of ['keyDown', 'keyUp']) h.context.handleBeforeInputEvent({ preventDefault() {} }, { type, meta: true, key });
    assert.equal(h.context.getZoomFactor(), expected);
    assert.equal(h.saves, 1);
  }
  const h = keyboard();
  for (let i = 0; i < 3; i++) h.context.handleBeforeInputEvent({ preventDefault() {} }, { type: 'keyDown', meta: true, key: '+', isAutoRepeat: i > 0 });
  assert.equal(h.context.getZoomFactor(), 1.3);
  h.context.handleBeforeInputEvent({ preventDefault() { assert.fail(); } }, { type: 'keyDown', key: '+' });
  assert.equal(h.saves, 3);
});

test('fits representative viewport sizes without changing the zoom or aspect-ratio rules', () => {
  for (const [width, height] of [[900, 620], [1320, 760], [1920, 1080]]) {
    for (const sidebar of [360, 44]) {
      const h = game(width - sidebar, height - 100);
      const result = h.api.apply();
      assert.ok(result.rect.width <= width - sidebar + 1e-8 && result.rect.height <= height - 100 + 1e-8);
      assert.equal(result.rect.width / result.rect.height, 1.5);
      assert.ok(Math.abs(result.rect.left + result.rect.width / 2 - (width - sidebar) / 2) < 1);
      assert.ok(Math.abs(result.rect.top + result.rect.height / 2 - (height - 100) / 2) < 1);
    }
  }
  const h = game(540, 520);
  const enlarged = h.api.configure({ contentReady: true, userScale: 2.5 });
  assert.equal(enlarged.rect.width, 1350);
  assert.equal(enlarged.rect.height, 900);
  assert.equal(enlarged.rect.top, 0);
});

test('centers the screenshot viewport and keeps undersized game content centered on both axes', () => {
  const h = game(612, 520);
  assert.equal(h.api.apply().rect.top, 56);
  assert.equal(h.frame.style.getPropertyValue('top'), '56px');
  const smaller = h.api.configure({ contentReady: true, userScale: 0.7 });
  assert.ok(Math.abs(smaller.rect.left + smaller.rect.width / 2 - 306) < 1);
  assert.ok(Math.abs(smaller.rect.top + smaller.rect.height / 2 - 260) < 1);
});

test('fits measured canvas dimensions and removes client drawing around the game', () => {
  const h = game(800, 600, { gameSize: { width: 1280, height: 720 } });
  const result = h.api.apply();
  assert.equal(result.scale, 0.625);
  assert.equal(result.rect.width, 800);
  assert.equal(result.rect.height, 450);
  assert.equal(result.rect.top, 75);
  assert.equal(h.frame.style.getPropertyValue('width'), '1280px');
  assert.equal(h.frame.style.getPropertyValue('height'), '720px');
  assert.equal(h.frame.style.getPropertyValue('outline'), 'none');
  assert.equal(h.frame.style.getPropertyValue('box-shadow'), 'none');
  h.api.configure({ contentReady: true, gameSize: { width: 0, height: 1 } });
  assert.equal(h.api.apply().rect.height, 450);
  h.api.configure({ contentReady: true, gameSize: null });
  assert.equal(h.frame.style.getPropertyValue('width'), '960px');
  assert.equal(h.frame.style.getPropertyValue('height'), '640px');
});

test('passes cached canvas dimensions to presentation without reading child frames during resize', () => {
  const h = game(), n = native(h, { gameSize: { width: 1280, height: 720 } });
  n.context.mainWindow.webContents.mainFrame = { get framesInSubtree() { assert.fail('resize must not query frame geometry'); } };
  n.setSize(1160, 700); n.context.updateLayout(false); h.time.advance(20);
  assert.equal(h.frame.style.getPropertyValue('width'), '1280px');
  assert.equal(h.scale, 0.625);
  assert.equal(h.frame.style.getPropertyValue('top'), '75px');
  n.context.mainWindow.close();
  assert.equal(n.context.gameContentSize, null);
  assert.equal(n.context.gameContentEpoch, 1);
});

test('updates vertical centering together with sidebar and zoom animations', async () => {
  const h = game(540, 520);
  assert.equal(h.frame.style.getPropertyValue('top'), '80px');
  h.api.prepareViewportTransition(); h.resize(856, 520);
  const sidebar = h.api.beginViewportTransition({ width: 856, height: 520, duration: 200 });
  assert.match(h.frame.style.getPropertyValue('transition'), /top 200ms/);
  h.time.advance(32);
  assert.equal(h.frame.style.getPropertyValue('top'), '0px');
  h.time.advance(300); await sidebar; h.api.endViewportTransition();
  const zoom = h.api.configure({ contentReady: true, userScale: 0.7, animateScale: true, duration: 180 });
  assert.match(h.frame.style.getPropertyValue('transition'), /top 180ms/);
  h.time.advance(16);
  assert.equal(h.frame.style.getPropertyValue('top'), '78px');
  h.time.advance(300); await zoom;
  assert.equal(h.frame.style.getPropertyValue('top'), '78px');
});

test('updates game scaling each frame during continuous native window resizing without per-frame IPC', (t) => {
  const h = game(), n = native(h);
  const before = h.layouts;
  for (let i = 1; i <= 12; i++) {
    n.setSize(1320 - i * 20, 760); n.context.updateLayout(); h.time.advance(16);
    assert.equal(h.scale, (960 - i * 20) / 960);
  }
  assert.equal(n.scripts.length, 0);
  assert.equal(h.layouts - before, 12);
  assert.equal(n.bounds.at(-1).width, 720);
  t.diagnostic(`12 resize frames: ${h.layouts - before} scale updates, ${n.scripts.length} presentation IPC calls`);
});

test('updates native bounds while the event loop is not advancing and merges presentation work', () => {
  const h = game(), n = native(h);
  n.context.setImmediate = () => assert.fail('native bounds must not wait for the Node event loop');
  for (let i = 1; i <= 20; i++) {
    n.setSize(1320 - i * 10, 760);
    n.context.updateLayout();
    assert.equal(n.bounds.at(-1).width, 960 - i * 10);
  }
  assert.equal(n.bounds.length, 20);
  assert.equal(n.scripts.length, 0);
  h.time.advance(89);
  assert.equal(n.scripts.length, 0);
  h.time.advance(1);
  assert.equal(n.scripts.length, 1);
  assert.equal(h.scale, 760 / 960);
});

test('coalesces resize bursts into one layout update using the latest viewport', () => {
  const h = game();
  const before = h.layouts;
  for (let i = 1; i <= 20; i++) h.resize(960 - i * 10, 660);
  assert.equal(h.time.pending, 1);
  h.time.advance(16);
  assert.equal(h.layouts - before, 1);
  assert.equal(h.scale, 760 / 960);
});

test('keeps ordinary sidebar animations and persists the target only when the toggle completes', async () => {
  const h = game(), n = native(h);
  const pending = n.handlers.get('sidebar:transition-start')({ sender: { id: 1 } }, 'collapse');
  await new Promise(setImmediate);
  assert.equal(n.context.sidebarCollapsed, true);
  assert.equal(n.context.currentConfig.view.sidebarCollapsed, false);
  assert.equal(n.saves, 0);
  assert.equal(n.bounds.at(-1).width, 1276);
  h.time.advance(300); await pending;
  await n.handlers.get('sidebar:toggle')({}, 'collapse');
  assert.equal(n.context.currentConfig.view.sidebarCollapsed, true);
  assert.equal(n.saves, 1);
  assert.equal(h.scale, 660 / 640);
});

test('uses the current sidebar target and cancels old animation values when the window changes', async () => {
  for (const [collapsed, action, expected] of [[false, 'collapse', 1356], [true, 'expand', 1040]]) {
    const h = game(collapsed ? 1276 : 960, 660), n = native(h, { collapsed });
    const pending = n.handlers.get('sidebar:transition-start')({ sender: { id: 1 } }, action);
    await new Promise(setImmediate);
    n.setSize(1400, 800); n.context.updateLayout(false);
    assert.equal(n.bounds.at(-1).width, expected);
    assert.equal(n.context.sidebarTransitionActive, false);
    await pending;
    assert.equal(h.scale, Math.min(expected / 960, 700 / 640));
    h.time.advance(320);
    assert.equal(h.scale, Math.min(expected / 960, 700 / 640));
    await n.handlers.get('sidebar:toggle')({}, action);
    assert.equal(n.bounds.at(-1).width, expected);
  }
});

test('does not begin an outdated animation when the window resizes while preparation is pending', async () => {
  let resume;
  const prepareGate = new Promise(resolve => { resume = resolve; });
  const h = game(), n = native(h, { prepareGate });
  const pending = n.handlers.get('sidebar:transition-start')({ sender: { id: 1 } }, 'collapse');
  n.setSize(1400, 800); n.context.updateLayout(false); resume();
  assert.equal(await pending, true);
  assert.equal(n.bounds.at(-1).width, 1356);
  assert.equal(n.scripts.some(code => code.includes('.beginViewportTransition(')), false);
  assert.equal(h.scale, 700 / 640);
});

test('recomputes animation dimensions after asynchronous preparation', async () => {
  let resume;
  const prepareGate = new Promise(resolve => { resume = resolve; });
  const h = game(), n = native(h, { prepareGate });
  const pending = n.handlers.get('sidebar:transition-start')({ sender: { id: 1 } }, 'collapse');
  n.setSize(1400, 800); resume();
  await new Promise(setImmediate);
  assert.equal(n.bounds.at(-1).width, 1356);
  h.time.advance(32);
  assert.equal(h.scale, 700 / 640);
  h.time.advance(300); await pending;
});

test('discards a pending sidebar operation when its window closes and restores the saved layout state', async () => {
  let resume;
  const prepareGate = new Promise(resolve => { resume = resolve; });
  const h = game(), n = native(h, { prepareGate });
  const pending = n.handlers.get('sidebar:transition-start')({ sender: { id: 1 } }, 'collapse');
  n.context.mainWindow.close(); resume();
  assert.equal(await pending, false);
  assert.equal(n.context.sidebarTransitionActive, false);
  assert.equal(n.context.sidebarCollapsed, false);
  assert.equal(n.saves, 0);
});

test('lets a new zoom value interrupt a sidebar animation without being overwritten by queued frames', async () => {
  const h = game();
  h.api.prepareViewportTransition(); h.resize(1276, 660);
  const pending = h.api.beginViewportTransition({ width: 1276, height: 660, duration: 200 });
  h.api.configure({ contentReady: true, userScale: 1.1, animateScale: true, duration: 180 });
  assert.equal((await pending).cancelled, true);
  h.time.advance(320);
  assert.equal(h.scale, 660 / 640 * 1.1);
});

test('cancels a zoom animation when resizing and applies the current scale on the next frame', async () => {
  const h = game();
  const pending = h.api.configure({ contentReady: true, userScale: 1.1, animateScale: true, duration: 180 });
  h.resize(720, 660);
  assert.equal((await pending).cancelled, true);
  h.time.advance(16);
  assert.equal(h.scale, 0.75 * 1.1);
  assert.equal(h.frame.listenerCount, 0);
});

test('preserves reduced motion, loading and missing-frame behavior', async () => {
  const h = game(960, 660, { reducedMotion: true });
  h.api.prepareViewportTransition(); h.resize(1276, 660);
  const outcome = await h.api.beginViewportTransition({ width: 1276, height: 660, duration: 200 });
  assert.equal(outcome.animated, false); h.api.endViewportTransition();
  h.showFrame(false); assert.equal(h.api.apply().reason, 'element-not-found');
  h.showFrame(true); assert.equal(h.api.configure({ contentReady: false }).reason, 'game-content-loading');
});

test('cancels a scheduled resize when restoring original page styles', () => {
  const h = game();
  h.resize(720, 660); h.api.restore();
  const layouts = h.layouts;
  h.time.advance(100);
  assert.equal(h.layouts, layouts);
  assert.equal(h.time.pending, 0);
});
