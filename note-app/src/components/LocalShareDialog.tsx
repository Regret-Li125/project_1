import React, { useCallback, useEffect, useRef, useState } from 'react';
import { shareApi } from '../api/shareApi';
import { exportApi } from '../api/exportApi';
import { buildShareExportPath } from '../utils/shareUtils';
import type { ShareResult } from '../types/note';

interface LocalShareDialogProps {
  isOpen: boolean;
  shareResult: ShareResult;
  onClose: () => void;
}

export const LocalShareDialog: React.FC<LocalShareDialogProps> = ({
  isOpen,
  shareResult,
  onClose,
}) => {
  const [isSharing, setIsSharing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [stoppedNotice, setStoppedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 启动流程重入锁；启动中对话框被关闭时置取消标记
  const startingRef = useRef(false);
  const cancelRequestedRef = useRef(false);

  // 对话框重新打开时重置上次会话残留的界面状态（渲染期间按 prev-state 模式调整。
  // 关闭期间未完成的启动流程已被置取消标记，收尾时不会再 setState，可安全重置）
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setIsStarting(false);
      setError(null);
      setStoppedNotice(null);
      setExportPath(null);
    }
  }

  // 对话框打开时水合服务器状态：已在运行则直接展示运行中状态
  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;

    shareApi
      .getStatus()
      .then((status) => {
        if (disposed) return;
        if (status.isRunning) {
          setIsSharing(true);
          setShareUrl(status.url);
          setLocalUrl(status.localUrl);
        } else {
          setIsSharing(false);
          setShareUrl(null);
          setLocalUrl(null);
        }
      })
      .catch(() => {
        // 水合失败保持默认未分享状态
      });

    return () => {
      disposed = true;
    };
  }, [isOpen]);

  // 启动流程进行中对话框被外部关闭（isOpen 变 false）→ 置取消标记
  useEffect(() => {
    if (!isOpen && startingRef.current) {
      cancelRequestedRef.current = true;
    }
  }, [isOpen]);

  // 组件卸载时若启动仍在进行 → 置取消标记，流程完成后会自行停止服务器
  useEffect(() => {
    return () => {
      if (startingRef.current) {
        cancelRequestedRef.current = true;
      }
    };
  }, []);

  const stopSharing = useCallback(async (): Promise<boolean> => {
    if (isStopping) return false;
    setIsStopping(true);
    try {
      const result = await shareApi.stopLocalServer();
      if (!result.success) {
        // 停止失败：保留分享状态并提示
        setError(result.error || '停止分享失败，请稍后重试');
        return false;
      }
      setIsSharing(false);
      setShareUrl(null);
      setLocalUrl(null);
      // 提示导出文件保留位置（不自动删除）
      setStoppedNotice(
        exportPath
          ? `分享已停止。导出文件仍保留在：${exportPath}（不会自动删除，可手动清理）`
          : '分享已停止。之前导出的文件仍保留在原导出目录中（不会自动删除，可手动清理）'
      );
      setExportPath(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setIsStopping(false);
    }
  }, [exportPath, isStopping]);

  const handleClose = useCallback(async () => {
    if (startingRef.current) {
      // 启动中：仅置取消标记，由启动流程完成后负责停止服务器
      cancelRequestedRef.current = true;
      return;
    }
    if (isSharing) {
      const stopped = await stopSharing();
      if (!stopped) return; // 停止失败：保留状态，不关闭
    }
    onClose();
  }, [isSharing, onClose, stopSharing]);

  const startSharing = async () => {
    if (startingRef.current || isStarting || isSharing) return; // ref 锁防重入
    startingRef.current = true;
    cancelRequestedRef.current = false;
    setError(null);
    setStoppedNotice(null);
    setIsStarting(true);

    const isCancelled = () => cancelRequestedRef.current;

    try {
      // 先选择导出目录
      const selectedDir = await exportApi.selectDirectory();
      if (!selectedDir) {
        if (!isCancelled()) setIsStarting(false);
        startingRef.current = false;
        return;
      }

      // 导出到所选目录下的专用子目录 knowledge-share-<时间戳>
      const shareDir = buildShareExportPath(selectedDir);
      const exportResult = await exportApi.exportHtmlDirectory(
        shareResult.notes,
        shareResult.folders,
        shareDir
      );

      if (!exportResult.success) {
        if (!isCancelled()) {
          setError(exportResult.error || '导出失败');
          setIsStarting(false);
        }
        startingRef.current = false;
        return;
      }

      if (isCancelled()) {
        // 导出完成前对话框已被关闭：不再启动服务器，也不再 setState
        startingRef.current = false;
        return;
      }

      // 启动本地服务器（url/localUrl 已内嵌 token，直接展示使用）
      const serverResult = await shareApi.startLocalServer(shareDir);
      if (isCancelled()) {
        // 启动中对话框已被关闭：立即停掉刚启动的服务器，不再 setState
        if (serverResult.success) {
          await shareApi.stopLocalServer();
        }
        startingRef.current = false;
        return;
      }

      if (serverResult.success) {
        setShareUrl(serverResult.url || null);
        setLocalUrl(serverResult.localUrl || null);
        setExportPath(shareDir);
        setIsSharing(true);
      } else {
        setError(serverResult.error || '启动服务器失败');
      }
      setIsStarting(false);
      startingRef.current = false;
    } catch (err) {
      if (!isCancelled()) {
        setError(String(err));
        setIsStarting(false);
      }
      startingRef.current = false;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="local-share-overlay"
      onClick={() => {
        if (!isStarting && !isStopping) void handleClose();
      }}
    >
      <div className="local-share-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="local-share-title">局域网分享</h2>

        <div className="local-share-content">
          {error && (
            <div className="local-share-error">{error}</div>
          )}

          <div className="local-share-info">
            <h3>分享范围：</h3>
            <ul>
              <li>笔记: {shareResult.noteCount} 篇</li>
              <li>文件夹: {shareResult.folderCount} 个</li>
            </ul>
          </div>

          {isSharing && shareUrl ? (
            <div className="local-share-active">
              <div className="local-share-status">
                <span className="status-dot active"></span>
                <span>正在分享</span>
              </div>

              <div className="local-share-urls">
                <div className="local-share-url">
                  <label>局域网访问地址：</label>
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                    {shareUrl}
                  </a>
                </div>
                {localUrl && (
                  <div className="local-share-url">
                    <label>本机访问地址：</label>
                    <a href={localUrl} target="_blank" rel="noopener noreferrer">
                      {localUrl}
                    </a>
                  </div>
                )}
                {exportPath && (
                  <div className="local-share-url">
                    <label>导出文件位置：</label>
                    <span>{exportPath}</span>
                  </div>
                )}
              </div>

              <div className="local-share-warning">
                <p>⚠️ 安全提示：</p>
                <ul>
                  <li>同一局域网内的设备可以访问上述地址</li>
                  <li>只能看到你选择分享的笔记范围</li>
                  <li>点击"停止分享"后地址将不可访问</li>
                  <li>停止分享后导出文件不会被自动删除</li>
                  <li>关闭应用时会自动停止分享</li>
                </ul>
              </div>

              <button
                className="local-share-stop"
                onClick={() => void stopSharing()}
                disabled={isStopping}
              >
                {isStopping ? '正在停止…' : '停止分享'}
              </button>
            </div>
          ) : (
            <div className="local-share-start">
              <p>启动局域网分享后，同一网络内的设备可以通过浏览器访问你的知识库。</p>

              {stoppedNotice && (
                <div className="local-share-warning">
                  <p>{stoppedNotice}</p>
                </div>
              )}

              <div className="local-share-warning">
                <p>📁 导出提示：</p>
                <ul>
                  <li>导出文件会写入所选目录下新建的 knowledge-share-时间戳 子目录</li>
                  <li>建议选择一个空目录，避免与已有文件混淆</li>
                  <li>停止分享后导出文件保留在原位置，不会被自动删除</li>
                </ul>
              </div>

              <div className="local-share-security">
                <p>安全说明：</p>
                <ul>
                  <li>默认不开启，需要你主动启动</li>
                  <li>只读访问，无法修改你的笔记</li>
                  <li>只显示你选择分享的笔记范围</li>
                  <li>关闭应用时自动停止分享</li>
                </ul>
              </div>

              <button
                className="local-share-start-btn"
                onClick={() => void startSharing()}
                disabled={isStarting}
              >
                {isStarting ? '正在导出并启动…' : '启动局域网分享'}
              </button>
            </div>
          )}
        </div>

        <div className="local-share-actions">
          <button
            className="local-share-close"
            onClick={() => void handleClose()}
            disabled={isStarting || isStopping}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
