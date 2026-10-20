// Run with: electron test/electron-clicker-capture.cjs
// Keyboard events target isolated hidden renderers, never the user's desktop.
const { app, BrowserWindow, WebContentsView, ipcMain, nativeImage, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-aigis-clicker-capture-'));
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
app.on('window-all-closed', () => {});
app.setPath('userData', scratch);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('ui/sidebar.js');
const start = source.indexOf('  function renderClicker(');
const end = source.indexOf('  function updateTotpProgress(', start);
assert.ok(start >= 0 && end > start);
fs.writeFileSync(path.join(scratch, 'index.html'), read('ui/index.html')
  .replace('href="sidebar.css"', `href="${pathToFileURL(path.join(root, 'ui/sidebar.css')).href}"`)
  .replace('<script src="sidebar.js"></script>', ''));

let window, view;
const state = { enabled: true, acknowledged: true, available: true, cps: 10, keyCode: 'KeyB' };
const holds = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await check()) return; await wait(10); }
  throw new Error('Timed out waiting for the capture interaction');
}
const timeout = setTimeout(() => finish(new Error('Capture verification timed out')), 20000);
function finish(error) {
  clearTimeout(timeout);
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
  if (error) console.error(error);
  console.log(JSON.stringify({ result: error ? 'failed' : 'passed', artifacts: scratch }));
  app.exit(error ? 1 : 0);
}

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1320, height: 760,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false } });
  view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 48, width: 960, height: 640 });
  await view.webContents.loadURL('data:text/html,<style>html,body{margin:0}canvas{display:block;width:960px;height:640px}</style><canvas id="canvas" width="960" height="640"></canvas>');
  view.webContents.debugger.attach('1.3');
  view.webContents.setBackgroundThrottling(false);
  await view.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await view.webContents.executeJavaScript(read('resources/game-clicker.js'));
  await view.webContents.executeJavaScript(`window.clicks = { down: 0, up: 0 };
    document.getElementById('canvas').addEventListener('mousedown', () => clicks.down++);
    document.getElementById('canvas').addEventListener('mouseup', () => clicks.up++);`);
  const configure = () => view.webContents.executeJavaScript(`window.__MT_AIGIS_CLICKER__.configure(${JSON.stringify({ ...state, active: true })})`);
  await configure();
  ipcMain.handle('clicker:settings', async (_event, settings) => {
    Object.assign(state, settings); await configure();
    window.webContents.send('clicker:state', state); return state;
  });
  ipcMain.handle('clicker:hold', async (_event, held) => {
    holds.push(held);
    await view.webContents.executeJavaScript(`window.__MT_AIGIS_CLICKER__.setPointerHeld(${held})`);
    return state;
  });
  ipcMain.handle('config:get', () => ({ clicker: state }));
  await window.loadFile(path.join(scratch, 'index.html'));
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await window.webContents.executeJavaScript(`
    var api = window.mtAigis, clickerState = null, clickerPointerHeld = false, clickerUiKeyHeld = false,
      clickerCpsEditing = false, clickerSettingsRevision = 0;
    function byId(id) { return document.getElementById(id); }
    window.errors = []; function errorText(error) { return error.message; }
    function setRuntime(message) { errors.push(message); } function setSettingsMessage(message) { errors.push(message); }
    ${source.slice(start, end)}
    byId('page-game').classList.remove('active'); byId('page-settings').classList.add('active');
    installClickerControls(); renderClicker(${JSON.stringify(state)});
    api.on('clicker:state', renderClicker);
    void 0;
  `);
  const snapshot = () => view.webContents.executeJavaScript('({ ...clicks })');
  async function key(type, code, autoRepeat = false) {
    const label = code.replace(/^(Key|Digit)/, '');
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, code, key: code.startsWith('Key') ? label.toLowerCase() : label,
      windowsVirtualKeyCode: code.startsWith('F') ? 111 + Number(label.slice(1)) : label.charCodeAt(0), autoRepeat,
    });
  }
  for (const code of ['KeyB', 'KeyC', 'Digit2', 'F12', 'KeyB']) {
    const before = await snapshot(); const heldBefore = holds.filter(Boolean).length;
    await window.webContents.executeJavaScript("byId('clicker-key').focus()");
    await key('rawKeyDown', code);
    await until(() => window.webContents.executeJavaScript(`clickerState.keyCode === '${code}'`));
    const symbol = await window.webContents.executeJavaScript(`({
      image: api.getKeyIcon('${code}'), value: byId('clicker-key').value,
      iconDisplay: getComputedStyle(document.querySelector('.keyboard-icon')).display,
      textDisplay: getComputedStyle(byId('story-skip-key')).display,
      accessibleName: byId('btn-story-skip').getAttribute('aria-label')
    })`);
    const label = code.replace(/^(Key|Digit)/, '');
    const expected = code === 'F12' ? '' : nativeImage.createFromNamedImage(label.toLowerCase() + '.square').toDataURL();
    assert.equal(symbol.image, expected);
    assert.equal(symbol.value, label);
    assert.equal(symbol.accessibleName, '跳过剧情[' + label + ']');
    assert.equal(symbol.iconDisplay === 'none', !expected);
    assert.equal(symbol.textDisplay === 'none', !!expected);
    assert.equal(await window.webContents.executeJavaScript('document.activeElement.id'), 'clicker-key');
    await key('rawKeyDown', code, true);
    await key('rawKeyDown', code); // A late duplicate must also remain part of capture.
    await key('keyUp', code);
    assert.notEqual(await window.webContents.executeJavaScript('document.activeElement.id'), 'clicker-key');
    assert.deepEqual(await snapshot(), before);
    assert.equal(holds.filter(Boolean).length, heldBefore);
    await key('rawKeyDown', code);
    await until(async () => (await snapshot()).down > before.down);
    await key('keyUp', code);
    await until(async () => { const result = await snapshot(); return result.down === result.up; });
    const released = await snapshot(); await wait(150);
    assert.deepEqual(await snapshot(), released);
    console.log(JSON.stringify({ key: code, captureClicks: 0, nextPressClicks: released.down - before.down }));
  }
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await window.webContents.executeJavaScript(`document.getAnimations().forEach(animation => {
      animation.pause(); animation.currentTime = 1000;
    }); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(scratch, 'key-symbol-' + theme + '.png'), image.toPNG());
  }
  assert.deepEqual(await window.webContents.executeJavaScript('errors'), []);
}).then(() => finish()).catch(finish);
