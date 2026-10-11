const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const adapterSource = fs.readFileSync(
  path.join(__dirname, '..', 'resources', 'game-scroll.js'),
  'utf8'
);

function createStyle() {
  const values = new Map();
  const priorities = new Map();
  return {
    getPropertyPriority(property) {
      return priorities.get(property) || '';
    },
    getPropertyValue(property) {
      return values.get(property) || '';
    },
    setProperty(property, value, priority = '') {
      values.set(property, String(value));
      priorities.set(property, String(priority));
    },
  };
}

function createElement(dimensions) {
  return {
    ...dimensions,
    style: createStyle(),
    dispatchEvent() {
      return true;
    },
  };
}

function createHarness(options = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  const forwarded = [];
  let now = options.startAt ?? 1000;
  let nextTimer = 0;
  const scrollCalls = [];
  const parsedUrl = new URL(options.url || 'https://osapi.dmm.com/gadgets/ifr');
  const documentElement = createElement({
    clientWidth: 960,
    clientHeight: 640,
    scrollWidth: 970,
    scrollHeight: 8000,
  });
  const body = createElement({
    clientWidth: 960,
    clientHeight: 640,
    scrollWidth: 970,
    scrollHeight: 8000,
  });
  const canvas = createElement({});
  canvas.tagName = 'CANVAS';
  canvas.isConnected = true;
  canvas.width = options.bufferWidth ?? 1920;
  canvas.height = options.bufferHeight ?? 1280;
  let geometryReads = 0;
  canvas.getBoundingClientRect = () => {
    geometryReads++;
    return { width: options.canvasWidth ?? 960, height: options.canvasHeight ?? 640 };
  };
  const mainFrame = createElement({});
  const document = {
    body,
    documentElement,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    elementFromPoint() {
      return body;
    },
    getElementById(id) {
      if (!options.withAigisSurface) return null;
      if (id === 'canvas') return canvas;
      if (id === 'main_frame') return mainFrame;
      return null;
    },
  };
  const window = {
    document,
    addEventListener(type, listener) {
      const registered = windowListeners.get(type) || [];
      registered.push(listener);
      windowListeners.set(type, registered);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter(value => value !== listener));
    },
    scrollTo(x, y) {
      scrollCalls.push([x, y]);
    },
  };
  window.window = window;
  window.top = window;

  class WheelEvent extends Event {
    static DOM_DELTA_PIXEL = 0;
    static DOM_DELTA_LINE = 1;
    static DOM_DELTA_PAGE = 2;
    constructor(type, options = {}) {
      super(type, options);
      for (const name of ['deltaX', 'deltaY', 'deltaMode', 'clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons']) {
        this[name] = options[name] || 0;
      }
      for (const name of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) this[name] = !!options[name];
    }
  }
  body.dispatchEvent = event => {
    for (const listener of listeners.get(event.type) || []) listener(event);
    forwarded.push(event);
    return true;
  };

  function advance(milliseconds) {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].callback();
    }
    now = end;
  }

  const context = vm.createContext({
    Event,
    ...(options.moduleCanvas ? { Module: { canvas } } : {}),
    WheelEvent,
    clearTimeout(id) { timers.delete(id); },
    console,
    document,
    location: {
      href: parsedUrl.href,
      hostname: parsedUrl.hostname,
      pathname: parsedUrl.pathname,
      protocol: parsedUrl.protocol,
    },
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id;
    },
    window,
  });

  return {
    context,
    body,
    canvas,
    documentElement,
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    run() {
      return vm.runInContext(adapterSource, context);
    },
    mainFrame,
    scrollCalls,
    window,
    forwarded,
    advance,
    get pendingTimers() { return timers.size; },
    input(deltaY, values = {}) {
      let prevented = false, stopped = false;
      const event = {
        type: 'wheel', isTrusted: true, deltaY, deltaX: 0, deltaMode: 0,
        clientX: 321, clientY: 234, screenX: 500, screenY: 600,
        target: body, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
        preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; },
        ...values,
      };
      for (const listener of listeners.get(event.type) || []) listener(event);
      return { prevented, stopped };
    },
    pagehide() { for (const listener of [...windowListeners.get('pagehide') || []]) listener(); },
    windowListenerCount(type) { return (windowListeners.get(type) || []).length; },
    get geometryReads() { return geometryReads; },
  };
}

test('normalizes an oversized game document when installed', () => {
  const harness = createHarness();

  const result = harness.run();

  assert.equal(result.fresh, true);
  for (const element of [harness.documentElement, harness.body]) {
    assert.equal(element.style.getPropertyValue('overflow'), 'hidden');
    assert.equal(element.style.getPropertyPriority('overflow'), 'important');
  }
  assert.deepEqual(harness.scrollCalls, [[0, 0]]);
  const layout = JSON.parse(JSON.stringify(
    harness.window.__MT_AIGIS_SCROLL__.status().layout
  ));
  assert.deepEqual(layout, {
    clientWidth: 960,
    clientHeight: 640,
    scrollWidth: 970,
    scrollHeight: 8000,
    htmlOverflow: 'hidden',
    bodyOverflow: 'hidden',
  });
});

test('aligns the playable canvas and hides the auxiliary launcher frame', async (t) => {
  for (const launcher of ['aigis.html', 'aigis_all.html']) {
    await t.test(launcher, () => {
      const harness = createHarness({
        url: `https://drc1bk94f7rq8.cloudfront.net/00/html/${launcher}`,
        withAigisSurface: true,
      });

      harness.run();

      assert.equal(harness.canvas.style.getPropertyValue('display'), 'block');
      assert.equal(harness.canvas.style.getPropertyPriority('display'), 'important');
      assert.equal(harness.canvas.style.getPropertyValue('margin-left'), '0');
      assert.equal(harness.canvas.style.getPropertyPriority('margin-left'), 'important');
      assert.equal(harness.canvas.style.getPropertyValue('margin-right'), '0');
      assert.equal(harness.canvas.style.getPropertyPriority('margin-right'), 'important');
      assert.equal(harness.mainFrame.style.getPropertyValue('display'), 'none');
      assert.equal(harness.mainFrame.style.getPropertyPriority('display'), 'important');
      assert.equal(harness.mainFrame.style.getPropertyValue('visibility'), 'hidden');
      assert.equal(harness.mainFrame.style.getPropertyPriority('visibility'), 'important');
    });
  }
});

test('reapplies the baseline without duplicating input listeners', () => {
  const harness = createHarness();
  harness.run();
  harness.documentElement.style.setProperty('overflow', 'auto');
  harness.body.style.setProperty('overflow', 'auto');

  const result = harness.run();

  assert.equal(result.fresh, false);
  assert.equal(harness.documentElement.style.getPropertyValue('overflow'), 'hidden');
  assert.equal(harness.body.style.getPropertyValue('overflow'), 'hidden');
  assert.equal(harness.listenerCount('wheel'), 1);
  assert.equal(harness.listenerCount('mousewheel'), 1);
});

test('reports the main canvas CSS size rather than its high-DPI buffer or the container scroll size', () => {
  const h = createHarness({ withAigisSurface: true, moduleCanvas: true });
  const result = h.run();
  assert.deepEqual(JSON.parse(JSON.stringify(result.gameSize)), { width: 960, height: 640 });
  assert.equal(h.canvas.width, 1920);
  assert.equal(h.canvas.height, 1280);
  const reads = h.geometryReads;
  for (let i = 0; i < 100; i++) { h.input(120); h.advance(10); }
  assert.equal(h.geometryReads, reads);
});

test('rejects missing, disconnected and zero-sized canvases without guessing a game rectangle', () => {
  for (const options of [{}, { withAigisSurface: true, canvasWidth: 0 }, { withAigisSurface: true, canvasHeight: 0 }]) {
    const h = createHarness(options);
    assert.equal(h.run().gameSize, null);
  }
  const h = createHarness({ moduleCanvas: true });
  h.canvas.isConnected = false;
  assert.equal(h.run().gameSize, null);
});

test('waits for game initialization and all existing postRun callbacks before measuring the canvas', async () => {
  const h = createHarness({ moduleCanvas: true, canvasWidth: 300, canvasHeight: 150 });
  const gameModule = h.context.Module;
  const calls = [];
  const callbacks = [() => {
    calls.push('original');
    h.canvas.getBoundingClientRect = () => ({ width: 960, height: 640 });
  }];
  gameModule.postRun = callbacks;
  h.run();
  const adapter = h.window.__MT_AIGIS_SCROLL__;
  let result;
  const pending = adapter.whenReady().then(ready => { result = ready && adapter.status().gameSize; });
  await Promise.resolve();
  assert.equal(result, undefined);
  assert.equal(adapter.whenReady(), adapter.whenReady());
  h.run();
  assert.equal(gameModule.postRun, callbacks);
  assert.equal(callbacks.length, 2);
  assert.equal(h.windowListenerCount('pagehide'), 2);
  assert.equal(h.pendingTimers, 0);
  gameModule.calledRun = true;
  for (const callback of callbacks.splice(0).reverse()) callback();
  assert.deepEqual(calls, ['original']);
  await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { width: 960, height: 640 });
  assert.equal(h.windowListenerCount('pagehide'), 1);
  assert.equal(gameModule.onAbort, undefined);
  h.canvas.getBoundingClientRect = () => ({ width: 1280, height: 720 });
  await adapter.whenReady();
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.status().gameSize)), { width: 1280, height: 720 });
  assert.equal(callbacks.length, 0);
});

test('retains a function-valued postRun callback without changing its execution', async () => {
  const h = createHarness({ moduleCanvas: true });
  let calls = 0;
  const original = () => { calls++; };
  h.context.Module.postRun = original;
  h.run();
  const pending = h.window.__MT_AIGIS_SCROLL__.whenReady();
  assert.equal(h.context.Module.postRun[0], original);
  for (const callback of h.context.Module.postRun.splice(0).reverse()) callback();
  assert.equal(await pending, true);
  assert.equal(calls, 1);
});

test('does not register readiness hooks after initialization or for absent and aborted engines', async () => {
  for (const [engine, aborted, expected] of [[false, false, false], [true, false, true], [true, true, false]]) {
    const h = createHarness({ moduleCanvas: engine });
    if (engine) h.context.Module.calledRun = true;
    h.context.ABORT = aborted;
    h.run();
    const reads = h.geometryReads;
    assert.equal(await h.window.__MT_AIGIS_SCROLL__.whenReady(), expected);
    assert.equal(h.geometryReads, reads);
    assert.equal(h.context.Module?.postRun, undefined);
    assert.equal(h.windowListenerCount('pagehide'), 1);
    assert.equal(h.pendingTimers, 0);
  }
});

test('settles aborted initialization and preserves the original abort callback and exception', async () => {
  const h = createHarness({ moduleCanvas: true });
  const calls = [], originalPostRun = () => {};
  const error = new Error('fixture abort');
  const originalAbort = function (...args) { calls.push({ receiver: this, args }); throw error; };
  h.context.Module.postRun = [originalPostRun];
  h.context.Module.onAbort = originalAbort;
  h.run();
  const pending = h.window.__MT_AIGIS_SCROLL__.whenReady();
  assert.throws(() => h.context.Module.onAbort('fixture', 7), value => value === error);
  assert.equal(await pending, false);
  assert.equal(calls[0].receiver, h.context.Module);
  assert.deepEqual(calls[0].args, ['fixture', 7]);
  assert.equal(h.context.Module.onAbort, originalAbort);
  assert.deepEqual(h.context.Module.postRun, [originalPostRun]);
  assert.equal(h.windowListenerCount('pagehide'), 1);
  assert.equal(h.pendingTimers, 0);
});

test('cleans up a page exit while initialization waits without overwriting later game callbacks', async () => {
  const h = createHarness({ moduleCanvas: true });
  const original = () => {}, laterAbort = () => {};
  h.context.Module.postRun = [original];
  h.run();
  const pending = h.window.__MT_AIGIS_SCROLL__.whenReady();
  h.context.Module.onAbort = laterAbort;
  h.pagehide();
  assert.equal(await pending, false);
  assert.equal(h.context.Module.onAbort, laterAbort);
  assert.deepEqual(h.context.Module.postRun, [original]);
  assert.equal(h.windowListenerCount('pagehide'), 1);
  assert.equal(h.pendingTimers, 0);
});

test('does not complete readiness when the game aborts or exits during the postRun callback batch', async () => {
  for (const abort of [false, true]) {
    const h = createHarness({ moduleCanvas: true });
    h.context.Module.postRun = [() => abort ? h.context.Module.onAbort() : h.pagehide()];
    h.run();
    const pending = h.window.__MT_AIGIS_SCROLL__.whenReady();
    for (const callback of h.context.Module.postRun.splice(0).reverse()) callback();
    assert.equal(await pending, false);
    assert.equal(h.windowListenerCount('pagehide'), 1);
  }
});

test('handles pixel, line and page units at every sensitivity level', () => {
  for (let level = 1; level <= 5; level++) {
    for (const mode of [0, 1, 2]) {
      const h = createHarness(); h.run(); h.window.__MT_AIGIS_SCROLL__.setLevel(level);
      for (let i = 0; i < 10; i++) {
        h.input(mode === 0 ? 120 : mode === 1 ? 3 : 1, { deltaMode: mode });
        h.advance(300);
      }
      assert.equal(h.forwarded.length, 10, `level ${level}, mode ${mode}`);
      assert.ok(h.forwarded.every(e => e.deltaY === 1 && e.deltaMode === 1));
      assert.equal(h.window.__MT_AIGIS_SCROLL__.status().originalEvents, 10);
    }
  }
});

test('accumulates small pixel or fractional line input before emitting a game step', () => {
  for (const [mode, amount, count] of [[0, 3, 6], [1, 0.25, 4]]) {
    const h = createHarness(); h.run();
    for (let i = 1; i <= count; i++) {
      h.input(amount, { deltaMode: mode });
      assert.equal(h.forwarded.length, i === count ? 1 : 0);
      h.advance(20);
    }
    h.advance(300);
    assert.equal(h.forwarded.length, 1);
  }
});

test('dispatches the first gesture immediately and retains a valid trailing step without further input', () => {
  const h = createHarness({ startAt: 0 }); h.run();
  h.input(120); assert.equal(h.forwarded.length, 1);
  h.advance(40); h.input(120); assert.equal(h.forwarded.length, 1);
  h.advance(99); assert.equal(h.forwarded.length, 1);
  h.advance(1); assert.equal(h.forwarded.length, 2);
  h.advance(1000); assert.equal(h.forwarded.length, 2);
  assert.equal(h.pendingTimers, 0);
});

test('keeps a slow-profile pending step when the partial-input idle timer expires first', () => {
  const h = createHarness(); h.run(); h.window.__MT_AIGIS_SCROLL__.setLevel(1);
  h.input(120); h.advance(10); h.input(120);
  h.advance(180); assert.equal(h.forwarded.length, 1);
  h.advance(50); assert.equal(h.forwarded.length, 2);
  h.advance(1000); assert.equal(h.pendingTimers, 0);
});

test('coalesces high-frequency input into one pending step and bounded timers at all levels', (t) => {
  const intervals = [240, 185, 140, 100, 72];
  for (let level = 1; level <= 5; level++) {
    const h = createHarness(); h.run(); h.window.__MT_AIGIS_SCROLL__.setLevel(level);
    for (let i = 0; i < 100; i++) {
      h.input(120); assert.ok(h.pendingTimers <= 2); h.advance(10);
    }
    h.advance(300);
    assert.ok(h.forwarded.length <= Math.ceil(1000 / intervals[level - 1]) + 1);
    const count = h.forwarded.length; h.advance(10000);
    assert.equal(h.forwarded.length, count);
    assert.equal(h.pendingTimers, 0);
    t.diagnostic(`level ${level}: 100 inputs, ${count} outputs, at most 2 pending timers`);
  }
});

test('discards old-direction pending input and responds to reversals without a stale cooldown', () => {
  const h = createHarness(); h.run();
  h.input(18); h.advance(20); h.input(100); h.advance(125); h.input(-18);
  assert.deepEqual(h.forwarded.map(e => e.deltaY), [1, 1, -1]);
  const queued = createHarness(); queued.run();
  queued.input(18); queued.advance(20); queued.input(100); queued.advance(20); queued.input(-18);
  assert.deepEqual(queued.forwarded.map(e => e.deltaY), [1, -1]);
  queued.advance(1000); assert.equal(queued.forwarded.length, 2);
  const partial = createHarness(); partial.run();
  partial.input(10); partial.input(-18);
  assert.deepEqual(partial.forwarded.map(e => e.deltaY), [-1]);
});

test('preserves coordinates and modifiers for modern and legacy events without recursive normalization', () => {
  for (const type of ['wheel', 'mousewheel']) {
    const h = createHarness(); h.run();
    h.input(type === 'wheel' ? 120 : 0, { type, wheelDelta: -120, shiftKey: true, altKey: true });
    const e = h.forwarded[0];
    assert.equal(e.type, type); assert.equal(e.clientX, 321); assert.equal(e.clientY, 234);
    assert.equal(e.screenX, 500); assert.equal(e.screenY, 600);
    assert.equal(e.shiftKey, true); assert.equal(e.altKey, true);
    assert.equal(e.isTrusted, false); assert.equal(e.bubbles, true); assert.equal(e.cancelable, true);
    assert.equal(e.deltaY, 1); assert.equal(e.deltaMode, 1);
    if (type === 'mousewheel') { assert.equal(e.wheelDelta, -120); assert.equal(e.wheelDeltaY, -120); }
    assert.equal(h.window.__MT_AIGIS_SCROLL__.status().originalEvents, 1);
    assert.equal(h.window.__MT_AIGIS_SCROLL__.status().normalizedEvents, 1);
  }
});

test('uses the latest qualifying event coordinates for the coalesced trailing step', () => {
  const h = createHarness(); h.run();
  h.input(120); h.advance(10); h.input(120, { clientX: 400 });
  h.advance(10); h.input(120, { clientX: 450, shiftKey: true });
  h.advance(120);
  assert.equal(h.forwarded.length, 2);
  assert.equal(h.forwarded[1].clientX, 450);
  assert.equal(h.forwarded[1].shiftKey, true);
});

test('leaves shortcut gestures, horizontal input and unsupported values untouched', () => {
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { isTrusted: false }, { deltaX: 200 }, { deltaMode: 9 }]) {
    const h = createHarness(); h.run();
    assert.deepEqual(h.input(120, values), { prevented: false, stopped: false });
    assert.equal(h.forwarded.length, 0);
  }
  const h = createHarness(); h.run();
  assert.deepEqual(h.input(0), { prevented: false, stopped: false });
});

test('cancels pending steps and partial accumulation on profile changes or page exit', () => {
  for (const action of [h => h.window.__MT_AIGIS_SCROLL__.setLevel(5), h => h.pagehide()]) {
    const h = createHarness(); h.run();
    h.input(120); h.advance(10); h.input(120); action(h);
    h.advance(1000); assert.equal(h.forwarded.length, 1); assert.equal(h.pendingTimers, 0);
    h.input(120); assert.equal(h.forwarded.length, 2);
  }
});
