import type { Note } from '../types/note';

export type SearchMatch = {
  type: 'title' | 'tag' | 'content';
  index: number;
  length: number;
};

export type NoteWithScore = Note & {
  _searchScore: number;
  _searchMatches: SearchMatch[];
};

export function filterNotes(
  notes: Note[],
  searchQuery: string,
  selectedTag: string | null
): Note[] {
  let filtered = notes;

  if (selectedTag) {
    filtered = filtered.filter((note) => note.tags.includes(selectedTag));
  }

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    const scored: NoteWithScore[] = [];

    for (const note of filtered) {
      const matches: SearchMatch[] = [];
      let score = 0;

      const titleLower = note.title.toLowerCase();
      const titleIdx = titleLower.indexOf(query);
      if (titleIdx !== -1) {
        score += 100;
        matches.push({ type: 'title', index: titleIdx, length: query.length });
        if (titleIdx === 0) score += 20;
      }

      for (const tag of note.tags) {
        const tagIdx = tag.toLowerCase().indexOf(query);
        if (tagIdx !== -1) {
          score += 50;
          matches.push({ type: 'tag', index: tagIdx, length: query.length });
          break;
        }
      }

      const contentLower = note.content.toLowerCase();
      const contentIdx = contentLower.indexOf(query);
      if (contentIdx !== -1) {
        score += 10;
        matches.push({ type: 'content', index: contentIdx, length: query.length });
      }

      if (score > 0) {
        scored.push({ ...note, _searchScore: score, _searchMatches: matches });
      }
    }

    scored.sort((a, b) => b._searchScore - a._searchScore);
    return scored;
  }

  return filtered;
}

export function getTagStats(notes: Note[]): { name: string; count: number }[] {
  const tagMap = new Map<string, number>();

  notes.forEach((note) => {
    note.tags.forEach((tag) => {
      if (tag.trim()) {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      }
    });
  });

  return Array.from(tagMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
}

export function getRecentNotes(notes: Note[], limit: number = 5): Note[] {
  return [...notes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
