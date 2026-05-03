import React, { useMemo } from 'react';
import type { Note } from '../types/note';
import { formatDate } from '../utils/dateFormat';

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: () => void;
}

export const NoteListItem: React.FC<NoteListItemProps> = React.memo(({
  note,
  isSelected,
  onSelect,
}) => {
  const summary = useMemo(
    () => note.content.replace(/[#*`~()[\]]/g, '').substring(0, 100),
    [note.content]
  );

  return (
    <button
      className={`note-list-item ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="note-list-item-header">
        <h3 className="note-list-item-title">
          {note.title || '未命名笔记'}
        </h3>
        <span className="note-list-item-time">
          {formatDate(note.updatedAt)}
        </span>
      </div>
      {summary && (
        <p className="note-list-item-summary">{summary}</p>
      )}
      {note.tags.length > 0 && (
        <div className="note-list-item-tags">
          {note.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag-badge">
              {tag}
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
