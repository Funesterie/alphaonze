'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('funesterie', {
  bootstrap: () => ipcRenderer.invoke('funesterie:bootstrap'),
  setProfile: (profileId) => ipcRenderer.invoke('funesterie:set-profile', profileId),
  listTools: () => ipcRenderer.invoke('funesterie:list-tools'),
  callTool: (name, args) => ipcRenderer.invoke('funesterie:call-tool', { name, args }),
  chat: (message) => ipcRenderer.invoke('funesterie:chat', message),
  checkUpdates: () => ipcRenderer.invoke('funesterie:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('funesterie:download-update'),
  openExternal: (url) => ipcRenderer.invoke('funesterie:open-external', url)
});
