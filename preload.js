const { contextBridge, ipcRenderer, nativeImage } = require('electron');

const keyIcons = new Map();
function getKeyIcon(keyCode) {
  if (process.platform !== 'darwin' || typeof keyCode !== 'string' || !/^(?:Key[A-Z]|Digit[0-9])$/.test(keyCode)) return '';
  if (keyIcons.has(keyCode)) return keyIcons.get(keyCode);
  let icon = '';
  try {
    const name = keyCode.replace(/^(Key|Digit)/, '').toLowerCase() + '.square';
    const image = nativeImage.createFromNamedImage(name);
    if (!image.isEmpty()) icon = image.toDataURL();
  } catch {
    // Keep the binding text usable if the system symbol is unavailable.
  }
  keyIcons.set(keyCode, icon);
  return icon;
}

contextBridge.exposeInMainWorld('mtAigis', {
  getKeyIcon,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  version: '2.0.0',
});
