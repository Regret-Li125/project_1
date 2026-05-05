import type { Note, Folder, ShareScope, ShareResult } from '../types/note';

export function collectShareScope(
  notes: Note[],
  folders: Folder[],
  scope: ShareScope
): ShareResult {
  let selectedNotes: Note[] = [];
  let selectedFolders: Folder[] = [];

  switch (scope.type) {
    case 'note': {
      const note = notes.find((n) => n.id === scope.noteId);
      if (note) {
        selectedNotes = [note];
      }
      break;
    }
    case 'folder': {
      const folder = folders.find((f) => f.id === scope.folderId);
      if (folder) {
        selectedFolders = [folder];
        selectedNotes = notes.filter((n) => n.folderId === scope.folderId);
      }
      break;
    }
    case 'vault': {
      selectedNotes = [...notes];
      selectedFolders = [...folders];
      break;
    }
  }

  return {
    notes: selectedNotes,
    folders: selectedFolders,
    noteCount: selectedNotes.length,
    folderCount: selectedFolders.length,
  };
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}
