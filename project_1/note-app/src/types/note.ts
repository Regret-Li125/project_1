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

export type SearchMatch = {
  type: 'title' | 'tag' | 'content';
  index: number;
  length: number;
};

export type NoteWithScore = Note & {
  _searchScore: number;
  _searchMatches: SearchMatch[];
};

// ---------- Phase 3: AI 增强 ----------

/** 速记整理方式（与本地模板一一对应） */
export type AICaptureMode = 'study' | 'meeting' | 'project' | 'action_items' | 'knowledge';

/** AI 服务提供方：openai 为云端 OpenAI 兼容服务（需 Key），其余为本地服务（免 Key） */
export type AIProvider = 'openai' | 'ollama' | 'lmstudio';

/** 暴露给渲染进程的 AI 配置（不含明文 API Key） */
export type AIConfigPublic = {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  maskedApiKey: string;
};

