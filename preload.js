const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oscAPI', {
  sendOSC: (payload) => ipcRenderer.send('osc:send', payload),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  exportConfig: (jsonStr) => ipcRenderer.invoke('config:export', jsonStr),
  importConfig: () => ipcRenderer.invoke('config:import'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  getLocalIPs: () => ipcRenderer.invoke('app:get-ips'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url)
});