import { describe, it, expect } from 'vitest';
import {
  parseLinks,
  parseContentToNodes,
  extractLinksFromNote,
  findBacklinks,
  findUnresolvedLinks,
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
});

describe('extractLinksFromNote', () => {
  it('extracts unique link targets', () => {
    const targets = extractLinksFromNote('[[A]] and [[A]] and [[B]]');
    expect(targets).toEqual(['A', 'B']);
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

  it('returns empty when no backlinks', () => {
    expect(findBacklinks(notes, 'Note A')).toHaveLength(0);
  });

  it('includes context around link', () => {
    const backlinks = findBacklinks(notes, 'Note B');
    expect(backlinks[0].context).toContain('Note B');
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

  it('returns empty when all links resolved', () => {
    const notes = [
      { id: '1', title: 'A', content: '[[B]]' },
      { id: '2', title: 'B', content: '' },
    ];
    expect(findUnresolvedLinks(notes)).toHaveLength(0);
  });
});
