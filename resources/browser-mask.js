(function () {
  'use strict';

  if (window.__MT_BROWSER_MASK__) return;
  window.__MT_BROWSER_MASK__ = true;

  const define = (target, key, getter) => {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
    } catch {}
  };

  define(Navigator.prototype, 'webdriver', () => false);
  define(Navigator.prototype, 'language', () => 'ja');
  define(Navigator.prototype, 'languages', () => ['ja', 'en-US', 'en']);
  define(Navigator.prototype, 'platform', () => 'MacIntel');
  define(Navigator.prototype, 'vendor', () => 'Google Inc.');

  if (!window.chrome) {
    window.chrome = {};
  }

  if (!window.chrome.runtime) {
    window.chrome.runtime = {};
  }

  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
    };
  }

  if (!window.chrome.csi) {
    window.chrome.csi = function () {
      return {
        onloadT: Date.now(),
        startE: performance.timeOrigin || Date.now(),
        pageT: Math.floor(performance.now()),
        tran: 15,
      };
    };
  }

  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function () {
      const timing = performance.timing || {};
      return {
        requestTime: (timing.requestStart || Date.now()) / 1000,
        startLoadTime: (timing.navigationStart || Date.now()) / 1000,
        commitLoadTime: (timing.responseStart || Date.now()) / 1000,
        finishDocumentLoadTime: (timing.domContentLoadedEventEnd || Date.now()) / 1000,
        finishLoadTime: (timing.loadEventEnd || Date.now()) / 1000,
        firstPaintTime: ((performance.timeOrigin || Date.now()) + (performance.now() || 0)) / 1000,
      };
    };
  }

  const originalQuery = navigator.permissions && navigator.permissions.query
    ? navigator.permissions.query.bind(navigator.permissions)
    : null;

  if (originalQuery) {
    navigator.permissions.query = (parameters) => {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return originalQuery(parameters);
    };
  }

  if (window.screen) {
    define(screen, 'colorDepth', () => 24);
    define(screen, 'pixelDepth', () => 24);
  }
})();
