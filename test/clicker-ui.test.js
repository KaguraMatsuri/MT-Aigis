const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { defaultConfig } = require('../lib/secure-config');
const { isAdaptedPage } = require('../lib/navigation');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');
const clicker = fs.readFileSync(path.join(root, 'resources/game-clicker.js'), 'utf8');
const driverFixture = fs.readFileSync(path.join(root, 'test/game-clicker.test.js'), 'utf8');

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

function native(options = {}, driver) {
  const handlers = new Map(), dialogs = [], saved = [], messages = [], calls = [];
  let focused = true, viewFocused = true, failSave = false, installed = false, useWaiter, overlayFailure, overlayWait;
  let editing = false, editingWait;
  let releaseWaiter;
  const rootCalls = [];
  const rootFrame = {
    url: 'https://play.games.dmm.com/game/aigisc', isDestroyed() { return false; },
    async executeJavaScript(code) { rootCalls.push(code); return editingWait ? await editingWait : editing; },
  };
  const window = {
    isDestroyed() { return false; }, isFocused() { return focused; }, getContentSize() { return [1320, 760]; },
    contentView: { addChildView() {} }, webContents: { id: 1, focus() {} },
  };
  const overlay = {
    setBounds() {}, setVisible(visible) { this.visible = visible; },
    webContents: {
      id: 2, isDestroyed() { return false; }, focus() {},
      send(channel, config) { if (channel === 'native-overlay:state') dialogs.push({ config }); },
    },
  };
  const view = { webContents: {
    isDestroyed() { return false; }, isFocused() { return viewFocused; },
    focusedFrame: rootFrame, mainFrame: rootFrame,
  } };
  const frame = {
    url: 'https://drc1bk94f7rq8.cloudfront.net/00/html/aigis_all.html', isDestroyed() { return false; },
    async executeJavaScript(code) {
      calls.push(code);
      if (driver) return vm.runInContext(code, driver.context);
      if (code === clicker) { const fresh = !installed; installed = true; return { installed: true, fresh }; }
      if (code.includes('waitForFirstUse')) { useWaiter = deferred(); return useWaiter.promise; }
      if (code.includes('waitForKeyboardRelease')) {
        releaseWaiter?.resolve({ released: false });
        releaseWaiter = deferred(); return releaseWaiter.promise;
      }
      if (code.includes('setKeyboardHeld(false)') || code.includes('.stop()')) releaseWaiter?.resolve({ released: true });
      if (code.includes('const element = document.activeElement')) return false;
      if (code.includes('.configure(') && (!context.currentConfig.clicker.enabled || context.currentConfig.clicker.acknowledged)) {
        useWaiter?.resolve({ requested: false, disposed: false });
      }
      return { installed: true };
    },
  };
  const context = vm.createContext({
    URL, AbortController, defaultConfig,
    mainWindow: window, gameView: view, currentConfig: defaultConfig(),
    gameContentReady: true, gameContentEpoch: 0, gameViewLoadingMasked: false,
    gameViewFallbackHidden: false, overlayState: null, overlayView: overlay, gameClickerSource: clicker,
    clickerFrames: new Map(), clickerPointerHeld: false, clickerKeyHeld: false, clickerKeyActive: false, clickerKeySequence: 0,
    clickerWarningTask: null, clickerWarningAbort: null, clickerWarningRespond: null,
    normalizeZoomFactor() { return 1; }, normalizeScrollLevel() { return 5; },
    normalizeLanguage() { return 'auto'; }, normalizeCustomUrl() { return ''; },
    normalizeTelemetryConsent(value) { return value ?? null; }, isValidInstallationId() { return false; },
    appText(key) { return key === 'clickerAllow' ? '允许' : '不允许'; },
    effectiveLanguage() { return 'zh'; }, trustedGameNewsUrl(url) { return url || ''; },
    isGameUrl: isAdaptedPage,
    sendToRenderer(channel, state) { messages.push({ channel, state }); },
    store: { save(config) { if (failSave) throw new Error('fixture save failure'); saved.push(JSON.parse(JSON.stringify(config))); } },
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
  });
  context.currentConfig.clicker = { ...context.currentConfig.clicker, ...options };
  vm.runInContext([
    section(main, 'const CLICKER_WARNING =', 'const APP_TEXT ='),
    section(main, 'function isGameContentFrame(', 'function createWindow('),
    section(main, 'function isGameContainerFrame(', 'function focusGameContainer('),
    section(main, 'function normalizeConfig(', 'function normalizeZoomFactor('),
    section(main, 'function normalizeOverlayState(', 'function resolveUpdatePrompt('),
    section(main, 'function getPublicClickerState(', 'function sendToRenderer('),
    section(main, "ipcMain.handle('native-overlay:open'", "ipcMain.handle('sidebar:transition-start'"),
    section(main, "ipcMain.handle('clicker:settings'", "ipcMain.handle('telemetry:consent'"),
  ].join('\n'), context);
  context.ensureOverlayView = async () => {
    if (overlayFailure) { const error = overlayFailure; overlayFailure = null; throw error; }
    if (overlayWait) await overlayWait;
    return true;
  };
  return {
    context, frame, rootFrame, rootCalls, calls, dialogs, saved, messages,
    async ready() { await context.installGameClicker(frame); },
    async turn() { await new Promise(setImmediate); },
    invoke(channel, value, sender = 1) { return handlers.get(channel)({ sender: { id: sender } }, value); },
    respond(action, sender = 2) { return handlers.get('native-overlay:clicker-respond')({ sender: { id: sender } }, action); },
    keyboardFirstUse() { useWaiter.resolve({ requested: true, disposed: false }); },
    focus(value) { focused = value; }, failSave(value) { failSave = value; },
    failOverlay(error) { overlayFailure = error; }, waitOverlay(promise) { overlayWait = promise; },
    viewFocus(value) { viewFocused = value; }, editRoot(value) { editing = value; },
    waitEditing(promise) { editingWait = promise; },
    key(type = 'keyDown', values = {}) {
      context.handleGameClickerKey({ type, code: context.currentConfig.clicker.keyCode, key: 'b', ...values });
    },
  };
}

function ui(n) {
  const nodes = new Map(), windowListeners = new Map(), documentListeners = new Map(), requests = [], errors = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, disabled: false, value: '5', textContent: '', checked: true, listeners: new Map(),
      attributes: {},
      classList: {
        values: new Set(),
        toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); },
        contains(name) { return this.values.has(name); },
      },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      setPointerCapture(id) { this.captured = id; },
      setAttribute(name, value) { this.attributes[name] = value; },
      select() { this.selected = true; },
      blur() { context.document.activeElement = { tagName: 'BODY' }; this.listeners.get('blur')?.(); },
      closest() { return id === 'clicker-key' ? this : null; },
    });
    return nodes.get(id);
  }
  const context = vm.createContext({
    clickerState: null, clickerPointerHeld: false, clickerUiKeyHeld: false,
    clickerCpsEditing: false, clickerSettingsRevision: 0,
    byId: node, document: { activeElement: { tagName: 'BODY' }, addEventListener(type, listener) { documentListeners.set(type, listener); } },
    window: { addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []; listeners.push(listener); windowListeners.set(type, listeners);
    } },
    errorText(error) { return error.message; }, setRuntime(message) { errors.push(message); },
    setSettingsMessage(message) { errors.push(message); },
    api: { invoke(channel, value) {
      requests.push({ channel, value });
      if (channel === 'config:get') return Promise.resolve({ clicker: n.context.getPublicClickerState() });
      return n.invoke(channel, value);
    } },
  });
  vm.runInContext(section(sidebar, '  function renderClicker(', '  function updateTotpProgress('), context);
  context.installClickerControls();
  context.renderClicker(n.context.getPublicClickerState());
  function event(values = {}) { return { code: 'KeyB', key: 'b', isTrusted: true, button: 0, pointerId: 7,
    target: {}, preventDefault() {}, stopPropagation() {}, ...values }; }
  return {
    context, node, requests, errors,
    emit(id, type, values) {
      if (type === 'focus') context.document.activeElement = node(id);
      return node(id).listeners.get(type).call(node(id), event(values));
    },
    windowEvent(type, values) { for (const listener of windowListeners.get(type)) listener(event(values)); },
    documentEvent(type, values) { return documentListeners.get(type)(event(values)); },
  };
}

test('shows one first-use warning, sends no hold command before consent, and does not start on acknowledgement', async () => {
  const n = native(); await n.ready();
  const first = n.invoke('clicker:hold', true), second = n.invoke('clicker:hold', true);
  await n.turn();
  assert.equal(n.dialogs.length, 1);
  assert.equal(n.dialogs[0].config.body, '剧情跳过功能实现方式为在游戏中进行的随机散布自动点击, 可能会有一定的风险, 请谨慎考虑后使用. 此功能可在设置页彻底关闭.');
  assert.equal(n.dialogs[0].config.kind, 'clicker-consent');
  assert.equal(n.dialogs[0].config.closeLabel, '不允许');
  assert.equal(n.dialogs[0].config.visitLabel, '允许');
  assert.ok(!n.calls.some(code => code.includes('setPointerHeld(true)')));
  n.respond('allow'); const [state] = await Promise.all([first, second]);
  assert.equal(state.available, true);
  assert.equal(n.context.overlayState, null);
  assert.equal(n.saved[0].clicker.acknowledged, true);
  assert.ok(!n.calls.some(code => code.includes('setPointerHeld(true)')));
  await n.invoke('clicker:hold', true);
  assert.ok(n.calls.some(code => code.includes('setPointerHeld(true)')));
  await n.invoke('clicker:hold', false);
});

async function integratedClicker() {
  const context = vm.createContext({ vm, source: clicker });
  vm.runInContext(section(driverFixture, 'function game(', "\ntest('"), context);
  const driver = context.game(), n = native({ acknowledged: true }, driver);
  await n.ready();
  n.context.gameView.webContents.focusedFrame = n.frame;
  return { n, driver, u: ui(n) };
}

test('releases host keyboard feedback when the game frame blurs, edits, resizes or hides while its owner window stays focused', async () => {
  for (const reason of ['blur', 'editor', 'resize', 'hidden']) {
    const { n, driver, u } = await integratedClicker();
    n.key(); driver.key('keydown'); await n.turn(); u.context.renderClicker(n.context.getPublicClickerState());
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
    if (reason === 'blur') {
      n.context.gameView.webContents.focusedFrame = n.rootFrame; driver.emit('blur');
    } else if (reason === 'editor') {
      driver.document.activeElement = { tagName: 'INPUT' };
      driver.documentEvent('focusin', { target: driver.document.activeElement });
    } else if (reason === 'resize') driver.emit('resize');
    else { driver.document.visibilityState = 'hidden'; driver.documentEvent('visibilitychange'); }
    await n.turn(); u.context.renderClicker(n.messages.at(-1).state);
    assert.equal(n.context.mainWindow.isFocused(), true);
    assert.equal(n.context.clickerKeyActive, false);
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
    assert.equal(driver.pending, 0);
    const downs = driver.downs.length; driver.advance(1000);
    assert.equal(driver.downs.length, downs);
    assert.equal(n.saved.length, 0);
  }
});

test('keeps an independent pointer hold active when frame blur releases the native keyboard source', async () => {
  const { n, driver, u } = await integratedClicker();
  n.key(); driver.key('keydown'); await n.turn(); u.context.renderClicker(n.context.getPublicClickerState());
  u.emit('btn-story-skip', 'pointerdown'); await n.turn();
  n.context.gameView.webContents.focusedFrame = n.rootFrame; driver.emit('blur'); await n.turn();
  u.context.renderClicker(n.messages.at(-1).state);
  assert.equal(n.context.clickerKeyActive, false);
  assert.equal(n.context.clickerPointerHeld, true);
  assert.equal(driver.pending, 1);
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
  u.emit('btn-story-skip', 'pointerup'); await n.turn();
  assert.equal(driver.pending, 0);
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
});

test('ignores a previous frame release response after a fresh native hold has started', async () => {
  const { n, driver } = await integratedClicker(); const delayed = deferred();
  const execute = n.frame.executeJavaScript; let releaseRequests = 0;
  n.frame.executeJavaScript = async code => {
    const result = await execute.call(n.frame, code);
    if (code.includes('waitForKeyboardRelease') && ++releaseRequests === 1) await delayed.promise;
    return result;
  };
  n.key(); driver.key('keydown'); await n.turn();
  n.key('keyUp'); driver.key('keyup'); await n.turn();
  n.key(); driver.key('keydown'); await n.turn();
  delayed.resolve(); await n.turn();
  assert.equal(n.context.clickerKeyHeld, true);
  assert.equal(n.context.clickerKeyActive, true);
  assert.equal(driver.pending, 1);
  n.key('keyUp'); driver.key('keyup'); await n.turn();
  assert.equal(driver.pending, 0);
});

test('clears a held keyboard on expected frame disposal without displaying a navigation error', async () => {
  for (const rejects of [false, true]) {
    const { n, driver } = await integratedClicker(); const execute = n.frame.executeJavaScript;
    n.frame.executeJavaScript = async code => {
      const result = await execute.call(n.frame, code);
      if (rejects && code.includes('waitForKeyboardRelease')) throw new Error('fixture disposed context');
      return result;
    };
    n.key(); driver.key('keydown'); await n.turn();
    n.frame.isDestroyed = () => true; driver.emit('pagehide'); await n.turn();
    assert.equal(n.context.clickerKeyActive, false);
    assert.equal(n.messages.some(message => message.channel === 'browser:error'), false);
    assert.equal(driver.pending, 0);
  }
});

test('routes a game-frame B request to the same platform warning and retries after an overlay failure', async () => {
  const n = native(); await n.ready();
  n.failOverlay(new Error('fixture dialog failure'));
  n.keyboardFirstUse(); await n.turn();
  assert.equal(n.dialogs.length, 0);
  assert.equal(n.messages.at(-1).channel, 'browser:error');
  n.keyboardFirstUse(); await n.turn(); assert.equal(n.dialogs.length, 1);
  n.respond('allow'); await n.turn();
  assert.equal(n.context.currentConfig.clicker.acknowledged, true);
});

test('persists denial, hides the button, restores B, and warns again after re-enabling an unacknowledged feature', async () => {
  const n = native(); await n.ready(); const u = ui(n);
  const first = n.invoke('clicker:hold', true); await n.turn(); n.respond('deny');
  u.context.renderClicker(await first);
  assert.equal(u.node('btn-story-skip').hidden, true);
  assert.equal(n.saved.at(-1).clicker.enabled, false);
  u.windowEvent('keydown'); assert.equal(u.requests.length, 0);
  u.context.renderClicker(await n.invoke('clicker:settings', { enabled: true }));
  assert.equal(u.node('btn-story-skip').hidden, false);
  const again = n.invoke('clicker:hold', true);
  await n.turn(); assert.equal(n.dialogs.length, 2); n.respond('allow'); await again;
});

test('saves CPS on change rather than every drag input and keeps the preview during unrelated state updates', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  for (let value = 6; value <= 10; value++) {
    u.node('clicker-cps').value = String(value); u.emit('clicker-cps', 'input');
  }
  assert.equal(u.requests.length, 0); assert.equal(u.node('clicker-cps-value').textContent, '10');
  u.context.renderClicker(n.context.getPublicClickerState()); assert.equal(u.node('clicker-cps').value, '10');
  u.emit('clicker-cps', 'change'); await n.turn();
  assert.equal(n.saved.length, 1); assert.equal(n.saved[0].clicker.cps, 10);
});

test('handles long pointer holds, cancellation and B in the client UI without multiplying held inputs', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  u.emit('btn-story-skip', 'pointerdown'); await n.turn();
  assert.equal(u.node('btn-story-skip').captured, 7);
  u.windowEvent('keydown'); await n.turn();
  u.emit('btn-story-skip', 'pointerup'); await n.turn();
  assert.equal(u.requests.at(-1).value, true);
  u.windowEvent('keyup'); await n.turn(); assert.equal(u.requests.at(-1).value, false);
  u.emit('btn-story-skip', 'pointerdown'); u.emit('btn-story-skip', 'lostpointercapture'); await n.turn();
  assert.equal(u.requests.at(-1).value, false);
});

test('clears the original UI hold on acknowledgement and immediately disables the binding when switching off', async () => {
  const n = native(); await n.ready(); const u = ui(n);
  u.windowEvent('keydown'); await n.turn(); n.respond('allow'); await n.turn();
  assert.equal(u.context.clickerUiKeyHeld, false);
  assert.ok(!n.calls.some(code => code.includes('setPointerHeld(true)')));
  u.node('clicker-enabled').checked = false; u.emit('clicker-enabled', 'change');
  const count = u.requests.length; u.windowEvent('keydown');
  assert.equal(u.requests.length, count); assert.equal(u.node('btn-story-skip').hidden, true);
  await n.turn();
});

test('releases a B hold on entering an editor and leaves subsequent typing untouched', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  u.windowEvent('keydown'); await n.turn();
  const input = { closest() { return this; } };
  u.context.document.activeElement = input;
  u.documentEvent('focusin', { target: input }); await n.turn();
  assert.equal(u.requests.at(-1).value, false);
  const count = u.requests.length;
  u.windowEvent('keydown', { target: input });
  assert.equal(u.requests.length, count);
});

test('rejects other senders, ignores acknowledgement supplied by the UI, and normalizes legacy settings', async () => {
  const n = native(); await n.ready();
  assert.equal(await n.invoke('clicker:hold', true, 999), null);
  assert.equal(await n.invoke('clicker:settings', { enabled: false }, 999), null);
  assert.equal(await n.invoke('clicker:settings', 'invalid'), null);
  assert.equal(await n.invoke('clicker:settings', []), null);
  assert.equal(n.dialogs.length, 0); assert.equal(n.saved.length, 0);
  const state = await n.invoke('clicker:settings', { cps: 999, acknowledged: true });
  assert.equal(state.cps, 10); assert.equal(state.acknowledged, false);
  const original = n.context.normalizeConfig({});
  assert.deepEqual(JSON.parse(JSON.stringify(original.clicker)), { enabled: true, cps: 10, keyCode: 'KeyB', acknowledged: false });
  assert.equal(n.context.normalizeConfig({ clicker: { cps: 15 } }).clicker.cps, 10);
});

test('forwards a bound key from the outer DMM page once and releases it without involving pointer holds', async () => {
  const n = native({ acknowledged: true }); await n.ready();
  n.viewFocus(false);
  n.key(); await n.turn();
  assert.equal(n.rootCalls.length, 1);
  assert.equal(n.calls.filter(code => code.includes('setKeyboardHeld(true)')).length, 1);
  for (let i = 0; i < 20; i++) n.key('keyDown', { isAutoRepeat: true });
  assert.equal(n.rootCalls.length, 1);
  await n.invoke('clicker:hold', true);
  n.key('keyUp'); await n.turn();
  assert.ok(n.calls.at(-1).includes('setKeyboardHeld(false)'));
  assert.equal(n.context.clickerPointerHeld, true);
  assert.equal(n.context.clickerKeyHeld, false);
});

test('cancels pending native key forwarding on quick release, blur, resize, navigation, and rebinding', async () => {
  for (const interrupt of [
    n => n.key('keyUp'), n => n.context.releaseGameClickerKey(),
    n => n.context.stopGameClicker(),
    n => { n.context.gameContentEpoch++; },
    n => { n.rootFrame.url = 'https://accounts.dmm.com/'; },
    n => {
      n.context.gameView.webContents.isDestroyed = () => true;
      Object.defineProperty(n.context.gameView.webContents, 'focusedFrame', {
        get() { throw new Error('fixture destroyed contents'); },
      });
    },
    n => n.invoke('clicker:settings', { keyCode: 'KeyC' }),
  ]) {
    const n = native({ acknowledged: true }); await n.ready(); const check = deferred(); n.waitEditing(check.promise);
    n.key(); await interrupt(n); check.resolve(false); await n.turn();
    assert.ok(!n.calls.some(code => code.includes('setKeyboardHeld(true)')));
  }
});

test('does not forward keys from editors, other embedded origins, shortcuts, IME or a background window', async () => {
  for (const setup of [
    n => n.editRoot(true), n => n.focus(false),
    n => { n.context.gameView.webContents.focusedFrame = { url: 'https://example.test/', isDestroyed() { return false; } }; },
  ]) {
    const n = native({ acknowledged: true }); await n.ready(); setup(n); n.key(); await n.turn();
    assert.ok(!n.calls.some(code => code.includes('setKeyboardHeld(true)')));
  }
  for (const values of [{ control: true }, { meta: true }, { alt: true }, { isComposing: true }, { code: 'KeyC' }]) {
    const n = native({ acknowledged: true }); await n.ready(); n.key('keyDown', values); await n.turn();
    assert.equal(n.rootCalls.length, 0);
  }
});

test('forwards keys from osapi containers, leaves focused game DOM keys alone, and gates the first forwarded use', async () => {
  const n = native({ acknowledged: true }); await n.ready();
  n.rootFrame.url = 'https://osapi.dmm.com/gadgets/ifr'; n.key(); await n.turn();
  assert.ok(n.calls.some(code => code.includes('setKeyboardHeld(true)')));
  n.key('keyUp'); const calls = n.calls.length;
  n.context.gameView.webContents.focusedFrame = n.frame; n.key(); await n.turn();
  assert.ok(!n.calls.slice(calls).some(code => code.includes('setKeyboardHeld(true)')));
  const first = native(); await first.ready(); first.key(); await first.turn();
  assert.equal(first.dialogs.length, 1);
  assert.ok(!first.calls.some(code => code.includes('setKeyboardHeld(true)')));
  first.respond('allow'); await first.turn();
  assert.ok(!first.calls.some(code => code.includes('setKeyboardHeld(true)')));
  first.key('keyDown', { isAutoRepeat: true }); await first.turn();
  assert.ok(!first.calls.some(code => code.includes('setKeyboardHeld(true)')));
  first.key('keyUp'); first.key(); await first.turn();
  assert.ok(first.calls.some(code => code.includes('setKeyboardHeld(true)')));
});

test('validates and persists bindings while retaining legacy defaults and updating the warning title', async () => {
  const n = native(); await n.ready();
  for (const keyCode of ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F12']) {
    assert.equal((await n.invoke('clicker:settings', { keyCode })).keyCode, keyCode);
  }
  const saved = n.saved.length;
  for (const keyCode of ['Escape', 'F13', 'ControlLeft', 'Ctrl+B', 'Keya', null, 42]) {
    assert.equal(await n.invoke('clicker:settings', { keyCode }), null);
  }
  assert.equal(n.saved.length, saved);
  assert.equal(n.context.normalizeConfig({ clicker: { keyCode: 'invalid' } }).clicker.keyCode, 'KeyB');
  const pending = n.invoke('clicker:hold', true); await n.turn();
  assert.equal(n.dialogs.at(-1).config.title, '跳过剧情[F12]');
  n.respond('deny'); await pending;
});

test('captures one key, saves immediately, updates displayed bindings, and exits without starting clicks', async () => {
  for (const keyCode of ['KeyC', 'Digit2', 'F12']) {
    const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
    u.emit('clicker-key', 'focus'); assert.equal(u.node('clicker-key').selected, true);
    u.emit('clicker-key', 'keydown', { code: keyCode }); await n.turn();
    assert.equal(u.requests.length, 1);
    assert.equal(u.requests[0].channel, 'clicker:settings');
    assert.equal(u.requests[0].value.keyCode, keyCode);
    const label = keyCode.replace(/^(Key|Digit)/, '');
    assert.equal(u.node('btn-story-skip').textContent, '跳过剧情[' + label + ']');
    assert.equal(u.node('clicker-setting-label').textContent, '跳过剧情[' + label + ']');
    assert.equal(u.node('btn-story-skip').attributes['aria-keyshortcuts'], label);
    assert.equal(u.node('clicker-key').value, label);
    assert.ok(!n.calls.some(code => code.includes('Held(true)')));
    u.emit('clicker-key', 'keydown', { code: 'KeyZ' });
    assert.equal(u.requests.length, 1);
  }
});

test('cancels binding capture on Escape or lost focus and leaves invalid or modified keys unsaved', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  for (const type of ['escape', 'field-blur', 'window-blur']) {
    u.emit('clicker-key', 'focus');
    if (type === 'escape') u.emit('clicker-key', 'keydown', { code: 'Escape', key: 'Escape' });
    else if (type === 'field-blur') u.emit('clicker-key', 'blur');
    else u.windowEvent('blur');
    u.emit('clicker-key', 'keydown', { code: 'KeyC' });
  }
  u.emit('clicker-key', 'focus');
  for (const values of [{ code: 'F13' }, { code: 'Space' }, { ctrlKey: true }, { metaKey: true },
    { altKey: true }, { isComposing: true }, { isTrusted: false }, { repeat: true }]) {
    u.emit('clicker-key', 'keydown', values);
  }
  assert.equal(u.requests.length, 0);
  assert.equal(u.node('clicker-key').value, 'B');
});

test('uses the new UI binding and releases a held key when the saved binding changes', async () => {
  const n = native({ acknowledged: true, keyCode: 'KeyC' }); await n.ready(); const u = ui(n);
  u.windowEvent('keydown', { code: 'KeyB' }); assert.equal(u.requests.length, 0);
  u.windowEvent('keydown', { code: 'KeyC' }); await n.turn();
  assert.equal(n.context.clickerPointerHeld, true);
  u.context.renderClicker(await n.invoke('clicker:settings', { keyCode: 'Digit2' })); await n.turn();
  assert.equal(u.context.clickerUiKeyHeld, false);
  assert.equal(n.context.clickerPointerHeld, false);
  assert.equal(u.node('btn-story-skip').textContent, '跳过剧情[2]');
});

test('shows the existing pressed style immediately for UI keys and pointer holds until both sources release', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  const button = u.node('btn-story-skip');
  u.windowEvent('keydown');
  assert.equal(button.classList.contains('clicker-held'), true);
  await n.turn();
  u.emit('btn-story-skip', 'pointerdown'); await n.turn();
  u.windowEvent('keyup');
  assert.equal(button.classList.contains('clicker-held'), true);
  u.emit('btn-story-skip', 'pointerup');
  assert.equal(button.classList.contains('clicker-held'), false);
  await n.turn();
  assert.equal(n.context.clickerPointerHeld, false);
  assert.equal(n.saved.length, 0);
});

test('publishes native keyboard holds without saving them and keeps a pointer press visible after native key release', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  n.key(); await n.turn();
  assert.equal(n.messages.at(-1).channel, 'clicker:state');
  assert.equal(n.messages.at(-1).state.keyboardHeld, true);
  u.context.renderClicker(n.messages.at(-1).state);
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
  u.emit('btn-story-skip', 'pointerdown'); await n.turn();
  n.key('keyUp'); u.context.renderClicker(n.messages.at(-1).state);
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
  u.emit('btn-story-skip', 'pointerup'); await n.turn();
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
  assert.equal(n.saved.length, 0);
  assert.equal(Object.hasOwn(n.context.currentConfig.clicker, 'keyboardHeld'), false);
});

test('clears pressed styles and UI holds on a forced stop, window blur, or entering an editor', async () => {
  for (const interrupt of ['stop', 'blur', 'editor']) {
    const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
    u.windowEvent('keydown'); await n.turn();
    if (interrupt === 'stop') {
      n.context.stopGameClicker(true);
      assert.equal(n.messages.at(-1).state.resetHolds, true);
      u.context.renderClicker(n.messages.at(-1).state);
    } else if (interrupt === 'blur') u.windowEvent('blur');
    else u.documentEvent('focusin', { target: { closest() { return this; } } });
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
    assert.equal(u.context.clickerUiKeyHeld, false);
    await n.turn();
    assert.equal(n.context.clickerPointerHeld, false);
    u.windowEvent('keydown', { repeat: true });
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
  }
});

test('clears native pressed feedback on blur, rebinding, disabling, and popup opening', async () => {
  for (const interrupt of ['blur', 'binding', 'disable', 'popup']) {
    const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
    n.key(); await n.turn(); u.context.renderClicker(n.messages.at(-1).state);
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
    if (interrupt === 'blur') n.context.stopGameClicker(true);
    else if (interrupt === 'binding') await n.invoke('clicker:settings', { keyCode: 'KeyC' });
    else if (interrupt === 'disable') await n.invoke('clicker:settings', { enabled: false });
    else await n.context.showOverlay({ kind: 'game-news' });
    u.context.renderClicker(n.messages.at(-1).state);
    assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
    assert.equal(n.context.clickerKeyActive, false);
  }
});

test('validates focused game input before publishing pressed feedback and leaves its DOM click source unchanged', async () => {
  const n = native({ acknowledged: true }); await n.ready();
  n.context.gameView.webContents.focusedFrame = n.frame;
  n.key(); await n.turn();
  assert.equal(n.messages.at(-1).state.keyboardHeld, true);
  assert.ok(!n.calls.some(code => code.includes('setKeyboardHeld(true)')));
  n.key('keyUp');
  const original = n.frame.executeJavaScript;
  n.frame.executeJavaScript = (code) => code.includes('const element = document.activeElement')
    ? Promise.resolve(true) : original.call(n.frame, code);
  n.key(); await n.turn();
  assert.equal(n.messages.at(-1).state.keyboardHeld, false);
  const count = n.messages.length;
  for (let i = 0; i < 100; i++) n.context.stopGameClicker();
  assert.equal(n.messages.length, count);
});

test('does not show a held keyboard style during the first-use warning or resume it after allowing', async () => {
  const n = native(); await n.ready(); const u = ui(n);
  u.windowEvent('keydown'); await n.turn();
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
  n.respond('allow'); await n.turn();
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), false);
  u.windowEvent('keydown'); await n.turn();
  assert.equal(u.node('btn-story-skip').classList.contains('clicker-held'), true);
});

test('does not write a cancelled warning after navigation and stops without per-resize calls while idle', async () => {
  const n = native(); await n.ready();
  const pending = n.invoke('clicker:hold', true);
  await n.turn();
  n.context.gameContentEpoch++; n.context.clickerWarningAbort.abort();
  await pending;
  assert.equal(n.context.overlayState, null);
  assert.equal(n.saved.length, 0); assert.equal(n.context.currentConfig.clicker.enabled, true);
  const before = n.calls.length;
  for (let i = 0; i < 100; i++) n.context.stopGameClicker();
  assert.equal(n.calls.length, before);
});

test('accepts a warning response only once from the owned overlay and cannot create consent through public overlay IPC', async () => {
  const n = native(); await n.ready();
  assert.equal(await n.invoke('native-overlay:open', { kind: 'clicker-consent' }), false);
  assert.equal(await n.invoke('native-overlay:update', { kind: 'clicker-consent' }), false);
  assert.equal(n.respond('allow'), false);
  const pending = n.invoke('clicker:hold', true); await n.turn();
  assert.equal(n.respond('allow', 1), false);
  assert.equal(n.respond('allow', 999), false);
  assert.equal(n.respond('invalid'), false);
  assert.equal(await n.invoke('native-overlay:close', undefined, 2), false);
  assert.equal(await n.invoke('native-overlay:update', { kind: 'game-news' }), false);
  assert.equal(n.saved.length, 0);
  assert.equal(n.respond('allow'), true);
  assert.equal(n.respond('deny'), false);
  await pending;
  assert.equal(n.saved.length, 1);
  assert.equal(n.respond('allow'), false);
});

test('does not show or save a warning cancelled while the shared overlay is loading', async () => {
  const n = native(); await n.ready(); const loading = deferred(); n.waitOverlay(loading.promise);
  const pending = n.invoke('clicker:hold', true);
  n.context.gameContentEpoch++; n.context.clickerWarningAbort.abort();
  loading.resolve(); await pending;
  assert.equal(n.dialogs.length, 0); assert.equal(n.saved.length, 0);
  assert.equal(n.context.clickerWarningRespond, null);
  assert.equal(n.context.overlayState, null);
});

test('cancels a replaced warning without saving consent and preserves the new shared popup', async () => {
  const n = native(); await n.ready();
  const pending = n.invoke('clicker:hold', true); await n.turn();
  await n.context.showOverlay({ kind: 'game-news', title: 'fixture news', body: 'fixture body' });
  await pending;
  assert.equal(n.saved.length, 0);
  assert.equal(n.context.currentConfig.clicker.enabled, true);
  assert.equal(n.context.currentConfig.clicker.acknowledged, false);
  assert.equal(n.context.overlayState.kind, 'game-news');
  assert.equal(n.respond('allow'), false);
  n.context.closeOverlay(); await n.turn();
  assert.equal(n.messages.at(-1).state.available, true);
  assert.ok(!n.calls.some(code => code.includes('setPointerHeld(true)')));
});

test('closes a denied warning and keeps the session disabled when persistence fails', async () => {
  const n = native(); await n.ready(); n.failSave(true);
  const pending = n.invoke('clicker:hold', true); await n.turn(); n.respond('deny');
  await assert.rejects(pending, /fixture save failure/);
  assert.equal(n.context.overlayState, null);
  assert.equal(n.context.currentConfig.clicker.enabled, false);
  assert.equal(n.context.clickerWarningTask, null);
});

function overlayUi() {
  const nodes = new Map(), calls = [];
  let onState;
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      open: false, hidden: false, disabled: false, textContent: '', listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; },
      getBoundingClientRect() { return { left: 100, top: 100, right: 600, bottom: 400 }; },
    });
    return nodes.get(id);
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ui/native-overlay.js'), 'utf8'), {
    document: { getElementById: node, querySelector: node, documentElement: {} },
    setTimeout(callback) { callback(); },
    window: { mtAigisOverlay: {
      onState(listener) { onState = listener; },
      respondClicker(action) { calls.push(['clicker', action]); },
      respondUpdate(action) { calls.push(['update', action]); },
      close() { calls.push(['close']); }, openExternal(url) { calls.push(['external', url]); },
    } },
  });
  return { node, calls, state: onState,
    emit(id, type, event = {}) { node(id).listeners.get(type)({ preventDefault() {}, ...event }); },
  };
}

test('reuses the platform dialog, focuses deny, ignores backdrop clicks, and treats Escape as denial', () => {
  const u = overlayUi();
  u.state({ kind: 'clicker-consent', title: '跳过剧情[B]', body: 'fixture warning', closeLabel: '不允许', visitLabel: '允许' });
  assert.equal(u.node('native-overlay-dialog').open, true);
  assert.equal(u.node('native-overlay-close').focused, true);
  assert.equal(u.node('native-overlay-title').textContent, '跳过剧情[B]');
  assert.equal(u.node('native-overlay-kicker').hidden, true);
  assert.equal(u.node('native-overlay-date').hidden, true);
  assert.equal(u.node('native-overlay-open').disabled, false);
  u.emit('native-overlay-dialog', 'click', { clientX: 10, clientY: 10 });
  assert.equal(u.calls.length, 0);
  u.emit('native-overlay-dialog', 'cancel');
  assert.deepEqual(u.calls, [['clicker', 'deny']]);
  assert.equal(u.node('native-overlay-dialog').open, false);
});

test('routes allow and deny separately while retaining the update and news popup controls', () => {
  const u = overlayUi();
  u.state({ kind: 'clicker-consent' }); u.emit('native-overlay-open', 'click');
  u.state({ kind: 'clicker-consent' }); u.emit('native-overlay-close', 'click');
  u.state({ kind: 'app-update', kicker: 'fixture update', date: '1.2.0' });
  assert.equal(u.node('native-overlay-kicker').hidden, false);
  assert.equal(u.node('native-overlay-date').hidden, false);
  u.emit('native-overlay-open', 'click');
  u.state({ kind: 'game-news', url: 'https://example.test/news' }); u.emit('native-overlay-open', 'click');
  u.emit('native-overlay-dialog', 'click', { clientX: 10, clientY: 10 });
  assert.deepEqual(u.calls, [['clicker', 'allow'], ['clicker', 'deny'], ['update', 'install'],
    ['external', 'https://example.test/news'], ['close']]);
});

test('keeps the feature off for the current session when saving fails and uses the existing error channel', async () => {
  const n = native({ acknowledged: true }); await n.ready(); const u = ui(n);
  n.failSave(true);
  u.node('clicker-enabled').checked = false; u.emit('clicker-enabled', 'change'); await n.turn();
  assert.equal(n.context.currentConfig.clicker.enabled, false);
  assert.equal(u.node('btn-story-skip').hidden, true);
  assert.equal(u.errors[0], 'fixture save failure');
});

test('never reads a destroyed frame URL or sends it a stop command', async () => {
  const n = native({ acknowledged: true }); await n.ready();
  n.frame.isDestroyed = () => true;
  Object.defineProperty(n.frame, 'url', { get() { throw new Error('fixture destroyed frame'); } });
  const calls = n.calls.length;
  assert.doesNotThrow(() => n.context.stopGameClicker(true));
  await n.context.syncGameClicker();
  assert.equal(n.calls.length, calls);
  assert.equal(n.context.getPublicClickerState().available, false);
});

test('stops child-frame navigation using Electron navigation details and discards its clicker entry', async () => {
  const n = native({ acknowledged: true }); await n.ready();
  let navigation;
  n.context.gameView.webContents.on = (_event, handler) => { navigation = handler; };
  vm.runInContext(section(main, "  gameView.webContents.on('did-start-navigation'", '  gameView.webContents.setZoomFactor('), n.context);
  await n.invoke('clicker:hold', true);
  navigation({ isMainFrame: false, isSameDocument: false, frame: n.frame, url: 'https://example.test/' },
    'https://example.test/', false, false);
  assert.equal(n.context.clickerFrames.size, 0);
  assert.equal(n.context.clickerPointerHeld, false);
  assert.ok(n.calls.some(code => code.includes('.stop()')));
});

test('uses the approved button and settings labels, native slider bounds, and retains the mute control', () => {
  const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
  assert.match(html, /id="btn-story-skip"[^>]*aria-keyshortcuts="B"[^>]*>跳过剧情\[B\]</);
  assert.match(html, /id="clicker-cps"[^>]*min="1"[^>]*max="10"[^>]*step="1"[^>]*value="10"/);
  assert.match(html, /id="btn-mute"/);
  assert.match(html, /for="clicker-enabled">跳过剧情\[B\]</);
  assert.match(html, /for="clicker-cps">CPS</);
});
