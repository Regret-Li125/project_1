export type ParsedLink = {
  type: 'link';
  targetTitle: string;
  displayText: string;
  startIndex: number;
  endIndex: number;
};

export type ParsedNode = {
  type: 'text' | 'link';
  content: string;
  targetTitle?: string;
};

// 目标字符类排除嵌套的 '['，避免 [[a[[b]] 之类输入误匹配
const LINK_PATTERN = /\[\[([^\][|]+)(\|([^\]]*))?\]\]/g;

export function parseLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];

  // 使用 matchAll：每次调用返回独立迭代器，不存在模块级全局正则 lastIndex 残留隐患
  for (const match of content.matchAll(LINK_PATTERN)) {
    const targetTitle = match[1].trim();
    // 过滤空标题链接（如 [[ ]]），不进入结果
    if (!targetTitle) continue;

    // match[3] !== undefined 表示别名语法存在（[[a|]] 视为存在空别名）
    const hasAlias = match[3] !== undefined;
    const displayText = hasAlias ? match[3].trim() : targetTitle;

    links.push({
      type: 'link',
      targetTitle,
      displayText,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return links;
}

export function parseContentToNodes(content: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  let lastIndex = 0;

  const links = parseLinks(content);

  for (const link of links) {
    if (link.startIndex > lastIndex) {
      nodes.push({
        type: 'text',
        content: content.slice(lastIndex, link.startIndex),
      });
    }

    nodes.push({
      type: 'link',
      content: link.displayText,
      targetTitle: link.targetTitle,
    });

    lastIndex = link.endIndex;
  }

  if (lastIndex < content.length) {
    nodes.push({
      type: 'text',
      content: content.slice(lastIndex),
    });
  }

  return nodes;
}

export function extractLinksFromNote(content: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  // 按小写归一去重，保留首个出现的原始写法
  for (const link of parseLinks(content)) {
    const key = link.targetTitle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(link.targetTitle);
  }

  return targets;
}

export function findBacklinks(
  notes: Array<{ id: string; title: string; content: string }>,
  targetTitle: string
): Array<{ noteId: string; noteTitle: string; context: string }> {
  const backlinks: Array<{ noteId: string; noteTitle: string; context: string }> = [];
  const normalizedTarget = targetTitle.trim().toLowerCase();

  for (const note of notes) {
    const links = parseLinks(note.content);
    for (const link of links) {
      if (link.targetTitle.trim().toLowerCase() === normalizedTarget) {
        // 按码点截取上下文，避免截断代理对（如 emoji），并折叠空白便于单行展示
        const chars = Array.from(note.content);
        const cpStart = Array.from(note.content.slice(0, link.startIndex)).length;
        const cpEnd = Array.from(note.content.slice(0, link.endIndex)).length;
        const start = Math.max(0, cpStart - 50);
        const end = Math.min(chars.length, cpEnd + 50);
        const context = chars.slice(start, end).join('').replace(/\s+/g, ' ').trim();
        backlinks.push({
          noteId: note.id,
          noteTitle: note.title,
          context: `...${context}...`,
        });
        // 每篇笔记只取第一条匹配的反链，避免同一笔记在列表中重复出现
        break;
      }
    }
  }

  return backlinks;
}

export function findUnresolvedLinks(
  notes: Array<{ id: string; title: string; content: string }>
): Array<{ sourceNoteId: string; targetTitle: string }> {
  const unresolved: Array<{ sourceNoteId: string; targetTitle: string }> = [];
  const titles = new Set(notes.map((n) => n.title.trim().toLowerCase()));

  for (const note of notes) {
    const links = parseLinks(note.content);
    for (const link of links) {
      if (!titles.has(link.targetTitle.trim().toLowerCase())) {
        unresolved.push({
          sourceNoteId: note.id,
          targetTitle: link.targetTitle,
        });
      }
    }
  }

  return unresolved;
}

/**
 * 统一的“按标题解析笔记”入口：忽略大小写与首尾空格；
 * 存在重名笔记时取 updatedAt 最新者，保证图谱与反链面板行为一致。
 */
export function resolveNoteByTitle<T extends { title: string; updatedAt: string }>(
  notes: T[],
  title: string
): T | undefined {
  const normalized = title.trim().toLowerCase();
  let best: T | undefined;

  for (const note of notes) {
    if (note.title.trim().toLowerCase() !== normalized) continue;
    // updatedAt 为 ISO 字符串，可直接按字典序比较
    if (!best || note.updatedAt > best.updatedAt) {
      best = note;
    }
  }

  return best;
}
