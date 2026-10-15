const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise(setImmediate);

function cookieHarness() {
  let saves = 0, schedules = 0;
  const cookies = new EventEmitter();
  cookies.get = async () => [{ name: 'session', value: 'synthetic', domain: '.dmm.com' }];
  const context = vm.createContext({
    authCookieSession: null, currentConfig: { session: { cookies: [] } },
    gameView: { webContents: { isDestroyed: () => false, session: { cookies } } },
    store: { save() { saves++; } }, debugLog() {}, scheduleSessionFlush() { schedules++; },
  });
  vm.runInContext(section(main, 'function onAuthCookieChanged(', 'function scheduleSessionFlush(') +
    section(main, 'function isDmmCookie(', 'async function restoreAuthCookies('), context);
  return { context, cookies, get saves() { return saves; }, get schedules() { return schedules; } };
}

test('registers one cookie listener across window recreation and filters unrelated changes', () => {
  const h = cookieHarness(), session = h.context.gameView.webContents.session;
  for (let i = 0; i < 20; i++) h.context.observeAuthCookies(session);
  assert.equal(h.cookies.listenerCount('changed'), 1);
  h.cookies.emit('changed', {}, { domain: '.example.test' });
  assert.equal(h.schedules, 0);
  h.cookies.emit('changed', {}, { domain: '.accounts.dmm.com' }, 'explicit', true);
  assert.equal(h.schedules, 1);
  const replacement = { cookies: new EventEmitter() };
  h.context.observeAuthCookies(replacement);
  assert.equal(h.cookies.listenerCount('changed'), 0);
  assert.equal(replacement.cookies.listenerCount('changed'), 1);
});

test('writes changed cookies once, ignores ordering and saves removal', async () => {
  const h = cookieHarness();
  const values = [
    { name: 'one', value: 'synthetic', domain: '.dmm.com' },
    { name: 'two', value: 'synthetic', domain: '.dmm.co.jp' },
  ];
  h.cookies.get = async () => values;
  for (let i = 0; i < 60; i++) {
    values.reverse();
    await h.context.persistAuthCookies();
  }
  assert.equal(h.saves, 1);
  values[0].value = 'changed';
  await h.context.persistAuthCookies(); assert.equal(h.saves, 2);
  h.cookies.get = async () => [];
  await h.context.persistAuthCookies(); assert.equal(h.saves, 3);
});

test('retries cookie persistence after a failed write and discards a closed-view query', async () => {
  const h = cookieHarness(), save = h.context.store.save;
  h.context.store.save = () => { throw new Error('fixture EACCES'); };
  await assert.rejects(h.context.persistAuthCookies(), /EACCES/);
  assert.equal(h.context.currentConfig.session.cookies.length, 0);
  h.context.store.save = save;
  await h.context.persistAuthCookies(); assert.equal(h.saves, 1);
  const gate = deferred(); h.cookies.get = () => gate.promise;
  const pending = h.context.persistAuthCookies();
  h.context.gameView = null;
  gate.resolve([]); await pending;
  assert.equal(h.saves, 1);
});

function networkHarness(fetch) {
  const timers = new Set();
  const context = vm.createContext({
    NETWORK_TARGETS: { a: { label: 'a', url: 'https://fixture.invalid/a' }, b: { label: 'b', url: 'https://fixture.invalid/b' } },
    networkProbeTasks: new Map(), networkStatusTask: null, CHROME_UA: 'fixture',
    fetchThroughGameSession: fetch, AbortController, AbortSignal, Date,
    setTimeout(callback) { timers.add(callback); return callback; }, clearTimeout(timer) { timers.delete(timer); },
  });
  vm.runInContext(section(main, 'function pingTarget(', 'function getPublicClickerState('), context);
  return { context, timers };
}

test('shares pending probes, cancels unused bodies and permits a new probe after completion', async () => {
  const gate = deferred(), signals = []; let calls = 0, cancelled = 0;
  const h = networkHarness(async (_url, options) => {
    calls++; signals.push(options.signal); await gate.promise;
    return { status: 200, body: { async cancel() { cancelled++; } } };
  });
  const pending = Array.from({ length: 20 }, () => h.context.pingTarget('a'));
  assert.equal(calls, 1); assert.ok(pending.every(p => p === pending[0]));
  const other = h.context.pingTarget('b'); assert.equal(calls, 2);
  gate.resolve();
  assert.ok((await Promise.all([...pending, other])).every(result => result.ok));
  assert.equal(cancelled, 2); assert.ok(signals.every(signal => signal.aborted));
  assert.equal(h.context.networkProbeTasks.size, 0); assert.equal(h.timers.size, 0);
  await h.context.pingTarget('a'); assert.equal(calls, 3);
});

test('releases failed probes and keeps a successful result if body cancellation fails', async () => {
  let failing = true;
  const h = networkHarness(async () => {
    if (failing) throw new Error('fixture connection failure');
    return { status: 206, body: { async cancel() { throw new Error('fixture cleanup failure'); } } };
  });
  assert.equal((await h.context.pingTarget('a')).ok, false);
  assert.equal(h.context.networkProbeTasks.size, 0);
  failing = false;
  assert.equal((await h.context.pingTarget('a')).ok, true);
  assert.equal(h.timers.size, 0);
});

test('shares the IP and region lookup triggered by repeated connection-test clicks', async () => {
  const gate = deferred(); let calls = 0;
  const h = networkHarness(async url => {
    calls++; await gate.promise;
    return { json: async () => url.includes('ipify') ? { ip: '192.0.2.1' } : { success: true, country_code: 'JP' } };
  });
  const pending = Array.from({ length: 10 }, () => h.context.getNetworkStatus());
  assert.equal(calls, 1);
  gate.resolve(); await Promise.all(pending);
  assert.equal(calls, 2); assert.equal(h.context.networkStatusTask, null);
});

function uiHarness() {
  const nodes = new Map(), calls = [];
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set(id === 'page-game' ? ['active'] : []);
      let text = '';
      nodes.set(id, {
        id, writes: 0, disabled: false,
        get textContent() { return text; }, set textContent(value) { text = value; this.writes++; },
        classList: { contains: k => classes.has(k), remove: k => classes.delete(k),
          toggle(k, value) { if (value) classes.add(k); else classes.delete(k); } },
        setAttribute() {},
      });
    }
    return nodes.get(id);
  }
  const document = { visibilityState: 'visible', body: node('body'),
    querySelectorAll(selector) { return selector === '.page' ? ['game', 'vault', 'settings'].map(p => node('page-' + p)) : []; } };
  const context = vm.createContext({
    document, byId: node, sidebarScrolling: false, pingTasks: {}, networkStatusTask: null,
    pingFields: { a: node('ping-a'), b: node('ping-b'), c: node('ping-c'), d: node('ping-d') },
    t: key => key, errorText: error => error.message, formatBytes: String,
    applyCustomUrlState() {}, updateScrollControl() {}, refreshVault() {}, setRuntime() {},
    api: { invoke(channel) { calls.push(channel); return Promise.resolve({ title: 'fixture', diskBytes: 123, audioMuted: true }); } },
  });
  vm.runInContext([
    section(sidebar, '  function showPage(', '  function waitForSidebarTransition('),
    section(sidebar, '  function syncMuteState(', '  function applyCustomUrlState('),
    section(sidebar, '  function refreshBrowserState(', '  function renderGameNews('),
    section(sidebar, '  function runPing(', '  function updateScrollControl('),
    section(sidebar, '  function renderCache(', '  function renderClicker('),
  ].join('\n'), context);
  return { context, node, document, calls };
}

test('suppresses hidden cache queries and DOM writes while keeping titlebar and mute state current', async () => {
  const h = uiHarness(); h.context.applySidebarState(true, false);
  for (let i = 0; i < 240; i++) await h.context.refreshCache(false, true);
  for (let i = 0; i < 30; i++) await h.context.refreshBrowserState(true);
  assert.equal(h.calls.filter(c => c === 'cache:stats').length, 0);
  assert.equal(h.node('page-title').writes, 0); assert.equal(h.node('zoom-value').writes, 0);
  assert.equal(h.node('top-status').textContent, 'gameSession'); assert.equal(h.node('top-status').writes, 1);
  assert.equal(h.node('mute-label').textContent, 'muted'); assert.equal(h.node('mute-label').writes, 1);
  h.context.applySidebarState(false, false); await turn();
  assert.equal(h.calls.filter(c => c === 'cache:stats').length, 1);
  assert.equal(h.node('cache-disk').textContent, '123'); assert.equal(h.node('page-title').textContent, 'fixture');
});

test('refreshes cache when returning to the game tab and suppresses a result after hiding', async () => {
  const h = uiHarness(); h.context.showPage('settings');
  await h.context.refreshCache(false); assert.equal(h.calls.length, 0);
  h.context.showPage('game'); await turn(); assert.ok(h.calls.includes('cache:stats'));
  const writes = h.node('cache-disk').writes, gate = deferred();
  h.context.api.invoke = () => gate.promise;
  const pending = h.context.refreshCache(true);
  h.document.visibilityState = 'hidden'; gate.resolve({ diskBytes: 999 }); await pending;
  assert.equal(h.node('cache-disk').writes, writes);
});

test('refreshes visible controls and cache when the document becomes visible again', async () => {
  const h = uiHarness(); let onVisibility;
  h.document.addEventListener = (_event, callback) => { onVisibility = callback; };
  vm.runInContext(section(sidebar, "  document.addEventListener('visibilitychange'",
    '  setTimeout(function () { Object.keys(pingFields)'), h.context);
  h.document.visibilityState = 'hidden'; onVisibility();
  assert.equal(h.calls.length, 0);
  h.document.visibilityState = 'visible'; onVisibility(); await turn();
  assert.deepEqual(h.calls, ['browser:state', 'cache:stats']);
});

test('coalesces repeated UI probe clicks before IPC and allows retries after rejection', async () => {
  const h = uiHarness(), gate = deferred();
  h.context.api.invoke = channel => { h.calls.push(channel); return gate.promise; };
  const pending = [];
  for (let i = 0; i < 10; i++) {
    for (const target of ['a', 'b', 'c', 'd']) pending.push(h.context.runPing(target));
    pending.push(h.context.refreshNetworkStatus(false));
  }
  assert.equal(h.calls.filter(c => c === 'network:ping').length, 4);
  assert.equal(h.calls.filter(c => c === 'network:status').length, 1);
  gate.reject(new Error('fixture network failure')); await Promise.all(pending);
  assert.equal(Object.keys(h.context.pingTasks).length, 0); assert.equal(h.context.networkStatusTask, null);
  await h.context.runPing('a'); assert.equal(h.calls.filter(c => c === 'network:ping').length, 5);
});

function logHarness(options = {}) {
  const files = new Map(), counts = { stat: 0, append: 0, rename: 0 };
  const timers = new Map(), consoleLines = [];
  if (options.initial) files.set('/virtual/debug.log', options.initial);
  const context = vm.createContext({
    DEBUG_LOG: '/virtual/debug.log', debugLogTask: Promise.resolve(), debugLogSize: null,
    Buffer, Date, URL, console: { log(...parts) { consoleLines.push(parts.join(' ')); } },
    setTimeout(callback, delay) { timers.set(callback, delay); return callback; },
    clearTimeout(timer) { timers.delete(timer); },
    fs: { promises: {
      async stat(file) { counts.stat++; return { size: Buffer.byteLength(files.get(file) || '') }; },
      async appendFile(file, line) {
        counts.append++; if (options.beforeWrite) await options.beforeWrite(line, counts.append);
        files.set(file, (files.get(file) || '') + line);
      },
      async rename(from, to) { counts.rename++; files.set(to, files.get(from)); files.delete(from); },
    } },
  });
  vm.runInContext(section(main, 'function debugLog(', 'function loadGameNewsDiskCache('), context);
  return { context, counts, files, timers, consoleLines };
}

test('removes URL credentials, query strings and fragments from file and console logs', async () => {
  const h = logHarness();
  h.context.debugLog('game-frame-adapter', {
    href: 'https://fixture-user:fixture-password@osapi.dmm.com/gadgets/ifr?st=fixture-session#rpctoken=fixture-rpc',
    nested: { url: 'https://example.test/path?token=fixture-other' },
  });
  h.context.debugLog('failed at https://example.test/login?code=fixture-code#fixture-hash');
  await h.context.flushDebugLog();
  for (const output of [h.files.get('/virtual/debug.log'), h.consoleLines.join('\n')]) {
    assert.match(output, /https:\/\/osapi\.dmm\.com\/gadgets\/ifr/);
    assert.match(output, /https:\/\/example\.test\/path/);
    for (const secret of ['fixture-user', 'fixture-password', 'fixture-session', 'fixture-rpc', 'fixture-other', 'fixture-code', 'fixture-hash']) {
      assert.equal(output.includes(secret), false, secret);
    }
  }
});

test('writes logs asynchronously in order with a single initial file-size query', async () => {
  const gate = deferred(), h = logHarness({ beforeWrite: () => gate.promise });
  for (let i = 0; i < 100; i++) h.context.debugLog('fixture-' + i);
  assert.equal(h.counts.append, 0);
  let flushed = false; const pending = h.context.flushDebugLog().then(() => { flushed = true; });
  await turn(); assert.equal(h.counts.append, 1); assert.equal(flushed, false);
  gate.resolve(); await pending;
  const lines = h.files.get('/virtual/debug.log').trim().split('\n');
  assert.equal(lines.length, 100); assert.equal(h.counts.stat, 1);
  lines.forEach((line, i) => assert.ok(line.endsWith('fixture-' + i)));
  assert.equal(h.timers.size, 0);
});

test('does not extend the shutdown wait to include newly queued logs', async () => {
  const first = deferred(), later = deferred();
  const h = logHarness({ beforeWrite(_line, count) { return count === 1 ? first.promise : later.promise; } });
  h.context.debugLog('before-shutdown'); await turn();
  const pending = h.context.flushDebugLog();
  for (let i = 0; i < 20; i++) h.context.debugLog('after-shutdown-' + i);
  first.resolve(); await pending;
  assert.equal(h.files.get('/virtual/debug.log').trim().split('\n').length, 1);
  assert.equal(h.timers.size, 0);
  later.resolve(); await h.context.debugLogTask;
});

test('limits the log wait to two seconds even when the filesystem never responds', async () => {
  const h = logHarness({ beforeWrite() { return new Promise(() => {}); } });
  h.context.debugLog('stalled'); await turn();
  let finished = false;
  const pending = h.context.flushDebugLog().then(() => { finished = true; });
  await turn(); assert.equal(finished, false);
  const [[expire, delay]] = [...h.timers];
  assert.equal(delay, 2000);
  expire(); await pending;
  assert.equal(finished, true); assert.equal(h.timers.size, 0);
});

test('rotates logs before the next queued write and recovers after write failure', async () => {
  const h = logHarness({ initial: 'x'.repeat(2 * 1024 * 1024 + 1) });
  h.context.debugLog('new'); await h.context.flushDebugLog();
  assert.equal(h.counts.rename, 1); assert.ok(h.files.get('/virtual/debug.log').endsWith('new\n'));
  assert.equal(h.files.get('/virtual/debug.log.1').length, 2 * 1024 * 1024 + 1);
  const recover = logHarness({ beforeWrite(_line, count) { if (count === 1) throw new Error('fixture EIO'); } });
  recover.context.debugLog('failed'); recover.context.debugLog('recovered');
  await recover.context.flushDebugLog();
  assert.ok(recover.files.get('/virtual/debug.log').endsWith('recovered\n'));
});

test('flushes the real asynchronous file API into an isolated log before completion', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtaigis-debug-log-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'debug.log');
  const context = vm.createContext({
    DEBUG_LOG: file, debugLogTask: Promise.resolve(), debugLogSize: null,
    Buffer, Date, fs, setTimeout, clearTimeout, console: { log() {} },
  });
  vm.runInContext(section(main, 'function debugLog(', 'function loadGameNewsDiskCache('), context);
  for (let i = 0; i < 20; i++) context.debugLog('fixture-' + i);
  await context.flushDebugLog();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 20);
  lines.forEach((line, i) => assert.ok(line.endsWith('fixture-' + i)));
});
