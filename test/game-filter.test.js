const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const containerSource = fs.readFileSync(path.join(root, 'resources/game-container-focus.js'), 'utf8');
const scrollSource = fs.readFileSync(path.join(root, 'resources/game-scroll.js'), 'utf8');

function section(start, end) {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return main.slice(first, last);
}

function container() {
  function node(id) {
    const attributes = new Map(), styles = new Map();
    return {
      id, children: [], parentElement: null,
      style: {
        setProperty(key, value) { styles.set(key, value); },
        getPropertyValue(key) { return styles.get(key) || ''; },
      },
      hasAttribute(key) { return attributes.has(key); },
      getAttribute(key) { return attributes.get(key) || ''; },
      setAttribute(key, value) { attributes.set(key, value); },
    };
  }
  const html = node('html'), body = node('body'), wrapper = node('wrapper');
  const header = node('header'), footer = node('footer'), frame = node('aigis');
  const canvas = node('canvas'), dialog = node('aigis-input-dialog-div'), audio = node('audio'), communication = node('main_frame');
  frame.src = 'https://drc1bk94f7rq8.cloudfront.net/00/html/aigis_all.html';
  Object.defineProperty(frame, 'contentDocument', { get() { assert.fail('filtering the parent must not rewrite the game document'); } });
  body.parentElement = html; html.children = [body];
  wrapper.parentElement = body; footer.parentElement = body; body.children = [wrapper, footer];
  header.parentElement = wrapper; frame.parentElement = wrapper; wrapper.children = [header, frame];
  const context = vm.createContext({
    window: {}, location: { href: 'https://osapi.dmm.com/gadgets/ifr' }, URL,
    document: { documentElement: html, body, querySelectorAll() { return [frame]; }, addEventListener() {} },
    MutationObserver: class { observe() {} }, requestAnimationFrame() {},
  });
  return { context, html, body, wrapper, header, footer, frame, gameNodes: [canvas, dialog, audio, communication] };
}

function native() {
  const presentations = [], containerUpdates = [], visibility = [];
  const view = { webContents: { isDestroyed() { return false; } }, setVisible(value) { visibility.push(value); } };
  const context = vm.createContext({
    URL, gameView: view, gameContentReady: false, gameContentSize: null, gameContentEpoch: 0,
    gameViewLoadingMasked: true, gameViewFallbackHidden: false,
    currentConfig: { telemetry: { consent: false } },
    containerFocusSource: containerSource, scrollSource: 'fixture-scroll-source',
    getScrollLevel() { return 5; }, debugLog() {}, startAnonymousUsage() { assert.fail(); },
    applyGamePresentation() { presentations.push(context.gameContentSize); return Promise.resolve(); },
    focusAllGameContainers() { containerUpdates.push(context.gameContentSize); return Promise.resolve(); },
  });
  vm.runInContext([
    section('function isGameContentFrame(', 'function createWindow('),
    section('function resetGameContent(', 'function focusAllGameContainers('),
  ].join('\n'), context);
  function frame(size, options = {}) {
    const calls = [];
    return {
      url: options.url || 'https://drc1bk94f7rq8.cloudfront.net/00/html/aigis_all.html', calls,
      async executeJavaScript(code) {
        calls.push(code);
        if (code === 'fixture-scroll-source') return { fresh: true };
        if (code.includes('.setLevel(')) {
          if (options.gate) await options.gate;
          return { gameSize: size };
        }
        return options.container ? vm.runInContext(code, options.container.context) : null;
      },
    };
  }
  return { context, frame, presentations, containerUpdates, visibility };
}

test('filters only DOM outside the game iframe and configures its viewport using measured dimensions', async () => {
  const c = container(), n = native();
  n.context.gameContentSize = { width: 1280, height: 720 };
  const f = n.frame(null, { url: 'https://osapi.dmm.com/gadgets/ifr', container: c });
  const result = await n.context.focusGameContainer(f);
  assert.equal(result.focused, true);
  assert.equal(result.fresh, true);
  assert.equal(f.calls.length, 1);
  assert.equal(c.frame.style.getPropertyValue('width'), '1280px');
  assert.equal(c.frame.style.getPropertyValue('height'), '720px');
  assert.equal(c.body.style.getPropertyValue('width'), '1280px');
  assert.equal(c.header.style.getPropertyValue('display'), 'none');
  assert.equal(c.footer.style.getPropertyValue('display'), 'none');
  assert.deepEqual(c.wrapper.children, [c.header, c.frame]);
  for (const node of c.gameNodes) assert.equal(node.style.getPropertyValue('display'), '');
  n.context.resetGameContent();
  await n.context.focusGameContainer(f);
  assert.equal(c.frame.style.getPropertyValue('width'), '960px');
  assert.equal(c.frame.style.getPropertyValue('height'), '640px');
});

test('caches geometry from the playable frame and only refreshes presentation when its measured size changes', async () => {
  const n = native(), f = n.frame({ width: 1280, height: 720 });
  await n.context.installGameFrameAdapter(f);
  assert.deepEqual(JSON.parse(JSON.stringify(n.context.gameContentSize)), { width: 1280, height: 720 });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1], /await adapter\.whenReady\(\)/);
  assert.equal(n.presentations.length, 0);
  n.context.markGameContentReady(); await new Promise(setImmediate);
  assert.equal(n.presentations.length, 1);
  assert.equal(n.containerUpdates.length, 1);
  assert.equal(n.visibility.at(-1), true);
  await n.context.installGameFrameAdapter(f);
  assert.equal(n.presentations.length, 1);
  await n.context.installGameFrameAdapter(n.frame({ width: 1024, height: 768 }));
  assert.equal(n.presentations.length, 2);
  assert.equal(n.containerUpdates.length, 2);
});

test('waits inside the existing frame call before caching the initialized game size, and rejects abort geometry', async () => {
  for (const abort of [false, true]) {
    const n = native(), style = { setProperty() {}, getPropertyValue() { return ''; } };
    let width = 300, height = 150;
    const canvas = { tagName: 'CANVAS', isConnected: true, style, getBoundingClientRect() { return { width, height }; } };
    const listeners = new Map();
    const context = vm.createContext({
      Module: { canvas, postRun: [] },
      window: { scrollTo() {}, addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener() {} },
      document: { documentElement: { style }, body: { style }, getElementById(id) { return id === 'canvas' ? canvas : null; }, addEventListener() {} },
      location: new URL('https://drc1bk94f7rq8.cloudfront.net/00/html/aigis_all.html'),
    });
    const calls = [];
    const frame = {
      url: context.location.href,
      async executeJavaScript(code) { calls.push(code); return vm.runInContext(code, context); },
    };
    n.context.scrollSource = scrollSource;
    const pending = n.context.installGameFrameAdapter(frame);
    await new Promise(setImmediate);
    assert.equal(n.context.gameContentSize, null);
    assert.equal(calls.length, 2);
    if (abort) context.Module.onAbort();
    else {
      width = 960; height = 640;
      context.Module.calledRun = true;
      for (const callback of context.Module.postRun.splice(0).reverse()) callback();
    }
    await pending;
    const size = JSON.parse(JSON.stringify(n.context.gameContentSize));
    assert.deepEqual(size, abort ? null : { width: 960, height: 640 });
    assert.equal(calls.length, 2);
  }
});

test('ignores unrelated or invalid canvas measurements and leaves login frames untouched', async () => {
  const n = native();
  const login = n.frame({ width: 300, height: 150 }, { url: 'https://accounts.dmm.com/login' });
  assert.equal(await n.context.installGameFrameAdapter(login), null);
  assert.equal(login.calls.length, 0);
  for (const size of [null, { width: 0, height: 640 }, { width: 960, height: Infinity }, { width: '960', height: 640 }]) {
    await n.context.installGameFrameAdapter(n.frame(size));
    assert.equal(n.context.gameContentSize, null);
  }
  await n.context.installGameFrameAdapter(n.frame({ width: 300, height: 150 }, { url: 'https://osapi.dmm.com/gadgets/ifr' }));
  assert.equal(n.context.gameContentSize, null);
});

test('discards measurements belonging to an old navigation or a replaced game view', async () => {
  for (const replaceView of [false, true]) {
    const n = native(); let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    const pending = n.context.installGameFrameAdapter(n.frame({ width: 1280, height: 720 }, { gate }));
    await new Promise(setImmediate);
    if (replaceView) n.context.gameView = {};
    else n.context.resetGameContent();
    resume(); await pending;
    assert.equal(n.context.gameContentSize, null);
    assert.equal(n.presentations.length, 0);
  }
});

test('does not unmask a new page when an old presentation finishes late', async () => {
  const n = native(); let resume;
  n.context.applyGamePresentation = () => new Promise(resolve => { resume = resolve; });
  n.context.markGameContentReady();
  n.context.resetGameContent();
  n.context.gameContentReady = true;
  resume(); await new Promise(setImmediate);
  assert.equal(n.context.gameViewLoadingMasked, true);
  assert.equal(n.visibility.length, 0);
});
