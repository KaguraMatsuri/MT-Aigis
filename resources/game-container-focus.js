(function () {
  'use strict';

  if (window.__MT_AIGIS_CONTAINER_FOCUS__) {
    return window.__MT_AIGIS_CONTAINER_FOCUS__.apply();
  }

  const ATTR_STYLE = 'data-mt-aigis-container-style';
  const GAME_WIDTH = 960;
  const GAME_HEIGHT = 640;
  let scheduled = false;

  function saveStyle(element) {
    if (element && !element.hasAttribute(ATTR_STYLE)) {
      element.setAttribute(ATTR_STYLE, element.getAttribute('style') || '');
    }
  }

  function setStyle(element, property, value) {
    if (!element) return;
    saveStyle(element);
    element.style.setProperty(property, value, 'important');
  }

  function isPlayableFrame(frame) {
    try {
      const parsed = new URL(frame.src, location.href);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      return (
        (
          host === 'drc1bk94f7rq8.cloudfront.net' ||
          host === 'millennium-war.net' ||
          host.endsWith('.millennium-war.net')
        ) &&
        /\/aigis(?:_[a-z0-9-]+)?\.html?$/.test(pathname)
      );
    } catch {
      return false;
    }
  }

  function findGameFrame() {
    return [...document.querySelectorAll('iframe')].find(isPlayableFrame) || null;
  }

  function hideOutsideGamePath(frame) {
    let current = frame;
    while (current && current.parentElement && current.parentElement !== document.documentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling !== current) setStyle(sibling, 'display', 'none');
      }
      setStyle(current, 'visibility', 'visible');
      current = current.parentElement;
    }
  }

  function apply() {
    if (!document.documentElement) return { installed: true, focused: false };

    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      setStyle(element, 'width', `${GAME_WIDTH}px`);
      setStyle(element, 'height', `${GAME_HEIGHT}px`);
      setStyle(element, 'margin', '0');
      setStyle(element, 'padding', '0');
      setStyle(element, 'overflow', 'hidden');
      setStyle(element, 'background', '#101011');
    }
    if (document.body) setStyle(document.body, 'visibility', 'hidden');

    const frame = findGameFrame();
    if (!frame) return { installed: true, focused: false };

    hideOutsideGamePath(frame);
    setStyle(frame, 'display', 'block');
    setStyle(frame, 'visibility', 'visible');
    setStyle(frame, 'opacity', '1');
    setStyle(frame, 'position', 'fixed');
    setStyle(frame, 'inset', '0');
    setStyle(frame, 'width', `${GAME_WIDTH}px`);
    setStyle(frame, 'height', `${GAME_HEIGHT}px`);
    setStyle(frame, 'margin', '0');
    setStyle(frame, 'border', '0');
    setStyle(frame, 'z-index', '2147483647');
    return { installed: true, focused: true };
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  const observer = new MutationObserver(scheduleApply);
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', apply, { once: true });

  window.__MT_AIGIS_CONTAINER_FOCUS__ = { apply };
  return { ...apply(), fresh: true };
})();
