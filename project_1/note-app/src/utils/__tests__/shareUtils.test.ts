import { describe, it, expect } from 'vitest';
import { collectShareScope, sanitizeFileName } from '../shareUtils';
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

  it('collects entire vault', () => {
    const result = collectShareScope(notes, folders, { type: 'vault' });
    expect(result.noteCount).toBe(3);
    expect(result.folderCount).toBe(2);
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
});
