import React from 'react';
import type { ShareScope } from '../types/note';

interface AppHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewNote: () => void;
  onQuickCapture: () => void;
  onOpenCommandPalette: () => void;
  onShare: (scope: ShareScope) => void;
  onLocalShare: (scope: ShareScope) => void;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
}

export const AppHeader: React.FC<AppHeaderProps> = React.memo(({
  searchQuery,
  onSearchChange,
  onNewNote,
  onQuickCapture,
  onOpenCommandPalette,
  onShare,
  onLocalShare,
  selectedNoteId,
  selectedFolderId,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onSearchChange('');
    }
  };

  const [showShareMenu, setShowShareMenu] = React.useState(false);
  const shareMenuRef = React.useRef<HTMLDivElement>(null);
  const [theme, setTheme] = React.useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  React.useEffect(() => {
    if (!showShareMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showShareMenu]);

  return (
    <header className="app-header">
      <h1 className="app-title">个人知识库</h1>
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="搜索笔记... (Ctrl+K 命令面板)"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="搜索笔记"
        />
      </div>
      <div className="header-actions">
        <button
          className="command-palette-btn"
          onClick={onOpenCommandPalette}
          aria-label="命令面板"
          title="命令面板 (Ctrl+K)"
        >
          命令面板
        </button>
        <button
          className="quick-capture-btn"
          onClick={onQuickCapture}
          aria-label="速记"
          title="速记"
        >
          速记
        </button>
        <div className="share-menu-container" ref={shareMenuRef}>
          <button
            className="share-btn"
            onClick={() => setShowShareMenu(!showShareMenu)}
            aria-label="分享/导出"
            title="分享/导出"
          >
            分享/导出
          </button>
          {showShareMenu && (
            <div className="share-menu">
              <div className="share-menu-section">导出</div>
              {selectedNoteId && (
                <button
                  className="share-menu-item"
                  onClick={() => {
                    onShare({ type: 'note', noteId: selectedNoteId });
                    setShowShareMenu(false);
                  }}
                >
                  导出当前笔记
                </button>
              )}
              {selectedFolderId && (
                <button
                  className="share-menu-item"
                  onClick={() => {
                    onShare({ type: 'folder', folderId: selectedFolderId });
                    setShowShareMenu(false);
                  }}
                >
                  导出当前文件夹
                </button>
              )}
              <button
                className="share-menu-item"
                onClick={() => {
                  onShare({ type: 'vault' });
                  setShowShareMenu(false);
                }}
              >
                导出整个知识库
              </button>
              <div className="share-menu-divider"></div>
              <div className="share-menu-section">局域网分享</div>
              <button
                className="share-menu-item"
                onClick={() => {
                  onLocalShare({ type: 'vault' });
                  setShowShareMenu(false);
                }}
              >
                启动局域网分享
              </button>
            </div>
          )}
        </div>
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
        <button
          className="new-note-btn"
          onClick={onNewNote}
          aria-label="新建笔记"
        >
          + 新建笔记
        </button>
      </div>
    </header>
  );
});
