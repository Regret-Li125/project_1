const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesApi', {
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: (notes, folders) => ipcRenderer.invoke('notes:save', notes, folders),
  getStorageInfo: () => ipcRenderer.invoke('notes:getStorageInfo'),
});

contextBridge.exposeInMainWorld('exportApi', {
  selectDirectory: () => ipcRenderer.invoke('export:selectDirectory'),
  selectSaveFile: (defaultName) => ipcRenderer.invoke('export:selectSaveFile', defaultName),
  exportMarkdownZip: (notes, folders, attachments, savePath) =>
    ipcRenderer.invoke('export:markdownZip', notes, folders, attachments, savePath),
  exportHtmlZip: (notes, folders, attachments, savePath) =>
    ipcRenderer.invoke('export:htmlZip', notes, folders, attachments, savePath),
  exportMarkdownDirectory: (notes, folders, attachments, exportPath) =>
    ipcRenderer.invoke('export:markdownDirectory', notes, folders, attachments, exportPath),
  exportHtmlDirectory: (notes, folders, attachments, exportPath) =>
    ipcRenderer.invoke('export:htmlDirectory', notes, folders, attachments, exportPath),
});

contextBridge.exposeInMainWorld('shareApi', {
  startLocalServer: (exportPath) => ipcRenderer.invoke('share:startLocalServer', exportPath),
  stopLocalServer: () => ipcRenderer.invoke('share:stopLocalServer'),
  getStatus: () => ipcRenderer.invoke('share:getStatus'),
});

contextBridge.exposeInMainWorld('lifecycleApi', {
  onRequestClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:request-close', handler);
    return () => ipcRenderer.removeListener('app:request-close', handler);
  },
  confirmClose: () => ipcRenderer.invoke('app:confirm-close'),
});
