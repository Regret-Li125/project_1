import type { Note } from '../types/note';

interface ReviewPanelProps {
  reviewNotes: Note[];
  onNoteSelect: (noteId: string) => void;
  onReviewSelect: (noteId: string) => void;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  reviewNotes,
  onReviewSelect,
}) => {
  if (reviewNotes.length === 0) {
    return null;
  }

  return (
    <div className="sidebar-section">
      <h3 className="sidebar-title">今日回顾</h3>
      <ul className="review-list">
        {reviewNotes.map((note) => (
          <li key={note.id}>
            <button
              className="sidebar-item review-item"
              onClick={() => onReviewSelect(note.id)}
            >
              {note.title || '未命名笔记'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};