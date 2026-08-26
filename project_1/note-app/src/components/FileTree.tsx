import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Note, Folder } from '../types/note';

interface FileTreeProps {
  notes: Note[];
  folders: Folder[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  onNoteSelect: (noteId: string) => void;
  onFolderSelect: (folderId: string | null) => void;
  onNewFolder: (parentId?: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
}

export const FileTree: React.FC<FileTreeProps> = React.memo(({
  notes,
  folders,
  selectedNoteId,
  selectedFolderId,
  onNoteSelect,
  onFolderSelect,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [renameHint, setRenameHint] = useState<string | null>(null);
  const renameHintTimerRef = useRef<number | null>(null);

  const rootFolders = folders.filter((f) => f.parentId === null);
  const rootNotes = notes.filter((n) => n.folderId === null);

  // 文件夹被删除后，清理已失效的展开状态
  useEffect(() => {
    setExpandedFolders((prev) => {
      const existingIds = new Set(folders.map((f) => f.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (existingIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [folders]);

  useEffect(() => () => {
    if (renameHintTimerRef.current !== null) {
      window.clearTimeout(renameHintTimerRef.current);
    }
  }, []);

  const showRenameHint = useCallback((message: string) => {
    setRenameHint(message);
    if (renameHintTimerRef.current !== null) {
      window.clearTimeout(renameHintTimerRef.current);
    }
    renameHintTimerRef.current = window.setTimeout(() => setRenameHint(null), 2000);
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(folderId)) {
        newExpanded.delete(folderId);
      } else {
        newExpanded.add(folderId);
      }
      return newExpanded;
    });
  }, []);

  const handleRenameStart = useCallback((folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditingName(folder.name);
  }, []);

  const handleRenameConfirm = useCallback(() => {
    if (!editingFolderId) return;
    const trimmed = editingName.trim();
    if (trimmed) {
      onRenameFolder(editingFolderId, trimmed);
    } else {
      // 空名不提交，恢复原名并提示
      showRenameHint('文件夹名称不能为空，已恢复原名');
    }
    setEditingFolderId(null);
    setEditingName('');
  }, [editingFolderId, editingName, onRenameFolder, showRenameHint]);

  const handleDragStart = useCallback((noteId: string) => {
    setDraggedNoteId(noteId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    // 阻止冒泡：避免外层容器把放置目标重置为根目录
    e.stopPropagation();
    setDropTargetFolderId(folderId);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 仅在真正离开当前行（而非进入其子元素）时清除高亮，避免抖动
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDropTargetFolderId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    // 阻止冒泡：文件夹行处理自己的 drop，只有外层容器负责"移到根目录"
    e.stopPropagation();
    if (draggedNoteId) {
      onMoveNote(draggedNoteId, folderId);
      setDraggedNoteId(null);
      setDropTargetFolderId(null);
    }
  }, [draggedNoteId, onMoveNote]);

  const renderFolder = (folder: Folder, level: number = 0, visited: Set<string> = new Set()) => {
    // 环保护：数据异常导致 parentId 成环时避免无限递归
    if (visited.has(folder.id)) return null;
    visited.add(folder.id);
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const isDropTarget = dropTargetFolderId === folder.id;
    const childFolders = folders.filter((f) => f.parentId === folder.id);
    const childNotes = notes.filter((n) => n.folderId === folder.id);

    return (
      <div key={folder.id} className="file-tree-folder">
        <div
          className={`file-tree-item folder ${isSelected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            toggleFolder(folder.id);
            onFolderSelect(folder.id);
          }}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          <span className="folder-icon">{isExpanded ? '📂' : '📁'}</span>
          {editingFolderId === folder.id ? (
            <input
              type="text"
              className="folder-rename-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleRenameConfirm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm();
                if (e.key === 'Escape') setEditingFolderId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="folder-name">{folder.name}</span>
          )}
          <div className="folder-actions">
            <button
              className="folder-action-btn"
              title="新建子文件夹"
              onClick={(e) => {
                e.stopPropagation();
                onNewFolder(folder.id);
              }}
            >
              +
            </button>
            <button
              className="folder-action-btn"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                handleRenameStart(folder);
              }}
            >
              ✏️
            </button>
            <button
              className="folder-action-btn danger"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
            >
              🗑️
            </button>
          </div>
        </div>
        {isExpanded && (
          <>
            {childFolders.map((f) => renderFolder(f, level + 1, visited))}
            {childNotes.map((n) => renderNote(n, level + 1))}
          </>
        )}
      </div>
    );
  };

  const renderNote = (note: Note, level: number = 0) => {
    const isSelected = selectedNoteId === note.id;
    return (
      <div
        key={note.id}
        className={`file-tree-item note ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 16 + 24}px` }}
        onClick={() => onNoteSelect(note.id)}
        draggable
        onDragStart={() => handleDragStart(note.id)}
      >
        <span className="note-icon">📝</span>
        <span className="note-title">{note.title || '未命名笔记'}</span>
      </div>
    );
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">文件树</span>
        {renameHint && (
          <span
            role="status"
            style={{ marginLeft: '8px', fontSize: '12px', color: '#b45309' }}
          >
            {renameHint}
          </span>
        )}
        <button
          className="new-folder-btn"
          onClick={() => onNewFolder()}
          title="新建文件夹"
        >
          📁+
        </button>
      </div>
      <div
        className="file-tree-content"
        onDragOver={(e) => handleDragOver(e, null)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, null)}
      >
        {rootFolders.map((f) => renderFolder(f))}
        {rootNotes.map((n) => renderNote(n))}
        {rootFolders.length === 0 && rootNotes.length === 0 && (
          <div className="file-tree-empty">暂无笔记</div>
        )}
      </div>
    </div>
  );
});
