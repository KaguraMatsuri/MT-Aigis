const { contextBridge, ipcRenderer, nativeImage } = require('electron');

let keyboardIcon = '';
if (process.platform === 'darwin') {
  try {
    const image = nativeImage.createFromNamedImage('keyboard');
    if (!image.isEmpty()) keyboardIcon = image.toDataURL();
  } catch {
    // Keep the binding text usable if the system symbol is unavailable.
  }
}

contextBridge.exposeInMainWorld('mtAigis', {
  keyboardIcon,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  version: '2.0.0',
});
