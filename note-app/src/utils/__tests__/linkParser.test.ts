import { describe, it, expect } from 'vitest';
import {
  parseLinks,
  parseContentToNodes,
  extractLinksFromNote,
  findBacklinks,
  findUnresolvedLinks,
  resolveNoteByTitle,
} from '../linkParser';

describe('parseLinks', () => {
  it('parses simple wikilink', () => {
    const links = parseLinks('Hello [[World]] end');
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe('World');
    expect(links[0].displayText).toBe('World');
  });

  it('parses wikilink with display text', () => {
    const links = parseLinks('See [[target|display text]] here');
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe('target');
    expect(links[0].displayText).toBe('display text');
  });

  it('parses multiple links', () => {
    const links = parseLinks('[[A]] and [[B]] and [[C]]');
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.targetTitle)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty for no links', () => {
    expect(parseLinks('no links here')).toHaveLength(0);
  });

  it('handles links with whitespace in target', () => {
    const links = parseLinks('[[  spaced  ]]');
    expect(links[0].targetTitle).toBe('spaced');
  });

  it('tracks correct indices', () => {
    const links = parseLinks('ab[[cd]]ef');
    expect(links[0].startIndex).toBe(2);
    expect(links[0].endIndex).toBe(8);
  });

  it('filters out empty-title links', () => {
    expect(parseLinks('[[ ]]')).toHaveLength(0);
    expect(parseLinks('[[]]')).toHaveLength(0);
    expect(parseLinks('[[ ]] and [[Real]]')).toHaveLength(1);
  });

  it('treats [[a|]] as having an empty alias', () => {
    const links = parseLinks('[[target|]]');
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe('target');
    // 别名语法存在但为空，displayText 为空串而非回退到目标
    expect(links[0].displayText).toBe('');
  });

  it('trims alias whitespace but keeps alias semantics', () => {
    const links = parseLinks('[[target|  alias  ]]');
    expect(links[0].displayText).toBe('alias');
  });

  it('does not match nested opening brackets as one link', () => {
    // 目标字符类排除 '['，外层 [[a[[b]] 只应匹配出内层的 [[b]]
    const links = parseLinks('[[a[[b]]');
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe('b');
  });

  it('parses Chinese titles and aliases', () => {
    const links = parseLinks('参考 [[知识图谱|图谱说明]] 与 [[读书笔记]]');
    expect(links).toHaveLength(2);
    expect(links[0].targetTitle).toBe('知识图谱');
    expect(links[0].displayText).toBe('图谱说明');
    expect(links[1].targetTitle).toBe('读书笔记');
    expect(links[1].displayText).toBe('读书笔记');
  });

  it('does not share lastIndex state across calls', () => {
    // 多次交替调用不应因全局正则 lastIndex 残留而漏匹配
    expect(parseLinks('[[A]]')).toHaveLength(1);
    expect(parseLinks('[[B]]')).toHaveLength(1);
    expect(parseLinks('[[A]]')).toHaveLength(1);
  });
});

describe('parseContentToNodes', () => {
  it('splits text and links', () => {
    const nodes = parseContentToNodes('Hello [[World]] end');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: 'text', content: 'Hello ' });
    expect(nodes[1].type).toBe('link');
    expect(nodes[1].targetTitle).toBe('World');
    expect(nodes[2]).toEqual({ type: 'text', content: ' end' });
  });

  it('handles link at start', () => {
    const nodes = parseContentToNodes('[[Start]] rest');
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe('link');
    expect(nodes[1]).toEqual({ type: 'text', content: ' rest' });
  });

  it('handles link at end', () => {
    const nodes = parseContentToNodes('text [[End]]');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({ type: 'text', content: 'text ' });
    expect(nodes[1].type).toBe('link');
  });

  it('returns single text node for no links', () => {
    const nodes = parseContentToNodes('plain text');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({ type: 'text', content: 'plain text' });
  });

  it('ignores empty-title links in node stream', () => {
    const nodes = parseContentToNodes('a [[ ]] b');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({ type: 'text', content: 'a [[ ]] b' });
  });
});

describe('extractLinksFromNote', () => {
  it('extracts unique link targets', () => {
    const targets = extractLinksFromNote('[[A]] and [[A]] and [[B]]');
    expect(targets).toEqual(['A', 'B']);
  });

  it('dedupes case-insensitively and keeps first original spelling', () => {
    const targets = extractLinksFromNote('[[Note A]] then [[note a]] then [[NOTE A]]');
    expect(targets).toEqual(['Note A']);
  });

  it('returns empty for no links', () => {
    expect(extractLinksFromNote('no links')).toEqual([]);
  });
});

describe('findBacklinks', () => {
  const notes = [
    { id: '1', title: 'Note A', content: 'Links to [[Note B]] here' },
    { id: '2', title: 'Note B', content: 'No links' },
    { id: '3', title: 'Note C', content: 'Also links to [[Note B]]' },
  ];

  it('finds backlinks case-insensitively', () => {
    const backlinks = findBacklinks(notes, 'note b');
    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((b) => b.noteId)).toEqual(['1', '3']);
  });

  it('matches target with surrounding whitespace', () => {
    const backlinks = findBacklinks(notes, '  Note B  ');
    expect(backlinks).toHaveLength(2);
  });

  it('returns empty when no backlinks', () => {
    expect(findBacklinks(notes, 'Note A')).toHaveLength(0);
  });

  it('includes context around link', () => {
    const backlinks = findBacklinks(notes, 'Note B');
    expect(backlinks[0].context).toContain('Note B');
  });

  it('collapses whitespace in context', () => {
    const spaced = [
      { id: '1', title: 'A', content: 'line one\n\n   links to [[B]]\n next' },
    ];
    const backlinks = findBacklinks(spaced, 'B');
    expect(backlinks[0].context).toBe('...line one links to [[B]] next...');
  });

  it('slices context by code points without breaking surrogate pairs', () => {
    const emojiPrefix = '😀'.repeat(60);
    const notesWithEmoji = [
      { id: '1', title: 'A', content: `${emojiPrefix} link [[B]]` },
    ];
    const backlinks = findBacklinks(notesWithEmoji, 'B');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].context).toContain('[[B]]');
    // 上下文最多保留链接前 50 个码点，且不产生孤立代理字符
    expect(backlinks[0].context).toContain('😀');
    expect(backlinks[0].context).not.toContain('\uFFFD');
  });

  it('pins one-backlink-per-note semantics', () => {
    const multi = [
      { id: '1', title: 'A', content: '[[B]] once and [[B]] twice and [[B]] thrice' },
    ];
    const backlinks = findBacklinks(multi, 'B');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].noteId).toBe('1');
  });

  it('includes self-referencing backlinks', () => {
    const selfRef = [
      { id: '1', title: 'A', content: 'See also [[A]] itself' },
    ];
    const backlinks = findBacklinks(selfRef, 'A');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].noteId).toBe('1');
  });
});

describe('findUnresolvedLinks', () => {
  it('finds links with no matching note', () => {
    const notes = [
      { id: '1', title: 'A', content: '[[B]] and [[C]]' },
      { id: '2', title: 'B', content: '' },
    ];
    const unresolved = findUnresolvedLinks(notes);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].targetTitle).toBe('C');
  });

  it('ignores case and surrounding whitespace when matching titles', () => {
    const notes = [
      { id: '1', title: ' A ', content: '[[a]]' },
      { id: '2', title: 'B', content: '[[ A ]]' },
    ];
    expect(findUnresolvedLinks(notes)).toHaveLength(0);
  });

  it('returns empty when all links resolved', () => {
    const notes = [
      { id: '1', title: 'A', content: '[[B]]' },
      { id: '2', title: 'B', content: '' },
    ];
    expect(findUnresolvedLinks(notes)).toHaveLength(0);
  });
});

describe('resolveNoteByTitle', () => {
  const notes = [
    { id: '1', title: 'Dup', updatedAt: '2024-01-01T00:00:00.000Z' },
    { id: '2', title: 'dup', updatedAt: '2024-06-01T00:00:00.000Z' },
    { id: '3', title: 'Other', updatedAt: '2024-03-01T00:00:00.000Z' },
  ];

  it('resolves case-insensitively and trims whitespace', () => {
    expect(resolveNoteByTitle(notes, '  OTHER  ')?.id).toBe('3');
  });

  it('picks the most recently updated note among duplicates', () => {
    expect(resolveNoteByTitle(notes, 'Dup')?.id).toBe('2');
    expect(resolveNoteByTitle(notes, 'DUP')?.id).toBe('2');
  });

  it('returns undefined when no note matches', () => {
    expect(resolveNoteByTitle(notes, 'Missing')).toBeUndefined();
  });
});
