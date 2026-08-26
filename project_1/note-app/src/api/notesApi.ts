import type { Note, Folder } from '../types/note';

type NotesDesktopApi = {
  loadNotes: () => Promise<{ notes: Note[]; folders: Folder[]; error?: string }>;
  saveNotes: (notes: Note[], folders?: Folder[]) => Promise<{ success: boolean; error?: string }>;
  getStorageInfo: () => Promise<{ path: string }>;
};

declare global {
  interface Window {
    notesApi: NotesDesktopApi;
  }
}

export const notesApi: NotesDesktopApi = {
  loadNotes: async () => {
    if (window.notesApi) {
      return window.notesApi.loadNotes();
    }
    // Fallback for development without Electron
    console.warn('[notesApi] Running outside Electron — data stored in localStorage (not persisted to disk).');
    const data = localStorage.getItem('personal_knowledge_notes');
    if (!data) return { notes: [], folders: [] };
    try {
      const parsed = JSON.parse(data);
      return {
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      };
    } catch (error) {
      // 解析失败：备份原始字符串到另一个 key，避免覆盖丢失，再返回空数据
      console.error('[notesApi] Failed to parse localStorage data, backing up raw string.', error);
      try {
        localStorage.setItem('personal_knowledge_notes_backup', data);
      } catch (backupError) {
        console.error('[notesApi] Failed to back up raw data:', backupError);
      }
      return { notes: [], folders: [] };
    }
  },

  saveNotes: async (notes: Note[], folders: Folder[] = []) => {
    if (window.notesApi) {
      return window.notesApi.saveNotes(notes, folders);
    }
    // Fallback for development without Electron
    console.warn('[notesApi] Running outside Electron — data stored in localStorage (not persisted to disk).');
    try {
      localStorage.setItem('personal_knowledge_notes', JSON.stringify({
        version: 1,
        notes,
        folders,
      }));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  getStorageInfo: async () => {
    if (window.notesApi) {
      return window.notesApi.getStorageInfo();
    }
    return { path: 'localStorage (development mode)' };
  },
};
