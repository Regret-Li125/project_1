import React, { useState, useCallback, useDeferredValue, useEffect, useRef } from 'react';
import type { Note } from '../types/note';
import { aiApi, isAIReady } from '../api/aiApi';
import { MarkdownPreview } from './MarkdownPreview';

// 插入到正文开头的 AI 摘要引用块；重复插入前先移除旧块，保证替换而非堆积
const AI_SUMMARY_BLOCK_RE = /> \*\*AI 摘要\*\*：[^\n]*(?:\n> [^\n]*)*(?:\n+|$)/g;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef<'editor' | 'preview' | null>(null);

  // ---------- Phase 3: AI 增强状态（结果按 noteId 键控，杜绝跨笔记串扰） ----------
  const [aiReady, setAiReady] = useState(false);
  const [summaryState, setSummaryState] = useState<{ noteId: string; text: string } | null>(null);
  const [summaryError, setSummaryError] = useState<{ noteId: string; message: string } | null>(null);
  const [summaryLoadingId, setSummaryLoadingId] = useState<string | null>(null);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [suggestedState, setSuggestedState] = useState<{ noteId: string; tags: string[] } | null>(null);
  const [tagsError, setTagsError] = useState<{ noteId: string; message: string } | null>(null);
  const [tagsLoadingId, setTagsLoadingId] = useState<string | null>(null);

  const deferredContent = useDeferredValue(note.content);

  const summaryLoading = summaryLoadingId === note.id;
  const tagsLoading = tagsLoadingId === note.id;
  const summary = summaryState?.noteId === note.id ? summaryState.text : null;
  const summaryErrorMessage = summaryError?.noteId === note.id ? summaryError.message : null;
  const tagsErrorMessage = tagsError?.noteId === note.id ? tagsError.message : null;
  const visibleSuggestedTags =
    suggestedState?.noteId === note.id
      ? suggestedState.tags.filter((tag) => !note.tags.includes(tag))
      : [];

  // 挂载与切换笔记时读取 AI 配置：AI 默认关闭，未配置时降级隐藏 AI 功能
  useEffect(() => {
    let cancelled = false;
    aiApi
      .getConfig()
      .then((cfg) => {
        if (!cancelled) setAiReady(isAIReady(cfg));
      })
      .catch(() => {
        if (!cancelled) setAiReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [note.id]);

  // 切换笔记时重置删除确认状态（渲染期间调整状态，不卸载组件，避免破坏聚焦）
  const [prevNoteId, setPrevNoteId] = useState(note.id);
  if (prevNoteId !== note.id) {
    setPrevNoteId(note.id);
    setShowDeleteConfirm(false);
    // 同时清空上一篇笔记的 AI 摘要/标签推荐结果
    setSummaryState(null);
    setSummaryError(null);
    setSummaryLoadingId(null);
    setSummaryCollapsed(false);
    setSuggestedState(null);
    setTagsError(null);
    setTagsLoadingId(null);
  }

  const handleEditorScroll = useCallback(() => {
    if (syncingRef.current === 'preview') return;
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!textarea || !preview) return;
    syncingRef.current = 'editor';
    const ratio = textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight || 1);
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    // 双 rAF：程序性设置 scrollTop 触发的反向 scroll 事件在同一帧末尾才派发，
    // 延迟到下一帧再清标志，避免回环
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { syncingRef.current = null; });
    });
  }, []);

  const handlePreviewScroll = useCallback(() => {
    if (syncingRef.current === 'editor') return;
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    if (!textarea || !preview) return;
    syncingRef.current = 'preview';
    const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
    textarea.scrollTop = ratio * (textarea.scrollHeight - textarea.clientHeight);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { syncingRef.current = null; });
    });
  }, []);

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
    }
    // trim 后为空（纯空格）或已添加成功，都清空输入框
    if (!tag || !note.tags.includes(tag)) {
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
      // IME 组合输入中（如中文拼音未上屏）不响应 Enter/逗号
      if (e.nativeEvent.isComposing) return;
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

  // ---------- Phase 3: AI 操作 ----------

  const handleSummarize = useCallback(async () => {
    if (summaryLoading) return; // 防重入
    const noteId = note.id;
    setSummaryLoadingId(noteId);
    setSummaryError(null);
    try {
      const result = await aiApi.summarize({ content: note.content.slice(0, 8000) });
      const text = result.summary?.trim();
      if (result.success && text) {
        setSummaryState({ noteId, text });
        setSummaryCollapsed(false);
      } else {
        setSummaryState(null);
        setSummaryError({ noteId, message: result.error ?? '生成摘要失败' });
      }
    } catch {
      setSummaryState(null);
      setSummaryError({ noteId, message: '生成摘要失败' });
    } finally {
      setSummaryLoadingId((current) => (current === noteId ? null : current));
    }
  }, [summaryLoading, note.id, note.content]);

  const handleInsertSummary = useCallback(() => {
    const text = summary?.trim();
    if (!text) return;
    const block = text
      .split('\n')
      .map((line, index) => (index === 0 ? `> **AI 摘要**：${line}` : `> ${line}`))
      .join('\n');
    // 已存在 AI 摘要引用块则先移除，实现替换而非重复插入
    const stripped = note.content.replace(AI_SUMMARY_BLOCK_RE, '');
    const rest = stripped === note.content ? stripped : stripped.replace(/^\n+|\n+$/g, '');
    onUpdate({ content: rest ? `${block}\n\n${rest}` : block });
  }, [summary, note.content, onUpdate]);

  const handleToggleSummaryCollapsed = useCallback(() => {
    setSummaryCollapsed((prev) => !prev);
  }, []);

  const handleCloseSummary = useCallback(() => {
    setSummaryState(null);
  }, []);

  const handleSuggestTags = useCallback(async () => {
    if (tagsLoading) return; // 防重入
    const noteId = note.id;
    setTagsLoadingId(noteId);
    setTagsError(null);
    try {
      const result = await aiApi.suggestTags({
        title: note.title,
        content: note.content.slice(0, 2000),
        existingTags: note.tags,
        max: 5,
      });
      if (result.success && result.tags && result.tags.length > 0) {
        setSuggestedState({ noteId, tags: result.tags });
      } else {
        setSuggestedState(null);
        setTagsError({
          noteId,
          message: result.success ? 'AI 未给出可用标签' : (result.error ?? '推荐标签失败'),
        });
      }
    } catch {
      setSuggestedState(null);
      setTagsError({ noteId, message: '推荐标签失败' });
    } finally {
      setTagsLoadingId((current) => (current === noteId ? null : current));
    }
  }, [tagsLoading, note.id, note.title, note.content, note.tags]);

  // 复用与手动添加一致的 trim + 去重逻辑
  const handleAddSuggestedTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (trimmed && !note.tags.includes(trimmed)) {
        onUpdate({ tags: [...note.tags, trimmed] });
      }
      setSuggestedState((prev) =>
        prev && prev.noteId === note.id
          ? { noteId: prev.noteId, tags: prev.tags.filter((t) => t !== tag) }
          : prev
      );
    },
    [note.id, note.tags, onUpdate]
  );

  const handleAddAllSuggestedTags = useCallback(() => {
    if (!suggestedState || suggestedState.noteId !== note.id) return;
    const merged = [...note.tags];
    for (const tag of suggestedState.tags) {
      const trimmed = tag.trim();
      if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
    }
    if (merged.length !== note.tags.length) onUpdate({ tags: merged });
    setSuggestedState(null);
  }, [suggestedState, note.id, note.tags, onUpdate]);

  const handleCloseSuggestedTags = useCallback(() => {
    setSuggestedState(null);
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

      {aiReady && (
        <div className="ai-toolbar">
          <button
            type="button"
            className="ai-btn"
            onClick={handleSummarize}
            disabled={summaryLoading || !note.content.trim()}
          >
            {summaryLoading ? '生成中…' : 'AI 摘要'}
          </button>
          <button
            type="button"
            className="ai-btn"
            onClick={handleSuggestTags}
            disabled={tagsLoading || !note.content.trim()}
          >
            {tagsLoading ? '生成中…' : 'AI 标签'}
          </button>
        </div>
      )}

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
        {visibleSuggestedTags.length > 0 && (
          <div className="ai-suggested-tags">
            <span className="ai-suggested-label">推荐标签：</span>
            {visibleSuggestedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="ai-suggested-tag"
                onClick={() => handleAddSuggestedTag(tag)}
              >
                + {tag}
              </button>
            ))}
            <button type="button" className="ai-add-all-btn" onClick={handleAddAllSuggestedTags}>
              全部添加
            </button>
            <button
              type="button"
              className="ai-close-btn"
              onClick={handleCloseSuggestedTags}
              aria-label="关闭标签推荐"
            >
              ×
            </button>
          </div>
        )}
        {tagsErrorMessage && <div className="ai-error">{tagsErrorMessage}</div>}
      </div>

      {summary && (
        <div className="ai-summary-panel">
          <div className="ai-summary-header">
            <button
              type="button"
              className="ai-summary-toggle"
              onClick={handleToggleSummaryCollapsed}
              aria-expanded={!summaryCollapsed}
            >
              {summaryCollapsed ? '▸ AI 摘要' : '▾ AI 摘要'}
            </button>
            <div className="ai-summary-actions">
              <button type="button" className="ai-insert-btn" onClick={handleInsertSummary}>
                插入到文首
              </button>
              <button
                type="button"
                className="ai-close-btn"
                onClick={handleCloseSummary}
                aria-label="关闭摘要预览"
              >
                ×
              </button>
            </div>
          </div>
          {!summaryCollapsed && <div className="ai-summary-body">{summary}</div>}
        </div>
      )}
      {summaryErrorMessage && <div className="ai-error">{summaryErrorMessage}</div>}

      <div className="editor-content">
        <textarea
          ref={textareaRef}
          className="markdown-input"
          placeholder="输入 Markdown 内容..."
          value={note.content}
          onChange={handleContentChange}
          onScroll={handleEditorScroll}
          aria-label="Markdown 内容"
        />
        <div ref={previewRef} className="preview-scroll-container" onScroll={handlePreviewScroll}>
          <MarkdownPreview content={deferredContent} onLinkClick={onLinkClick} />
        </div>
      </div>
    </div>
  );
};
