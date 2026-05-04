import type { Note } from '../types/note';

export function pickReviewNotes(notes: Note[], limit: number = 3): Note[] {
  // 过滤掉标题和内容都为空的笔记
  const validNotes = notes.filter((note) => note.title.trim() || note.content.trim());
  
  if (validNotes.length === 0) return [];
  
  // 优先选择未复习的笔记
  const neverReviewed = validNotes.filter((note) => note.lastReviewedAt === null);
  
  if (neverReviewed.length >= limit) {
    return neverReviewed.slice(0, limit);
  }
  
  // 按复习时间排序，选择最久未复习的
  const sorted = [...validNotes].sort((a, b) => {
    if (a.lastReviewedAt === null && b.lastReviewedAt === null) return 0;
    if (a.lastReviewedAt === null) return -1;
    if (b.lastReviewedAt === null) return 1;
    return new Date(a.lastReviewedAt).getTime() - new Date(b.lastReviewedAt).getTime();
  });
  
  return sorted.slice(0, limit);
}

export function pickRandomNote(notes: Note[]): Note | null {
  const validNotes = notes.filter((note) => note.title.trim() || note.content.trim());
  if (validNotes.length === 0) return null;
  
  const randomIndex = Math.floor(Math.random() * validNotes.length);
  return validNotes[randomIndex];
}
