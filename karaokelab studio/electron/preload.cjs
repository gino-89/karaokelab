const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  selectFolderDialog: (options) => ipcRenderer.invoke('dialog:selectFolder', options),
  syncWriteSongsToFolder: (payload) => ipcRenderer.invoke('sync:writeSongs', payload),
  syncReadFolderInfo: (folderPath) => ipcRenderer.invoke('sync:readFolderInfo', folderPath),
  syncReadFolderSongs: (folderPath) => ipcRenderer.invoke('sync:readFolderSongs', folderPath),
  getAIServerStatus: () => ipcRenderer.invoke('ai:getStatus'),
  onAIStatusUpdate: (callback) => {
    const subscription = (_event, status) => callback(status);
    ipcRenderer.on('ai:statusUpdate', subscription);
    return () => ipcRenderer.removeListener('ai:statusUpdate', subscription);
  }
});
