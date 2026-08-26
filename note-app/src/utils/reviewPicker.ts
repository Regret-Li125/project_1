import type { Note } from '../types/note';

function toTime(dateString: string): number {
  const time = new Date(dateString).getTime();
  return Number.isNaN(time) ? 0 : time;
}

// Fisher–Yates 洗牌，random 可注入便于测试；越界索引钳制到合法范围
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(Math.floor(random() * (i + 1)), i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pickReviewNotes(
  notes: Note[],
  limit: number = 3,
  random: () => number = Math.random
): Note[] {
  if (limit <= 0) return [];

  // 过滤掉标题和内容都为空的笔记
  const validNotes = notes.filter((note) => note.title.trim() || note.content.trim());

  if (validNotes.length === 0) return [];

  // 候选集先洗牌，同优先级内随机抽取；稳定排序保持洗牌后的相对顺序
  const shuffled = shuffle(validNotes, random);
  const sorted = shuffled.sort((a, b) => {
    if (a.lastReviewedAt === null && b.lastReviewedAt === null) return 0;
    if (a.lastReviewedAt === null) return -1;
    if (b.lastReviewedAt === null) return 1;
    return toTime(a.lastReviewedAt) - toTime(b.lastReviewedAt);
  });

  return sorted.slice(0, limit);
}

export function pickRandomNote(
  notes: Note[],
  random: () => number = Math.random
): Note | null {
  const validNotes = notes.filter((note) => note.title.trim() || note.content.trim());
  if (validNotes.length === 0) return null;

  const randomIndex = Math.min(
    Math.floor(random() * validNotes.length),
    validNotes.length - 1
  );
  return validNotes[randomIndex];
}
