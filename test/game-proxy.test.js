const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { getGameProxyConfig } = require('../lib/game-proxy');
const { defaultConfig } = require('../lib/secure-config');

const custom = { enabled: true, scheme: 'socks5', host: '127.0.0.1', port: '1080' };

test('uses system settings by default and uses one explicit route for all game URLs', () => {
  assert.deepEqual(getGameProxyConfig(defaultConfig().proxy), { mode: 'system' });
  for (const scheme of ['http', 'https', 'socks5']) {
    assert.deepEqual(getGameProxyConfig({ ...custom, scheme }), {
      mode: 'fixed_servers',
      proxyRules: scheme + '://127.0.0.1:1080',
      proxyBypassRules: '<-loopback>',
    });
  }
  assert.equal(getGameProxyConfig({ ...custom, host: '::1' }).proxyRules, 'socks5://[::1]:1080');
  assert.equal(getGameProxyConfig({ ...custom, host: '[::1]' }).proxyRules, 'socks5://[::1]:1080');
  for (const extras of [
    { scheme: 'unknown' }, { host: 'example.test,direct://' }, { host: '' },
    { host: 'https://example.test' }, { port: '' }, { port: 0 }, { port: '65536' },
  ]) {
    assert.throws(() => getGameProxyConfig({ ...custom, ...extras }), { code: 'ERR_INVALID_GAME_PROXY' });
  }
});

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

function fixture(proxy, hold) {
  const events = [], handlers = new Map();
  let failure;
  const session = {
    webRequest: { onBeforeRequest(first, second) { events.push(second ? 'tracker-filter' : 'blocked'); } },
    async setProxy(rules) {
      events.push(rules.mode);
      if (hold) await hold;
      if (failure) throw failure;
    },
    async closeAllConnections() { events.push('connections-closed'); },
  };
  const context = vm.createContext({
    gameView: { webContents: { isDestroyed: () => false, session } },
    gameProxyTask: null,
    gameProxyBlocked: !!proxy.enabled,
    currentConfig: { proxy }, getGameProxyConfig, defaultConfig,
    TRACKER_RULES: ['https://tracker.test/*'], GAME_AUXILIARY_FRAME_RULES: [],
    debugLog() { events.push('error'); },
    sendToRenderer(channel) { events.push(channel); },
    preconnectGameOrigins() { events.push('preconnect'); },
    async restoreAuthCookies() { events.push('cookies'); },
    loadDirectGame() { events.push('load'); },
    store: { save() { events.push('saved'); } },
    isWindowControlSender(event) { return event === 'trusted'; },
    ipcMain: { handle(channel, fn) { handlers.set(channel, fn); } },
  });
  vm.runInContext(
    section('function setGameProxyBlocked(', "ipcMain.handle('browser:navigate'") +
    section('async function initializeGameSession()', 'function preconnectGameOrigins(') +
    section("ipcMain.handle('config:save'", 'const LEGACY_CREDENTIAL_FILES'),
    context
  );
  return {
    context, events, routesFail() { failure = new Error('fixture error'); },
    save(proxy, sender = 'trusted') { return handlers.get('config:save')(sender, { proxy }); }
  };
}

test('keeps the default startup behavior but blocks a missing or failed explicit proxy', async () => {
  const regular = fixture(defaultConfig().proxy);
  assert.equal(await regular.context.initializeGameSession(), true);
  assert.deepEqual(regular.events, ['system', 'connections-closed', 'preconnect', 'cookies', 'load']);
  regular.routesFail();
  assert.equal(await regular.context.initializeGameSession(), true);

  for (const proxy of [{ ...custom, port: undefined }, custom]) {
    const explicit = fixture(proxy);
    explicit.routesFail();
    assert.equal(await explicit.context.initializeGameSession(), false);
    assert.equal(explicit.context.gameProxyBlocked, true);
    assert.ok(explicit.events.includes('browser:error'));
    assert.ok(!explicit.events.includes('preconnect') && !explicit.events.includes('load'));
  }
});

test('saves only after a working session configuration and resumes startup after correction', async () => {
  const blocked = fixture({ ...custom, port: '' });
  blocked.context.gameSessionStartup = blocked.context.initializeGameSession();
  assert.equal(await blocked.context.gameSessionStartup, false);
  assert.equal((await blocked.save({ ...custom, port: undefined })).ok, false);
  assert.equal((await blocked.save(custom, 'untrusted')).ok, false);
  assert.ok(!blocked.events.includes('saved'));
  assert.equal((await blocked.save(custom)).ok, true);
  await blocked.context.gameSessionStartup;
  assert.deepEqual(blocked.events.slice(-7), [
    'fixed_servers', 'connections-closed', 'saved', 'tracker-filter', 'preconnect', 'cookies', 'load',
  ]);
});

test('keeps the request block if a runtime route change fails and serializes concurrent saves', async () => {
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  const h = fixture(defaultConfig().proxy, pending);
  h.context.gameSessionStartup = Promise.resolve(true);
  const first = h.save(custom);
  await new Promise(setImmediate);
  assert.equal(h.context.gameProxyBlocked, true);
  assert.equal((await h.save({ ...custom, port: '1081' })).ok, false);
  h.routesFail();
  resume();
  assert.equal((await first).ok, false);
  assert.equal(h.context.currentConfig.proxy.enabled, false);
  assert.equal(h.context.gameProxyBlocked, true);
  assert.ok(h.events.includes('connections-closed'));
  assert.ok(!h.events.includes('saved'));
});

test('a reopened view waits for the earlier switch on the shared session', async () => {
  let resume;
  const h = fixture(defaultConfig().proxy, new Promise(resolve => { resume = resolve; }));
  const original = h.context.gameView;
  const switching = h.context.applyProxySettings(custom, true);
  await new Promise(setImmediate);
  h.context.gameView = { webContents: original.webContents };
  h.context.gameProxyBlocked = false;
  const startup = h.context.initializeGameSession();
  await new Promise(setImmediate);
  assert.deepEqual(h.events, ['blocked', 'fixed_servers']);
  resume();
  assert.equal(await switching, false);
  assert.equal(await startup, true);
  assert.ok(!h.events.includes('saved'));
  assert.deepEqual(h.events.slice(-5), ['system', 'connections-closed', 'preconnect', 'cookies', 'load']);
});
