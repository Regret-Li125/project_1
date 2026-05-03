import React, { useState } from 'react';

type CaptureType = 'text' | 'link';
type TemplateType = 'study' | 'meeting' | 'project' | 'action_items' | 'knowledge';

interface QuickCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (note: {
    title: string;
    content: string;
    tags: string[];
    sourceType?: 'quick_capture' | 'link';
    sourceUrl?: string;
  }) => void;
}

const templates: Record<TemplateType, { label: string; template: (content: string) => string }> = {
  study: {
    label: '整理成学习笔记',
    template: (content) => `# 学习笔记

## 核心概念

${content}

## 关键要点

- 

## 实践应用

- 

## 相关链接

- `,
  },
  meeting: {
    label: '整理成会议纪要',
    template: (content) => `# 会议纪要

## 会议内容

${content}

## 决议事项

- 

## 待办事项

- 

## 下一步计划

- `,
  },
  project: {
    label: '整理成项目笔记',
    template: (content) => `# 项目笔记

## 背景

${content}

## 目标

- 

## 实施方案

- 

## 风险与挑战

- 

## 时间节点

- `,
  },
  action_items: {
    label: '提取行动项',
    template: (content) => `# 行动项

## 原始内容

${content}

## 待办事项

- [ ] 

## 优先级

- 高：
- 中：
- 低：

## 截止日期

- `,
  },
  knowledge: {
    label: '提取知识点',
    template: (content) => `# 知识点

## 原始内容

${content}

## 核心知识点

1. 

## 详细说明

- 

## 相关概念

- 

## 个人理解

- `,
  },
};

export const QuickCapture: React.FC<QuickCaptureProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [captureType, setCaptureType] = useState<CaptureType>('text');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('study');
  const [noteTitle, setNoteTitle] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    let finalContent: string;
    let title = noteTitle;

    if (captureType === 'link') {
      finalContent = `# ${title || '链接笔记'}

来源链接：${url}

## 摘要

${content}

## 关键观点

- 

## 我的想法

- `;
    } else {
      const templateFn = templates[selectedTemplate].template;
      finalContent = templateFn(content);
    }

    if (!title) {
      title = captureType === 'link' ? '链接笔记' : '速记笔记';
    }

    onSave({
      title,
      content: finalContent,
      tags: [],
      sourceType: captureType === 'link' ? 'link' : 'quick_capture',
      sourceUrl: captureType === 'link' ? url : undefined,
    });

    setContent('');
    setUrl('');
    setNoteTitle('');
    onClose();
  };

  return (
    <div className="quick-capture-overlay" onClick={onClose}>
      <div className="quick-capture" onClick={(e) => e.stopPropagation()}>
        <div className="quick-capture-header">
          <h2>速记</h2>
          <button className="quick-capture-close" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="quick-capture-tabs">
          <button
            className={`quick-capture-tab ${captureType === 'text' ? 'active' : ''}`}
            onClick={() => setCaptureType('text')}
          >
            文本速记
          </button>
          <button
            className={`quick-capture-tab ${captureType === 'link' ? 'active' : ''}`}
            onClick={() => setCaptureType('link')}
          >
            链接速记
          </button>
        </div>

        <div className="quick-capture-content">
          <div className="quick-capture-field">
            <label>笔记标题</label>
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="可选，留空自动生成"
            />
          </div>

          {captureType === 'link' && (
            <div className="quick-capture-field">
              <label>链接地址</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          <div className="quick-capture-field">
            <label>{captureType === 'link' ? '备注' : '输入内容'}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                captureType === 'link'
                  ? '输入链接备注或摘录...'
                  : '粘贴或输入要整理的内容...'
              }
              rows={6}
            />
          </div>

          {captureType === 'text' && (
            <div className="quick-capture-field">
              <label>整理方式</label>
              <div className="template-options">
                {Object.entries(templates).map(([key, { label }]) => (
                  <button
                    key={key}
                    className={`template-option ${selectedTemplate === key ? 'selected' : ''}`}
                    onClick={() => setSelectedTemplate(key as TemplateType)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="template-note">
                当前未配置 AI，已使用本地模板整理
              </p>
            </div>
          )}
        </div>

        <div className="quick-capture-footer">
          <button className="quick-capture-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="quick-capture-save"
            onClick={handleSave}
            disabled={captureType === 'link' ? !url : !content}
          >
            保存为笔记
          </button>
        </div>
      </div>
    </div>
  );
};
