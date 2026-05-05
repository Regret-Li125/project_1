import React from 'react';
import type { ShareResult } from '../types/note';

type ExportFormat = 'markdown-zip' | 'html-zip' | 'markdown-dir' | 'html-dir';

interface ShareConfirmDialogProps {
  isOpen: boolean;
  shareResult: ShareResult;
  onConfirm: (format: ExportFormat) => void;
  onCancel: () => void;
}

export const ShareConfirmDialog: React.FC<ShareConfirmDialogProps> = ({
  isOpen,
  shareResult,
  onConfirm,
  onCancel,
}) => {
  const [selectedFormat, setSelectedFormat] = React.useState<ExportFormat>('markdown-zip');

  if (!isOpen) return null;

  const hasSourceUrl = shareResult.notes.some((n) => n.sourceUrl);
  const hasTags = shareResult.notes.some((n) => n.tags.length > 0);

  return (
    <div className="share-confirm-overlay" onClick={onCancel}>
      <div className="share-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="share-confirm-title">确认导出</h2>
        
        <div className="share-confirm-content">
          <div className="share-confirm-section">
            <h3>你将导出：</h3>
            <ul className="share-confirm-list">
              <li>笔记数量: <strong>{shareResult.noteCount}</strong> 篇</li>
              <li>文件夹数量: <strong>{shareResult.folderCount}</strong> 个</li>
              {hasTags && <li>包含标签信息</li>}
              {hasSourceUrl && <li>包含源链接</li>}
              <li>包含创建/更新时间</li>
            </ul>
          </div>

          <div className="share-confirm-section">
            <h3>不会导出：</h3>
            <ul className="share-confirm-list">
              <li>本机绝对路径</li>
              <li>应用日志</li>
              <li>未选择的笔记</li>
            </ul>
          </div>

          <div className="share-confirm-section">
            <h3>导出格式：</h3>
            <div className="share-format-options">
              <label className="share-format-option">
                <input
                  type="radio"
                  name="format"
                  value="markdown-zip"
                  checked={selectedFormat === 'markdown-zip'}
                  onChange={() => setSelectedFormat('markdown-zip')}
                />
                <div className="share-format-info">
                  <span className="share-format-name">Markdown 压缩包 (.zip)</span>
                  <span className="share-format-desc">包含 .md 文件，可用任何 Markdown 编辑器打开</span>
                </div>
              </label>
              <label className="share-format-option">
                <input
                  type="radio"
                  name="format"
                  value="html-zip"
                  checked={selectedFormat === 'html-zip'}
                  onChange={() => setSelectedFormat('html-zip')}
                />
                <div className="share-format-info">
                  <span className="share-format-name">静态网页压缩包 (.zip)</span>
                  <span className="share-format-desc">生成 HTML 文件，可直接在浏览器中查看</span>
                </div>
              </label>
              <label className="share-format-option">
                <input
                  type="radio"
                  name="format"
                  value="markdown-dir"
                  checked={selectedFormat === 'markdown-dir'}
                  onChange={() => setSelectedFormat('markdown-dir')}
                />
                <div className="share-format-info">
                  <span className="share-format-name">Markdown 文件夹</span>
                  <span className="share-format-desc">导出到文件夹，适合后续处理</span>
                </div>
              </label>
              <label className="share-format-option">
                <input
                  type="radio"
                  name="format"
                  value="html-dir"
                  checked={selectedFormat === 'html-dir'}
                  onChange={() => setSelectedFormat('html-dir')}
                />
                <div className="share-format-info">
                  <span className="share-format-name">静态网页文件夹</span>
                  <span className="share-format-desc">导出到文件夹，可自行托管</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="share-confirm-actions">
          <button className="share-confirm-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="share-confirm-submit"
            onClick={() => onConfirm(selectedFormat)}
          >
            确认导出
          </button>
        </div>
      </div>
    </div>
  );
};
