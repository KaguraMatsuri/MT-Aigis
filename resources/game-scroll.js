(function () {
  'use strict';

  if (window.__MT_AIGIS_SCROLL__) {
    if (typeof window.__MT_AIGIS_SCROLL__.applyBaseline === 'function') {
      window.__MT_AIGIS_SCROLL__.applyBaseline();
    }
    return { ...window.__MT_AIGIS_SCROLL__.status(), fresh: false };
  }

  const IDLE_RESET = 180;
  const AIGIS_SURFACE_HOST = 'drc1bk94f7rq8.cloudfront.net';
  const AIGIS_SURFACE_PATHS = new Set([
    '/00/html/aigis.html',
    '/00/html/aigis_all.html',
  ]);
  const PROFILES = {
    1: { threshold: 34, interval: 240 },
    2: { threshold: 26, interval: 185 },
    3: { threshold: 18, interval: 140 },
    4: { threshold: 13, interval: 100 },
    5: { threshold: 9, interval: 72 },
  };
  let level = 3;
  let accumulated = 0;
  let lastDispatch = -Infinity;
  let lastDirection = 0;
  let resetTimer = null;
  let dispatchTimer = null;
  let pendingEvent = null;
  let pendingDirection = 0;
  let originalEvents = 0;
  let normalizedEvents = 0;
  let readyPromise = null;

  function isAigisSurfaceDocument() {
    return (
      location.protocol === 'https:' &&
      location.hostname.toLowerCase() === AIGIS_SURFACE_HOST &&
      AIGIS_SURFACE_PATHS.has(location.pathname)
    );
  }

  function findGameCanvas() {
    const moduleCanvas = typeof Module !== 'undefined' && Module && Module.canvas;
    if (moduleCanvas && moduleCanvas.tagName === 'CANVAS' && moduleCanvas.isConnected !== false) return moduleCanvas;
    const canvas = document.getElementById('canvas');
    return canvas && canvas.tagName === 'CANVAS' && canvas.isConnected !== false ? canvas : null;
  }

  function gameCanvasSize() {
    const canvas = findGameCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
    return { width: rect.width, height: rect.height };
  }

  function whenReady() {
    if (readyPromise) return readyPromise;
    const gameModule = typeof Module !== 'undefined' && Module;
    if (!gameModule || (typeof ABORT !== 'undefined' && ABORT)) return Promise.resolve(false);
    if (gameModule.calledRun) return Promise.resolve(true);

    readyPromise = new Promise((resolve) => {
      const previousAbort = gameModule.onAbort;
      const callbacks = Array.isArray(gameModule.postRun)
        ? gameModule.postRun
        : typeof gameModule.postRun === 'function' ? [gameModule.postRun] : [];
      let settled = false;
      function finish(ready) {
        if (settled) return;
        settled = true;
        const index = callbacks.indexOf(afterRun);
        if (index >= 0) callbacks.splice(index, 1);
        if (gameModule.onAbort === onAbort) gameModule.onAbort = previousAbort;
        window.removeEventListener('pagehide', onPageHide);
        resolve(ready);
      }
      function afterRun() {
        // The engine runs postRun callbacks in reverse order; measure after all of them.
        Promise.resolve().then(() => finish(true));
      }
      function onAbort(...args) {
        try {
          if (typeof previousAbort === 'function') return previousAbort.apply(this, args);
        } finally {
          finish(false);
        }
      }
      function onPageHide() { finish(false); }
      callbacks.push(afterRun);
      gameModule.postRun = callbacks;
      gameModule.onAbort = onAbort;
      window.addEventListener('pagehide', onPageHide, { once: true });
    });
    return readyPromise;
  }

  function alignAigisSurface() {
    if (!isAigisSurfaceDocument()) return;
    const canvas = findGameCanvas();
    if (canvas) {
      canvas.style.setProperty('display', 'block', 'important');
      canvas.style.setProperty('margin-left', '0', 'important');
      canvas.style.setProperty('margin-right', '0', 'important');
    }
    const auxiliaryFrame = document.getElementById('main_frame');
    if (auxiliaryFrame) {
      auxiliaryFrame.style.setProperty('display', 'none', 'important');
      auxiliaryFrame.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  function frameLayout() {
    const root = document.documentElement;
    const body = document.body;
    const dimension = (property) => Math.max(
      Number(root && root[property]) || 0,
      Number(body && body[property]) || 0
    );
    const overflow = (element) => element && element.style
      ? element.style.getPropertyValue('overflow')
      : '';
    return {
      clientWidth: dimension('clientWidth'),
      clientHeight: dimension('clientHeight'),
      scrollWidth: dimension('scrollWidth'),
      scrollHeight: dimension('scrollHeight'),
      htmlOverflow: overflow(root),
      bodyOverflow: overflow(body),
    };
  }

  function applyFrameBaseline() {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      element.style.setProperty('margin', '0', 'important');
      element.style.setProperty('padding', '0', 'important');
      element.style.setProperty('background-color', '#000', 'important');
      element.style.setProperty('overscroll-behavior', 'none', 'important');
      element.style.setProperty('overflow', 'hidden', 'important');
    }
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
    alignAigisSurface();
  }

  function resetSoon() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      accumulated = 0;
      if (!pendingEvent) lastDirection = 0;
      resetTimer = null;
    }, IDLE_RESET);
  }

  function dispatchNormalized(event, direction) {
    const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
    const normalized = new WheelEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
      buttons: event.buttons,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      deltaX: 0,
      deltaY: direction,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    });
    if (event.type === 'mousewheel') {
      Object.defineProperties(normalized, {
        wheelDelta: { value: -direction * 120 },
        wheelDeltaY: { value: -direction * 120 },
        wheelDeltaX: { value: 0 },
      });
    }
    target.dispatchEvent(normalized);
  }

  function resetInput() {
    if (resetTimer) clearTimeout(resetTimer);
    if (dispatchTimer) clearTimeout(dispatchTimer);
    resetTimer = dispatchTimer = null;
    accumulated = 0;
    pendingEvent = null;
    pendingDirection = lastDirection = 0;
    lastDispatch = -Infinity;
  }

  function dispatchPending() {
    dispatchTimer = null;
    const event = pendingEvent;
    const direction = pendingDirection;
    pendingEvent = null;
    pendingDirection = 0;
    if (!event) return;
    lastDispatch = performance.now();
    normalizedEvents += 1;
    dispatchNormalized(event, direction);
  }

  function normalizeScroll(event) {
    if (!event.isTrusted || event.ctrlKey || event.metaKey) return;
    originalEvents += 1;
    const deltaMode = Number(event.deltaMode) || WheelEvent.DOM_DELTA_PIXEL;
    const deltaY = Number.isFinite(event.deltaY) && (event.type !== 'mousewheel' || event.deltaY !== 0)
      ? event.deltaY
      : -(Number(event.wheelDeltaY || event.wheelDelta) || 0);
    const deltaX = Number(event.deltaX) || 0;
    if (
      !Number.isFinite(deltaY) || deltaY === 0 ||
      Math.abs(deltaY) < Math.abs(deltaX) ||
      ![WheelEvent.DOM_DELTA_PIXEL, WheelEvent.DOM_DELTA_LINE, WheelEvent.DOM_DELTA_PAGE].includes(deltaMode)
    ) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const direction = Math.sign(deltaY);
    if (lastDirection && direction !== lastDirection) resetInput();
    lastDirection = direction;
    const profile = PROFILES[level];
    // Pixel gestures use the sensitivity threshold; line/page input uses discrete units.
    accumulated += deltaMode === WheelEvent.DOM_DELTA_PIXEL ? deltaY : deltaY * profile.threshold;
    resetSoon();

    if (Math.abs(accumulated) < profile.threshold) return;
    accumulated = 0;
    pendingEvent = event;
    pendingDirection = direction;
    const wait = profile.interval - (performance.now() - lastDispatch);
    if (wait <= 0) {
      if (dispatchTimer) clearTimeout(dispatchTimer);
      dispatchPending();
    } else if (!dispatchTimer) {
      dispatchTimer = setTimeout(dispatchPending, wait);
    }
  }

  applyFrameBaseline();
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', applyFrameBaseline, { once: true });
  }
  document.addEventListener('wheel', normalizeScroll, { capture: true, passive: false });
  document.addEventListener('mousewheel', normalizeScroll, { capture: true, passive: false });
  window.addEventListener('pagehide', resetInput);

  window.__MT_AIGIS_SCROLL__ = {
    applyBaseline: applyFrameBaseline,
    whenReady,
    status() {
      return {
        installed: true,
        href: location.href,
        originalEvents,
        normalizedEvents,
        level,
        interval: PROFILES[level].interval,
        layout: frameLayout(),
        gameSize: gameCanvasSize(),
      };
    },
    setLevel(value) {
      const numeric = Math.round(Number(value));
      level = Math.min(5, Math.max(1, Number.isFinite(numeric) ? numeric : 3));
      resetInput();
      return this.status();
    },
  };
  return { ...window.__MT_AIGIS_SCROLL__.status(), fresh: true };
})();
