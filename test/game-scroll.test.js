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

function createHarness() {
  const listeners = new Map();
  const scrollCalls = [];
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
  };
  const window = {
    document,
    scrollTo(x, y) {
      scrollCalls.push([x, y]);
    },
  };
  window.window = window;
  window.top = window;

  const context = vm.createContext({
    Event,
    WheelEvent: class WheelEvent extends Event {},
    clearTimeout,
    console,
    document,
    location: { href: 'https://osapi.dmm.com/gadgets/ifr' },
    performance: { now: () => 0 },
    setTimeout,
    window,
  });

  return {
    body,
    documentElement,
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    run() {
      return vm.runInContext(adapterSource, context);
    },
    scrollCalls,
    window,
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
