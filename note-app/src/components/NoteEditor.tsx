import React, { useState, useCallback, useDeferredValue } from 'react';
import type { Note } from '../types/note';
import { MarkdownPreview } from './MarkdownPreview';

interface NoteEditorProps {
  note: Note;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onUpdate: (patch: Partial<Pick<Note, 'title' | 'content' | 'tags'>>) => void;
  onDelete: () => void;
  onBack: () => void;
  onLinkClick?: (targetTitle: string) => void;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  note,
  saveStatus,
  onUpdate,
  onDelete,
  onBack,
  onLinkClick,
}) => {
  const [tagInput, setTagInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deferredContent = useDeferredValue(note.content);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ title: e.target.value });
    },
    [onUpdate]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUpdate({ content: e.target.value });
    },
    [onUpdate]
  );

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !note.tags.includes(tag)) {
      onUpdate({ tags: [...note.tags, tag] });
      setTagInput('');
    }
  }, [tagInput, note.tags, onUpdate]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      onUpdate({ tags: note.tags.filter((tag) => tag !== tagToRemove) });
    },
    [note.tags, onUpdate]
  );

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag]
  );

  const handleDelete = useCallback(() => {
    if (showDeleteConfirm) {
      onDelete();
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  }, [showDeleteConfirm, onDelete]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  return (
    <div className="note-editor">
      <div className="editor-header">
        <button className="back-btn" onClick={onBack} aria-label="返回列表">
          ← 返回
        </button>
        <div className="save-status">
          {saveStatus === 'saving' && '保存中...'}
          {saveStatus === 'saved' && '已保存'}
          {saveStatus === 'error' && '保存失败'}
        </div>
        <div className="editor-actions">
          {showDeleteConfirm ? (
            <div className="delete-confirm">
              <span>确定删除？</span>
              <button className="delete-confirm-btn" onClick={handleDelete}>
                确定
              </button>
              <button className="cancel-btn" onClick={handleCancelDelete}>
                取消
              </button>
            </div>
          ) : (
            <button
              className="delete-btn"
              onClick={handleDelete}
              aria-label="删除笔记"
            >
              删除
            </button>
          )}
        </div>
      </div>

      <input
        type="text"
        className="title-input"
        placeholder="笔记标题"
        value={note.title}
        onChange={handleTitleChange}
        aria-label="笔记标题"
      />

      <div className="tags-section">
        <div className="tags-list">
          {note.tags.map((tag) => (
            <span key={tag} className="tag-item">
              {tag}
              <button
                className="tag-remove"
                onClick={() => handleRemoveTag(tag)}
                aria-label={`移除标签 ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          className="tag-input"
          placeholder="添加标签..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={handleAddTag}
          aria-label="添加标签"
        />
      </div>

      <div className="editor-content">
        <textarea
          className="markdown-input"
          placeholder="输入 Markdown 内容..."
          value={note.content}
          onChange={handleContentChange}
          aria-label="Markdown 内容"
        />
        <MarkdownPreview content={deferredContent} onLinkClick={onLinkClick} />
      </div>
    </div>
  );
};
