function installGameBackgroundActivity(window, contents, { isGameUrl, onError }) {
  const debuggerApi = contents.debugger;
  let disposed = false;
  let owned = false;
  let applied = null;
  let generation = 0;
  let dirty = false;
  let task = null;

  function detach() {
    if (!owned) return;
    owned = false;
    applied = null;
    try { if (debuggerApi.isAttached()) debuggerApi.detach(); } catch (_) {}
  }

  function sync() {
    if (disposed) return Promise.resolve();
    dirty = true;
    if (task) return task;
    task = Promise.resolve().then(async () => {
      while (dirty && !disposed && !window.isDestroyed() && !contents.isDestroyed()) {
        dirty = false;
        const version = generation;
        const enabled = isGameUrl(contents.getURL()) &&
          (!window.isVisible() || window.isMinimized() || !window.isFocused());
        if (applied === enabled) continue;
        if (!owned) {
          if (!enabled || debuggerApi.isAttached() || contents.isDevToolsOpened()) continue;
          debuggerApi.attach('1.3');
          owned = true;
        }
        // Reapply after navigation: the native render widget may have been replaced.
        if (enabled) contents.setBackgroundThrottling(false);
        await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled });
        if (disposed) break;
        applied = version === generation ? enabled : null;
        if (!enabled) detach();
      }
    }).catch(error => {
      detach();
      if (!disposed && !contents.isDestroyed()) onError(error);
    }).finally(() => {
      task = null;
      if (dirty && !disposed) sync();
    });
    return task;
  }

  function refresh() {
    generation++;
    applied = null;
    return sync();
  }

  function onDetach() {
    generation++;
    owned = false;
    applied = null;
  }

  const windowEvents = ['blur', 'focus', 'minimize', 'restore', 'hide', 'show'];
  const pageEvents = ['did-navigate', 'did-frame-finish-load', 'devtools-closed'];
  function dispose() {
    if (disposed) return;
    disposed = true;
    dirty = false;
    for (const event of windowEvents) window.removeListener(event, sync);
    for (const event of pageEvents) contents.removeListener(event, refresh);
    window.removeListener('closed', dispose);
    contents.removeListener('destroyed', dispose);
    debuggerApi.removeListener('detach', onDetach);
    detach();
  }

  for (const event of windowEvents) window.on(event, sync);
  for (const event of pageEvents) contents.on(event, refresh);
  window.once('closed', dispose);
  contents.once('destroyed', dispose);
  debuggerApi.on('detach', onDetach);
  sync();
  return { sync, dispose };
}

module.exports = { installGameBackgroundActivity };
