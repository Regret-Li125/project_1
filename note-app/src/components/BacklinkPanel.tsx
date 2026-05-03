import React from 'react';
import type { Note } from '../types/note';
import { findBacklinks, extractLinksFromNote } from '../utils/linkParser';

interface BacklinkPanelProps {
  currentNote: Note;
  notes: Note[];
  onNoteSelect: (noteId: string) => void;
  onCreateNote: (title: string) => void;
}

export const BacklinkPanel: React.FC<BacklinkPanelProps> = ({
  currentNote,
  notes,
  onNoteSelect,
  onCreateNote,
}) => {
  const backlinks = findBacklinks(notes, currentNote.title);
  const outgoingLinks = extractLinksFromNote(currentNote.content);
  
  const resolvedLinks = outgoingLinks.filter((title) =>
    notes.some((n) => n.title.toLowerCase() === title.toLowerCase())
  );
  const unresolvedLinks = outgoingLinks.filter(
    (title) => !notes.some((n) => n.title.toLowerCase() === title.toLowerCase())
  );

  return (
    <div className="backlink-panel">
      <div className="backlink-section">
        <h3 className="backlink-title">
          反向链接
          <span className="backlink-count">{backlinks.length}</span>
        </h3>
        {backlinks.length > 0 ? (
          <ul className="backlink-list">
            {backlinks.map((backlink) => (
              <li key={backlink.noteId} className="backlink-item">
                <button
                  className="backlink-link"
                  onClick={() => onNoteSelect(backlink.noteId)}
                >
                  <span className="backlink-note-title">{backlink.noteTitle}</span>
                  <span className="backlink-context">{backlink.context}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="backlink-empty">
            <p className="empty-title">还没有其他笔记链接到这里</p>
            <p className="empty-description">
              你可以在其他笔记中输入 <code>[[{currentNote.title}]]</code> 来建立关联。
            </p>
          </div>
        )}
      </div>

      <div className="backlink-section">
        <h3 className="backlink-title">
          出链
          <span className="backlink-count">{outgoingLinks.length}</span>
        </h3>
        {outgoingLinks.length > 0 ? (
          <ul className="backlink-list">
            {resolvedLinks.map((title) => {
              const note = notes.find(
                (n) => n.title.toLowerCase() === title.toLowerCase()
              );
              return note ? (
                <li key={note.id} className="backlink-item resolved">
                  <button
                    className="backlink-link"
                    onClick={() => onNoteSelect(note.id)}
                  >
                    <span className="backlink-note-title">{note.title}</span>
                    <span className="backlink-status">已创建</span>
                  </button>
                </li>
              ) : null;
            })}
            {unresolvedLinks.map((title) => (
              <li key={title} className="backlink-item unresolved">
                <button
                  className="backlink-link"
                  onClick={() => onCreateNote(title)}
                >
                  <span className="backlink-note-title">{title}</span>
                  <span className="backlink-status">待创建</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="backlink-empty">
            <p className="empty-title">还没有出链</p>
            <p className="empty-description">
              在笔记中使用 <code>[[笔记标题]]</code> 来链接其他笔记。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};