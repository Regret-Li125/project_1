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

const LINK_PATTERN = /\[\[([^\]|]+)(\|([^\]]*))?\]\]/g;

export function parseLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  let match;

  while ((match = LINK_PATTERN.exec(content)) !== null) {
    links.push({
      type: 'link',
      targetTitle: match[1].trim(),
      displayText: match[3] ? match[3].trim() : match[1].trim(),
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
  const links = parseLinks(content);
  return [...new Set(links.map((l) => l.targetTitle))];
}

export function findBacklinks(
  notes: Array<{ id: string; title: string; content: string }>,
  targetTitle: string
): Array<{ noteId: string; noteTitle: string; context: string }> {
  const backlinks: Array<{ noteId: string; noteTitle: string; context: string }> = [];
  const normalizedTarget = targetTitle.toLowerCase();

  for (const note of notes) {
    const links = parseLinks(note.content);
    for (const link of links) {
      if (link.targetTitle.toLowerCase() === normalizedTarget) {
        const start = Math.max(0, link.startIndex - 50);
        const end = Math.min(note.content.length, link.endIndex + 50);
        const context = note.content.slice(start, end).trim();
        backlinks.push({
          noteId: note.id,
          noteTitle: note.title,
          context: `...${context}...`,
        });
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
  const titles = new Set(notes.map((n) => n.title.toLowerCase()));

  for (const note of notes) {
    const links = parseLinks(note.content);
    for (const link of links) {
      if (!titles.has(link.targetTitle.toLowerCase())) {
        unresolved.push({
          sourceNoteId: note.id,
          targetTitle: link.targetTitle,
        });
      }
    }
  }

  return unresolved;
}
