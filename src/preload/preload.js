'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Única superficie que la interfaz puede tocar: no se expone `require`, ni
 * rutas del sistema, ni acceso directo a Electron.
 */
contextBridge.exposeInMainWorld('mundial', {
  channels: () => ipcRenderer.invoke('channels:list'),
  refresh: () => ipcRenderer.invoke('channels:refresh'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (changes) => ipcRenderer.invoke('settings:set', changes),
  info: () => ipcRenderer.invoke('app:info'),
  openOfficial: (payload) => ipcRenderer.invoke('official:open', payload),
  updateOfficialBounds: (bounds) => ipcRenderer.invoke('official:bounds', bounds),
  closeOfficial: () => ipcRenderer.invoke('official:close'),
  toggleMiniView: (active) => ipcRenderer.invoke('official:mini', active),
  setOfficialVisible: (visible) => ipcRenderer.invoke('official:visible', visible),
  onMiniChange: (listener) => {
    ipcRenderer.on('official:mini-changed', (_event, payload) => listener(payload));
  },
  onAdSkipped: (listener) => {
    ipcRenderer.on('official:ad-skipped', (_event, payload) => listener(payload));
  },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  publishRemoteState: (state) => ipcRenderer.send('remote:state', state),
  controlOfficialPlayback: (action, value) => ipcRenderer.invoke('official:control', action, value),
  onRemoteCommand: (listener) => {
    ipcRenderer.on('remote:command', (_event, command) => listener(command));
  },
  onCatalogue: (listener) => {
    ipcRenderer.on('channels:updated', (_event, payload) => listener(payload));
  },
});
