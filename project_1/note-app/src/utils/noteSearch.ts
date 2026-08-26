import type { Note, NoteWithScore, SearchMatch } from '../types/note';

export type { NoteWithScore, SearchMatch } from '../types/note';

export function filterNotes(
  notes: Note[],
  searchQuery: string,
  selectedTag: string | null
): NoteWithScore[] {
  let filtered = notes;

  if (selectedTag) {
    const wantedTag = selectedTag.toLowerCase();
    filtered = filtered.filter((note) =>
      note.tags.some((tag) => tag.toLowerCase() === wantedTag)
    );
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

  // 无搜索词时也补齐评分字段，保持返回类型一致
  return filtered.map((note) => ({ ...note, _searchScore: 0, _searchMatches: [] }));
}

export function getTagStats(notes: Note[]): { name: string; count: number }[] {
  const tagMap = new Map<string, number>();

  notes.forEach((note) => {
    note.tags.forEach((tag) => {
      const name = tag.trim();
      if (name) {
        tagMap.set(name, (tagMap.get(name) || 0) + 1);
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

function toTime(dateString: string): number {
  const time = new Date(dateString).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function getRecentNotes(notes: Note[], limit: number = 5): Note[] {
  return [...notes]
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt))
    .slice(0, limit);
}
