// Run with: electron test/electron-game-runtime.cjs
// Uses hidden windows, a temporary profile, loopback fixtures and muted output.
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { installGameBackgroundActivity } = require('../lib/game-background');
const { defaultConfig } = require('../lib/secure-config');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-aigis-game-runtime-'));
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
app.on('window-all-closed', () => {});
app.setPath('userData', scratch);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1');

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function section(source, first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, first);
  return source.slice(start, end);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(25);
  }
  throw new Error(`Timed out: ${label}`);
}

function tone() {
  const rate = 8000, samples = rate, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * 8000), 44 + i * 2);
  return wav;
}
const wav = tone();
const server = http.createServer((request, response) => {
  if (request.url === '/tone.wav') {
    response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav); return;
  }
  if (request.url.startsWith('/asset')) { response.end('fixture-asset'); return; }
  const host = request.headers.host.split(':')[0];
  const child = host === 'a.test' ? 'b.test' : host === 'b.test' ? 'c.test' : null;
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<html><body>${child ? `<iframe src="http://${child}:${server.address().port}/" width="900" height="600"></iframe>` : ''}<script>
    window.framesRun = 0; window.assets = 0;
    async function draw() {
      framesRun++;
      if (framesRun === 1) for (let i = 0; i < 3; i++) {
        const result = await fetch('/asset?' + i);
        if (await result.text() !== 'fixture-asset') throw new Error('Invalid asset');
        assets++;
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    window.gains = [];
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () { const gain = createGain.call(this); gains.push(gain); return gain; };
    window.context = new AudioContext();
    const oscillator = context.createOscillator(); oscillator.connect(context.destination); oscillator.start();
    const analyser = context.createAnalyser(); gains[0].connect(analyser);
    const sink = context.createMediaStreamDestination(); analyser.connect(sink); context.resume();
    window.media = document.createElement('audio'); media.volume = 0.8;
    media.src = '/tone.wav'; media.loop = true; document.body.append(media); media.play();
    window.detached = new Audio('/tone.wav'); detached.volume = 0.6; detached.loop = true; detached.play();
    window.video = document.createElement('video'); video.autoplay = true; video.loop = true;
    video.src = '/tone.wav'; document.body.append(video);
    window.routed = new Audio('/tone.wav'); routed.volume = 0.8; routed.loop = true;
    const routedContext = new AudioContext();
    const source = routedContext.createMediaElementSource(routed); source.connect(routedContext.destination);
    const routedAnalyser = routedContext.createAnalyser(); gains[1].connect(routedAnalyser);
    const routedSink = routedContext.createMediaStreamDestination(); routedAnalyser.connect(routedSink);
    routed.play(); routedContext.resume();
    function rms(node) {
      const data = new Float32Array(node.fftSize); node.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    }
    window.sample = () => ({ host: location.hostname, visibility: document.visibilityState,
      framesRun, assets, context: context.state, gain: gains[0].gain.value,
      volume: media.volume, effective: fixtureNativeVolume.call(media),
      detached: fixtureNativeVolume.call(detached), routed: fixtureNativeVolume.call(routed),
      video: fixtureNativeVolume.call(video), videoPaused: video.paused,
      paused: media.paused, rms: rms(analyser), routedRms: rms(routedAnalyser) });
  </script></body></html>`);
});

let window, view, policy;
const errors = [];
const deadline = setTimeout(() => finish(new Error('Runtime verification exceeded 30 seconds')), 30000);
async function finish(error) {
  clearTimeout(deadline);
  policy?.dispose();
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
  server.closeAllConnections(); server.close();
  if (error) console.error(error);
  console.log(JSON.stringify({ result: error ? 'failed' : 'passed', artifacts: scratch }));
  app.exit(error ? 1 : 0);
}

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gameUrl = `http://a.test:${server.address().port}/`;
  const preload = path.join(scratch, 'audio-preload.js');
  fs.writeFileSync(preload, `require('electron').contextBridge.executeInMainWorld({ func: () => {
    window.fixtureNativeVolume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume').get;
  }});\n` + read('resources/game-audio-preload.js'));
  window = new BrowserWindow({ show: false, width: 1000, height: 700,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false } });
  view = new WebContentsView({ webPreferences: { partition: 'runtime-fixture', contextIsolation: true,
    sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, backgroundThrottling: false } });
  const contents = view.webContents;
  contents.on('preload-error', (_event, _file, error) => errors.push(error.message));
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await contents.session.setProxy({ mode: 'direct' });
  contents.session.registerPreloadScript({ id: 'mt-aigis-audio', type: 'frame', filePath: preload });
  contents.setAudioMuted(true);
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 960, height: 640 });
  view.setVisible(false); // The real launch mask also hides the game view while it loads.

  const stateFile = path.join(scratch, 'saved-config.json');
  const mainContext = vm.createContext({ mainWindow: window, gameView: view, ipcMain,
    currentConfig: defaultConfig(), gameAudioVolume: 100, gameAudioRevision: 0,
    store: { save(config) { fs.writeFileSync(stateFile, JSON.stringify(config)); } },
    sendToRenderer(channel, state) { window.webContents.send(channel, state); } });
  const main = read('main.js');
  vm.runInContext(section(main, 'function normalizeAudioVolume(', 'function normalizeZoomFactor(') +
    section(main, 'function getGameAudioState(', "ipcMain.handle('window:titlebar-toggle'"), mainContext);
  await window.loadURL('data:text/html,<input id="game-volume" type="range" min="0" max="100" value="100"><output id="game-volume-value">100%</output>');
  const sidebar = read('ui/sidebar.js');
  await window.webContents.executeJavaScript(`
    var api = window.mtAigis, volumeEditing = false, volumeTimer = null, volumeRequestRevision = 0,
      volumeRequests = 0, audioRevision = -1;
    function byId(id) { return document.getElementById(id); }
    function setRuntime(message) { throw new Error(message); }
    function errorText(error) { return error.message; }
    ${section(sidebar, '  function renderAudioState(', '  function refreshBrowserState(')}
    ${section(sidebar, "  byId('game-volume').addEventListener('input'", "  byId('btn-ping-all').addEventListener")}
  `);

  // Window states are simulated; no visible OS window or user input is touched.
  const ownerState = { focused: false, minimized: false };
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => window.isDestroyed(),
    isVisible: () => true, isFocused: () => ownerState.focused, isMinimized: () => ownerState.minimized });
  window.once('closed', () => owner.emit('closed'));
  policy = installGameBackgroundActivity(owner, contents, { isGameUrl: url => url === gameUrl,
    onError: error => errors.push(error.message) });
  const snapshot = () => Promise.all([...new Set(contents.mainFrame.framesInSubtree)]
    .map(frame => frame.executeJavaScript('window.sample()')));
  async function loaded() {
    await policy.sync();
    return until(async () => {
      const result = await snapshot();
      return result.length === 3 && result.every(frame => frame.assets === 3 && frame.framesRun > 5 &&
        frame.visibility === 'visible' && !frame.paused && !frame.videoPaused && frame.rms > 0) && result;
    }, 'nested game frames must load in the background');
  }
  await contents.loadURL(gameUrl);
  const initial = await loaded();
  assert.ok(initial.every(frame => frame.effective === 0.8 && frame.detached === 0.6 && frame.routed === 0.8));
  for (const volume of [25, 0, 100]) {
    await window.webContents.executeJavaScript(`byId('game-volume').value = '${volume}';
      byId('game-volume').dispatchEvent(new Event('input')); byId('game-volume').dispatchEvent(new Event('change'));`);
    await until(() => window.webContents.executeJavaScript('volumeRequests === 0'), 'volume IPC completion');
    const result = await until(async () => {
      const frames = await snapshot();
      return frames.every(frame => Math.abs(frame.gain - volume / 100) < 0.0001 &&
        frame.rms <= 0.8 * volume / 100 + 0.0001) && frames;
    }, 'audio gain settling');
    for (let i = 0; i < result.length; i++) {
      const frame = result[i];
      assert.equal(frame.volume, 0.8); assert.equal(frame.effective, 0.8 * volume / 100);
      assert.equal(frame.detached, 0.6 * volume / 100); assert.equal(frame.routed, 0.8);
      assert.equal(frame.video, volume / 100);
      const expected = initial[i].routedRms * volume / 100;
      assert.ok(Math.abs(frame.routedRms - expected) < 0.012, JSON.stringify(frame));
    }
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).view.audioVolume, volume);
    console.log(JSON.stringify({ volume, frames: result }));
  }
  ownerState.focused = true; owner.emit('focus'); await policy.sync();
  assert.equal(contents.debugger.isAttached(), false);
  ownerState.minimized = true; owner.emit('minimize'); await policy.sync();
  await loaded();
  const reloaded = new Promise(resolve => contents.once('did-finish-load', resolve));
  contents.reload(); await reloaded; await loaded();
  await contents.loadURL(gameUrl + 'login'); await policy.sync();
  assert.equal(contents.debugger.isAttached(), false);
  assert.deepEqual(errors, []);
  console.log('Background loading, foreground release, minimize, reload and mixed audio paths passed.');
}).then(() => finish()).catch(finish);
