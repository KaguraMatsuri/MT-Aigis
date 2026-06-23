(function () {
  'use strict';

  if (window.__MT_GAME_FOCUS__) return;

  const ATTR_STYLE = 'data-mt-aigis-style';
  const ATTR_HIDDEN = 'data-mt-aigis-hidden';
  const GAME_WIDTH = 960;
  const GAME_HEIGHT = 640;
  let userScale = 1;
  let themeColor = '#101011';
  let ringColor = 'rgba(255,255,255,0.16)';
  let resizeTimer = null;

  function saveStyle(element) {
    if (!element.hasAttribute(ATTR_STYLE)) {
      element.setAttribute(ATTR_STYLE, element.getAttribute('style') || '');
    }
  }

  function setStyle(element, property, value) {
    saveStyle(element);
    element.style.setProperty(property, value, 'important');
  }

  function findGameFrame() {
    const frame = document.getElementById('game_frame');
    if (!frame || !frame.src || frame.src.startsWith('about:')) return null;
    return frame;
  }

  function hideElement(element) {
    if (!element || element.id === 'game_frame') return;
    saveStyle(element);
    element.setAttribute(ATTR_HIDDEN, 'true');
    element.style.setProperty('display', 'none', 'important');
  }

  function isolateFrame(frame) {
    let current = frame;
    while (current && current.parentElement && current.parentElement !== document.documentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling !== current) hideElement(sibling);
      }
      current = current.parentElement;
    }
  }

  function apply() {
    if (window.top !== window) return { ok: false, reason: 'not-top-frame' };
    const frame = findGameFrame();
    if (!frame) return { ok: false, reason: 'element-not-found' };

    isolateFrame(frame);

    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const fitScale = Math.min(viewportWidth / GAME_WIDTH, viewportHeight / GAME_HEIGHT);
    const scale = Math.max(0.1, fitScale * userScale);
    const renderedWidth = GAME_WIDTH * scale;
    const renderedHeight = GAME_HEIGHT * scale;
    const left = Math.floor((viewportWidth - renderedWidth) / 2);
    const top = Math.floor((viewportHeight - renderedHeight) / 2);

    for (const element of [document.documentElement, document.body]) {
      setStyle(element, 'width', '100%');
      setStyle(element, 'height', '100%');
      setStyle(element, 'margin', '0');
      setStyle(element, 'padding', '0');
      setStyle(element, 'overflow', 'hidden');
      setStyle(element, 'background', themeColor);
    }

    setStyle(document.body, 'visibility', 'hidden');
    let ancestor = frame;
    while (ancestor) {
      setStyle(ancestor, 'visibility', 'visible');
      if (ancestor !== frame) {
        setStyle(ancestor, 'background', 'transparent');
        setStyle(ancestor, 'border', '0');
        setStyle(ancestor, 'box-shadow', 'none');
      }
      ancestor = ancestor.parentElement;
    }

    setStyle(frame, 'display', 'block');
    setStyle(frame, 'position', 'fixed');
    setStyle(frame, 'left', `${left}px`);
    setStyle(frame, 'top', `${top}px`);
    setStyle(frame, 'width', `${GAME_WIDTH}px`);
    setStyle(frame, 'height', `${GAME_HEIGHT}px`);
    setStyle(frame, 'min-width', `${GAME_WIDTH}px`);
    setStyle(frame, 'min-height', `${GAME_HEIGHT}px`);
    setStyle(frame, 'max-width', 'none');
    setStyle(frame, 'max-height', 'none');
    setStyle(frame, 'margin', '0');
    setStyle(frame, 'border', '0');
    setStyle(frame, 'outline', `1px solid ${ringColor}`);
    setStyle(frame, 'box-shadow', `0 0 0 1px ${ringColor}`);
    setStyle(frame, 'background', themeColor);
    setStyle(frame, 'transform-origin', 'top left');
    setStyle(frame, 'transform', `scale(${scale})`);
    setStyle(frame, 'z-index', '2147483647');

    return {
      ok: true,
      viewport: { width: viewportWidth, height: viewportHeight },
      scale,
      fitScale,
      userScale,
      rect: { left, top, width: renderedWidth, height: renderedHeight },
    };
  }

  function restore() {
    document.querySelectorAll(`[${ATTR_STYLE}]`).forEach((element) => {
      element.setAttribute('style', element.getAttribute(ATTR_STYLE) || '');
      element.removeAttribute(ATTR_STYLE);
      element.removeAttribute(ATTR_HIDDEN);
    });
    return { ok: true };
  }

  function scheduleApply() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      apply();
    }, 40);
  }

  const observer = new MutationObserver(() => {
    if (findGameFrame()) scheduleApply();
  });
  const startObserver = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  };

  window.addEventListener('resize', scheduleApply, { passive: true });
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

  window.__MT_GAME_FOCUS__ = {
    enableAggressive: apply,
    enableSafe: apply,
    apply,
    restore,
    setUserScale(value) {
      const numeric = Number(value);
      userScale = Number.isFinite(numeric) ? Math.min(2.5, Math.max(0.7, numeric)) : 1;
      return apply();
    },
    setTheme(colors) {
      if (colors && colors.fill) themeColor = String(colors.fill);
      if (colors && colors.ring) ringColor = String(colors.ring);
      return apply();
    },
    diagnose() {
      return {
        href: location.href,
        hasGameFrame: !!findGameFrame(),
        userScale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    },
  };
})();
