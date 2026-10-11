const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const test = require('node:test');
const vm = require('node:vm');
const { isValidUpdateVersion, matchesSha512, normalizeGithubRelease, resolveUpdateAssetUrl } = require('../lib/update-notification');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function section(start, end) {
  const first = mainSource.indexOf(start), last = mainSource.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return mainSource.slice(first, last);
}

const temporaryDirectories = new Set();
test.after(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

function harness(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mtaigis-update-download-'));
  temporaryDirectories.add(directory);
  const downloads = options.downloads || path.join(directory, 'downloads');
  const timers = [], states = [], renamed = [], removed = [];
  let maximumBuffered = 0, writtenBytes = 0, tick = 0, sink = null;
  const context = vm.createContext({
    Readable, pipeline, crypto, Buffer, path, AbortController,
    Date: { now() { return ++tick; } },
    app: { getPath() { return downloads; } },
    fs: {
      ...fs,
      createWriteStream(file, streamOptions) {
        sink = fs.createWriteStream(file, { ...streamOptions, highWaterMark: 64 * 1024 });
        if (options.writeError) {
          sink._write = (_chunk, _encoding, callback) => setImmediate(() => callback(options.writeError));
          sink._writev = (_chunks, callback) => setImmediate(() => callback(options.writeError));
        }
        const originalWrite = sink.write.bind(sink);
        sink.write = (chunk, ...args) => {
          writtenBytes += chunk.length;
          const result = originalWrite(chunk, ...args);
          maximumBuffered = Math.max(maximumBuffered, sink.writableLength);
          return result;
        };
        return sink;
      },
      renameSync(from, to) { renamed.push([from, to]); fs.renameSync(from, to); },
      rmSync(file, removeOptions) { removed.push(file); fs.rmSync(file, removeOptions); },
    },
    setTimeout(callback, delay) { const timer = { callback, delay, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    fetchBinary: options.fetchBinary || (async () => ({
      headers: { get() { return String(options.totalBytes); } }, body: options.body,
    })),
    appText(_key, values) { return String(values.percent); },
    setUpdateState(status, message) { states.push({ status, percent: Number(message) }); },
    isValidUpdateVersion, matchesSha512, resolveUpdateAssetUrl,
  });
  vm.runInContext(
    section('function pickDmgAsset(', 'async function readLatestManifest(') +
    section('async function downloadUpdateDmg(', 'function openInstallerAndQuit('), context);
  return {
    context, directory, downloads, timers, states, renamed, removed,
    manifest(sha512 = Buffer.alloc(64, 7).toString('base64')) {
      return { version: '1.3.0', dmg: {
        downloadUrl: 'https://github.com/KaguraMatsuri/MT-Aigis/releases/download/v1.3.0/MT-Aigis-1.3.0-arm64.dmg',
        sha512, size: options.totalBytes || 1,
      } };
    },
    get sink() { return sink; },
    get maximumBuffered() { return maximumBuffered; },
    get writtenBytes() { return writtenBytes; },
  };
}

function bufferedSource(count, chunk) {
  let index = 0;
  return new ReadableStream({ pull(controller) {
    if (index++ < count) controller.enqueue(chunk);
    else controller.close();
  } });
}

test('bounds download buffering, throttles progress, and reaches 100 only after verified completion', async (t) => {
  const count = 1024;
  const chunk = Buffer.alloc(16 * 1024, 7);
  const digest = crypto.createHash('sha512');
  for (let i = 0; i < count; i++) digest.update(chunk);
  const h = harness({ body: bufferedSource(count, chunk), totalBytes: count * chunk.length });
  await h.context.downloadUpdateDmg(h.manifest(digest.digest('base64')));
  assert.equal(h.writtenBytes, count * chunk.length);
  assert.ok(h.maximumBuffered <= 128 * 1024, h.maximumBuffered);
  assert.ok(h.states.length <= 12, h.states.length);
  assert.equal(h.states.at(-1).percent, 100);
  assert.ok(h.states.slice(0, -1).every(state => state.percent < 100));
  assert.equal(h.renamed.length, 1);
  assert.equal(h.removed.length, 0);
  assert.ok(h.timers.every(timer => !timer.active));
  t.diagnostic(`16 MiB input: max write buffer ${h.maximumBuffered} bytes; ${h.states.length} progress events`);
});

test('cleans up corrupt downloads without reporting successful completion', async () => {
  const h = harness({ body: bufferedSource(1, Buffer.alloc(32)), totalBytes: 32 });
  await assert.rejects(h.context.downloadUpdateDmg(h.manifest()), /checksum mismatch/);
  assert.equal(h.renamed.length, 0);
  assert.equal(h.removed.length, 1);
  assert.ok(h.states.every(state => state.percent < 100));
});

test('handles disk write failures through the pipeline and removes the partial download', async () => {
  const h = harness({ body: bufferedSource(2, Buffer.alloc(32)), totalBytes: 64, writeError: new Error('fixture disk full') });
  await assert.rejects(h.context.downloadUpdateDmg(h.manifest()), /fixture disk full/);
  assert.equal(h.renamed.length, 0);
  assert.equal(h.removed.length, 1);
  assert.ok(h.timers.every(timer => !timer.active));
});

test('aborts stalled downloads and clears the inactivity timer', async () => {
  let canceled = false;
  const h = harness({ body: new ReadableStream({ cancel() { canceled = true; } }), totalBytes: 100 });
  const pending = h.context.downloadUpdateDmg(h.manifest());
  await new Promise(setImmediate);
  const timer = h.timers.find(timer => timer.active);
  assert.equal(timer.delay, 30000);
  timer.callback();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(canceled, true);
  assert.equal(h.removed.length, 1);
  assert.ok(h.timers.every(timer => !timer.active));
});

test('aborts a stalled download response before creating a file', async () => {
  const h = harness({ fetchBinary(_url, signal) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const pending = h.context.downloadUpdateDmg(h.manifest());
  const timer = h.timers.find(timer => timer.active);
  assert.equal(timer.delay, 8000);
  timer.callback();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.removed.length, 1);
  assert.ok(h.timers.every(timer => !timer.active));
});

test('releases a timed-out update check so the next attempt starts fresh requests', async () => {
  const controllers = [];
  const requests = [];
  const context = vm.createContext({
    app: { isPackaged: true }, updateDownloadTask: null, updateState: {}, CHROME_UA: 'fixture',
    UPDATE_MANIFEST_URL: 'https://fixture.invalid/manifest', GITHUB_RELEASE_API_URL: 'https://fixture.invalid/release',
    AbortSignal: { timeout(delay) { assert.equal(delay, 8000); const controller = new AbortController(); controllers.push(controller); return controller.signal; } },
    fetch(url, options) {
      requests.push(url);
      if (url.endsWith('/release')) return Promise.resolve({ ok: true, async json() { return {}; } });
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    },
    appText(key) { return key; }, effectiveLanguage() { return 'en'; }, Buffer, isValidUpdateVersion, matchesSha512, normalizeGithubRelease, resolveUpdateAssetUrl,
    setUpdateState(status) { context.updateState.status = status; },
    debugLog() {},
  });
  vm.runInContext(section('function formatUpdateError(', 'function parseLatestManifest(') + section('async function fetchTextWithMeta(', 'async function showUpdateNotification(') + section('function checkForUpdates(', 'function isGameContentFrame('), context);
  const first = context.checkForUpdates();
  assert.equal(context.checkForUpdates(), first);
  controllers[0].abort();
  await first;
  assert.equal(context.updateDownloadTask, null);
  assert.equal(context.updateState.status, 'error');
  const second = context.checkForUpdates();
  assert.notEqual(second, first);
  assert.equal(requests.length, 4);
  controllers[2].abort();
  await second;
});

function updateCheckHarness(options = {}) {
  const calls = { manifest: 0, release: 0, prompt: 0, download: 0, install: 0 };
  const context = vm.createContext({
    app: { isPackaged: true }, updateDownloadTask: null, updateState: {}, normalizeGithubRelease,
    async readLatestManifest() {
      calls.manifest++;
      if (options.manifestError) throw options.manifestError;
      return { version: options.version || '1.3.0', dmg: {} };
    },
    async readLatestGithubRelease() { calls.release++; return null; },
    appVersionValue() { return '1.2.0'; },
    async showUpdateNotification() { calls.prompt++; return 'install'; },
    async downloadUpdateDmg() {
      calls.download++;
      return options.download ? options.download(context, calls.download) : '/virtual/update.dmg';
    },
    async openInstallerAndQuit() { calls.install++; context.setUpdateState('opened', 'updateOpened'); return context.updateState; },
    appText(key) { return key; },
    setUpdateState(status, message, extra = {}) { context.updateState = { status, message, ...extra }; },
    debugLog() {},
  });
  vm.runInContext([
    section('function formatUpdateError(', 'function parseLatestManifest('),
    section('function compareVersions(', 'async function fetchTextWithMeta('),
    section('function checkForUpdates(', 'function isGameContentFrame('),
  ].join('\n'), context);
  return { context, calls };
}

test('reports a download response 404 as failure and allows a successful fresh check afterward', async () => {
  const h = updateCheckHarness({ download(_context, attempt) {
    if (attempt === 1) throw new Error('HTTP 404');
    return '/virtual/update.dmg';
  } });
  const failed = await h.context.checkForUpdates();
  assert.equal(failed.status, 'error');
  assert.equal(failed.message, 'updateFailed');
  assert.equal(failed.error, 'updateFailed');
  assert.equal(h.calls.install, 0);
  assert.equal(h.context.updateDownloadTask, null);
  const retried = await h.context.checkForUpdates();
  assert.equal(retried.status, 'opened');
  assert.deepEqual(h.calls, { manifest: 2, release: 2, prompt: 2, download: 2, install: 1 });
  assert.equal(h.context.updateDownloadTask, null);
});

test('reports a 404 after progress started as download failure', async () => {
  const h = updateCheckHarness({ download(context) {
    context.setUpdateState('downloading', 'updateDownloadingPercent');
    throw new Error('HTTP 404');
  } });
  const failed = await h.context.checkForUpdates();
  assert.equal(failed.status, 'error');
  assert.equal(failed.message, 'updateFailed');
  assert.equal(h.calls.install, 0);
  assert.equal(h.context.updateDownloadTask, null);
});

test('preserves missing-manifest compatibility and distinguishes other checking failures', async () => {
  for (const [message, expected, code] of [
    ['HTTP 404', 'current', 'UPDATE_MANIFEST_NOT_FOUND'],
    ['HTTP 404', 'error'],
    ['missing dmg', 'error'],
    ['invalid manifest', 'error'],
    ['invalid manifest in latest-mac.yml', 'error'],
    ['HTTP 500', 'error'],
  ]) {
    const h = updateCheckHarness({ manifestError: Object.assign(new Error(message), { code }) });
    const result = await h.context.checkForUpdates();
    assert.equal(result.status, expected, message);
    assert.equal(result.message, expected === 'current' ? 'updateCurrent' : 'updateFailed', message);
    assert.equal(h.calls.download, 0);
    assert.equal(h.context.updateDownloadTask, null);
  }
});

test('keeps the no-update result when the manifest version matches the installed app', async () => {
  const h = updateCheckHarness({ version: '1.2.0' });
  const result = await h.context.checkForUpdates();
  assert.equal(result.status, 'current');
  assert.equal(result.message, 'updateCurrent');
  assert.equal(h.calls.prompt, 0);
  assert.equal(h.calls.download, 0);
});

test('applies separate timeouts to IP and region queries and returns the available IP on region failure', async () => {
  const signals = [];
  const context = vm.createContext({
    CHROME_UA: 'fixture',
    AbortSignal: { timeout(delay) { assert.equal(delay, 8000); const signal = new AbortController().signal; signals.push(signal); return signal; } },
    async fetchThroughGameSession(url, options) {
      assert.ok(options.signal);
      if (url.includes('ipify')) return { async json() { return { ip: '192.0.2.1' }; } };
      throw new Error('fixture region timeout');
    },
  });
  vm.runInContext(section('async function getNetworkStatus(', 'function sendToRenderer('), context);
  const status = await context.getNetworkStatus();
  assert.equal(status.ip, '192.0.2.1');
  assert.equal(status.countryCode, '');
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});

test('isolates overlapping downloads from two client instances sharing Downloads', async () => {
  const data = Buffer.alloc(4096, 7);
  const first = harness({ totalBytes: data.length, body: bufferedSource(1, data) });
  let finishFirst, firstWritten, secondWritten, secondSource;
  const firstGate = new Promise(resolve => { finishFirst = resolve; });
  const ready = new Promise(resolve => { firstWritten = resolve; });
  first.context.pipeline = async (...args) => { await pipeline(...args); firstWritten(); await firstGate; };
  const source = new ReadableStream({ start(controller) { secondSource = controller; controller.enqueue(data.subarray(0, 1)); } });
  const second = harness({ downloads: first.downloads, totalBytes: data.length, body: source });
  const secondReady = new Promise(resolve => { secondWritten = resolve; });
  const originalCreate = second.context.fs.createWriteStream;
  second.context.fs.createWriteStream = (...args) => {
    const sink = originalCreate(...args), write = sink._write.bind(sink);
    sink._write = (chunk, encoding, callback) => write(chunk, encoding, error => { callback(error); secondWritten(); });
    return sink;
  };
  const digest = crypto.createHash('sha512').update(data).digest('base64');
  const firstTask = first.context.downloadUpdateDmg(first.manifest(digest));
  await ready;
  const secondTask = second.context.downloadUpdateDmg(second.manifest(digest));
  await secondReady;
  finishFirst();
  const firstFile = await firstTask;
  assert.deepEqual(fs.readFileSync(firstFile), data);
  secondSource.enqueue(data.subarray(1)); secondSource.close();
  const secondFile = await secondTask;
  assert.notEqual(path.dirname(firstFile), path.dirname(secondFile));
  assert.deepEqual(fs.readFileSync(secondFile), data);
  assert.equal(first.removed.length, 0); assert.equal(second.removed.length, 0);
});

test('leaves legacy temporary symlinks and their unrelated targets untouched', async () => {
  const data = Buffer.from('verified installer');
  const h = harness({ totalBytes: data.length, body: bufferedSource(1, data) });
  const dir = path.join(h.downloads, 'MT-Aigis Updates'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(h.directory, 'unrelated.txt'); fs.writeFileSync(target, 'keep original');
  const legacy = path.join(dir, 'MT-Aigis-1.3.0.dmg.download'); fs.symlinkSync(target, legacy);
  const final = await h.context.downloadUpdateDmg(h.manifest(crypto.createHash('sha512').update(data).digest('base64')));
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep original');
  assert.equal(fs.lstatSync(legacy).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(final).isFile(), true);
  assert.deepEqual(fs.readFileSync(final), data);
});

test('refuses a preexisting symlink inside the task directory without overwriting its target', async () => {
  const data = Buffer.from('fixture');
  const h = harness({ totalBytes: data.length, body: bufferedSource(1, data) });
  const target = path.join(h.directory, 'unrelated.txt'); fs.writeFileSync(target, 'keep original');
  const create = h.context.fs.createWriteStream;
  h.context.fs.createWriteStream = (file, options) => { fs.symlinkSync(target, file); return create(file, options); };
  await assert.rejects(h.context.downloadUpdateDmg(h.manifest()), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep original');
  assert.equal(h.removed.length, 1);
  assert.equal(fs.existsSync(h.removed[0]), false);
});

test('hashes actual disk contents and rejects corruption after the network stream completed', async () => {
  const data = Buffer.from('fixture installer');
  const h = harness({ totalBytes: data.length, body: bufferedSource(1, data) });
  const lstat = h.context.fs.lstatSync;
  h.context.fs.lstatSync = file => { fs.writeFileSync(file, Buffer.alloc(data.length, 9)); return lstat(file); };
  await assert.rejects(h.context.downloadUpdateDmg(h.manifest(crypto.createHash('sha512').update(data).digest('base64'))), /checksum mismatch/);
  assert.equal(h.renamed.length, 0);
  assert.ok(h.states.every(state => state.percent < 100));
  assert.equal(fs.existsSync(h.removed[0]), false);
});

test('rejects short and oversized downloads and cleans only the current task directory', async () => {
  for (const size of [1, 3]) {
    const data = Buffer.alloc(2, 7), h = harness({ totalBytes: size, body: bufferedSource(1, data) });
    const updateDir = path.join(h.downloads, 'MT-Aigis Updates'); fs.mkdirSync(updateDir, { recursive: true });
    const existing = path.join(updateDir, 'MT-Aigis-1.3.0.dmg'); fs.writeFileSync(existing, 'previous download');
    await assert.rejects(h.context.downloadUpdateDmg(h.manifest(crypto.createHash('sha512').update(data).digest('base64'))), /size mismatch/);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'previous download');
    assert.equal(h.renamed.length, 0); assert.ok(h.states.every(state => state.percent < 100));
    assert.equal(fs.existsSync(h.removed[0]), false);
  }
});

test('cleans the current download on disk verification read failure or final rename failure', async () => {
  for (const failure of ['read', 'rename']) {
    const data = Buffer.from('fixture installer'), h = harness({ totalBytes: data.length, body: bufferedSource(1, data) });
    if (failure === 'read') h.context.fs.createReadStream = () => new Readable({ read() { this.destroy(new Error('fixture read failure')); } });
    else h.context.fs.renameSync = () => { throw new Error('fixture rename failure'); };
    await assert.rejects(h.context.downloadUpdateDmg(h.manifest(crypto.createHash('sha512').update(data).digest('base64'))), new RegExp(`fixture ${failure} failure`));
    assert.ok(h.states.every(state => state.percent < 100));
    assert.equal(h.removed.length, 1); assert.equal(fs.existsSync(h.removed[0]), false);
    assert.ok(h.timers.every(timer => !timer.active));
  }
});

test('rejects malformed manifest fields before creating directories or starting a download', async () => {
  const h = harness({ totalBytes: 1 }); let requests = 0;
  h.context.fetchBinary = async () => { requests++; throw new Error('unexpected download'); };
  for (const invalid of [
    { version: '1.3.0/../../../outside' },
    { dmg: { ...h.manifest().dmg, size: 0 } },
    { dmg: { ...h.manifest().dmg, size: Number.MAX_SAFE_INTEGER + 1 } },
    { dmg: { ...h.manifest().dmg, sha512: 'invalid' } },
    { dmg: { ...h.manifest().dmg, sha512: h.manifest().dmg.sha512 + '!' } },
    { dmg: { ...h.manifest().dmg, downloadUrl: 'https://example.com/update.dmg' } },
    { dmg: { ...h.manifest().dmg, downloadUrl: h.manifest().dmg.downloadUrl.replace(/\.dmg$/, '.zip') } },
    { dmg: { ...h.manifest().dmg, downloadUrl: h.manifest().dmg.downloadUrl.replace('/v1.3.0/', '/v1.4.0/') } },
  ]) await assert.rejects(h.context.downloadUpdateDmg({ ...h.manifest(), ...invalid }), /invalid/);
  assert.equal(requests, 0); assert.equal(fs.existsSync(h.downloads), false);
  assert.equal(h.removed.length, 0); assert.equal(h.timers.length, 0);
});
