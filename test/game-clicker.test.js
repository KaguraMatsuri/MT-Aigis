const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'resources/game-clicker.js'), 'utf8');

function game(options = {}) {
  let now = 0, nextId = 0, reads = 0;
  const timers = new Map(), events = [], windowListeners = new Map(), documentListeners = new Map();
  const body = { tagName: 'BODY', closest() { return null; } };
  function add(map, type, listener) { const list = map.get(type) || []; list.push(listener); map.set(type, list); }
  const canvas = {
    tagName: 'CANVAS', isConnected: true, width: 1920, height: 1280,
    getBoundingClientRect() { reads++; return { left: 0, top: 0, width: 960, height: 640 }; },
    dispatchEvent(event) { events.push({ ...event, at: now }); return true; },
  };
  const document = {
    activeElement: body, visibilityState: 'visible',
    getElementById() { return canvas; }, elementFromPoint() { return canvas; },
    addEventListener(type, listener) { add(documentListeners, type, listener); },
  };
  const window = {
    addEventListener(type, listener) { add(windowListeners, type, listener); },
    removeEventListener(type, listener) { windowListeners.set(type, (windowListeners.get(type) || []).filter(fn => fn !== listener)); },
  };
  const context = vm.createContext({
    window, document, Module: { canvas }, performance: { now: () => now }, Math,
    MouseEvent: class { constructor(type, values) { this.type = type; Object.assign(this, values); } },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context);
  const api = window.__MT_AIGIS_CLICKER__;
  api.configure({ enabled: true, acknowledged: true, active: true, cps: 5, ...options });
  function emit(map, type, values) {
    let prevented = false;
    const event = { code: 'KeyB', key: 'b', isTrusted: true, target: body,
      preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...values };
    for (const listener of [...map.get(type) || []]) listener(event);
    return prevented;
  }
  return {
    api, canvas, context, document, events, window,
    key(type, values) { return emit(windowListeners, type, values); },
    emit(type, values) { return emit(windowListeners, type, values); },
    documentEvent(type, values) { return emit(documentListeners, type, values); },
    get pending() { return timers.size; }, get reads() { return reads; },
    get downs() { return events.filter(event => event.type === 'mousedown'); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = end;
    },
  };
}

test('emits complete left-button clicks at five CPS inside the central circle using CSS coordinates', () => {
  const h = game();
  assert.equal(h.key('keydown'), true);
  h.advance(999);
  assert.equal(h.downs.length, 5);
  assert.equal(h.reads, 1);
  assert.equal(h.pending, 1);
  for (let i = 0; i < h.events.length; i += 3) {
    const [move, down, up] = h.events.slice(i, i + 3);
    assert.equal(move.type, 'mousemove'); assert.equal(down.type, 'mousedown'); assert.equal(up.type, 'mouseup');
    assert.equal(down.buttons, 1); assert.equal(up.buttons, 0); assert.equal(down.button, 0);
    assert.equal(down.clientX, up.clientX); assert.equal(down.clientY, up.clientY);
    assert.equal(up.at - down.at, 50);
    assert.ok(Math.hypot(down.clientX - 480, down.clientY - 320) <= 32);
    assert.equal(down.bubbles, true); assert.equal(down.cancelable, true);
  }
  assert.ok(new Set(h.downs.map(event => event.clientX)).size > 1);
  h.key('keyup'); assert.equal(h.pending, 0);
  h.advance(1000); assert.equal(h.downs.length, 5);
});

test('enforces every CPS setting, avoids catch-up batches, and bounds the scheduled work to one timer', () => {
  for (let cps = 1; cps <= 10; cps++) {
    const h = game({ cps }); h.api.setPointerHeld(true);
    h.advance(999);
    assert.ok(h.downs.length <= cps);
    assert.ok(h.downs.length >= cps - 1);
    assert.ok(h.pending <= 1);
    h.api.setPointerHeld(false); assert.equal(h.pending, 0);
  }
  const h = game({ cps: 100 }); h.api.setPointerHeld(true); h.advance(999);
  assert.equal(h.downs.length, 10);
});

test('shares one loop for keyboard and pointer holds, ignores key repeat, and releases a partially held click', () => {
  const h = game(); h.key('keydown'); h.api.setPointerHeld(true);
  for (let i = 0; i < 10; i++) h.key('keydown', { repeat: true });
  h.advance(10); h.key('keyup');
  assert.equal(h.events.filter(event => event.type === 'mouseup').length, 0);
  h.api.setPointerHeld(false);
  assert.equal(h.events.at(-1).type, 'mouseup');
  assert.equal(h.events.at(-1).at, 10);
  assert.equal(h.pending, 0);
});

test('stops for backgrounding, text input, resize and navigation without automatically resuming', () => {
  for (const action of [
    h => h.api.configure({ enabled: true, acknowledged: true, active: false, cps: 5 }),
    h => h.documentEvent('focusin', { target: { tagName: 'INPUT' } }),
    h => h.emit('resize'), h => h.emit('pagehide'),
    h => { h.document.visibilityState = 'hidden'; h.documentEvent('visibilitychange'); },
  ]) {
    const h = game(); h.key('keydown'); h.advance(10); action(h);
    assert.equal(h.pending, 0); assert.equal(h.events.at(-1).type, 'mouseup');
    h.advance(2000); assert.equal(h.downs.length, 1);
  }
  const h = game(); h.key('keydown'); h.emit('blur'); h.key('keydown', { repeat: true });
  h.advance(1000); assert.equal(h.downs.length, 1);
});

test('blocks clicking before first acknowledgement and requires a fresh hold afterwards', async () => {
  const h = game({ acknowledged: false });
  const pending = h.api.waitForFirstUse();
  h.key('keydown'); assert.equal((await pending).requested, true);
  h.advance(1000); assert.equal(h.events.length, 0);
  h.api.configure({ enabled: true, acknowledged: true, active: true, cps: 5 });
  h.key('keydown', { repeat: true }); h.advance(1000);
  assert.equal(h.events.length, 0);
  h.key('keyup'); h.key('keydown'); assert.equal(h.downs.length, 1);
});

test('removes the B binding when disabled and never captures typing, shortcuts, IME or synthetic keys', () => {
  const h = game();
  for (const values of [{ target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } },
    { target: { isContentEditable: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { isTrusted: false }, { code: 'KeyA' }]) {
    assert.equal(h.key('keydown', values), false);
  }
  assert.equal(h.events.length, 0);
  h.api.configure({ enabled: false, acknowledged: true, active: true, cps: 5 });
  assert.equal(h.key('keydown'), false);
  h.api.setPointerHeld(true); h.advance(1000); assert.equal(h.events.length, 0);
});

test('rejects obscured, missing and detached canvases, and resolves the first-use waiter on page exit', async () => {
  const h = game(); h.document.elementFromPoint = () => ({ tagName: 'INPUT' });
  h.key('keydown'); assert.equal(h.events.length, 0); assert.equal(h.pending, 0);
  h.canvas.isConnected = false; h.key('keyup'); h.key('keydown'); assert.equal(h.events.length, 0);
  const waiting = game({ acknowledged: false });
  const pending = waiting.api.waitForFirstUse(); waiting.emit('pagehide');
  assert.equal((await pending).disposed, true);
});

test('uses the configured letter, digit or function key and stops both held sources when rebinding', () => {
  for (const keyCode of ['KeyC', 'Digit2', 'F12']) {
    const h = game({ keyCode });
    assert.equal(h.key('keydown'), false);
    assert.equal(h.key('keydown', { code: keyCode }), true);
    assert.equal(h.downs.length, 1);
    h.api.setKeyboardHeld(true);
    h.api.configure({ enabled: true, acknowledged: true, active: true, cps: 5, keyCode: 'KeyZ' });
    assert.equal(h.pending, 0);
    h.advance(1000); assert.equal(h.downs.length, 1);
    assert.equal(h.key('keydown', { code: keyCode }), false);
    assert.equal(h.key('keydown', { code: 'KeyZ' }), true);
  }
});

test('shares one timer with host keyboard, game DOM keyboard and pointer holds, and gates host input', () => {
  const h = game(); h.api.setKeyboardHeld(true); h.key('keydown'); h.api.setPointerHeld(true);
  h.advance(999); assert.equal(h.downs.length, 5); assert.equal(h.pending, 1);
  h.api.setKeyboardHeld(false); h.key('keyup');
  assert.equal(h.pending, 1);
  h.api.setPointerHeld(false); assert.equal(h.pending, 0);
  h.advance(1000); assert.equal(h.downs.length, 5);
  for (const options of [{ acknowledged: false }, { active: false }, { enabled: false }]) {
    const gated = game(options); gated.api.setKeyboardHeld(true); gated.advance(1000);
    assert.equal(gated.events.length, 0);
  }
});

test('waits for keyboard release without a timer and preserves pointer clicking on frame blur', async () => {
  const h = game();
  let resolved = false;
  const release = h.api.waitForKeyboardRelease().then(result => { resolved = true; return result; });
  await Promise.resolve();
  assert.equal(resolved, false); assert.equal(h.pending, 0);
  h.key('keydown'); h.api.setPointerHeld(true); h.emit('blur');
  assert.equal((await release).released, true);
  assert.equal(h.pending, 1);
  h.api.setPointerHeld(false); assert.equal(h.pending, 0);
});

test('reports full keyboard release after all keyboard sources release and reports stop and editable focus', async () => {
  const h = game(); h.key('keydown'); h.api.setKeyboardHeld(true);
  let resolved = false;
  const release = h.api.waitForKeyboardRelease().then(result => { resolved = true; return result; });
  h.api.setKeyboardHeld(false); await Promise.resolve();
  assert.equal(resolved, false);
  h.key('keyup'); assert.equal((await release).released, true);
  assert.equal(h.pending, 0);
  for (const action of [
    h => h.api.stop(), h => h.emit('resize'),
    h => h.documentEvent('focusin', { target: { tagName: 'INPUT' } }),
    h => { h.document.visibilityState = 'hidden'; h.documentEvent('visibilitychange'); },
  ]) {
    const g = game(); const event = g.api.waitForKeyboardRelease(); g.key('keydown'); action(g);
    assert.equal((await event).released, true); assert.equal(g.pending, 0);
  }
});

test('keeps only one release waiter, resolves it on page exit, and never adds idle scheduled work', async () => {
  const h = game();
  const first = h.api.waitForKeyboardRelease(), second = h.api.waitForKeyboardRelease();
  assert.equal((await first).released, false); assert.equal(h.pending, 0);
  h.emit('pagehide'); const result = await second;
  assert.equal(result.released, true); assert.equal(result.disposed, true);
  assert.equal((await h.api.waitForKeyboardRelease()).disposed, true);
  assert.equal(h.pending, 0);
});

module.exports = { game };
