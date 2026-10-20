const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { installGameBackgroundActivity } = require('../lib/game-background');

function fixture() {
  const state = { focused: true, visible: true, minimized: false, destroyed: false,
    url: 'https://game.test/', attached: false, devtools: false };
  const calls = [], errors = [];
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => state.destroyed, isFocused: () => state.focused,
    isVisible: () => state.visible, isMinimized: () => state.minimized,
  });
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => state.attached,
    attach() { calls.push('attach'); state.attached = true; },
    detach() { calls.push('detach'); state.attached = false; this.emit('detach'); },
    async sendCommand(method, params) { calls.push({ method, ...params }); },
  });
  const contents = Object.assign(new EventEmitter(), {
    debugger: debuggerApi, isDestroyed: () => state.destroyed,
    getURL: () => state.url, isDevToolsOpened: () => state.devtools,
    setBackgroundThrottling(value) { calls.push({ throttling: value }); },
  });
  const policy = installGameBackgroundActivity(window, contents, {
    isGameUrl: url => url.startsWith('https://game.test/'), onError: error => errors.push(error),
  });
  return { state, window, contents, debuggerApi, policy, calls, errors,
    commands: () => calls.filter(call => call.method),
    turn: () => new Promise(setImmediate) };
}

test('keeps background game pages active and releases emulation on return without polling', async () => {
  const h = fixture(); await h.policy.sync();
  assert.equal(h.calls.length, 0);
  h.state.focused = false; h.window.emit('blur'); await h.policy.sync();
  assert.deepEqual(h.commands(), [{ method: 'Emulation.setFocusEmulationEnabled', enabled: true }]);
  assert.ok(h.calls.some(call => call.throttling === false));
  for (let i = 0; i < 20; i++) h.window.emit('blur');
  await h.policy.sync(); assert.equal(h.commands().length, 1);
  h.state.focused = true; h.window.emit('focus'); await h.policy.sync();
  assert.equal(h.commands().at(-1).enabled, false);
  assert.equal(h.state.attached, false);
  h.policy.dispose();
});

test('covers minimize and hide independently of focus while preserving normal window closure', async () => {
  for (const kind of ['minimized', 'visible']) {
    const h = fixture(); await h.policy.sync();
    h.state[kind] = kind === 'minimized';
    h.window.emit(kind === 'minimized' ? 'minimize' : 'hide'); await h.policy.sync();
    assert.equal(h.commands().at(-1).enabled, true);
    h.state[kind] = kind === 'visible';
    h.window.emit(kind === 'minimized' ? 'restore' : 'show'); await h.policy.sync();
    assert.equal(h.commands().at(-1).enabled, false);
    h.window.emit('closed');
    assert.equal(h.window.listenerCount('blur'), 0);
    assert.equal(h.contents.listenerCount('did-navigate'), 0);
    assert.equal(h.debuggerApi.listenerCount('detach'), 0);
    const before = h.calls.length;
    h.window.emit('blur'); await h.policy.sync();
    assert.equal(h.calls.length, before);
  }
});

test('refreshes replacement frames and removes emulation when leaving the game', async () => {
  const h = fixture(); h.state.focused = false; await h.policy.sync();
  h.contents.emit('did-frame-finish-load'); await h.policy.sync();
  assert.equal(h.commands().length, 2);
  h.state.url = 'https://login.test/'; h.contents.emit('did-navigate'); await h.policy.sync();
  assert.equal(h.commands().at(-1).enabled, false);
  assert.equal(h.state.attached, false);
  const count = h.calls.length;
  h.contents.emit('did-frame-finish-load'); await h.policy.sync();
  assert.equal(h.calls.length, count);
  h.state.url = 'https://game.test/reloaded'; h.contents.emit('did-navigate'); await h.policy.sync();
  assert.equal(h.commands().at(-1).enabled, true);
  h.policy.dispose();
});

test('serializes pending focus changes and does not revive a destroyed window', async () => {
  for (const close of [false, true]) {
    const h = fixture(); await h.policy.sync();
    let finish;
    h.debuggerApi.sendCommand = async (method, params) => {
      h.calls.push({ method, ...params });
      if (params.enabled) await new Promise(resolve => { finish = resolve; });
    };
    h.state.focused = false; h.window.emit('blur'); await h.turn();
    h.state.focused = true; h.window.emit('focus');
    if (close) { h.state.destroyed = true; h.contents.emit('destroyed'); }
    finish(); await h.policy.sync();
    assert.deepEqual(h.commands().map(call => call.enabled), close ? [true] : [true, false]);
    assert.equal(h.state.attached, false);
    h.policy.dispose();
  }
});

test('does not take over another debugger and recovers after devtools close or a command failure', async () => {
  const h = fixture(); await h.policy.sync();
  h.state.focused = false; h.state.attached = true;
  await h.policy.sync(); assert.equal(h.calls.length, 0);
  h.state.attached = false; h.state.devtools = true;
  await h.policy.sync(); assert.equal(h.calls.length, 0);
  h.state.devtools = false; h.contents.emit('devtools-closed'); await h.policy.sync();
  assert.equal(h.commands().at(-1).enabled, true);
  h.debuggerApi.sendCommand = async () => { throw new Error('fixture protocol error'); };
  h.contents.emit('did-navigate'); await h.policy.sync();
  assert.equal(h.errors.length, 1);
  assert.equal(h.state.attached, false);
  await h.turn(); assert.equal(h.errors.length, 1);
  h.debuggerApi.sendCommand = async (method, params) => h.calls.push({ method, ...params });
  h.window.emit('blur'); await h.policy.sync();
  assert.equal(h.commands().at(-1).enabled, true);
  h.policy.dispose();
});
