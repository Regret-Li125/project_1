import React, { useCallback, useState } from 'react';
import { shareApi } from '../api/shareApi';
import { exportApi } from '../api/exportApi';
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopSharing = useCallback(async () => {
    await shareApi.stopLocalServer();
    setIsSharing(false);
    setShareUrl(null);
    setLocalUrl(null);
  }, []);

  const handleClose = useCallback(async () => {
    await stopSharing();
    onClose();
  }, [onClose, stopSharing]);

  const startSharing = async () => {
    setError(null);
    setIsSharing(true);

    try {
      // First export to a temporary directory
      const exportPath = await exportApi.selectDirectory();
      if (!exportPath) {
        setIsSharing(false);
        return;
      }

      const exportResult = await exportApi.exportHtmlDirectory(
        shareResult.notes,
        shareResult.folders,
        shareResult.attachments,
        exportPath
      );

      if (!exportResult.success) {
        setError(exportResult.error || '导出失败');
        setIsSharing(false);
        return;
      }

      // Start local server
      const serverResult = await shareApi.startLocalServer(exportPath);
      if (serverResult.success) {
        setShareUrl(serverResult.url || null);
        setLocalUrl(serverResult.localUrl || null);
      } else {
        setError(serverResult.error || '启动服务器失败');
        setIsSharing(false);
      }
    } catch (err) {
      setError(String(err));
      setIsSharing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="local-share-overlay" onClick={handleClose}>
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
              <li>附件: {shareResult.attachmentCount} 个</li>
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
              </div>

              <div className="local-share-warning">
                <p>⚠️ 安全提示：</p>
                <ul>
                  <li>同一局域网内的设备可以访问上述地址</li>
                  <li>只能看到你选择分享的笔记范围</li>
                  <li>点击"停止分享"后地址将不可访问</li>
                  <li>关闭应用时会自动停止分享</li>
                </ul>
              </div>

              <button className="local-share-stop" onClick={stopSharing}>
                停止分享
              </button>
            </div>
          ) : (
            <div className="local-share-start">
              <p>启动局域网分享后，同一网络内的设备可以通过浏览器访问你的知识库。</p>
              
              <div className="local-share-security">
                <p>安全说明：</p>
                <ul>
                  <li>默认不开启，需要你主动启动</li>
                  <li>只读访问，无法修改你的笔记</li>
                  <li>只显示你选择分享的笔记范围</li>
                  <li>关闭应用时自动停止分享</li>
                </ul>
              </div>

              <button className="local-share-start-btn" onClick={startSharing}>
                启动局域网分享
              </button>
            </div>
          )}
        </div>

        <div className="local-share-actions">
          <button className="local-share-close" onClick={handleClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
