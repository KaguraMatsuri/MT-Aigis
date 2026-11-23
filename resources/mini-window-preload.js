const { contextBridge, ipcRenderer, nativeImage } = require('electron');

let revealIcon;
function getRevealIcon() {
  if (revealIcon !== undefined) return revealIcon;
  try {
    const eye = nativeImage.createFromNamedImage('eye');
    revealIcon = eye.isEmpty() ? '' : eye.toDataURL();
  } catch {
    revealIcon = '';
  }
  return revealIcon;
}

contextBridge.exposeInMainWorld('mtAigisMini', {
  getRevealIcon,
  controls: (changes) => ipcRenderer.invoke('window:mini:controls', changes),
  onState: (callback) => {
    ipcRenderer.on('window:mini:state', (_, state) => callback(state));
  },
});
