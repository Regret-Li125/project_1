import React from 'react';
import type { Note } from '../types/note';
import { NoteListItem } from './NoteListItem';
import { EmptyState } from './EmptyState';

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  selectedTag: string | null;
  onNoteSelect: (noteId: string) => void;
  onNewNote: () => void;
  onClearSearch: () => void;
  onClearTag: () => void;
}

export const NoteList: React.FC<NoteListProps> = React.memo(({
  notes,
  selectedNoteId,
  searchQuery,
  selectedTag,
  onNoteSelect,
  onNewNote,
  onClearSearch,
  onClearTag,
}) => {
  if (notes.length === 0) {
    if (searchQuery || selectedTag) {
      return (
        <EmptyState
          message="没有找到匹配的笔记"
          actionText="清除筛选"
          onAction={searchQuery ? onClearSearch : onClearTag}
        />
      );
    }
    return (
      <EmptyState
        message="还没有笔记，创建第一篇开始积累你的知识库"
        actionText="新建笔记"
        onAction={onNewNote}
      />
    );
  }

  return (
    <div className="note-list">
      {notes.map((note) => (
        <NoteListItem
          key={note.id}
          note={note}
          isSelected={note.id === selectedNoteId}
          onSelect={() => onNoteSelect(note.id)}
        />
      ))}
    </div>
  );
});