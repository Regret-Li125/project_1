import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

type Attachment = {
  id: string;
  type: 'image' | 'audio' | 'file';
  name: string;
  path: string;
  createdAt: string;
};

type Note = {
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

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type StorageData = {
  version: number;
  notes: Note[];
  folders: Folder[];
};

class NotesFileStore {
  private storagePath: string;

  constructor() {
    this.storagePath = path.join(app.getPath('userData'), 'personal-knowledge-notes', 'notes.json');
  }

  getStoragePath(): string {
    return this.storagePath;
  }

  async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async loadNotes(): Promise<{ notes: Note[]; folders: Folder[] }> {
    try {
      await this.ensureDirectory();
      const data = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data);

      if (!parsed || typeof parsed !== 'object') {
        return { notes: [], folders: [] };
      }

      if (parsed.version !== 1) {
        return { notes: [], folders: [] };
      }

      return {
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      };
    } catch (error) {
      const systemError = error as NodeJS.ErrnoException;
      if (systemError.code === 'ENOENT') {
        return { notes: [], folders: [] };
      }
      console.error('Failed to load notes:', error);
      return { notes: [], folders: [] };
    }
  }

  async saveNotes(notes: Note[], folders: Folder[] = []): Promise<void> {
    await this.ensureDirectory();
    const data: StorageData = {
      version: 1,
      notes,
      folders,
    };
    await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

export const notesFileStore = new NotesFileStore();
