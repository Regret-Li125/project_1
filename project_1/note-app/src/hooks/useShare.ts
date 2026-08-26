import { useState, useCallback, useMemo } from 'react';
import type { Note, Folder, ShareScope, ShareResult } from '../types/note';
import { exportApi } from '../api/exportApi';
import { collectShareScope } from '../utils/shareUtils';

export type ExportFormat = 'markdown-zip' | 'html-zip' | 'markdown-dir' | 'html-dir';

export function useShare(
  notes: Note[],
  folders: Folder[],
  onToast: { success: (msg: string) => void; error: (msg: string) => void }
) {
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showLocalShareDialog, setShowLocalShareDialog] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope | null>(null);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);

  const openShare = useCallback((scope: ShareScope) => {
    const result = collectShareScope(notes, folders, scope);
    setShareScope(scope);
    setShareResult(result);
    setShowShareDialog(true);
  }, [notes, folders]);

  const openLocalShare = useCallback((scope: ShareScope) => {
    const result = collectShareScope(notes, folders, scope);
    setShareScope(scope);
    setShareResult(result);
    setShowLocalShareDialog(true);
  }, [notes, folders]);

  const confirmShare = useCallback(async (format: ExportFormat) => {
    if (!shareResult || !shareScope) return;

    try {
      let result;

      switch (format) {
        case 'markdown-zip': {
          const savePath = await exportApi.selectSaveFile('知识库导出.zip');
          if (!savePath) return;
          result = await exportApi.exportMarkdownZip(shareResult.notes, shareResult.folders, savePath);
          break;
        }
        case 'html-zip': {
          const savePath = await exportApi.selectSaveFile('知识库导出.zip');
          if (!savePath) return;
          result = await exportApi.exportHtmlZip(shareResult.notes, shareResult.folders, savePath);
          break;
        }
        case 'markdown-dir': {
          const exportPath = await exportApi.selectDirectory();
          if (!exportPath) return;
          result = await exportApi.exportMarkdownDirectory(shareResult.notes, shareResult.folders, exportPath);
          break;
        }
        case 'html-dir': {
          const exportPath = await exportApi.selectDirectory();
          if (!exportPath) return;
          result = await exportApi.exportHtmlDirectory(shareResult.notes, shareResult.folders, exportPath);
          break;
        }
      }

      if (result) {
        if (result.success) {
          onToast.success('导出成功！');
        } else {
          onToast.error(`导出失败: ${result.error || '未知错误'}`);
        }
      }

      setShowShareDialog(false);
      setShareScope(null);
      setShareResult(null);
    } catch (error) {
      // 导出过程抛异常：提示用户并复位对话框状态，避免对话框卡死在打开状态
      console.error('Failed to export:', error);
      onToast.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
      setShowShareDialog(false);
      setShareScope(null);
      setShareResult(null);
    }
  }, [shareResult, shareScope, onToast]);

  const cancelShare = useCallback(() => {
    setShowShareDialog(false);
    setShareScope(null);
    setShareResult(null);
  }, []);

  const closeLocalShare = useCallback(() => {
    setShowLocalShareDialog(false);
    setShareScope(null);
    setShareResult(null);
  }, []);

  return useMemo(() => ({
    showShareDialog,
    showLocalShareDialog,
    shareResult,
    openShare,
    openLocalShare,
    confirmShare,
    cancelShare,
    closeLocalShare,
  }), [
    showShareDialog,
    showLocalShareDialog,
    shareResult,
    openShare,
    openLocalShare,
    confirmShare,
    cancelShare,
    closeLocalShare,
  ]);
}
