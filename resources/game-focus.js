(function () {
  'use strict';

  if (window.__MT_GAME_FOCUS__) return;

  const ATTR_STYLE = 'data-mt-aigis-style';
  const ATTR_HIDDEN = 'data-mt-aigis-hidden';
  const LAUNCH_MASK_ID = 'mt-aigis-launch-mask';
  let gameWidth = 960;
  let gameHeight = 640;
  let userScale = 1;
  let themeColor = '#101011';
  let gameContentReady = false;
  let resizeFrame = null;
  let transitionFrame = null;
  let transitionCompletion = null;
  let viewportTransitionActive = false;
  let observerActive = false;

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

  function viewportLayout(width, height) {
    const viewportWidth = Math.max(1, Number(width) || 1);
    const viewportHeight = Math.max(1, Number(height) || 1);
    const fitScale = Math.min(viewportWidth / gameWidth, viewportHeight / gameHeight);
    const scale = Math.max(0.1, fitScale * userScale);
    const renderedWidth = gameWidth * scale;
    const renderedHeight = gameHeight * scale;
    return {
      viewportWidth,
      viewportHeight,
      fitScale,
      scale,
      renderedWidth,
      renderedHeight,
      frameLeft: Math.floor((viewportWidth - gameWidth) / 2),
      left: Math.floor((viewportWidth - renderedWidth) / 2),
      top: Math.max(0, Math.floor((viewportHeight - renderedHeight) / 2)),
    };
  }

  function apply() {
    if (window.top !== window) return { ok: false, reason: 'not-top-frame' };
    const frame = findGameFrame();
    if (!frame) return { ok: false, reason: 'element-not-found' };

    isolateFrame(frame);

    const layout = viewportLayout(
      window.innerWidth || document.documentElement.clientWidth,
      window.innerHeight || document.documentElement.clientHeight
    );

    for (const element of [document.documentElement, document.body]) {
      setStyle(element, 'width', '100%');
      setStyle(element, 'height', '100%');
      setStyle(element, 'margin', '0');
      setStyle(element, 'padding', '0');
      setStyle(element, 'overflow', 'hidden');
      setStyle(element, 'background', themeColor);
    }

    if (!gameContentReady) {
      setStyle(document.body, 'visibility', 'hidden');
      setStyle(frame, 'visibility', 'hidden');
      setStyle(frame, 'opacity', '0');
      return {
        ok: false,
        reason: 'game-content-loading',
        viewport: { width: layout.viewportWidth, height: layout.viewportHeight },
      };
    }

    const launchMask = document.getElementById(LAUNCH_MASK_ID);
    if (launchMask) launchMask.remove();
    if (observerActive) {
      observer.disconnect();
      observerActive = false;
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
    setStyle(frame, 'opacity', '1');
    setStyle(frame, 'position', 'fixed');
    setStyle(frame, 'left', `calc(50% - ${gameWidth / 2}px)`);
    setStyle(frame, 'top', `${layout.top}px`);
    setStyle(frame, 'width', `${gameWidth}px`);
    setStyle(frame, 'height', `${gameHeight}px`);
    setStyle(frame, 'min-width', `${gameWidth}px`);
    setStyle(frame, 'min-height', `${gameHeight}px`);
    setStyle(frame, 'max-width', 'none');
    setStyle(frame, 'max-height', 'none');
    setStyle(frame, 'margin', '0');
    setStyle(frame, 'border', '0');
    setStyle(frame, 'outline', 'none');
    setStyle(frame, 'box-shadow', 'none');
    setStyle(frame, 'background', themeColor);
    setStyle(frame, 'transform-origin', 'top center');
    setStyle(frame, 'transform', `scale(${layout.scale})`);
    setStyle(frame, 'z-index', '2147483647');

    return {
      ok: true,
      viewport: { width: layout.viewportWidth, height: layout.viewportHeight },
      scale: layout.scale,
      fitScale: layout.fitScale,
      userScale,
      rect: { left: layout.left, top: layout.top, width: layout.renderedWidth, height: layout.renderedHeight },
    };
  }

  function cancelTransitionFrame(frame, freezeCurrent) {
    if (freezeCurrent && frame && transitionCompletion) {
      const computed = window.getComputedStyle(frame);
      setStyle(frame, 'left', computed.left);
      setStyle(frame, 'top', computed.top);
      setStyle(frame, 'transform', computed.transform);
    }
    if (transitionFrame) {
      cancelAnimationFrame(transitionFrame);
      transitionFrame = null;
    }
    if (transitionCompletion) {
      const complete = transitionCompletion;
      transitionCompletion = null;
      complete(true);
    }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function waitForFrameTransition(frame, propertyName, duration, result, clearStyle) {
    if (duration <= 0) {
      if (clearStyle) setStyle(frame, 'transition', 'none');
      return Promise.resolve({ ...result, animated: false });
    }
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      const finish = (cancelled = false) => {
        if (settled) return;
        settled = true;
        frame.removeEventListener('transitionend', onTransitionEnd);
        if (timeout) clearTimeout(timeout);
        if (transitionCompletion === finish) transitionCompletion = null;
        if (clearStyle) setStyle(frame, 'transition', 'none');
        resolve({ ...result, animated: true, cancelled });
      };
      const onTransitionEnd = (event) => {
        if (event.target === frame && event.propertyName === propertyName) finish(false);
      };
      frame.addEventListener('transitionend', onTransitionEnd);
      timeout = setTimeout(() => finish(false), duration + 80);
      transitionCompletion = finish;
    });
  }

  function prepareViewportTransition() {
    const frame = findGameFrame();
    if (!frame) return { ok: false, reason: 'element-not-found' };
    const layout = viewportLayout(
      window.innerWidth || document.documentElement.clientWidth,
      window.innerHeight || document.documentElement.clientHeight
    );
    viewportTransitionActive = true;
    cancelTransitionFrame();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    setStyle(frame, 'transition', 'none');
    setStyle(frame, 'left', `${layout.frameLeft}px`);
    setStyle(frame, 'top', `${layout.top}px`);
    setStyle(frame, 'transform', `scale(${layout.scale})`);
    return { ok: true, scale: layout.scale, viewport: { width: layout.viewportWidth, height: layout.viewportHeight } };
  }

  function beginViewportTransition(payload) {
    const frame = findGameFrame();
    if (!frame) return { ok: false, reason: 'element-not-found' };
    if (!viewportTransitionActive) return apply();
    const options = payload || {};
    const layout = viewportLayout(options.width, options.height);
    const duration = prefersReducedMotion()
      ? 0
      : Math.min(500, Math.max(0, Number(options.duration) || 200));
    viewportTransitionActive = true;
    cancelTransitionFrame();
    setStyle(frame, 'transform-origin', 'top center');
    if (duration === 0) {
      setStyle(frame, 'transition', 'none');
      setStyle(frame, 'left', `${layout.frameLeft}px`);
      setStyle(frame, 'top', `${layout.top}px`);
      setStyle(frame, 'transform', `scale(${layout.scale})`);
      return Promise.resolve({ ok: true, scale: layout.scale, animated: false });
    }
    setStyle(
      frame,
      'transition',
      `left ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), top ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
    );
    const completion = waitForFrameTransition(
      frame,
      'left',
      duration,
      { ok: true, scale: layout.scale },
      false
    );
    transitionFrame = requestAnimationFrame(() => {
      transitionFrame = requestAnimationFrame(() => {
        transitionFrame = null;
        setStyle(frame, 'left', `${layout.frameLeft}px`);
        setStyle(frame, 'top', `${layout.top}px`);
        setStyle(frame, 'transform', `scale(${layout.scale})`);
      });
    });
    return completion;
  }

  function animateUserScale(duration) {
    const frame = findGameFrame();
    if (viewportTransitionActive) return endViewportTransition();
    if (!frame || !gameContentReady) return apply();
    const layout = viewportLayout(
      window.innerWidth || document.documentElement.clientWidth,
      window.innerHeight || document.documentElement.clientHeight
    );
    const animationDuration = prefersReducedMotion()
      ? 0
      : Math.min(400, Math.max(0, Number(duration) || 180));
    cancelTransitionFrame(frame, true);
    if (animationDuration === 0) {
      setStyle(frame, 'transition', 'none');
      setStyle(frame, 'top', `${layout.top}px`);
      setStyle(frame, 'transform', `scale(${layout.scale})`);
      return Promise.resolve({ ok: true, scale: layout.scale, animated: false });
    }
    setStyle(frame, 'transition', `top ${animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`);
    const completion = waitForFrameTransition(
      frame,
      'transform',
      animationDuration,
      { ok: true, scale: layout.scale },
      true
    );
    transitionFrame = requestAnimationFrame(() => {
      transitionFrame = null;
      setStyle(frame, 'top', `${layout.top}px`);
      setStyle(frame, 'transform', `scale(${layout.scale})`);
    });
    return completion;
  }

  function endViewportTransition() {
    viewportTransitionActive = false;
    cancelTransitionFrame();
    const frame = findGameFrame();
    if (frame) setStyle(frame, 'transition', 'none');
    return apply();
  }

  function restore() {
    viewportTransitionActive = false;
    cancelTransitionFrame();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    const launchMask = document.getElementById(LAUNCH_MASK_ID);
    if (launchMask) launchMask.remove();
    document.querySelectorAll(`[${ATTR_STYLE}]`).forEach((element) => {
      element.setAttribute('style', element.getAttribute(ATTR_STYLE) || '');
      element.removeAttribute(ATTR_STYLE);
      element.removeAttribute(ATTR_HIDDEN);
    });
    return { ok: true };
  }

  function scheduleApply() {
    if (viewportTransitionActive || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      if (!viewportTransitionActive) apply();
    });
  }

  const observer = new MutationObserver(() => {
    if (findGameFrame()) scheduleApply();
  });
  const startObserver = () => {
    if (document.body && !observerActive) {
      observer.observe(document.body, { childList: true, subtree: true });
      observerActive = true;
    }
  };

  window.addEventListener('resize', () => {
    if (viewportTransitionActive) return;
    if (transitionFrame || transitionCompletion) {
      cancelTransitionFrame();
      const frame = findGameFrame();
      if (frame) setStyle(frame, 'transition', 'none');
    }
    scheduleApply();
  }, { passive: true });
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

  window.__MT_GAME_FOCUS__ = {
    enableAggressive: apply,
    enableSafe: apply,
    apply,
    prepareViewportTransition,
    beginViewportTransition,
    endViewportTransition,
    restore,
    configure(options) {
      const config = options || {};
      const previousUserScale = userScale;
      gameContentReady = !!config.contentReady;
      if (!gameContentReady) startObserver();
      if (config.fill) themeColor = String(config.fill);
      if (config.gameSize === null) {
        gameWidth = 960;
        gameHeight = 640;
      } else if (
        config.gameSize &&
        Number.isFinite(config.gameSize.width) && Number.isFinite(config.gameSize.height) &&
        config.gameSize.width > 0 && config.gameSize.height > 0
      ) {
        gameWidth = config.gameSize.width;
        gameHeight = config.gameSize.height;
      }
      const numeric = Number(config.userScale);
      userScale = Number.isFinite(numeric) ? Math.min(2.5, Math.max(0.7, numeric)) : 1;
      if (config.animateScale && Math.abs(previousUserScale - userScale) > 0.0001) {
        return animateUserScale(config.duration);
      }
      return apply();
    },
    setContentReady(value) {
      gameContentReady = !!value;
      if (!gameContentReady) startObserver();
      return apply();
    },
    setUserScale(value) {
      const numeric = Number(value);
      userScale = Number.isFinite(numeric) ? Math.min(2.5, Math.max(0.7, numeric)) : 1;
      return apply();
    },
    setTheme(colors) {
      if (colors && colors.fill) themeColor = String(colors.fill);
      return apply();
    },
    diagnose() {
      return {
        href: location.href,
        hasGameFrame: !!findGameFrame(),
        gameContentReady,
        userScale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    },
  };
})();
