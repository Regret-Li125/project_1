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

  // 列表只渲染前 10 条，键盘导航上界与之保持一致
  const maxIndex = Math.min(filteredNotes.length, 10) - 1;

  // 过滤结果变少时对 selectedIndex 做读取时钳制，避免越界
  const activeIndex = Math.max(0, Math.min(selectedIndex, maxIndex));

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
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

  // overlay 层监听 Escape，焦点离开 input 也可关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, handleClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME 组合输入中不响应导航/确认键
      if (e.nativeEvent.isComposing) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < maxIndex ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredNotes[activeIndex]) {
            onNoteSelect(filteredNotes[activeIndex].id);
            handleClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [filteredNotes, activeIndex, maxIndex, onNoteSelect, handleClose]
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
              className={`quick-switcher-item ${index === activeIndex ? 'selected' : ''}`}
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
