const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { defaultConfig } = require('../lib/secure-config');
const root = path.join(__dirname, '..');
const driver = fs.readFileSync(path.join(root, 'resources/game-audio-preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}
const turn = () => new Promise(setImmediate);

function audioPage() {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.window = globalThis;
    class AudioNode {
      constructor(context) { this.context = context; this.connections = []; }
      connect(destination, ...ports) { this.connections.push([destination, ...ports]); return destination; }
      disconnect(...args) { this.disconnected = args; }
    }
    class BaseContext {
      constructor() { this.state = 'running'; this.currentTime = 1; this.destination = new AudioNode(this); this.gains = []; this.listeners = new Set(); }
      createGain() {
        const gain = new AudioNode(this);
        gain.gain = { value: 1, targets: [], cancelAndHoldAtTime(time) { this.held = time; }, setTargetAtTime(value, time, constant) { this.targets.push({value, time, constant}); } };
        this.gains.push(gain); return gain;
      }
      addEventListener(_name, callback) { this.listeners.add(callback); }
      removeEventListener(_name, callback) { this.listeners.delete(callback); }
      close() { this.state = 'closed'; for (const listener of this.listeners) listener(); }
    }
    class AudioContext extends BaseContext {}
    class OfflineAudioContext extends BaseContext {}
    window.AudioNode = AudioNode; window.AudioContext = AudioContext;
    window.OfflineAudioContext = OfflineAudioContext;
  `, context);
  vm.runInContext(driver, context);
  return context;
}

test('inserts one master gain without overwriting game levels or chaining return values', () => {
  const c = audioPage(); c.installGameAudio(50);
  vm.runInContext(`
    const audio = new AudioContext();
    const music = audio.createGain(); music.gain.value = 0.2;
    const effects = audio.createGain(); effects.gain.value = 0.8;
    globalThis.result = { audio, music, effects, destination: music.connect(audio.destination, 0, 0) };
    effects.connect(audio.destination);
  `, c);
  const { audio, music, effects, destination } = c.result, master = audio.gains[2];
  assert.equal(audio.gains.length, 3); assert.equal(master.gain.value, 0.5);
  assert.equal(music.gain.value, 0.2); assert.equal(effects.gain.value, 0.8);
  assert.equal(destination, audio.destination);
  assert.equal(music.connections[0][0], master); assert.equal(effects.connections[0][0], master);
  assert.equal(master.connections[0][0], audio.destination);
  c.__MT_GAME_AUDIO__.setVolume(25);
  assert.equal(master.gain.targets.at(-1).value, 0.25);
  assert.equal(master.gain.targets.at(-1).constant, 0.02);
  assert.equal(music.gain.value, 0.2);
  music.disconnect(audio.destination, 0, 0);
  assert.equal(music.disconnected[0], master);
  assert.deepEqual(Array.from(music.disconnected).slice(1), [0, 0]);
  effects.disconnect(); assert.equal(effects.disconnected.length, 0);
});

test('preserves offline processing, parameter connections and independent audio contexts', () => {
  const c = audioPage(); c.installGameAudio(40);
  vm.runInContext(`
    const offline = new OfflineAudioContext(), offSource = offline.createGain();
    offSource.connect(offline.destination);
    const first = new AudioContext(), second = new AudioContext();
    const source = first.createGain(), other = second.createGain();
    source.connect(source.gain);
    source.connect(first.destination); other.connect(second.destination);
    globalThis.result = {offline, offSource, first, second, source};
  `, c);
  const { offline, offSource, first, second, source } = c.result;
  assert.equal(offline.gains.length, 1); assert.equal(offSource.connections[0][0], offline.destination);
  assert.equal(source.connections[0][0], source.gain);
  c.__MT_GAME_AUDIO__.setVolume(0);
  assert.equal(first.gains[1].gain.targets.at(-1).value, 0);
  assert.equal(second.gains[1].gain.targets.at(-1).value, 0);
  assert.equal(c.__MT_GAME_AUDIO__.setVolume(NaN), false);
  first.close(); assert.equal(first.listeners.size, 0);
  const calls = first.gains[1].gain.targets.length;
  c.__MT_GAME_AUDIO__.setVolume(100);
  assert.equal(first.gains[1].gain.targets.length, calls);
  assert.equal(second.gains[1].gain.targets.at(-1).value, 1);
  c.installGameAudio(10);
  source.connect(first.destination);
  assert.equal(first.gains.length, 2);
});

test('installs before page audio and rejects a stale initialization reply after a live volume update', async () => {
  const c = audioPage(); let respond, onState;
  const initial = new Promise(resolve => { respond = resolve; });
  c.document = {}; c.location = { protocol: 'https:' };
  c.require = () => ({
    contextBridge: { executeInMainWorld({ func, args }) {
      return vm.runInContext('(' + func.toString() + ')(...' + JSON.stringify(args || []) + ')', c);
    } },
    ipcRenderer: { on(_name, listener) { onState = listener; }, invoke() { return initial; } },
  });
  vm.runInContext(driver, c);
  vm.runInContext('globalThis.audio = new AudioContext(); audio.createGain().connect(audio.destination);', c);
  assert.equal(c.audio.gains[1].gain.value, 0);
  onState({}, { volume: 20, revision: 2 });
  respond({ volume: 100, revision: 0 }); await turn();
  assert.equal(c.audio.gains[1].gain.targets.at(-1).value, 0.2);
  assert.equal(c.audio.gains[1].gain.targets.length, 1);
});

function nativeAudio() {
  const handlers = new Map(), sent = [], saved = [];
  const frame = { isDestroyed: () => false, send: (channel, state) => sent.push({ channel, state }) };
  const c = vm.createContext({
    mainWindow: { webContents: { id: 1 } },
    gameView: { webContents: { id: 2, isDestroyed: () => false, mainFrame: { framesInSubtree: [frame, frame] } } },
    gameAudioVolume: 100, gameAudioRevision: 0, currentConfig: defaultConfig(),
    store: { save(config) { saved.push(config); } }, sendToRenderer() {},
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
  });
  vm.runInContext(section(main, 'function normalizeAudioVolume(', 'function normalizeZoomFactor(') +
    section(main, 'function getGameAudioState(', "ipcMain.handle('window:titlebar-toggle'"), c);
  return { c, handlers, sent, saved, set: payload => handlers.get('audio:set-volume')({ sender: { id: 1 } }, payload) };
}

test('previews volume without writes, saves the final value and limits mutation to the client UI', () => {
  const h = nativeAudio();
  assert.equal(h.handlers.get('audio:set-volume')({ sender: { id: 2 } }, { volume: 10, save: true }), null);
  assert.equal(h.handlers.get('audio:state')({ sender: { id: 999 } }), null);
  for (const volume of [NaN, Infinity, -1, 101, '50']) assert.equal(h.set({ volume, save: true }), null);
  for (let i = 99; i >= 50; i--) h.set({ volume: i, save: false });
  assert.equal(h.saved.length, 0); assert.equal(h.c.currentConfig.view.audioVolume, 100);
  h.set({ volume: 50, save: true });
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].view.audioVolume, 50);
  assert.equal(h.c.currentConfig.view.audioVolume, 50);
  assert.equal(h.handlers.get('audio:state')({ sender: { id: 2 } }).volume, 50);
  h.c.store.save = () => { throw new Error('fixture EACCES'); };
  assert.throws(() => h.set({ volume: 30, save: true }), /EACCES/);
  assert.equal(h.c.currentConfig.view.audioVolume, 50);
});

test('normalizes old configurations to 100 percent and preserves zero', () => {
  const h = nativeAudio();
  for (const value of [undefined, null, NaN, '']) assert.equal(h.c.normalizeAudioVolume(value), 100);
  assert.equal(h.c.normalizeAudioVolume(0), 0);
  assert.equal(defaultConfig().view.audioVolume, 100);
});

test('coalesces slider input, saves on release and ignores stale responses during editing', async () => {
  const handlers = new Map(), timers = new Map(), calls = [], replies = [];
  const nodes = { 'game-volume': { value: '100', addEventListener(name, fn) { handlers.set(name, fn); } }, 'game-volume-value': {} };
  const c = vm.createContext({
    byId: id => nodes[id], volumeEditing: false, volumeTimer: null, volumeRequestRevision: 0,
    volumeRequests: 0, audioRevision: -1, setRuntime() {}, errorText: e => e.message,
    setTimeout(fn) { timers.set(fn, true); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    api: { invoke(channel, payload) { calls.push({ channel, payload }); return new Promise(resolve => replies.push(resolve)); } },
  });
  vm.runInContext(section(sidebar, '  function renderAudioState(', '  function refreshBrowserState(') +
    section(sidebar, "  byId('game-volume').addEventListener('input'", "  byId('btn-ping-all').addEventListener"), c);
  for (let i = 99; i >= 20; i--) { nodes['game-volume'].value = String(i); handlers.get('input').call(nodes['game-volume']); }
  assert.equal(timers.size, 1); assert.equal(calls.length, 0);
  c.renderAudioState({ volume: 100, revision: 0 }); assert.equal(nodes['game-volume'].value, '20');
  handlers.get('change')();
  assert.equal(timers.size, 0); assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.volume, 20); assert.equal(calls[0].payload.save, true);
  replies.shift()({ volume: 20, revision: 1 }); await turn();
  assert.equal(nodes['game-volume-value'].textContent, '20%'); assert.equal(c.volumeRequests, 0);
  c.renderAudioState({ volume: 100, revision: 0 }); assert.equal(nodes['game-volume'].value, '20');
  c.volumeRequests = 1;
  c.renderAudioState({ volume: 30, revision: 2 });
  c.volumeRequests = 0;
  c.renderAudioState({ volume: 100, revision: 0 });
  assert.equal(nodes['game-volume'].value, '20');
  assert.equal(c.audioRevision, 2);
});
