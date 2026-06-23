const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mtAigis', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  version: '2.0.0',
});
