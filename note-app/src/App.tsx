import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import type { Note, Folder, ShareScope, ShareResult } from './types/note';
import { notesApi } from './api/notesApi';
import { exportApi } from './api/exportApi';
import { lifecycleApi } from './api/lifecycleApi';
import { filterNotes, getTagStats, getRecentNotes } from './utils/noteSearch';
import { pickReviewNotes, pickRandomNote } from './utils/reviewPicker';
import { collectShareScope } from './utils/shareUtils';

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
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';
import './styles/app.css';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraphView, setShowGraphView] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showLocalShareDialog, setShowLocalShareDialog] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope | null>(null);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  
  const toast = useToast();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ notes: Note[]; folders?: Folder[] } | null>(null);
  const foldersRef = useRef(folders);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredSelectedTag = useDeferredValue(selectedTag);
  const deferredNotes = useDeferredValue(notes);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  const createBlankNote = useCallback((overrides: Partial<Note> = {}): Note => {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
      title: '',
      content: '',
      tags: [],
      folderId: selectedFolderId,
      path: '',
      sourceType: 'manual',
      attachments: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      lastReviewedAt: null,
      ...overrides,
    };
  }, [selectedFolderId]);

  // 加载笔记
  useEffect(() => {
    const loadData = async () => {
      try {
        const { notes: loadedNotes, folders: loadedFolders } = await notesApi.loadNotes();
        setNotes(loadedNotes);
        setFolders(loadedFolders);
      } catch (error) {
        console.error('Failed to load data:', error);
        setStorageError('加载数据失败');
      }
    };
    loadData();
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const pendingSave = pendingSaveRef.current;
    if (!pendingSave) return;

    pendingSaveRef.current = null;
    const result = await notesApi.saveNotes(
      pendingSave.notes,
      pendingSave.folders || foldersRef.current
    );
    if (!result.success) {
      throw new Error(result.error || '保存失败');
    }
  }, []);

  // 保存笔记（带防抖）
  const handleSaveNotes = useCallback(async (updatedNotes: Note[], updatedFolders?: Folder[]) => {
    setSaveStatus('saving');
    
    // 存储待保存的数据
    pendingSaveRef.current = { notes: updatedNotes, folders: updatedFolders };
    
    // 清除之前的定时器
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    
    // 设置新的定时器（500ms 防抖）
    saveTimerRef.current = setTimeout(async () => {
      if (!pendingSaveRef.current) return;
      
      const { notes: notesToSave, folders: foldersToSave } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      
      try {
        const result = await notesApi.saveNotes(notesToSave, foldersToSave || foldersRef.current);
        if (result.success) {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } else {
          setSaveStatus('error');
          if (result.error) {
            setStorageError(result.error);
            toast.error('保存失败，请稍后重试');
          }
        }
      } catch {
        setSaveStatus('error');
        setStorageError('保存失败');
        toast.error('保存失败，请稍后重试');
      }
    }, 500);
  }, [toast]);

  // 立即保存（用于关键操作如删除）
  const handleSaveNotesImmediate = useCallback(async (updatedNotes: Note[], updatedFolders?: Folder[]) => {
    // 清除防抖定时器
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    
    setSaveStatus('saving');
    try {
      const result = await notesApi.saveNotes(updatedNotes, updatedFolders || foldersRef.current);
      if (result.success) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
        if (result.error) {
          setStorageError(result.error);
        }
      }
    } catch {
      setSaveStatus('error');
      setStorageError('保存失败');
    }
  }, []);

  // Electron 请求关闭时先刷新防抖保存，避免最后一次输入丢失。
  useEffect(() => {
    return lifecycleApi.onRequestClose(async () => {
      try {
        await flushPendingSave();
      } catch (error) {
        console.error('Failed to flush notes before close:', error);
      } finally {
        await lifecycleApi.confirmClose();
      }
    });
  }, [flushPendingSave]);

  // 新建笔记
  const handleNewNote = useCallback(() => {
    const newNote = createBlankNote();
    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setSelectedNoteId(newNote.id);
    setViewMode('editor');
    handleSaveNotes(updatedNotes);
    toast.success('已创建新笔记');
  }, [createBlankNote, notes, handleSaveNotes, toast]);

  // 选择笔记
  const handleNoteSelect = useCallback((noteId: string) => {
    setSelectedNoteId(noteId);
    setViewMode('editor');
    const updatedNotes = notes.map((note) =>
      note.id === noteId
        ? { ...note, lastOpenedAt: new Date().toISOString() }
        : note
    );
    setNotes(updatedNotes);
    handleSaveNotes(updatedNotes);
  }, [notes, handleSaveNotes]);

  // 更新笔记
  const handleNoteUpdate = useCallback((patch: Partial<Pick<Note, 'title' | 'content' | 'tags'>>) => {
    if (!selectedNoteId) return;
    const updatedNotes = notes.map((note) =>
      note.id === selectedNoteId
        ? { ...note, ...patch, updatedAt: new Date().toISOString() }
        : note
    );
    setNotes(updatedNotes);
    handleSaveNotes(updatedNotes);
  }, [notes, selectedNoteId, handleSaveNotes]);

  // 删除笔记
  const handleNoteDelete = useCallback(() => {
    if (!selectedNoteId) return;
    const updatedNotes = notes.filter((note) => note.id !== selectedNoteId);
    setNotes(updatedNotes);
    setSelectedNoteId(null);
    setViewMode('list');
    handleSaveNotesImmediate(updatedNotes);
    toast.success('笔记已删除');
  }, [notes, selectedNoteId, handleSaveNotesImmediate, toast]);

  // 返回列表
  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
    setViewMode('list');
  }, []);

  // 搜索
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // 标签筛选
  const handleTagSelect = useCallback((tag: string | null) => {
    setSelectedTag(tag);
  }, []);

  const handleClearTag = useCallback(() => {
    setSelectedTag(null);
  }, []);

  const handleClearFilter = useCallback(() => {
    setSelectedTag(null);
    setSearchQuery('');
  }, []);

  // 随机复习
  const handleRandomReview = useCallback(() => {
    const randomNote = pickRandomNote(notes);
    if (randomNote) {
      const now = new Date().toISOString();
      const updatedNotes = notes.map((note) =>
        note.id === randomNote.id
          ? { ...note, lastOpenedAt: now, lastReviewedAt: now }
          : note
      );
      setSelectedNoteId(randomNote.id);
      setViewMode('editor');
      setNotes(updatedNotes);
      handleSaveNotes(updatedNotes);
    }
  }, [notes, handleSaveNotes]);

  // 今日回顾选择
  const handleReviewSelect = useCallback((noteId: string) => {
    const now = new Date().toISOString();
    setSelectedNoteId(noteId);
    setViewMode('editor');
    const updatedNotes = notes.map((note) =>
      note.id === noteId
        ? { ...note, lastOpenedAt: now, lastReviewedAt: now }
        : note
    );
    setNotes(updatedNotes);
    handleSaveNotes(updatedNotes);
  }, [notes, handleSaveNotes]);

  const handleOpenTodayReview = useCallback(() => {
    const [firstReviewNote] = pickReviewNotes(notes, 1);
    if (firstReviewNote) {
      handleReviewSelect(firstReviewNote.id);
    }
  }, [notes, handleReviewSelect]);

  // 内部链接点击
  const handleInternalLinkClick = useCallback((targetTitle: string) => {
    const targetNote = notes.find((n) => n.title.toLowerCase() === targetTitle.toLowerCase());
    if (targetNote) {
      handleNoteSelect(targetNote.id);
    } else {
      const newNote = createBlankNote({
        title: targetTitle,
        folderId: null,
      });
      const updatedNotes = [newNote, ...notes];
      setNotes(updatedNotes);
      setSelectedNoteId(newNote.id);
      setViewMode('editor');
      handleSaveNotes(updatedNotes);
      toast.success(`已创建笔记: ${targetTitle}`);
    }
  }, [createBlankNote, notes, handleNoteSelect, handleSaveNotes, toast]);

  // 文件夹操作
  const handleNewFolder = useCallback((parentId?: string) => {
    const newFolder: Folder = {
      id: crypto.randomUUID ? crypto.randomUUID() : `folder_${Date.now()}`,
      name: '新建文件夹',
      parentId: parentId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updatedFolders = [...folders, newFolder];
    setFolders(updatedFolders);
    handleSaveNotes(notes, updatedFolders);
  }, [folders, notes, handleSaveNotes]);

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    const updatedFolders = folders.map((f) =>
      f.id === folderId ? { ...f, name, updatedAt: new Date().toISOString() } : f
    );
    setFolders(updatedFolders);
    handleSaveNotes(notes, updatedFolders);
  }, [folders, notes, handleSaveNotes]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    const updatedFolders = folders.filter((f) => f.id !== folderId);
    const updatedNotes = notes.map((n) =>
      n.folderId === folderId ? { ...n, folderId: null } : n
    );
    setFolders(updatedFolders);
    setNotes(updatedNotes);
    handleSaveNotes(updatedNotes, updatedFolders);
  }, [folders, notes, handleSaveNotes]);

  const handleMoveNote = useCallback((noteId: string, folderId: string | null) => {
    const updatedNotes = notes.map((n) =>
      n.id === noteId ? { ...n, folderId, updatedAt: new Date().toISOString() } : n
    );
    setNotes(updatedNotes);
    handleSaveNotes(updatedNotes);
  }, [notes, handleSaveNotes]);

  // 速记保存
  const handleQuickCaptureSave = useCallback((noteData: {
    title: string;
    content: string;
    tags: string[];
    sourceType?: Note['sourceType'];
    sourceUrl?: string;
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
    handleSaveNotes(updatedNotes);
    toast.success('速记已保存为笔记');
  }, [createBlankNote, notes, handleSaveNotes, toast]);

  // 分享功能
  const handleShare = useCallback((scope: ShareScope) => {
    const result = collectShareScope(notes, folders, scope);
    setShareScope(scope);
    setShareResult(result);
    setShowShareDialog(true);
  }, [notes, folders]);

  const handleShareConfirm = useCallback(async (format: 'markdown-zip' | 'html-zip' | 'markdown-dir' | 'html-dir') => {
    if (!shareResult || !shareScope) return;

    let result;

    switch (format) {
      case 'markdown-zip': {
        const savePath = await exportApi.selectSaveFile('知识库导出.zip');
        if (!savePath) return;
        result = await exportApi.exportMarkdownZip(
          shareResult.notes,
          shareResult.folders,
          shareResult.attachments,
          savePath
        );
        break;
      }
      case 'html-zip': {
        const savePath = await exportApi.selectSaveFile('知识库导出.zip');
        if (!savePath) return;
        result = await exportApi.exportHtmlZip(
          shareResult.notes,
          shareResult.folders,
          shareResult.attachments,
          savePath
        );
        break;
      }
      case 'markdown-dir': {
        const exportPath = await exportApi.selectDirectory();
        if (!exportPath) return;
        result = await exportApi.exportMarkdownDirectory(
          shareResult.notes,
          shareResult.folders,
          shareResult.attachments,
          exportPath
        );
        break;
      }
      case 'html-dir': {
        const exportPath = await exportApi.selectDirectory();
        if (!exportPath) return;
        result = await exportApi.exportHtmlDirectory(
          shareResult.notes,
          shareResult.folders,
          shareResult.attachments,
          exportPath
        );
        break;
      }
    }

    if (result) {
      if (result.success) {
        toast.success(`导出成功！`);
      } else {
        toast.error(`导出失败: ${result.error}`);
      }
    }

    setShowShareDialog(false);
    setShareScope(null);
    setShareResult(null);
  }, [shareResult, shareScope, toast]);

  const handleShareCancel = useCallback(() => {
    setShowShareDialog(false);
    setShareScope(null);
    setShareResult(null);
  }, []);

  const handleLocalShare = useCallback((scope: ShareScope) => {
    const result = collectShareScope(notes, folders, scope);
    setShareScope(scope);
    setShareResult(result);
    setShowLocalShareDialog(true);
  }, [notes, folders]);

  const handleLocalShareClose = useCallback(() => {
    setShowLocalShareDialog(false);
    setShareScope(null);
    setShareResult(null);
  }, []);

  const handleExportCurrentNote = useCallback(() => {
    if (selectedNoteId) {
      handleShare({ type: 'note', noteId: selectedNoteId });
    }
  }, [selectedNoteId, handleShare]);

  const handleExportCurrentFolder = useCallback(() => {
    if (selectedFolderId) {
      handleShare({ type: 'folder', folderId: selectedFolderId });
    }
  }, [selectedFolderId, handleShare]);

  const handleExportVault = useCallback(() => {
    handleShare({ type: 'vault' });
  }, [handleShare]);

  // 命令列表
  const commands = useMemo(() => [
    { id: 'new-note', label: '新建笔记', shortcut: 'Ctrl+N', action: handleNewNote },
    { id: 'quick-switch', label: '快速打开笔记', shortcut: 'Ctrl+P', action: () => setShowQuickSwitcher(true) },
    { id: 'search', label: '搜索全部笔记', shortcut: 'Ctrl+F', action: () => document.querySelector<HTMLInputElement>('.search-input')?.focus() },
    { id: 'graph', label: '打开知识图谱', shortcut: 'Ctrl+G', action: () => setShowGraphView(true) },
    { id: 'review', label: '打开今日回顾', action: handleOpenTodayReview },
    { id: 'random', label: '随机复习', action: handleRandomReview },
    { id: 'quick-capture', label: '新建速记', shortcut: 'Ctrl+Shift+N', action: () => setShowQuickCapture(true) },
    { id: 'export-note', label: '导出当前笔记', action: handleExportCurrentNote },
    { id: 'export-folder', label: '导出当前文件夹', action: handleExportCurrentFolder },
    { id: 'export-vault', label: '导出整个知识库', action: handleExportVault },
    { id: 'local-share', label: '启动局域网分享', action: () => handleLocalShare({ type: 'vault' }) },
  ], [handleNewNote, handleOpenTodayReview, handleRandomReview, handleExportCurrentNote, handleExportCurrentFolder, handleExportVault, handleLocalShare]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search-input')?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowQuickSwitcher((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowQuickCapture(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleNewNote();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        setShowGraphView((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewNote]);

  // 派生状态
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
        onShare={handleShare}
        onLocalShare={handleLocalShare}
        selectedNoteId={selectedNoteId}
        selectedFolderId={selectedFolderId}
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
          {storageError && (
            <div className="storage-error">{storageError}</div>
          )}
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
              searchQuery={searchQuery}
              selectedTag={selectedTag}
              onNoteSelect={handleNoteSelect}
              onNewNote={handleNewNote}
              onClearSearch={handleClearSearch}
              onClearTag={handleClearTag}
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

      {shareResult && (
        <ShareConfirmDialog
          isOpen={showShareDialog}
          shareResult={shareResult}
          onConfirm={handleShareConfirm}
          onCancel={handleShareCancel}
        />
      )}

      {shareResult && (
        <LocalShareDialog
          isOpen={showLocalShareDialog}
          shareResult={shareResult}
          onClose={handleLocalShareClose}
        />
      )}

      <Toast messages={toast.messages} onDismiss={toast.dismissToast} />
    </div>
  );
}

export default App;
