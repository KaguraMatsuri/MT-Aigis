(function () {
  'use strict';

  if (window.__MT_AIGIS_CLICKER__) return { installed: true, fresh: false };

  let enabled = false, acknowledged = false, active = false, cps = 10;
  let keyCode = 'KeyB', externalKeyboardHeld = false;
  let keyboardHeld = false, pointerHeld = false, keyDown = false;
  let timer = null, pressed = null, geometry = null, lastDown = -Infinity;
  let firstUseRequested = false, firstUseResolve = null, disposed = false;
  let keyboardReleaseResolve = null;
  let keysInstalled = false;

  function canvas() {
    const surface = typeof Module !== 'undefined' && Module && Module.canvas;
    const target = surface || document.getElementById('canvas');
    return target && target.tagName === 'CANVAS' && target.isConnected !== false ? target : null;
  }

  function editable(element) {
    return !!element && (element.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) ||
      !!(element.closest && element.closest('[contenteditable="true"]')));
  }

  function send(target, type, point, buttons) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons, clientX: point.x, clientY: point.y,
    }));
  }

  function releasePress() {
    const press = pressed;
    pressed = null;
    if (press && press.target.isConnected !== false) send(press.target, 'mouseup', press.point, 0);
  }

  function stopLoop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    releasePress();
    geometry = null;
  }

  function stop() {
    keyboardHeld = externalKeyboardHeld = pointerHeld = keyDown = false;
    stopLoop();
    resolveKeyboardRelease(true);
  }

  function resolveKeyboardRelease(released) {
    if (!keyboardReleaseResolve) return;
    const resolve = keyboardReleaseResolve;
    keyboardReleaseResolve = null;
    resolve({ released, disposed });
  }

  function canRun() {
    return enabled && acknowledged && active && !disposed &&
      document.visibilityState !== 'hidden' && (keyboardHeld || externalKeyboardHeld || pointerHeld) &&
      !editable(document.activeElement);
  }

  function nextClick() {
    timer = null;
    const target = canvas();
    if (!canRun() || !target || target !== geometry?.target) { stop(); return; }
    const wait = 1000 / cps - (performance.now() - lastDown);
    if (wait > 0) { timer = setTimeout(nextClick, Math.ceil(wait)); return; }
    const radius = Math.min(geometry.width, geometry.height) * 0.05;
    const angle = Math.random() * Math.PI * 2, distance = Math.sqrt(Math.random()) * radius;
    const point = {
      x: geometry.left + geometry.width / 2 + Math.cos(angle) * distance,
      y: geometry.top + geometry.height / 2 + Math.sin(angle) * distance,
    };
    if (document.elementFromPoint(point.x, point.y) !== target) { stop(); return; }
    send(target, 'mousemove', point, 0);
    if (!canRun()) { stop(); return; }
    pressed = { target, point };
    lastDown = performance.now();
    send(target, 'mousedown', point, 1);
    if (pressed) {
      timer = setTimeout(() => {
        timer = null;
        releasePress();
        if (canRun()) nextClick();
        else stop();
      }, 50);
    }
  }

  function startLoop() {
    if (timer !== null || pressed || !canRun()) return;
    const target = canvas(), rect = target && target.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
      rect.width <= 0 || rect.height <= 0) { stop(); return; }
    geometry = { target, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    nextClick();
  }

  function resolveFirstUse(requested) {
    if (!firstUseResolve) return;
    const resolve = firstUseResolve;
    firstUseResolve = null;
    firstUseRequested = false;
    resolve({ requested, disposed });
  }

  function isBoundKey(event) {
    if (event.code) return event.code === keyCode;
    return String(event.key || '').toUpperCase() === keyCode.replace(/^(Key|Digit)/, '');
  }

  function onKeyDown(event) {
    if (!isBoundKey(event) || !event.isTrusted || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      !enabled || !active || editable(event.target) || editable(document.activeElement) || !canvas()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || keyDown) return;
    keyDown = true;
    if (!acknowledged) {
      firstUseRequested = true;
      resolveFirstUse(true);
      return;
    }
    keyboardHeld = true;
    startLoop();
  }

  function onKeyUp(event) {
    if (!isBoundKey(event) || !keyDown) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    keyDown = keyboardHeld = false;
    if (!pointerHeld && !externalKeyboardHeld) stopLoop();
    if (!externalKeyboardHeld) resolveKeyboardRelease(true);
  }

  function updateKeys() {
    if (keysInstalled === enabled) return;
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    window[method]('keydown', onKeyDown, true);
    window[method]('keyup', onKeyUp, true);
    keysInstalled = enabled;
  }

  window.addEventListener('blur', () => {
    keyDown = keyboardHeld = externalKeyboardHeld = false;
    if (!pointerHeld) stopLoop();
    resolveKeyboardRelease(true);
  });
  window.addEventListener('resize', stop);
  document.addEventListener('focusin', (event) => { if (editable(event.target)) stop(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stop(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    stop();
    enabled = false;
    updateKeys();
    resolveFirstUse(false);
  });

  window.__MT_AIGIS_CLICKER__ = {
    configure(options) {
      const previousAcknowledged = acknowledged;
      const previousKeyCode = keyCode;
      enabled = !!options.enabled && !disposed;
      acknowledged = !!options.acknowledged;
      active = !!options.active;
      keyCode = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(options.keyCode) ? options.keyCode : 'KeyB';
      const value = Number(options.cps);
      cps = Number.isFinite(value) ? Math.max(1, Math.min(10, Math.round(value))) : 10;
      if (!enabled || !active || !acknowledged || !previousAcknowledged || previousKeyCode !== keyCode) stop();
      updateKeys();
      if (!enabled || acknowledged) resolveFirstUse(false);
      return { installed: true };
    },
    setPointerHeld(held) {
      pointerHeld = held === true && enabled && acknowledged && active && !disposed;
      if (pointerHeld) startLoop();
      else if (!keyboardHeld && !externalKeyboardHeld) stopLoop();
    },
    setKeyboardHeld(held) {
      externalKeyboardHeld = held === true && enabled && acknowledged && active && !disposed;
      if (externalKeyboardHeld) startLoop();
      else {
        if (!keyboardHeld && !pointerHeld) stopLoop();
        if (!keyboardHeld) resolveKeyboardRelease(true);
      }
    },
    stop,
    waitForKeyboardRelease() {
      resolveKeyboardRelease(false);
      if (disposed) return Promise.resolve({ released: false, disposed: true });
      return new Promise(resolve => { keyboardReleaseResolve = resolve; });
    },
    waitForFirstUse() {
      if (disposed || !enabled || acknowledged) return Promise.resolve({ requested: false, disposed });
      if (firstUseRequested) {
        firstUseRequested = false;
        return Promise.resolve({ requested: true, disposed });
      }
      return new Promise(resolve => { firstUseResolve = resolve; });
    },
  };
  return { installed: true, fresh: true };
})();
