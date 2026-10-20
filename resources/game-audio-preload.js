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
  const mediaLevels = new WeakMap();
  const mediaReferences = new Set();
  const collectedMedia = new FinalizationRegistry(reference => mediaReferences.delete(reference));
  const Media = window.HTMLMediaElement;
  const nativeVolume = Media && Object.getOwnPropertyDescriptor(Media.prototype, 'volume');

  function applyMediaVolume(element, entry) {
    entry.applied = entry.level * (entry.routed ? 1 : volume / 100);
    nativeVolume.set.call(element, entry.applied);
  }

  function trackMedia(element) {
    let entry = mediaLevels.get(element);
    if (!entry) {
      entry = { level: nativeVolume.get.call(element), routed: false };
      mediaLevels.set(element, entry);
      const reference = new WeakRef(element);
      mediaReferences.add(reference);
      collectedMedia.register(element, reference);
    }
    return entry;
  }

  if (nativeVolume) {
    Object.defineProperty(Media.prototype, 'volume', {
      ...nativeVolume,
      get() {
        const value = nativeVolume.get.call(this);
        return mediaLevels.get(this)?.level ?? value;
      },
      set(value) {
        nativeVolume.get.call(this); // Preserve the native receiver check.
        const numeric = +value;
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
          return nativeVolume.set.call(this, numeric);
        }
        const entry = trackMedia(this);
        entry.level = numeric;
        applyMediaVolume(this, entry);
      },
    });
    const nativePlay = Media.prototype.play;
    Media.prototype.play = function (...args) {
      applyMediaVolume(this, trackMedia(this));
      return nativePlay.apply(this, args);
    };
    const nativeMediaSource = Context.prototype.createMediaElementSource;
    Context.prototype.createMediaElementSource = function (...args) {
      const source = nativeMediaSource.apply(this, args);
      const entry = trackMedia(source.mediaElement);
      entry.routed = true;
      applyMediaVolume(source.mediaElement, entry);
      return source;
    };
    function onMediaEvent(event) {
      if (!(event.target instanceof Media)) return;
      const element = event.target;
      const entry = mediaLevels.get(element);
      if (!entry) { applyMediaVolume(element, trackMedia(element)); return; }
      const value = nativeVolume.get.call(element);
      if (value !== entry.applied) {
        entry.level = value;
        applyMediaVolume(element, entry);
      }
    }
    // Capture autoplay and native media controls without polling the document.
    for (const event of ['loadstart', 'play', 'volumechange']) {
      document.addEventListener(event, onMediaEvent, true);
    }
    function scanMedia() {
      document.querySelectorAll('audio, video').forEach(element => applyMediaVolume(element, trackMedia(element)));
    }
    scanMedia();
    document.addEventListener('DOMContentLoaded', scanMedia, { once: true });
  }

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
      for (const reference of mediaReferences) {
        const element = reference.deref();
        if (!element) { mediaReferences.delete(reference); continue; }
        applyMediaVolume(element, mediaLevels.get(element));
      }
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
