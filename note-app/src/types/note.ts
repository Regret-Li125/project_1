export type Note = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  folderId: string | null;
  path: string;
  sourceType: 'manual' | 'quick_capture' | 'link' | 'image' | 'voice_transcript';
  sourceUrl?: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  lastReviewedAt: string | null;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Attachment = {
  id: string;
  type: 'image' | 'audio' | 'file';
  name: string;
  path: string;
  createdAt: string;
};

export type LinkGraph = {
  nodes: Array<{
    id: string;
    title: string;
    tags: string[];
  }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
  }>;
  unresolvedLinks: Array<{
    sourceNoteId: string;
    targetTitle: string;
  }>;
};

export type ShareScope =
  | { type: 'note'; noteId: string }
  | { type: 'folder'; folderId: string }
  | { type: 'vault' };

export type ShareResult = {
  notes: Note[];
  folders: Folder[];
  attachments: Attachment[];
  noteCount: number;
  folderCount: number;
  attachmentCount: number;
};

export type AppState = {
  notes: Note[];
  folders: Folder[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  searchQuery: string;
  selectedTag: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageError: string | null;
  showCommandPalette: boolean;
  showQuickSwitcher: boolean;
  showGraphView: boolean;
  showQuickCapture: boolean;
};
