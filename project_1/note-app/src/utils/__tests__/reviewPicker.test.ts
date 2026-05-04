import { describe, it, expect } from 'vitest';
import { pickReviewNotes, pickRandomNote } from '../reviewPicker';
import type { Note } from '../../types/note';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '1',
    title: 'Test',
    content: 'content',
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

describe('pickReviewNotes', () => {
  it('prefers never-reviewed notes', () => {
    const notes = [
      makeNote({ id: '1', title: 'Reviewed', lastReviewedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '2', title: 'Never reviewed', lastReviewedAt: null }),
      makeNote({ id: '3', title: 'Also never', lastReviewedAt: null }),
    ];
    const result = pickReviewNotes(notes, 2);
    expect(result.map((n) => n.id)).toEqual(['2', '3']);
  });

  it('picks oldest reviewed when all have been reviewed', () => {
    const notes = [
      makeNote({ id: '1', lastReviewedAt: '2026-03-01T00:00:00Z' }),
      makeNote({ id: '2', lastReviewedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '3', lastReviewedAt: '2026-02-01T00:00:00Z' }),
    ];
    const result = pickReviewNotes(notes, 2);
    expect(result.map((n) => n.id)).toEqual(['2', '3']);
  });

  it('filters out empty notes', () => {
    const notes = [
      makeNote({ id: '1', title: '', content: '' }),
      makeNote({ id: '2', title: 'Has title', content: '' }),
    ];
    const result = pickReviewNotes(notes, 5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('returns empty for no valid notes', () => {
    expect(pickReviewNotes([], 3)).toEqual([]);
    expect(pickReviewNotes([makeNote({ title: '', content: '' })], 3)).toEqual([]);
  });

  it('respects limit', () => {
    const notes = [
      makeNote({ id: '1', lastReviewedAt: null }),
      makeNote({ id: '2', lastReviewedAt: null }),
      makeNote({ id: '3', lastReviewedAt: null }),
    ];
    expect(pickReviewNotes(notes, 2)).toHaveLength(2);
  });
});

describe('pickRandomNote', () => {
  it('returns a note from valid notes', () => {
    const notes = [
      makeNote({ id: '1', title: 'Valid' }),
      makeNote({ id: '2', title: 'Also valid' }),
    ];
    const result = pickRandomNote(notes);
    expect(result).not.toBeNull();
    expect(['1', '2']).toContain(result!.id);
  });

  it('returns null for empty array', () => {
    expect(pickRandomNote([])).toBeNull();
  });

  it('skips empty notes', () => {
    const notes = [makeNote({ title: '', content: '' })];
    expect(pickRandomNote(notes)).toBeNull();
  });
});
