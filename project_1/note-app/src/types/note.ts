export type Note = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  folderId: string | null;
  path: string;
  sourceType: 'manual' | 'quick_capture' | 'link';
  sourceUrl?: string;
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
  noteCount: number;
  folderCount: number;
};

