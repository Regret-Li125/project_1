import { describe, it, expect } from 'vitest';
import { collectShareScope, sanitizeFileName, buildShareExportPath } from '../shareUtils';
import type { Note, Folder } from '../../types/note';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Test',
    content: '',
    tags: [],
    folderId: null,
    path: '',
    sourceType: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: null,
    lastReviewedAt: null,
    ...overrides,
  };
}

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'f1',
    name: 'Test Folder',
    parentId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('collectShareScope', () => {
  const notes = [
    makeNote({ id: 'n1', folderId: 'f1' }),
    makeNote({ id: 'n2', folderId: 'f1' }),
    makeNote({ id: 'n3', folderId: null }),
  ];
  const folders = [
    makeFolder({ id: 'f1' }),
    makeFolder({ id: 'f2' }),
  ];

  it('collects single note', () => {
    const result = collectShareScope(notes, folders, { type: 'note', noteId: 'n1' });
    expect(result.noteCount).toBe(1);
    expect(result.notes[0].id).toBe('n1');
    expect(result.folderCount).toBe(0);
  });

  it('returns empty for non-existent note', () => {
    const result = collectShareScope(notes, folders, { type: 'note', noteId: 'missing' });
    expect(result.noteCount).toBe(0);
  });

  it('collects folder with its notes', () => {
    const result = collectShareScope(notes, folders, { type: 'folder', folderId: 'f1' });
    expect(result.noteCount).toBe(2);
    expect(result.folderCount).toBe(1);
    expect(result.folders[0].id).toBe('f1');
  });

  it('collects nested folders and their notes recursively', () => {
    const nestedFolders = [
      makeFolder({ id: 'f1' }),
      makeFolder({ id: 'f2', parentId: 'f1' }),
      makeFolder({ id: 'f3', parentId: 'f2' }),
      makeFolder({ id: 'f4' }),
    ];
    const nestedNotes = [
      makeNote({ id: 'n1', folderId: 'f1' }),
      makeNote({ id: 'n2', folderId: 'f2' }),
      makeNote({ id: 'n3', folderId: 'f3' }),
      makeNote({ id: 'n4', folderId: 'f4' }),
      makeNote({ id: 'n5', folderId: null }),
    ];
    const result = collectShareScope(nestedNotes, nestedFolders, {
      type: 'folder',
      folderId: 'f1',
    });
    expect(result.folders.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f3']);
    expect(result.folderCount).toBe(3);
    expect(result.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(result.noteCount).toBe(3);
  });

  it('handles parent id cycles without infinite loop', () => {
    const cyclicFolders = [
      makeFolder({ id: 'f1', parentId: 'f2' }),
      makeFolder({ id: 'f2', parentId: 'f1' }),
    ];
    const result = collectShareScope([], cyclicFolders, { type: 'folder', folderId: 'f1' });
    expect(result.folderCount).toBe(2);
  });

  it('collects entire vault', () => {
    const result = collectShareScope(notes, folders, { type: 'vault' });
    expect(result.noteCount).toBe(3);
    expect(result.folderCount).toBe(2);
  });
});

describe('buildShareExportPath', () => {
  it('appends timestamped knowledge-share subdirectory', () => {
    expect(buildShareExportPath('D:\\exports', 123)).toBe('D:\\exports/knowledge-share-123');
  });

  it('strips trailing separators', () => {
    expect(buildShareExportPath('/tmp/share/', 456)).toBe('/tmp/share/knowledge-share-456');
    expect(buildShareExportPath('D:\\exports\\', 456)).toBe('D:\\exports/knowledge-share-456');
  });
});

describe('sanitizeFileName', () => {
  it('replaces invalid characters', () => {
    expect(sanitizeFileName('file<>:"/\\|?*name')).toBe('file_________name');
  });

  it('replaces whitespace with underscore', () => {
    expect(sanitizeFileName('hello world  test')).toBe('hello_world_test');
  });

  it('truncates to 200 characters', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeFileName(long)).toHaveLength(200);
  });

  it('passes through clean names unchanged', () => {
    expect(sanitizeFileName('clean-file_name.txt')).toBe('clean-file_name.txt');
  });

  it("falls back to 'untitled' for empty or dot-only names", () => {
    expect(sanitizeFileName('')).toBe('untitled');
    expect(sanitizeFileName('.')).toBe('untitled');
    expect(sanitizeFileName('..')).toBe('untitled');
    expect(sanitizeFileName('...')).toBe('untitled');
  });

  it('strips control characters', () => {
    expect(sanitizeFileName('a\x00b\x1fc\x7f')).toBe('abc');
    expect(sanitizeFileName('\x00\x01')).toBe('untitled');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('aux.txt')).toBe('_aux.txt');
    expect(sanitizeFileName('com1')).toBe('_com1');
    expect(sanitizeFileName('LPT9')).toBe('_LPT9');
    expect(sanitizeFileName('console')).toBe('console');
  });

  it('keeps Chinese names unchanged', () => {
    expect(sanitizeFileName('我的笔记.md')).toBe('我的笔记.md');
    expect(sanitizeFileName('知识库 备份')).toBe('知识库_备份');
  });

  it('truncates by code points without breaking surrogate pairs', () => {
    const result = sanitizeFileName('😀'.repeat(250));
    expect(Array.from(result)).toHaveLength(200);
    expect(result.endsWith('😀')).toBe(true);
  });

  it('truncates mixed Chinese text by code points', () => {
    const result = sanitizeFileName('笔记'.repeat(150));
    expect(Array.from(result)).toHaveLength(200);
  });
});
