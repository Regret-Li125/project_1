import React from 'react';
import type { Note } from '../types/note';
import { TagList } from './TagList';
import { ReviewPanel } from './ReviewPanel';

interface SidebarProps {
  notes: Note[];
  recentNotes: Note[];
  reviewNotes: Note[];
  tags: { name: string; count: number }[];
  selectedTag: string | null;
  onTagSelect: (tag: string | null) => void;
  onNoteSelect: (noteId: string) => void;
  onReviewSelect: (noteId: string) => void;
  onRandomReview: () => void;
  onClearFilter: () => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  notes,
  recentNotes,
  reviewNotes,
  tags,
  selectedTag,
  onTagSelect,
  onNoteSelect,
  onReviewSelect,
  onRandomReview,
  onClearFilter,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <button
          className={`sidebar-item ${!selectedTag ? 'active' : ''}`}
          onClick={onClearFilter}
        >
          全部笔记 ({notes.length})
        </button>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-title">最近编辑</h3>
        {recentNotes.length > 0 ? (
          <ul className="recent-list">
            {recentNotes.map((note) => (
              <li key={note.id}>
                <button
                  className="sidebar-item"
                  onClick={() => onNoteSelect(note.id)}
                >
                  {note.title || '未命名笔记'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sidebar-empty">暂无笔记</p>
        )}
      </div>

      <ReviewPanel
        reviewNotes={reviewNotes}
        onReviewSelect={onReviewSelect}
      />

      <TagList
        tags={tags}
        selectedTag={selectedTag}
        onTagSelect={onTagSelect}
      />

      <div className="sidebar-section">
        <button
          className="random-review-btn"
          onClick={onRandomReview}
          disabled={notes.length === 0}
        >
          随机复习
        </button>
      </div>
    </aside>
  );
});