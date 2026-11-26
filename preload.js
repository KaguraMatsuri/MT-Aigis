const { contextBridge, ipcRenderer, nativeImage } = require('electron');

const keyIcons = new Map();
let miniWindowIcon;
let revealIcon;

function namedIconData(name) {
  try {
    const image = nativeImage.createFromNamedImage(name);
    return image.isEmpty() ? '' : image.toDataURL();
  } catch {
    return '';
  }
}

function getKeyIcon(keyCode) {
  if (process.platform !== 'darwin' || typeof keyCode !== 'string' || !/^(?:Key[A-Z]|Digit[0-9])$/.test(keyCode)) return '';
  if (keyIcons.has(keyCode)) return keyIcons.get(keyCode);
  const name = keyCode.replace(/^(Key|Digit)/, '').toLowerCase() + '.square';
  const icon = namedIconData(name);
  keyIcons.set(keyCode, icon);
  return icon;
}

contextBridge.exposeInMainWorld('mtAigis', {
  getKeyIcon,
  getMiniWindowIcon() {
    if (process.platform !== 'darwin') return '';
    return miniWindowIcon ??= namedIconData('fish');
  },
  getRevealIcon() {
    if (process.platform !== 'darwin') return '';
    return revealIcon ??= namedIconData('eye');
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  version: '2.0.0',
});
