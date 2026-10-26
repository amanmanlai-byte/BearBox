'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jj', {
  call: (name, args) => ipcRenderer.invoke('jj', name, args),
  on: (channel, cb) => { const f = (_e, data) => cb(data); ipcRenderer.on(channel, f); return () => ipcRenderer.removeListener(channel, f); },
});
