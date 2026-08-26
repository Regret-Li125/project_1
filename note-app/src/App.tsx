import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import type { Note, Folder } from './types/note';
import { filterNotes, getTagStats, getRecentNotes } from './utils/noteSearch';
import { pickReviewNotes, pickRandomNote } from './utils/reviewPicker';

import { AppHeader } from './components/AppHeader';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { FileTree } from './components/FileTree';
import { BacklinkPanel } from './components/BacklinkPanel';
import { CommandPalette } from './components/CommandPalette';
import { QuickSwitcher } from './components/QuickSwitcher';
import { KnowledgeGraph } from './components/KnowledgeGraph';
import { QuickCapture } from './components/QuickCapture';
import { ShareConfirmDialog } from './components/ShareConfirmDialog';
import { LocalShareDialog } from './components/LocalShareDialog';
import { AISettingsDialog } from './components/AISettingsDialog';
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';
import { useNotes } from './hooks/useNotes';
import { useShare } from './hooks/useShare';
import { notesApi } from './api/notesApi';
import './styles/app.css';

function App() {
  const {
    notes, setNotes,
    folders, setFolders,
    saveStatus, storageError,
    saveNotes, saveNotesImmediate,
    createBlankNote, toastRef,
  } = useNotes();

  const toast = useToast();

  // Sync toast ref for useNotes save error reporting
  useEffect(() => {
    toastRef.current = toast;
  }, [toast, toastRef]);

  const share = useShare(notes, folders, toast);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraphView, setShowGraphView] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredSelectedTag = useDeferredValue(selectedTag);
  const deferredNotes = useDeferredValue(notes);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  // lastOpenedAt 保存节流：30s 内最多触发一次全库保存
  const lastOpenedSaveRef = useRef(0);

  // Note operations
  const handleNewNote = useCallback(() => {
    const newNote = createBlankNote({ folderId: selectedFolderId });
    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setSelectedNoteId(newNote.id);
    setViewMode('editor');
    saveNotes(updatedNotes);
    toast.success('已创建新笔记');
  }, [createBlankNote, selectedFolderId, notes, setNotes, saveNotes, toast]);

  const handleNoteSelect = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
    setViewMode('editor');
    const updatedNotes = notes.map((note) =>
      note.id === noteId ? { ...note, lastOpenedAt: new Date().toISOString() } : note
    );
    setNotes(updatedNotes);
    // 仅更新内存状态；距上次保存不足 30s 时跳过落盘，避免每次点击都全库保存
    const now = Date.now();
    if (now - lastOpenedSaveRef.current >= 30_000) {
      lastOpenedSaveRef.current = now;
      saveNotes(updatedNotes);
    }
  }, [notes, setNotes, saveNotes]);

  const handleNoteUpdate = useCallback((patch: Partial<Pick<Note, 'title' | 'content' | 'tags'>>) => {
    if (!selectedNoteId) return;
    const updatedNotes = notes.map((note) =>
      note.id === selectedNoteId ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note
    );
    setNotes(updatedNotes);
    saveNotes(updatedNotes);
  }, [notes, selectedNoteId, setNotes, saveNotes]);

  const handleNoteDelete = useCallback(() => {
    if (!selectedNoteId) return;
    const updatedNotes = notes.filter((note) => note.id !== selectedNoteId);
    setNotes(updatedNotes);
    setSelectedNoteId(null);
    setViewMode('list');
    saveNotesImmediate(updatedNotes);
    toast.success('笔记已删除，可在数据文件夹的 .trash 中找回');
  }, [notes, selectedNoteId, setNotes, saveNotesImmediate, toast]);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
    setViewMode('list');
  }, []);

  // Search & filter
  const handleSearchChange = useCallback((query: string) => setSearchQuery(query), []);
  const handleTagSelect = useCallback((tag: string | null) => setSelectedTag(tag), []);
  const handleClearFilter = useCallback(() => { setSelectedTag(null); setSearchQuery(''); }, []);

  // Review
  const handleRandomReview = useCallback(() => {
    const randomNote = pickRandomNote(notes);
    if (randomNote) {
      const now = new Date().toISOString();
      const updatedNotes = notes.map((note) =>
        note.id === randomNote.id ? { ...note, lastOpenedAt: now, lastReviewedAt: now } : note
      );
      setSelectedNoteId(randomNote.id);
      setViewMode('editor');
      setNotes(updatedNotes);
      saveNotes(updatedNotes);
    }
  }, [notes, setNotes, saveNotes]);

  const handleReviewSelect = useCallback((noteId: string) => {
    const now = new Date().toISOString();
    setSelectedNoteId(noteId);
    setViewMode('editor');
    const updatedNotes = notes.map((note) =>
      note.id === noteId ? { ...note, lastOpenedAt: now, lastReviewedAt: now } : note
    );
    setNotes(updatedNotes);
    saveNotes(updatedNotes);
  }, [notes, setNotes, saveNotes]);

  const handleOpenTodayReview = useCallback(() => {
    const [first] = pickReviewNotes(notes, 1);
    if (first) handleReviewSelect(first.id);
  }, [notes, handleReviewSelect]);

  // Internal links
  const handleInternalLinkClick = useCallback((targetTitle: string) => {
    const target = notes.find((n) => n.title.toLowerCase() === targetTitle.toLowerCase());
    if (target) {
      handleNoteSelect(target.id);
    } else {
      const newNote = createBlankNote({ title: targetTitle, folderId: null });
      const updatedNotes = [newNote, ...notes];
      setNotes(updatedNotes);
      setSelectedNoteId(newNote.id);
      setViewMode('editor');
      saveNotes(updatedNotes);
      toast.success(`已创建笔记: ${targetTitle}`);
    }
  }, [createBlankNote, notes, handleNoteSelect, setNotes, saveNotes, toast]);

  // Folders
  const handleNewFolder = useCallback((parentId?: string) => {
    const newFolder: Folder = {
      id: crypto.randomUUID ? crypto.randomUUID() : `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: '新建文件夹',
      parentId: parentId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updatedFolders = [...folders, newFolder];
    setFolders(updatedFolders);
    saveNotes(notes, updatedFolders);
  }, [folders, notes, setFolders, saveNotes]);

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    const updatedFolders = folders.map((f) =>
      f.id === folderId ? { ...f, name, updatedAt: new Date().toISOString() } : f
    );
    setFolders(updatedFolders);
    saveNotes(notes, updatedFolders);
  }, [folders, notes, setFolders, saveNotes]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    // 收集被删文件夹及其全部后代 id
    const removedIds = new Set<string>([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of folders) {
        if (!removedIds.has(f.id) && f.parentId && removedIds.has(f.parentId)) {
          removedIds.add(f.id);
          changed = true;
        }
      }
    }
    // 级联：子文件夹重挂到被删文件夹的父级，避免层级丢失
    const updatedFolders = folders
      .filter((f) => f.id !== folderId)
      .map((f) => (f.parentId === folderId ? { ...f, parentId: target.parentId } : f));
    const updatedNotes = notes.map((n) =>
      n.folderId === folderId ? { ...n, folderId: null } : n
    );
    setFolders(updatedFolders);
    setNotes(updatedNotes);
    if (selectedFolderId && removedIds.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }
    saveNotes(updatedNotes, updatedFolders);
  }, [folders, notes, selectedFolderId, setFolders, setNotes, saveNotes]);

  const handleMoveNote = useCallback((noteId: string, folderId: string | null) => {
    const updatedNotes = notes.map((n) =>
      n.id === noteId ? { ...n, folderId, updatedAt: new Date().toISOString() } : n
    );
    setNotes(updatedNotes);
    saveNotes(updatedNotes);
  }, [notes, setNotes, saveNotes]);

  // Quick capture
  const handleQuickCaptureSave = useCallback((noteData: {
    title: string;
    content: string;
    tags: string[];
    sourceType?: Note['sourceType'];
    sourceUrl?: string;
    /** AI 整理失败回退本地模板时为 true */
    usedFallback?: boolean;
  }) => {
    const newNote = createBlankNote({
      title: noteData.title,
      content: noteData.content,
      tags: noteData.tags,
      folderId: null,
      sourceType: noteData.sourceType ?? 'quick_capture',
      sourceUrl: noteData.sourceUrl,
    });
    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setSelectedNoteId(newNote.id);
    setViewMode('editor');
    saveNotes(updatedNotes);
    if (noteData.usedFallback) {
      toast.info('AI 整理失败，已使用本地模板保存');
    } else {
      toast.success('速记已保存为笔记');
    }
  }, [createBlankNote, notes, setNotes, saveNotes, toast]);

  // Share shortcuts
  const handleExportCurrentNote = useCallback(() => {
    if (selectedNoteId) share.openShare({ type: 'note', noteId: selectedNoteId });
  }, [selectedNoteId, share]);

  const handleExportCurrentFolder = useCallback(() => {
    if (selectedFolderId) share.openShare({ type: 'folder', folderId: selectedFolderId });
  }, [selectedFolderId, share]);

  const handleExportVault = useCallback(() => share.openShare({ type: 'vault' }), [share]);

  // AI 设置
  const handleOpenAISettings = useCallback(() => setShowAISettings(true), []);
  const handleCloseAISettings = useCallback(() => setShowAISettings(false), []);

  // 打开 vault 数据文件夹（含 .trash 回收站），便于手动找回已删除笔记
  const handleOpenStorageFolder = useCallback(async () => {
    const result = await notesApi.openStorageFolder();
    if (!result.success) {
      toast.error(result.error || '打开数据文件夹失败');
    }
  }, [toast]);

  // Commands
  const commands = useMemo(() => [
    { id: 'new-note', label: '新建笔记', shortcut: 'Ctrl+N', action: handleNewNote },
    { id: 'quick-switch', label: '快速打开笔记', shortcut: 'Ctrl+P', action: () => setShowQuickSwitcher(true) },
    { id: 'search', label: '搜索全部笔记', shortcut: 'Ctrl+F', action: focusSearchInput },
    { id: 'graph', label: '打开知识图谱', shortcut: 'Ctrl+G', action: () => setShowGraphView(true) },
    { id: 'review', label: '打开今日回顾', action: handleOpenTodayReview },
    { id: 'random', label: '随机复习', action: handleRandomReview },
    { id: 'quick-capture', label: '新建速记', shortcut: 'Ctrl+Shift+N', action: () => setShowQuickCapture(true) },
    { id: 'export-note', label: '导出当前笔记', action: handleExportCurrentNote },
    { id: 'export-folder', label: '导出当前文件夹', action: handleExportCurrentFolder },
    { id: 'export-vault', label: '导出整个知识库', action: handleExportVault },
    { id: 'local-share', label: '启动局域网分享', action: () => share.openLocalShare({ type: 'vault' }) },
    { id: 'ai-settings', label: 'AI 设置', action: handleOpenAISettings },
    { id: 'open-storage', label: '打开数据文件夹', action: handleOpenStorageFolder },
  ], [handleNewNote, focusSearchInput, handleOpenTodayReview, handleRandomReview, handleExportCurrentNote, handleExportCurrentFolder, handleExportVault, handleOpenAISettings, handleOpenStorageFolder, share]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 弹窗打开时，全局快捷键一律放行给弹窗自身处理（如 Esc 关闭）
      const anyDialogOpen =
        showCommandPalette ||
        showQuickSwitcher ||
        showQuickCapture ||
        showAISettings ||
        showGraphView ||
        share.showShareDialog ||
        share.showLocalShareDialog;
      if (anyDialogOpen) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
      if (key === 'f') {
        e.preventDefault();
        focusSearchInput();
      }
      if (key === 'p') {
        e.preventDefault();
        setShowQuickSwitcher((prev) => !prev);
      }
      if (e.shiftKey && key === 'n') {
        e.preventDefault();
        setShowQuickCapture(true);
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        handleNewNote();
      }
      if (key === 'g') {
        e.preventDefault();
        setShowGraphView((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleNewNote,
    focusSearchInput,
    showCommandPalette,
    showQuickSwitcher,
    showQuickCapture,
    showAISettings,
    showGraphView,
    share,
  ]);

  // Derived state
  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  const filteredNotes = useMemo(
    () => filterNotes(deferredNotes, deferredSearchQuery, deferredSelectedTag),
    [deferredNotes, deferredSearchQuery, deferredSelectedTag]
  );

  const recentNotes = useMemo(() => getRecentNotes(deferredNotes, 5), [deferredNotes]);
  const allTags = useMemo(() => getTagStats(deferredNotes), [deferredNotes]);
  const reviewNotes = useMemo(() => pickReviewNotes(deferredNotes, 3), [deferredNotes]);

  return (
    <div className="app">
      <AppHeader
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onNewNote={handleNewNote}
        onQuickCapture={() => setShowQuickCapture(true)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onShare={share.openShare}
        onLocalShare={share.openLocalShare}
        selectedNoteId={selectedNoteId}
        selectedFolderId={selectedFolderId}
        searchInputRef={searchInputRef}
        onOpenSettings={handleOpenAISettings}
      />
      <div className="app-content">
        <div className="left-sidebar">
          <FileTree
            notes={notes}
            folders={folders}
            selectedNoteId={selectedNoteId}
            selectedFolderId={selectedFolderId}
            onNoteSelect={handleNoteSelect}
            onFolderSelect={setSelectedFolderId}
            onNewFolder={handleNewFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onMoveNote={handleMoveNote}
          />
          <Sidebar
            notes={notes}
            recentNotes={recentNotes}
            reviewNotes={reviewNotes}
            tags={allTags}
            selectedTag={selectedTag}
            onTagSelect={handleTagSelect}
            onNoteSelect={handleNoteSelect}
            onReviewSelect={handleReviewSelect}
            onRandomReview={handleRandomReview}
            onClearFilter={handleClearFilter}
          />
        </div>
        <main className="main-content">
          {storageError && <div className="storage-error">{storageError}</div>}
          {viewMode === 'editor' && selectedNote ? (
            <NoteEditor
              note={selectedNote}
              saveStatus={saveStatus}
              onUpdate={handleNoteUpdate}
              onDelete={handleNoteDelete}
              onBack={handleBack}
              onLinkClick={handleInternalLinkClick}
            />
          ) : (
            <NoteList
              notes={filteredNotes}
              selectedNoteId={selectedNoteId}
              searchQuery={deferredSearchQuery}
              selectedTag={selectedTag}
              onNoteSelect={handleNoteSelect}
              onNewNote={handleNewNote}
              onClearFilter={handleClearFilter}
            />
          )}
        </main>
        {selectedNote && viewMode === 'editor' && (
          <div className={`right-sidebar ${rightSidebarCollapsed ? 'collapsed' : ''}`}>
            <button
              className="sidebar-collapse-btn"
              onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
              title={rightSidebarCollapsed ? '展开侧面板' : '折叠侧面板'}
            >
              {rightSidebarCollapsed ? '◀' : '▶'}
            </button>
            {!rightSidebarCollapsed && (
              <BacklinkPanel
                currentNote={selectedNote}
                notes={notes}
                onNoteSelect={handleNoteSelect}
                onCreateNote={handleInternalLinkClick}
              />
            )}
          </div>
        )}
      </div>

      <CommandPalette
        isOpen={showCommandPalette}
        commands={commands}
        onClose={() => setShowCommandPalette(false)}
      />

      <QuickSwitcher
        isOpen={showQuickSwitcher}
        notes={notes}
        onClose={() => setShowQuickSwitcher(false)}
        onNoteSelect={handleNoteSelect}
      />

      {showGraphView && (
        <KnowledgeGraph
          notes={notes}
          selectedNoteId={selectedNoteId}
          onNoteSelect={handleNoteSelect}
          onClose={() => setShowGraphView(false)}
        />
      )}

      <QuickCapture
        isOpen={showQuickCapture}
        onClose={() => setShowQuickCapture(false)}
        onSave={handleQuickCaptureSave}
      />

      {share.shareResult && (
        <ShareConfirmDialog
          isOpen={share.showShareDialog}
          shareResult={share.shareResult}
          onConfirm={share.confirmShare}
          onCancel={share.cancelShare}
        />
      )}

      {share.shareResult && (
        <LocalShareDialog
          isOpen={share.showLocalShareDialog}
          shareResult={share.shareResult}
          onClose={share.closeLocalShare}
        />
      )}

      <AISettingsDialog
        isOpen={showAISettings}
        onClose={handleCloseAISettings}
      />

      <Toast messages={toast.messages} onDismiss={toast.dismissToast} />
    </div>
  );
}

export default App;
