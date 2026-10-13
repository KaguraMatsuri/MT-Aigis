const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(session) {
  let now = 100000;
  const handlers = new Map();
  const context = vm.createContext({
    gameView: { webContents: { isDestroyed() { return false; }, session } },
    cacheStatsCache: null, cacheStatsAt: 0, cacheStatsTask: null, cacheClearTask: null,
    CACHE_STATS_TTL_MS: 15000, Date: { now: () => now }, debugLog() {},
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
  });
  vm.runInContext(section(main, 'async function getCacheStats(', 'app.whenReady().then('), context);
  return { context, handlers, advance(milliseconds) { now += milliseconds; } };
}

test('shares fifty concurrent queries and retains successful values until expiry', async () => {
  const gate = deferred(); let queries = 0;
  const h = harness({ getCacheSize() { queries++; return gate.promise; } });
  const pending = Array.from({ length: 50 }, () => h.context.getCacheStats());
  assert.equal(queries, 1);
  gate.resolve(123);
  assert.ok((await Promise.all(pending)).every(stats => stats.diskBytes === 123));
  await h.context.getCacheStats();
  assert.equal(queries, 1);
  h.advance(15000);
  await h.context.getCacheStats();
  assert.equal(queries, 2);
});

test('propagates shared query failures without caching zero and retries after recovery', async () => {
  const gate = deferred(); let queries = 0;
  const h = harness({ getCacheSize() { queries++; return queries === 1 ? gate.promise : Promise.resolve(321); } });
  const pending = Array.from({ length: 50 }, () => h.context.getCacheStats());
  const outcomes = Promise.allSettled(pending);
  gate.reject(new Error('fixture native query failure'));
  assert.ok((await outcomes).every(result => result.status === 'rejected'));
  assert.equal(queries, 1);
  assert.equal(h.context.cacheStatsCache, null);
  assert.equal(h.context.cacheStatsAt, 0);
  assert.equal(h.context.cacheStatsTask, null);
  assert.equal((await h.context.getCacheStats()).diskBytes, 321);
  assert.equal(queries, 2);
});

test('leaves the last successful value and timestamp intact when a forced query fails', async () => {
  let failing = false, queries = 0;
  const h = harness({ async getCacheSize() { queries++; if (failing) throw new Error('fixture failure'); return 123; } });
  await h.context.getCacheStats();
  const at = h.context.cacheStatsAt;
  h.advance(1000); failing = true;
  await assert.rejects(h.context.getCacheStats(true), /fixture failure/);
  assert.equal(h.context.cacheStatsCache.diskBytes, 123);
  assert.equal(h.context.cacheStatsAt, at);
  assert.equal((await h.context.getCacheStats()).diskBytes, 123);
  assert.equal(queries, 2);
  h.advance(14000);
  await assert.rejects(h.context.getCacheStats(), /fixture failure/);
  assert.equal(h.context.cacheStatsAt, at);
  failing = false;
  await h.context.getCacheStats();
  assert.equal(queries, 4);
});

test('serializes overlapping clears with queries and refreshes once after clearing', async () => {
  const stats = deferred(), clear = deferred(), calls = []; let queries = 0;
  const h = harness({
    getCacheSize() { calls.push('stats'); return ++queries === 1 ? stats.promise : Promise.resolve(0); },
    clearCache() { calls.push('http'); return clear.promise; },
    async clearCodeCaches() { calls.push('code'); },
    async clearStorageData(options) { calls.push(options.storages.join(',')); },
    async closeAllConnections() { calls.push('connections'); },
  });
  const original = h.context.getCacheStats();
  const first = h.handlers.get('cache:clear-cache')(), second = h.handlers.get('cache:clear-cache')();
  const overlapping = h.context.getCacheStats();
  assert.deepEqual(calls, ['stats']);
  stats.resolve(123); await original; await new Promise(setImmediate);
  assert.deepEqual(calls, ['stats', 'http']);
  clear.resolve();
  const [a, b, c] = await Promise.all([first, second, overlapping]);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(c.diskBytes, 0);
  assert.deepEqual(calls, ['stats', 'http', 'code', 'serviceworkers,cachestorage,shadercache', 'connections', 'stats']);
  assert.equal(h.context.cacheClearTask, null);
  assert.equal(h.context.cacheStatsTask, null);
});

test('reports a failed post-clear size query without creating a false zero cache', async () => {
  let clears = 0;
  const h = harness({
    async getCacheSize() { throw new Error('fixture size query failure'); },
    async clearCache() { clears++; }, async clearCodeCaches() {},
    async clearStorageData() {}, async closeAllConnections() {},
  });
  const result = await h.handlers.get('cache:clear-cache')();
  assert.equal(clears, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'fixture size query failure');
  assert.equal(h.context.cacheStatsCache, null);
});

test('uses the existing read-failure UI and displays a genuine zero result after recovery', async () => {
  let failing = true;
  const h = harness({ async getCacheSize() { if (failing) throw new Error('fixture failure'); return 0; } });
  const field = { textContent: 'previous', classList: { contains: () => true } };
  const context = vm.createContext({
    document: { visibilityState: 'visible', body: { classList: { contains: () => false } } },
    sidebarScrolling: false, byId() { return field; }, t(key) { return key; },
    formatBytes(value) { return String(value); },
    api: { invoke(_channel, force) { return h.context.getCacheStats(force); } },
  });
  vm.runInContext(section(sidebar, '  function renderCache(', '  function updateTotpProgress('), context);
  await context.refreshCache(false);
  assert.equal(field.textContent, 'readFailed');
  failing = false;
  await context.refreshCache(false);
  assert.equal(field.textContent, '0');
});
