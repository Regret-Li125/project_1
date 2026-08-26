import React, { useMemo } from 'react';
import type { Note } from '../types/note';
import { formatDate } from '../utils/dateFormat';

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase().trim();
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > lastIdx) {
      parts.push(text.slice(lastIdx, idx));
    }
    parts.push(
      <mark key={idx} className="search-highlight">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    lastIdx = idx + q.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length > 0 ? parts : text;
}

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  searchQuery?: string;
  onSelect: () => void;
}

export const NoteListItem: React.FC<NoteListItemProps> = React.memo(({
  note,
  isSelected,
  searchQuery = '',
  onSelect,
}) => {
  const summary = useMemo(
    () => note.content.replace(/[#*`~()[\]\\]/g, '').substring(0, 100),
    [note.content]
  );

  return (
    <button
      className={`note-list-item ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="note-list-item-header">
        <h3 className="note-list-item-title">
          {searchQuery ? highlightText(note.title || '未命名笔记', searchQuery) : (note.title || '未命名笔记')}
        </h3>
        <span className="note-list-item-time">
          {formatDate(note.updatedAt)}
        </span>
      </div>
      {summary && (
        <p className="note-list-item-summary">
          {searchQuery ? highlightText(summary, searchQuery) : summary}
        </p>
      )}
      {note.tags.length > 0 && (
        <div className="note-list-item-tags">
          {note.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag-badge">
              {searchQuery ? highlightText(tag, searchQuery) : tag}
            </span>
          ))}
          {note.tags.length > 3 && (
            <span className="tag-badge">+{note.tags.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
});
