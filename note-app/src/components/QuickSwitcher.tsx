import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Note } from '../types/note';

interface QuickSwitcherProps {
  isOpen: boolean;
  notes: Note[];
  onClose: () => void;
  onNoteSelect: (noteId: string) => void;
}

export const QuickSwitcher: React.FC<QuickSwitcherProps> = ({
  isOpen,
  notes,
  onClose,
  onNoteSelect,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredNotes = useMemo(
    () => notes.filter((note) =>
      (note.title || '未命名笔记').toLowerCase().includes(query.toLowerCase())
    ),
    [notes, query]
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  }, []);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredNotes.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredNotes[selectedIndex]) {
            onNoteSelect(filteredNotes[selectedIndex].id);
            handleClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [filteredNotes, selectedIndex, onNoteSelect, handleClose]
  );

  if (!isOpen) return null;

  return (
    <div className="quick-switcher-overlay" onClick={handleClose}>
      <div className="quick-switcher" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="quick-switcher-input"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入笔记标题..."
        />
        <ul className="quick-switcher-list">
          {filteredNotes.slice(0, 10).map((note, index) => (
            <li
              key={note.id}
              className={`quick-switcher-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                onNoteSelect(note.id);
                handleClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="note-title">{note.title || '未命名笔记'}</span>
              {note.tags.length > 0 && (
                <span className="note-tags">
                  {note.tags.slice(0, 3).join(', ')}
                </span>
              )}
            </li>
          ))}
          {filteredNotes.length === 0 && (
            <li className="quick-switcher-empty">没有匹配的笔记</li>
          )}
        </ul>
      </div>
    </div>
  );
};
