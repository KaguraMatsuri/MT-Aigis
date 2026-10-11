(function () {
  'use strict';

  if (window.__MT_AIGIS_CONTAINER_FOCUS__) {
    return window.__MT_AIGIS_CONTAINER_FOCUS__.apply();
  }

  const ATTR_STYLE = 'data-mt-aigis-container-style';
  let gameWidth = 960;
  let gameHeight = 640;
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
      setStyle(element, 'width', `${gameWidth}px`);
      setStyle(element, 'height', `${gameHeight}px`);
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
    setStyle(frame, 'width', `${gameWidth}px`);
    setStyle(frame, 'height', `${gameHeight}px`);
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

  window.__MT_AIGIS_CONTAINER_FOCUS__ = {
    apply,
    configure(size) {
      if (size === null) {
        gameWidth = 960;
        gameHeight = 640;
      } else if (
        size && Number.isFinite(size.width) && Number.isFinite(size.height) &&
        size.width > 0 && size.height > 0
      ) {
        gameWidth = size.width;
        gameHeight = size.height;
      }
      return apply();
    },
  };
  return { ...apply(), fresh: true };
})();
