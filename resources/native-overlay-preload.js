const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mtAigisOverlay', {
  onState: (listener) => {
    const wrapped = (_, state) => listener(state);
    ipcRenderer.on('native-overlay:state', wrapped);
    return () => ipcRenderer.removeListener('native-overlay:state', wrapped);
  },
  close: () => ipcRenderer.invoke('native-overlay:close'),
  openExternal: (url) => ipcRenderer.invoke('native-overlay:open-external', url),
  respondUpdate: (action) => ipcRenderer.invoke('native-overlay:update-respond', action),
});
