import { useState, useEffect, useCallback, useMemo, useDeferredValue } from 'react';
import type { Note, Folder, ShareScope } from './types/note';
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
import { Toast } from './components/Toast';
import { useToast } from './hooks/useToast';
import { useNotes } from './hooks/useNotes';
import { useShare } from './hooks/useShare';
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
  toastRef.current = toast;

  const share = useShare(notes, folders, toast);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraphView, setShowGraphView] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredSelectedTag = useDeferredValue(selectedTag);
  const deferredNotes = useDeferredValue(notes);

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
    saveNotes(updatedNotes);
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
    toast.success('笔记已删除');
  }, [notes, selectedNoteId, setNotes, saveNotesImmediate, toast]);

  const handleBack = useCallback(() => {
    setSelectedNoteId(null);
    setViewMode('list');
  }, []);

  // Search & filter
  const handleSearchChange = useCallback((query: string) => setSearchQuery(query), []);
  const handleClearSearch = useCallback(() => setSearchQuery(''), []);
  const handleTagSelect = useCallback((tag: string | null) => setSelectedTag(tag), []);
  const handleClearTag = useCallback(() => setSelectedTag(null), []);
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
      id: crypto.randomUUID ? crypto.randomUUID() : `folder_${Date.now()}`,
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
    const updatedFolders = folders.filter((f) => f.id !== folderId);
    const updatedNotes = notes.map((n) =>
      n.folderId === folderId ? { ...n, folderId: null } : n
    );
    setFolders(updatedFolders);
    setNotes(updatedNotes);
    saveNotes(updatedNotes, updatedFolders);
  }, [folders, notes, setFolders, setNotes, saveNotes]);

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
    toast.success('速记已保存为笔记');
  }, [createBlankNote, notes, setNotes, saveNotes, toast]);

  // Share shortcuts
  const handleExportCurrentNote = useCallback(() => {
    if (selectedNoteId) share.openShare({ type: 'note', noteId: selectedNoteId });
  }, [selectedNoteId, share]);

  const handleExportCurrentFolder = useCallback(() => {
    if (selectedFolderId) share.openShare({ type: 'folder', folderId: selectedFolderId });
  }, [selectedFolderId, share]);

  const handleExportVault = useCallback(() => share.openShare({ type: 'vault' }), [share]);

  // Commands
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
    { id: 'local-share', label: '启动局域网分享', action: () => share.openLocalShare({ type: 'vault' }) },
  ], [handleNewNote, handleOpenTodayReview, handleRandomReview, handleExportCurrentNote, handleExportCurrentFolder, handleExportVault, share]);

  // Keyboard shortcuts
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

      <Toast messages={toast.messages} onDismiss={toast.dismissToast} />
    </div>
  );
}

export default App;
