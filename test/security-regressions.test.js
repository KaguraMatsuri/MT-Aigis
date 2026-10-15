const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const navigation = require('../lib/navigation');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
function section(start, end) {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return main.slice(first, last);
}

function browserHarness() {
  const handlers = new Map(), opened = [], loaded = [], events = [];
  let popup;
  const context = vm.createContext({
    URL, ...navigation, currentConfig: { view: { customUrl: '' } },
    ALLOWED_HOST_PARTS: ['dmm.com', 'dmm.co.jp'], GAME_URL: navigation.DEFAULT_URL,
    gameViewLoadingMasked: true,
    gameView: { webContents: {
      on(name, callback) { handlers.set(name, callback); },
      setWindowOpenHandler(callback) { popup = callback; },
      async loadURL(url) { loaded.push(url); },
    } },
    shell: { async openExternal(url) { opened.push(url); } },
    setImmediate(callback) { callback(); }, debugLog() {},
    syncGameViewVisibility() { events.push('visibility'); },
    sendToRenderer(channel, message) { events.push([channel, message]); },
  });
  vm.runInContext(
    section('function isGameContentFrame(', 'function createWindow(') +
    section('function isGameContainerFrame(', 'function focusGameContainer(') +
    section('function attachNavigationHandlers(', 'function isLoginUrl('), context,
  );
  context.attachNavigationHandlers();
  return { context, handlers, opened, loaded, events, popup: url => popup({ url }) };
}

test('allows web and email external links while blocking local files and application protocols', () => {
  const h = browserHarness();
  for (const url of ['https://example.test/', 'http://example.test/', 'mailto:fixture@example.test']) {
    h.popup(url);
    h.handlers.get('will-navigate')({ preventDefault() {} }, url);
  }
  assert.equal(h.opened.length, 6);
  for (const url of ['file:///tmp/fixture', 'mtaigis-audit-probe://synthetic', 'mtaigis-audit-probe://accounts.dmm.com/synthetic', 'file://accounts.dmm.com/tmp/fixture', 'javascript:alert(1)', 'data:text/plain,fixture', 'invalid']) {
    h.popup(url);
    h.handlers.get('will-navigate')({ preventDefault() {} }, url);
  }
  assert.equal(h.opened.length, 6);
  assert.equal(h.loaded.length, 0);
  h.popup('https://accounts.dmm.com/service/login');
  assert.equal(h.loaded.at(-1), 'https://accounts.dmm.com/service/login');
});

test('reports playable and container frame failures without treating blocked auxiliary frames as game failures', () => {
  const h = browserHarness(), fail = h.handlers.get('did-fail-load');
  for (const url of ['https://drc1bk94f7rq8.cloudfront.net/00/html/aigis.html', 'https://osapi.dmm.com/gadgets/ifr']) {
    h.context.gameViewLoadingMasked = true;
    fail({}, -105, 'ERR_NAME_NOT_RESOLVED', url, false);
    assert.equal(h.context.gameViewLoadingMasked, false);
    assert.equal(h.events.at(-1)[0], 'browser:error');
  }
  const count = h.events.length;
  for (const [code, url] of [
    [-20, 'https://drc1bk94f7rq8.cloudfront.net/00/html/main.html'],
    [-105, 'https://example.test/frame'],
    [-3, 'https://drc1bk94f7rq8.cloudfront.net/00/html/aigis.html'],
  ]) {
    fail({}, code, 'fixture error', url, false);
  }
  assert.equal(h.events.length, count);
  fail({}, -105, 'ERR_NAME_NOT_RESOLVED', navigation.DEFAULT_URL, true);
  assert.equal(h.events.length, count + 2);
});

function clipboardHarness() {
  const timers = new Map(), handlers = new Map(), logs = [];
  let text = '', nextTimer = 0;
  const context = vm.createContext({
    clipboardClearTimer: null,
    clipboard: { writeText(value) { text = value; }, readText() { return text; } },
    vault: { load: () => ({ email: 'fixture@example.test', password: 'fixture-password', twofa: '' }) },
    currentTotp: () => '123456', debugLog(...args) { logs.push(args); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ipcMain: { handle(channel, callback) { handlers.set(channel, callback); } },
  });
  vm.runInContext(
    section('function writeClipboardText(', "ipcMain.handle('config:get'") +
    section("ipcMain.handle('vault:copy'", 'function assertTrustedAutofillFrame(') +
    section("ipcMain.handle('clipboard:write'", "ipcMain.handle('sidebar:toggle'"), context,
  );
  return {
    context, timers, handlers, logs,
    get text() { return text; }, set text(value) { text = value; },
    expire() { const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); },
  };
}

test('clears only the password it copied and preserves later clipboard content', () => {
  const h = clipboardHarness(), copy = field => h.handlers.get('vault:copy')({}, field);
  assert.equal(copy('password'), true);
  assert.equal(h.text, 'fixture-password');
  assert.equal([...h.timers.values()][0].delay, 60000);
  h.expire(); assert.equal(h.text, '');
  copy('password'); h.text = 'copied by another app'; h.expire();
  assert.equal(h.text, 'copied by another app');
  for (const [channel, value] of [['vault:copy', 'email'], ['copy:text', 'other text'], ['clipboard:write', 'new value']]) {
    copy('password'); h.handlers.get(channel)({}, value);
    assert.equal(h.timers.size, 0);
    assert.notEqual(h.text, '');
  }
  copy('password'); copy('password'); assert.equal(h.timers.size, 1);
  h.expire(); assert.equal(h.text, '');
});

test('clipboard cleanup failures neither escape the timer nor log the copied password', () => {
  const h = clipboardHarness();
  h.handlers.get('vault:copy')({}, 'password');
  h.context.clipboard.readText = () => { throw new Error('fixture-password'); };
  assert.doesNotThrow(() => h.expire());
  assert.equal(JSON.stringify(h.logs).includes('fixture-password'), false);
});

test('production and developer entry points do not disable the Chromium sandbox globally', () => {
  for (const file of ['main.js', 'start.sh', 'start.command']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /no-sandbox|ELECTRON_NO_SANDBOX/);
  }
  const gamePreferences = section('function createGameView(', "focusSource = loadResource(");
  assert.match(gamePreferences, /sandbox: true/);
  assert.match(gamePreferences, /contextIsolation: true/);
  assert.match(gamePreferences, /nodeIntegration: false/);
});
