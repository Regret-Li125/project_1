import React, { useEffect, useMemo, useState } from 'react';
import type { Note } from '../types/note';
import {
  findBacklinks,
  extractLinksFromNote,
  resolveNoteByTitle,
} from '../utils/linkParser';

interface BacklinkPanelProps {
  currentNote: Note;
  notes: Note[];
  onNoteSelect: (noteId: string) => void;
  onCreateNote: (title: string) => void;
}

export const BacklinkPanel: React.FC<BacklinkPanelProps> = React.memo(({
  currentNote,
  notes,
  onNoteSelect,
  onCreateNote,
}) => {
  // 对 notes 做 300ms 防抖，避免编辑时每一次击键都触发全语料反链重解析
  const [debouncedNotes, setDebouncedNotes] = useState(notes);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedNotes(notes), 300);
    return () => clearTimeout(timer);
  }, [notes]);

  const backlinks = useMemo(
    () => findBacklinks(debouncedNotes, currentNote.title),
    [debouncedNotes, currentNote.title]
  );
  const outgoingLinks = useMemo(
    () => extractLinksFromNote(currentNote.content),
    [currentNote.content]
  );

  const { resolvedLinks, unresolvedLinks } = useMemo(() => {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const title of outgoingLinks) {
      // 与图谱共用同一解析逻辑（忽略大小写/首尾空格，重名取最新）
      if (resolveNoteByTitle(notes, title)) {
        resolved.push(title);
      } else {
        unresolved.push(title);
      }
    }
    return { resolvedLinks: resolved, unresolvedLinks: unresolved };
  }, [outgoingLinks, notes]);

  return (
    <div className="backlink-panel">
      <div className="backlink-section">
        <h3 className="backlink-title">
          反向链接
          <span className="backlink-count">{backlinks.length}</span>
        </h3>
        {backlinks.length > 0 ? (
          <ul className="backlink-list">
            {backlinks.map((backlink) => {
              const isSelf = backlink.noteId === currentNote.id;
              return (
                <li key={backlink.noteId} className="backlink-item">
                  <button
                    className="backlink-link"
                    onClick={() => onNoteSelect(backlink.noteId)}
                  >
                    <span className="backlink-note-title">
                      {backlink.noteTitle}
                      {isSelf && '（自引用）'}
                    </span>
                    <span className="backlink-context">{backlink.context}</span>
                  </button>
                </li>
              );
            })}
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
              const note = resolveNoteByTitle(notes, title);
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
});
