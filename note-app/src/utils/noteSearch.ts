import type { Note } from '../types/note';

export function filterNotes(
  notes: Note[],
  searchQuery: string,
  selectedTag: string | null
): Note[] {
  let filtered = notes;
  
  // 先按标签筛选
  if (selectedTag) {
    filtered = filtered.filter((note) => note.tags.includes(selectedTag));
  }
  
  // 再按搜索词筛选
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((note) => {
      const titleMatch = note.title.toLowerCase().includes(query);
      const contentMatch = note.content.toLowerCase().includes(query);
      const tagMatch = note.tags.some((tag) => tag.toLowerCase().includes(query));
      return titleMatch || contentMatch || tagMatch;
    });
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
