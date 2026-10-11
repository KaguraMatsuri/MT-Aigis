const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const config = require('../lib/secure-config');

const fixture = { email: 'fixture@example.test', password: 'fixture-password-密碼', twofa: 'JBSWY3DPEHPK3PXP' };
const fixtureKey = Buffer.alloc(32, 7);
const vaultPath = '/virtual/vault.json';

function harness(initialContent) {
  const disk = new Map();
  let reads = 0;
  let writes = 0;
  let failWrite = false;
  let failRename = false;
  if (initialContent !== undefined) disk.set(vaultPath, initialContent);
  const fakeFs = {
    mkdirSync() {}, chmodSync() {},
    existsSync(file) { return disk.has(file); },
    readFileSync(file) { reads++; return disk.get(file); },
    statSync() { return { mtime: new Date(0) }; },
    writeFileSync(file, content, options) {
      assert.equal(options.mode, 0o600);
      if (failWrite) throw new Error('fixture disk full');
      writes++; disk.set(file, content);
    },
    renameSync(from, to) {
      if (failRename) throw new Error('fixture rename failure');
      disk.set(to, disk.get(from)); disk.delete(from);
    },
  };
  const context = vm.createContext({
    Buffer, module: { exports: {} },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === './secure-config') return config;
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib/plain-vault.js'), 'utf8'), context);
  const { PlainVault, emptyVault } = context.module.exports;
  return {
    disk, PlainVault, emptyVault,
    vault: new PlainVault(vaultPath, fixtureKey),
    reopen(key = fixtureKey) { return new PlainVault(vaultPath, key); },
    defaultVault() { return new PlainVault(vaultPath); },
    get reads() { return reads; },
    get writes() { return writes; },
    failWrite(value) { failWrite = value; },
    failRename(value) { failRename = value; },
  };
}

function legacyMigration(h) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const first = source.indexOf('function existingLegacyCredentialFiles(');
  const last = source.indexOf('function maskSecret(', first);
  const context = vm.createContext({
    LEGACY_CREDENTIAL_FILES: ['/virtual/legacy.json', '/virtual/older.json'],
    fs: { existsSync(file) { return h.disk.has(file); } },
    PlainVault: h.PlainVault,
    vault: h.defaultVault(),
    emptyVault: h.emptyVault,
    logs: [],
    debugLog(...parts) { context.logs.push(parts); },
  });
  vm.runInContext(source.slice(first, last), context);
  return context;
}

test('automatically encrypts an existing plaintext vault without losing login or TOTP data', () => {
  const h = harness(JSON.stringify(fixture));
  assert.deepEqual(JSON.parse(JSON.stringify(h.vault.load())), fixture);
  const envelope = JSON.parse(h.disk.get(vaultPath));
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12);
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
  for (const value of Object.values(fixture)) assert.equal(h.disk.get(vaultPath).includes(value), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reopen().load())), fixture);
  assert.equal(h.writes, 1);
});

test('uses the embedded client key without a password or keychain and remains readable across restarts', () => {
  const h = harness(JSON.stringify(fixture));
  assert.deepEqual(JSON.parse(JSON.stringify(h.defaultVault().load())), fixture);
  assert.equal(JSON.parse(h.disk.get(vaultPath)).algorithm, 'aes-256-gcm');
  assert.deepEqual(JSON.parse(JSON.stringify(h.defaultVault().load())), fixture);
  assert.equal(h.writes, 1);
});

test('migrates the legacy TOTP field and keeps encrypted status reads at one file read each', () => {
  const h = harness(JSON.stringify({ email: fixture.email, password: fixture.password, twoFactorCode: fixture.twofa }));
  assert.equal(h.vault.status(true).data.twofa, fixture.twofa);
  for (let i = 0; i < 60; i++) h.vault.status(true);
  assert.equal(h.reads, 61);
  assert.equal(h.writes, 1);
  assert.equal('data' in h.vault.status(), false);
});

test('uses fresh IVs on saves while remaining readable by a new vault instance', () => {
  const h = harness();
  h.vault.save(fixture);
  const first = JSON.parse(h.disk.get(vaultPath));
  h.vault.save(fixture);
  const second = JSON.parse(h.disk.get(vaultPath));
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reopen().load())), fixture);
});

test('keeps the original plaintext file when migration cannot be written', () => {
  const original = JSON.stringify(fixture);
  const h = harness(original);
  h.failWrite(true);
  const status = h.vault.status(true);
  assert.match(status.error, /fixture disk full/);
  assert.equal('data' in status, false);
  assert.equal(h.disk.get(vaultPath), original);
  h.failWrite(false);
  assert.equal(h.vault.load().password, fixture.password);
});

test('keeps the original plaintext file when atomic replacement fails', () => {
  const original = JSON.stringify(fixture);
  const h = harness(original);
  h.failRename(true);
  assert.ok(h.vault.status().error);
  assert.equal(h.disk.get(vaultPath), original);
  h.failRename(false);
  assert.equal(h.vault.load().password, fixture.password);
});

test('rejects tampering or a wrong key without replacing the encrypted vault', () => {
  const h = harness();
  h.vault.save(fixture);
  const original = h.disk.get(vaultPath);
  assert.throws(() => h.reopen(Buffer.alloc(32, 8)).load());
  assert.equal(h.disk.get(vaultPath), original);
  const damaged = JSON.parse(original);
  const ciphertext = Buffer.from(damaged.data, 'base64');
  ciphertext[0] ^= 1;
  damaged.data = ciphertext.toString('base64');
  const corrupted = JSON.stringify(damaged);
  h.disk.set(vaultPath, corrupted);
  assert.ok(h.vault.status().error);
  assert.equal(h.disk.get(vaultPath), corrupted);
});

test('rejects unsupported encrypted formats instead of migrating them as empty plaintext', () => {
  const h = harness();
  h.vault.save(fixture);
  const damaged = JSON.parse(h.disk.get(vaultPath));
  damaged.version = 999;
  const original = JSON.stringify(damaged);
  h.disk.set(vaultPath, original);
  assert.ok(h.vault.status().error);
  assert.equal(h.disk.get(vaultPath), original);
});

test('rejects truncated authentication tags without rewriting the vault', () => {
  const h = harness();
  h.vault.save(fixture);
  const damaged = JSON.parse(h.disk.get(vaultPath));
  damaged.tag = Buffer.from(damaged.tag, 'base64').subarray(0, 4).toString('base64');
  const original = JSON.stringify(damaged);
  h.disk.set(vaultPath, original);
  assert.ok(h.vault.status().error);
  assert.equal(h.disk.get(vaultPath), original);
});

test('does not create a vault merely by checking a missing file', () => {
  const h = harness();
  assert.equal(h.vault.status().exists, false);
  assert.equal(h.writes, 0);
});

test('automatically imports and encrypts existing legacy login credentials without re-entry', () => {
  const h = harness();
  h.disk.set('/virtual/legacy.json', JSON.stringify({ ...fixture, twoFactorCode: fixture.twofa, twofa: '' }));
  const migration = legacyMigration(h);
  migration.migrateLegacyCredentials();
  assert.deepEqual(JSON.parse(JSON.stringify(h.defaultVault().load())), fixture);
  assert.equal(JSON.parse(h.disk.get('/virtual/legacy.json')).algorithm, 'aes-256-gcm');
  assert.equal(migration.readLegacyCredentials().password, fixture.password);
  const writes = h.writes;
  migration.migrateLegacyCredentials();
  assert.equal(h.writes, writes);
});

test('encrypts all legacy files while preserving an already-created current vault', () => {
  const h = harness();
  h.defaultVault().save(fixture);
  h.disk.set('/virtual/legacy.json', JSON.stringify({ ...fixture, password: 'older-password' }));
  h.disk.set('/virtual/older.json', JSON.stringify({ ...fixture, password: 'oldest-password' }));
  legacyMigration(h).migrateLegacyCredentials();
  assert.equal(h.defaultVault().load().password, fixture.password);
  assert.equal(JSON.parse(h.disk.get('/virtual/legacy.json')).algorithm, 'aes-256-gcm');
  assert.equal(JSON.parse(h.disk.get('/virtual/older.json')).algorithm, 'aes-256-gcm');
});

test('does not log credential contents when a legacy file is malformed', () => {
  const h = harness();
  h.disk.set('/virtual/legacy.json', `{"password":"${fixture.password}" broken`);
  const migration = legacyMigration(h);
  migration.migrateLegacyCredentials();
  assert.equal(migration.logs.length, 1);
  assert.equal(JSON.stringify(migration.logs).includes(fixture.password), false);
  assert.equal(h.defaultVault().exists(), false);
});
