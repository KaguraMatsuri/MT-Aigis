(function () {
  'use strict';

  if (window.__MT_AIGIS_SCROLL__) {
    return { ...window.__MT_AIGIS_SCROLL__.status(), fresh: false };
  }

  const IDLE_RESET = 180;
  const PROFILES = {
    1: { threshold: 34, interval: 240 },
    2: { threshold: 26, interval: 185 },
    3: { threshold: 18, interval: 140 },
    4: { threshold: 13, interval: 100 },
    5: { threshold: 9, interval: 72 },
  };
  let level = 3;
  let accumulated = 0;
  let lastDispatch = 0;
  let resetTimer = null;
  let originalEvents = 0;
  let normalizedEvents = 0;

  function applyFrameBaseline() {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      element.style.setProperty('margin', '0', 'important');
      element.style.setProperty('padding', '0', 'important');
      element.style.setProperty('background-color', '#000', 'important');
      element.style.setProperty('overscroll-behavior', 'none', 'important');
    }
  }

  function resetSoon() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      accumulated = 0;
      resetTimer = null;
    }, IDLE_RESET);
  }

  function dispatchNormalized(event, direction) {
    const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
    if (event.type === 'mousewheel') {
      const normalized = new Event('mousewheel', {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperties(normalized, {
        wheelDelta: { value: -direction * 120 },
        wheelDeltaY: { value: -direction * 120 },
        deltaY: { value: direction },
      });
      target.dispatchEvent(normalized);
      return;
    }

    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: 0,
      deltaY: direction,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    }));
  }

  function normalizeScroll(event) {
    if (!event.isTrusted || event.ctrlKey || event.metaKey) return;
    originalEvents += 1;
    const deltaY = Number.isFinite(event.deltaY)
      ? event.deltaY
      : -(Number(event.wheelDeltaY || event.wheelDelta) || 0);
    const deltaX = Number(event.deltaX) || 0;
    if (Math.abs(deltaY) < Math.abs(deltaX)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    accumulated += deltaY;
    resetSoon();

    const now = performance.now();
    const profile = PROFILES[level];
    if (
      Math.abs(accumulated) < profile.threshold ||
      now - lastDispatch < profile.interval
    ) return;

    const direction = Math.sign(accumulated);
    accumulated = 0;
    lastDispatch = now;
    normalizedEvents += 1;
    dispatchNormalized(event, direction);
  }

  applyFrameBaseline();
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', applyFrameBaseline, { once: true });
  }
  document.addEventListener('wheel', normalizeScroll, { capture: true, passive: false });
  document.addEventListener('mousewheel', normalizeScroll, { capture: true, passive: false });

  window.__MT_AIGIS_SCROLL__ = {
    status() {
      return {
        installed: true,
        href: location.href,
        originalEvents,
        normalizedEvents,
        level,
        interval: PROFILES[level].interval,
      };
    },
    setLevel(value) {
      const numeric = Math.round(Number(value));
      level = Math.min(5, Math.max(1, Number.isFinite(numeric) ? numeric : 3));
      accumulated = 0;
      return this.status();
    },
  };
  return { ...window.__MT_AIGIS_SCROLL__.status(), fresh: true };
})();
