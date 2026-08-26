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
    expect(result.map((n) => n.id).sort()).toEqual(['2', '3']);
  });

  it('mixes never-reviewed with oldest-reviewed when never-reviewed are not enough', () => {
    const notes = [
      makeNote({ id: '1', lastReviewedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '2', lastReviewedAt: null }),
      makeNote({ id: '3', lastReviewedAt: '2025-12-01T00:00:00Z' }),
      makeNote({ id: '4', lastReviewedAt: null }),
    ];
    // 未复习的 2、4 优先，剩余名额给最久未复习的 3
    const result = pickReviewNotes(notes, 3);
    expect(result.map((n) => n.id).sort()).toEqual(['2', '3', '4']);
  });

  it('picks oldest reviewed when all have been reviewed', () => {
    const notes = [
      makeNote({ id: '1', lastReviewedAt: '2026-03-01T00:00:00Z' }),
      makeNote({ id: '2', lastReviewedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '3', lastReviewedAt: '2026-02-01T00:00:00Z' }),
    ];
    const result = pickReviewNotes(notes, 2);
    expect(result.map((n) => n.id).sort()).toEqual(['2', '3']);
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

  it('handles limit edge cases', () => {
    const notes = [makeNote({ id: '1' }), makeNote({ id: '2' })];
    expect(pickReviewNotes(notes, 0)).toEqual([]);
    expect(pickReviewNotes(notes, 10)).toHaveLength(2);
  });

  it('keeps candidate order when random returns values near 1', () => {
    const notes = ['1', '2', '3', '4'].map((id) =>
      makeNote({ id, lastReviewedAt: null })
    );
    // j = floor(0.999999 * (i + 1)) = i，总是与自身交换，顺序不变
    const result = pickReviewNotes(notes, 4, () => 0.999999);
    expect(result.map((n) => n.id)).toEqual(['1', '2', '3', '4']);
  });

  it('shuffles deterministically with random () => 0', () => {
    const notes = ['1', '2', '3', '4'].map((id) =>
      makeNote({ id, lastReviewedAt: null })
    );
    // Fisher–Yates 每步 j = 0：[1,2,3,4] → [2,3,4,1]
    const result = pickReviewNotes(notes, 4, () => 0);
    expect(result.map((n) => n.id)).toEqual(['2', '3', '4', '1']);
  });

  it('clamps out-of-range random indexes', () => {
    const notes = ['1', '2', '3'].map((id) => makeNote({ id, lastReviewedAt: null }));
    // random() = 1 越界时应钳制到 i，不抛异常且顺序不变
    expect(() => pickReviewNotes(notes, 3, () => 1)).not.toThrow();
    expect(pickReviewNotes(notes, 3, () => 1).map((n) => n.id)).toEqual(['1', '2', '3']);
  });

  it('falls back safely for invalid lastReviewedAt dates', () => {
    const notes = [
      makeNote({ id: '1', lastReviewedAt: 'not-a-date' }),
      makeNote({ id: '2', lastReviewedAt: '2026-01-01T00:00:00Z' }),
    ];
    // 无效日期按最旧处理，排在最前
    const result = pickReviewNotes(notes, 1, () => 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
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

  it('uses injectable random with boundary indexes', () => {
    const notes = [
      makeNote({ id: '1', title: 'A' }),
      makeNote({ id: '2', title: 'B' }),
      makeNote({ id: '3', title: 'C' }),
    ];
    expect(pickRandomNote(notes, () => 0)!.id).toBe('1');
    expect(pickRandomNote(notes, () => 0.999999)!.id).toBe('3');
    // random() = 1 越界时钳制到最后一项
    expect(pickRandomNote(notes, () => 1)!.id).toBe('3');
  });
});
