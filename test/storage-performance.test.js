const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadWithFs(file, fakeFs, extras = {}) {
  const context = vm.createContext({
    module: { exports: {} }, Buffer,
    require(name) {
      if (name === 'fs') return fakeFs;
      return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name);
    },
    ...extras,
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return context.module.exports;
}

test('reuses a verified configuration key across saves and decryptions', () => {
  const disk = new Map();
  let keychainReads = 0;
  const fakeFs = {
    mkdirSync() {}, chmodSync() {},
    existsSync(file) { return disk.has(file); },
    readFileSync(file) { return Buffer.from(disk.get(file)); },
    writeFileSync(file, data) { disk.set(file, data); },
    renameSync(from, to) { disk.set(to, disk.get(from)); disk.delete(from); },
  };
  const exports = loadWithFs('lib/secure-config.js', fakeFs, {
    process: { platform: 'darwin' },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'child_process') return {
        execFileSync() { keychainReads++; return Buffer.alloc(32, 7).toString('base64'); },
      };
      return require(name);
    },
  });
  const store = new exports.SecureConfigStore('/virtual/config');
  for (let i = 0; i < 10; i++) store.save({ ...exports.defaultConfig(), fixture: i });
  assert.equal(store.load().fixture, 9);
  assert.equal(keychainReads, 1);
  const restarted = new exports.SecureConfigStore('/virtual/config');
  assert.equal(restarted.load().fixture, 9);
  assert.equal(keychainReads, 2);
});

test('does not cache an invalid configuration key after a failed operation', () => {
  let reads = 0;
  let valid = false;
  const fakeFs = {
    mkdirSync() {}, chmodSync() {}, existsSync() { return true; },
    readFileSync() { reads++; return valid ? Buffer.alloc(32, 1) : Buffer.alloc(4); },
  };
  const { SecureConfigStore } = loadWithFs('lib/secure-config.js', fakeFs, { process: { platform: 'linux' } });
  const store = new SecureConfigStore('/virtual/config');
  assert.throws(() => store.getOrCreateKey());
  valid = true;
  assert.equal(store.getOrCreateKey().length, 32);
  assert.equal(store.getOrCreateKey().length, 32);
  assert.equal(reads, 2);
});

function configKeyFixture(platform, legacy) {
  const validKey = Buffer.alloc(32, 3), disk = new Map();
  let availableKey = Buffer.alloc(32, 8), keyReads = 0;
  const fakeFs = {
    mkdirSync() {}, chmodSync() {},
    existsSync(file) { return file.endsWith('master.key') || disk.has(file); },
    readFileSync(file) {
      if (file.endsWith('master.key')) { keyReads++; return Buffer.from(availableKey); }
      return Buffer.from(disk.get(file));
    },
    writeFileSync(file, data) { disk.set(file, data); },
    renameSync(from, to) { disk.set(to, disk.get(from)); disk.delete(from); },
  };
  const exports = loadWithFs('lib/secure-config.js', fakeFs, {
    process: { platform },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'child_process') return {
        execFileSync() { keyReads++; return availableKey.toString('base64'); },
      };
      return require(name);
    },
  });
  const envelope = exports.encryptEnvelope(Buffer.from(JSON.stringify({ ...exports.defaultConfig(), fixture: 'original' })), validKey);
  const original = legacy ? Buffer.concat([
    Buffer.from(envelope.iv, 'base64'), Buffer.from(envelope.tag, 'base64'), Buffer.from(envelope.data, 'base64'),
  ]) : Buffer.from(JSON.stringify(envelope));
  disk.set('/virtual/config/config.enc', original);
  return {
    store: new exports.SecureConfigStore('/virtual/config'), original,
    readConfig() { return disk.get('/virtual/config/config.enc'); },
    recoverKey() { availableKey = validKey; },
    restart() { return new exports.SecureConfigStore('/virtual/config'); },
    get keyReads() { return keyReads; },
  };
}

test('invalidates an unauthenticated key and recovers both configuration formats without overwriting the failed read', async (t) => {
  for (const platform of ['darwin', 'linux']) {
    for (const legacy of [false, true]) {
      await t.test(`${platform}, ${legacy ? 'legacy' : 'envelope'}`, () => {
        const h = configKeyFixture(platform, legacy);
        assert.equal(h.store.load().fixture, undefined);
        assert.equal(h.store.getStatus().healthy, false);
        assert.equal(h.store.masterKey, null);
        assert.deepEqual(h.readConfig(), h.original);
        h.recoverKey();
        assert.equal(h.store.load().fixture, 'original');
        assert.equal(h.store.getStatus().healthy, true);
        assert.equal(h.keyReads, 2);
        for (let i = 0; i < 10; i++) h.store.save({ fixture: i });
        assert.equal(h.keyReads, 2);
        assert.equal(h.restart().load().fixture, 9);
        assert.equal(h.keyReads, 3);
      });
    }
  }
});

test('uses the recovered key on a save following a failed configuration read', () => {
  const h = configKeyFixture('darwin', false);
  h.store.load();
  h.recoverKey();
  h.store.save({ fixture: 'saved after recovery' });
  assert.equal(h.keyReads, 2);
  assert.equal(h.restart().load().fixture, 'saved after recovery');
  assert.equal(h.keyReads, 3);
});

test('rejects unsupported configuration envelopes before requesting a key', () => {
  let keyRequests = 0;
  const fakeFs = { mkdirSync() {}, chmodSync() {} };
  const { SecureConfigStore } = loadWithFs('lib/secure-config.js', fakeFs, {
    process: { platform: 'darwin' },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'child_process') return {
        execFileSync() { keyRequests++; return Buffer.alloc(32, 7).toString('base64'); },
      };
      return require(name);
    },
  });
  const store = new SecureConfigStore('/virtual/config');
  assert.throws(() => store.decryptEnvelope({ version: 999, algorithm: 'aes-256-gcm' }), /Unsupported encrypted config format/);
  assert.equal(keyRequests, 0);
});

test('reads vault data once per status and includes it only for internal callers', () => {
  let reads = 0;
  let content = '{"email":"fixture@example.test","password":"fixture-password","twofa":""}';
  let temporary = '';
  const fakeFs = {
    mkdirSync() {}, chmodSync() {}, existsSync() { return true; },
    statSync() { return { mtime: new Date(0) }; },
    readFileSync() { reads++; return content; },
    writeFileSync(_file, data) { temporary = data; },
    renameSync() { content = temporary; },
  };
  const { PlainVault } = loadWithFs('lib/plain-vault.js', fakeFs);
  const vault = new PlainVault('/virtual/vault.json');
  for (let i = 0; i < 60; i++) {
    const status = vault.status(true);
    assert.equal(status.data.password, 'fixture-password');
  }
  assert.equal(reads, 60);
  assert.equal('data' in vault.status(), false);
});

test('keeps the TOTP refresh when visible and pauses it when the sidebar is collapsed', () => {
  const source = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');
  const start = source.lastIndexOf('  setInterval(function () {');
  const timerSource = source.slice(start, source.indexOf('})();', start));
  let callback;
  let collapsed = false;
  let codeRefreshes = 0;
  let progressUpdates = 0;
  vm.runInNewContext(timerSource, {
    sidebarScrolling: false,
    document: { body: { classList: { contains() { return collapsed; } } } },
    byId() { return { classList: { contains() { return true; } } }; },
    updateTotpProgress() { progressUpdates++; },
    refreshVault() { codeRefreshes++; },
    setInterval(listener, delay) { assert.equal(delay, 1000); callback = listener; },
  });
  callback();
  assert.equal(codeRefreshes, 1);
  assert.equal(progressUpdates, 1);
  collapsed = true;
  callback();
  assert.equal(codeRefreshes, 1);
  assert.equal(progressUpdates, 1);
  collapsed = false;
  callback();
  assert.equal(codeRefreshes, 2);
});
