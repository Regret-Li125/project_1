import { contextBridge, ipcRenderer } from 'electron';
import type { Folder, Note } from '../src/types/note';

contextBridge.exposeInMainWorld('notesApi', {
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: (notes: Note[], folders?: Folder[]) => ipcRenderer.invoke('notes:save', notes, folders),
  getStorageInfo: () => ipcRenderer.invoke('notes:getStorageInfo'),
});
