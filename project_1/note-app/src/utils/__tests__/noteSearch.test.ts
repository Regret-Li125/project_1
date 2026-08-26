import { describe, it, expect } from 'vitest';
import { filterNotes, getTagStats, getRecentNotes } from '../noteSearch';
import type { Note } from '../../types/note';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '1',
    title: '',
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

describe('filterNotes', () => {
  const notes = [
    makeNote({ id: '1', title: 'React Guide', content: 'Learn React hooks', tags: ['react', 'frontend'] }),
    makeNote({ id: '2', title: 'Node.js API', content: 'Server side with Node', tags: ['node', 'backend'] }),
    makeNote({ id: '3', title: 'React Patterns', content: 'Advanced patterns', tags: ['react'] }),
    makeNote({ id: '4', title: 'Empty', content: '', tags: [] }),
  ];

  it('returns all notes when no filter', () => {
    expect(filterNotes(notes, '', null)).toHaveLength(4);
  });

  it('filters by tag', () => {
    const result = filterNotes(notes, '', 'react');
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toEqual(['1', '3']);
  });

  it('filters by search query matching title', () => {
    const result = filterNotes(notes, 'React', null);
    expect(result).toHaveLength(2);
  });

  it('filters by search query matching content', () => {
    const result = filterNotes(notes, 'Server', null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('sorts by relevance: title match > tag match > content match', () => {
    const specialNotes = [
      makeNote({ id: '1', title: 'Other', content: 'has test keyword', tags: [] }),
      makeNote({ id: '2', title: 'Test title', content: '', tags: [] }),
      makeNote({ id: '3', title: 'Other', content: '', tags: ['test'] }),
    ];
    const result = filterNotes(specialNotes, 'test', null);
    expect(result.map((n) => n.id)).toEqual(['2', '3', '1']);
  });

  it('title start match scores higher than mid-title match', () => {
    const specialNotes = [
      makeNote({ id: '1', title: 'My React App', content: '', tags: [] }),
      makeNote({ id: '2', title: 'React Guide', content: '', tags: [] }),
    ];
    const result = filterNotes(specialNotes, 'React', null);
    expect(result[0].id).toBe('2');
  });

  it('combines tag and search filters', () => {
    const result = filterNotes(notes, 'React', 'frontend');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('matches Chinese query against title and content', () => {
    const cnNotes = [
      makeNote({ id: '1', title: '知识库搭建指南', content: '如何构建个人知识体系', tags: [] }),
      makeNote({ id: '2', title: '健身计划', content: '每周三次训练', tags: [] }),
    ];
    const result = filterNotes(cnNotes, '知识', null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('treats regex metacharacters as literal text', () => {
    const specialNotes = [
      makeNote({ id: '1', title: 'C++ 入门', content: '', tags: [] }),
      makeNote({ id: '2', title: 'C 语言 (基础)', content: '', tags: [] }),
      makeNote({ id: '3', title: 'axb pattern', content: '', tags: [] }),
    ];
    expect(filterNotes(specialNotes, 'c++', null).map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(specialNotes, '(基础)', null).map((n) => n.id)).toEqual(['2']);
    // 'a.b' 不应按正则匹配到 'axb'
    expect(filterNotes(specialNotes, 'a.b', null)).toHaveLength(0);
  });

  it('filters tags case-insensitively', () => {
    expect(filterNotes(notes, '', 'REACT').map((n) => n.id)).toEqual(['1', '3']);
    expect(filterNotes(notes, '', 'React')).toHaveLength(2);
  });

  it('treats whitespace-only query as no query', () => {
    const result = filterNotes(notes, '   ', null);
    expect(result).toHaveLength(4);
    expect(result[0]._searchScore).toBe(0);
    expect(result[0]._searchMatches).toEqual([]);
  });

  it('provides _searchMatches indexes consistent with original strings', () => {
    const mixedNotes = [
      makeNote({
        id: '1',
        title: 'React 指南',
        content: '从 Hook 开始学 React',
        tags: ['前端React'],
      }),
    ];
    const result = filterNotes(mixedNotes, 'react', null);
    expect(result).toHaveLength(1);
    const note = result[0];
    expect(note._searchScore).toBeGreaterThan(0);
    expect(note._searchMatches.length).toBeGreaterThan(0);
    for (const match of note._searchMatches) {
      const source =
        match.type === 'title'
          ? note.title
          : match.type === 'tag'
            ? (note.tags.find((t) => t.toLowerCase().includes('react')) ?? '')
            : note.content;
      expect(
        source.substring(match.index, match.index + match.length).toLowerCase()
      ).toBe('react');
    }
  });
});

describe('getTagStats', () => {
  it('counts tags and sorts by count desc', () => {
    const notes = [
      makeNote({ tags: ['a', 'b'] }),
      makeNote({ tags: ['a', 'c'] }),
      makeNote({ tags: ['a'] }),
    ];
    const stats = getTagStats(notes);
    expect(stats[0]).toEqual({ name: 'a', count: 3 });
    expect(stats[1].name).toBe('b');
  });

  it('ignores empty tags', () => {
    const notes = [makeNote({ tags: ['', '  ', 'valid'] })];
    const stats = getTagStats(notes);
    expect(stats).toHaveLength(1);
    expect(stats[0].name).toBe('valid');
  });

  it('sorts alphabetically when counts are equal', () => {
    const notes = [makeNote({ tags: ['c', 'a', 'b'] })];
    const stats = getTagStats(notes);
    expect(stats.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('trims tag names before counting', () => {
    const notes = [makeNote({ tags: [' react ', 'react', '  '] })];
    const stats = getTagStats(notes);
    expect(stats).toEqual([{ name: 'react', count: 2 }]);
  });
});

describe('getRecentNotes', () => {
  it('returns notes sorted by updatedAt desc', () => {
    const notes = [
      makeNote({ id: '1', updatedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '2', updatedAt: '2026-03-01T00:00:00Z' }),
      makeNote({ id: '3', updatedAt: '2026-02-01T00:00:00Z' }),
    ];
    const recent = getRecentNotes(notes, 2);
    expect(recent.map((n) => n.id)).toEqual(['2', '3']);
  });

  it('respects limit', () => {
    const notes = [
      makeNote({ id: '1', updatedAt: '2026-01-01T00:00:00Z' }),
      makeNote({ id: '2', updatedAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(getRecentNotes(notes, 1)).toHaveLength(1);
  });

  it('falls back safely for invalid updatedAt dates', () => {
    const notes = [
      makeNote({ id: '1', updatedAt: 'not-a-date' }),
      makeNote({ id: '2', updatedAt: '2026-02-01T00:00:00Z' }),
    ];
    const recent = getRecentNotes(notes, 2);
    expect(recent.map((n) => n.id)).toEqual(['2', '1']);
  });
});
