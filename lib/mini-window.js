const CURSOR_INTERVAL_MS = 80;
const MOVE_GRACE_MS = 160;

function createMiniWindowControls(window, screen, initialRevealOnHover = false, gameContents) {
  let opacity = 100;
  let revealOnHover = initialRevealOnHover;
  let canHide = !initialRevealOnHover;
  let hiddenByHover = false;
  let draggingOpacity = false;
  let gameMouseDown = false;
  let resizing = false;
  let keepVisibleUntil = 0;
  let bounds = null;
  let timer = null;

  function updateBounds() {
    if (revealOnHover) bounds = window.getBounds();
  }

  function sampleCursor() {
    if (window.isDestroyed() || !bounds || draggingOpacity || gameMouseDown ||
      resizing || Date.now() < keepVisibleUntil) return;
    const point = screen.getCursorScreenPoint();
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width &&
      point.y >= bounds.y && point.y < bounds.y + bounds.height;
    if (inside) {
      canHide = true;
      if (hiddenByHover) {
        hiddenByHover = false;
        window.showInactive();
      }
    } else if (canHide && !hiddenByHover && window.isVisible()) {
      hiddenByHover = true;
      window.hide();
    }
  }

  function stopSampling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function syncSampling() {
    if (!revealOnHover || window.isDestroyed() || window.isMinimized() ||
      (!hiddenByHover && !window.isVisible())) {
      stopSampling();
      return;
    }
    if (timer) return;
    updateBounds();
    timer = setInterval(sampleCursor, CURSOR_INTERVAL_MS);
    timer.unref?.();
  }

  function onGeometryChange() {
    if (!revealOnHover) return;
    updateBounds();
    keepVisibleUntil = Date.now() + MOVE_GRACE_MS;
  }

  function clearGameMouseDown() {
    gameMouseDown = false;
  }

  function onGameMouseEvent(_event, mouse) {
    if (mouse.button !== 'left') return;
    if (mouse.type === 'mouseDown') {
      gameMouseDown = true;
      canHide = true;
    } else if (mouse.type === 'mouseUp' && gameMouseDown) {
      clearGameMouseDown();
      // Let the game process the release before the window can hide.
      keepVisibleUntil = Math.max(keepVisibleUntil, Date.now() + CURSOR_INTERVAL_MS);
    }
  }

  function clearInteraction() {
    draggingOpacity = false;
    clearGameMouseDown();
    resizing = false;
  }

  const listeners = {
    move: onGeometryChange,
    'will-resize': () => { resizing = true; },
    resize: onGeometryChange,
    resized: () => { resizing = false; onGeometryChange(); },
    blur: clearInteraction,
    hide: () => { clearInteraction(); syncSampling(); },
    show: () => { updateBounds(); syncSampling(); },
    minimize: () => { clearInteraction(); stopSampling(); },
    restore: syncSampling,
  };
  for (const [event, listener] of Object.entries(listeners)) window.on(event, listener);

  const gameListeners = {
    'before-mouse-event': onGameMouseEvent,
    blur: clearGameMouseDown,
    'did-navigate': clearGameMouseDown,
    'render-process-gone': clearGameMouseDown,
    destroyed: clearGameMouseDown,
  };
  for (const [event, listener] of Object.entries(gameListeners)) gameContents?.on(event, listener);

  return {
    update(changes) {
      if (Number.isFinite(changes?.opacity)) {
        const next = Math.max(20, Math.min(100, Math.round(changes.opacity)));
        if (next !== opacity) window.setOpacity(next / 100);
        opacity = next;
      }
      if (typeof changes?.draggingOpacity === 'boolean') draggingOpacity = changes.draggingOpacity;
      if (typeof changes?.revealOnHover === 'boolean' && revealOnHover !== changes.revealOnHover) {
        revealOnHover = changes.revealOnHover;
        canHide = true;
        if (!revealOnHover && hiddenByHover) {
          hiddenByHover = false;
          window.showInactive();
        }
        syncSampling();
      }
      return { opacity, revealOnHover };
    },
    dispose() {
      stopSampling();
      for (const [event, listener] of Object.entries(listeners)) window.removeListener(event, listener);
      for (const [event, listener] of Object.entries(gameListeners)) gameContents?.removeListener(event, listener);
    },
  };
}

module.exports = { createMiniWindowControls };
