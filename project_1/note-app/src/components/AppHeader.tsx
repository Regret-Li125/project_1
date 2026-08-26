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
  searchInputRef?: React.Ref<HTMLInputElement>;
  onOpenSettings?: () => void;
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
  searchInputRef,
  onOpenSettings,
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
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShareMenu(false);
      }
    };
    // mousedown 先于 click 触发，避免菜单项点击被外部监听抢走
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
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
          ref={searchInputRef}
        />
      </div>
      <button
        type="button"
        className="semantic-search-badge"
        disabled
        title="语义搜索功能规划中，敬请期待"
      >
        语义搜索·规划中
      </button>
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
          className="settings-btn"
          onClick={onOpenSettings}
          aria-label="设置"
          title="AI 设置"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          设置
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
