function installGameAudio(initialVolume) {
  if (window.__MT_GAME_AUDIO__) return true;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context || !window.AudioNode) return false;
  const nativeConnect = AudioNode.prototype.connect;
  const nativeDisconnect = AudioNode.prototype.disconnect;
  const masters = new WeakMap();
  const active = new Set();
  const collected = new FinalizationRegistry(reference => active.delete(reference));
  let volume = Math.max(0, Math.min(100, Number(initialVolume) || 0));

  function master(context) {
    let entry = masters.get(context);
    if (entry) return entry;
    const gain = context.createGain();
    gain.gain.value = volume / 100;
    nativeConnect.call(gain, context.destination);
    entry = { context, gain };
    masters.set(context, entry);
    const reference = new WeakRef(entry);
    active.add(reference);
    collected.register(context, reference, entry);
    const onState = () => {
      if (context.state !== 'closed') return;
      active.delete(reference);
      collected.unregister(entry);
      masters.delete(context);
      context.removeEventListener('statechange', onState);
    };
    context.addEventListener('statechange', onState);
    return entry;
  }

  AudioNode.prototype.connect = function (...args) {
    const destination = args[0];
    const context = this.context;
    if (context instanceof Context && context.state !== 'closed' && destination === context.destination) {
      const entry = master(context);
      args[0] = entry.gain;
      nativeConnect.apply(this, args);
      return destination;
    }
    return nativeConnect.apply(this, args);
  };
  AudioNode.prototype.disconnect = function (...args) {
    if (args[0] === this.context.destination) {
      const entry = masters.get(this.context);
      if (entry) args[0] = entry.gain;
    }
    return nativeDisconnect.apply(this, args);
  };

  Object.defineProperty(window, '__MT_GAME_AUDIO__', { value: Object.freeze({
    setVolume(value) {
      if (!Number.isFinite(value) || value < 0 || value > 100) return false;
      volume = value;
      for (const reference of active) {
        const entry = reference.deref();
        if (!entry) { active.delete(reference); continue; }
        const { context, gain } = entry;
        if (context.state === 'closed') continue;
        const now = context.currentTime;
        gain.gain.cancelAndHoldAtTime(now);
        gain.gain.setTargetAtTime(volume / 100, now, 0.02);
      }
      return true;
    },
  }) });
  return true;
}

if (typeof document !== 'undefined' && /^https?:$/.test(location.protocol)) {
  const { contextBridge, ipcRenderer } = require('electron');
  // Install before page scripts create audio nodes; wait silently for the saved level.
  contextBridge.executeInMainWorld({ func: installGameAudio, args: [0] });
  let revision = -1;
  function applyState(state) {
    if (!state || !Number.isFinite(state.volume) || !Number.isSafeInteger(state.revision) ||
      state.revision < revision || state.volume < 0 || state.volume > 100) return;
    revision = state.revision;
    contextBridge.executeInMainWorld({
      func: value => window.__MT_GAME_AUDIO__?.setVolume(value), args: [state.volume],
    });
  }
  ipcRenderer.on('audio:state', (_event, state) => applyState(state));
  ipcRenderer.invoke('audio:state').then(applyState).catch(() => {
    if (revision < 0) applyState({ volume: 100, revision: 0 });
  });
}

if (typeof module !== 'undefined') module.exports = { installGameAudio };
