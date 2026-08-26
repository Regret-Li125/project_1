import React, { useState, useEffect, useRef } from 'react';
import { aiApi, isAIReady } from '../api/aiApi';

type CaptureType = 'text' | 'link' | 'image' | 'voice';
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
    /** AI 整理失败回退本地模板时为 true，由 App 层提示 */
    usedFallback?: boolean;
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

const formatRecordingTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// Markdown 图片 alt 必须保持单行且不含方括号/圆括号，否则会破坏图片语法，
// 并导致导出时 !\[..\]\(vault-img://..\) 引用匹配失败（图片丢失、残留死链）。
const sanitizeImageAlt = (text: string): string => {
  const cleaned = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]()>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
    .trim();
  return cleaned || '图片';
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
  const [urlError, setUrlError] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // AI 状态：enabled && hasApiKey 时才走 AI 整理
  const [aiReady, setAiReady] = useState(false);
  const [saving, setSaving] = useState(false);

  // 图片速记
  const [imageRelPath, setImageRelPath] = useState('');
  const [imageDesc, setImageDesc] = useState('');
  const [imageError, setImageError] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);

  // 语音速记
  const [voiceText, setVoiceText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  // 关闭弹窗等非主动停止场景下丢弃录音结果，不触发转写
  const discardRecordingRef = useRef(false);

  // 停止录音并释放麦克风资源（只操作 ref，不触发 setState；
  // isRecording 等状态由手动停止或下次打开时的重置逻辑恢复）
  const stopRecordingResources = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // 每次打开时重置表单草稿（渲染期间根据 isOpen 变化调整状态，React 推荐模式）
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setCaptureType('text');
      setContent('');
      setUrl('');
      setSelectedTemplate('study');
      setNoteTitle('');
      setUrlError('');
      setAiReady(false);
      setSaving(false);
      setImageRelPath('');
      setImageDesc('');
      setImageError('');
      setOcrLoading(false);
      setVoiceText('');
      setVoiceError('');
      setIsRecording(false);
      setRecordingSeconds(0);
      setTranscribing(false);
    }
  }

  // 打开时探测 AI 配置状态
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  // 打开时自动聚焦内容区
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => contentRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Esc 关闭（无论焦点在哪个控件上）
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // 关闭或卸载时停止录音并释放 MediaStream（丢弃录音结果，不触发转写）
  useEffect(() => {
    if (!isOpen) {
      discardRecordingRef.current = true;
      stopRecordingResources();
    }
    return () => {
      discardRecordingRef.current = true;
      stopRecordingResources();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // 文本/语音共用的整理流程：AI 可用时优先 AI 整理，失败回退本地模板。
  // usedFallback 仅在「AI 可用但调用失败」时为 true，由 App 层 toast 提示降级。
  const organizeContent = async (
    raw: string,
    title: string
  ): Promise<{ content: string; usedFallback: boolean }> => {
    const fallback = () => ({
      content: templates[selectedTemplate].template(raw),
      usedFallback: aiReady,
    });
    if (!aiReady) return fallback();
    setSaving(true);
    try {
      const res = await aiApi.organizeText({
        content: raw,
        mode: selectedTemplate,
        title: title || undefined,
      });
      if (res.success && res.markdown) {
        return { content: res.markdown, usedFallback: false };
      }
    } catch {
      // 继续走本地模板兜底
    } finally {
      setSaving(false);
    }
    return fallback();
  };

  const handleSelectImage = async () => {
    setImageError('');
    try {
      const res = await aiApi.selectImageToVault();
      if (res.error) {
        setImageError(res.error);
        return;
      }
      if (!res.canceled && res.relPath) {
        setImageRelPath(res.relPath);
      }
    } catch {
      setImageError('选择图片失败');
    }
  };

  const handleOcr = async () => {
    if (!imageRelPath) return;
    setOcrLoading(true);
    setImageError('');
    try {
      const res = await aiApi.ocrImage({ relPath: imageRelPath });
      if (res.success && res.text) {
        const text = res.text;
        setImageDesc((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
      } else {
        setImageError(res.error || 'OCR 识别失败');
      }
    } catch {
      setImageError('OCR 识别失败');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleStartRecording = async () => {
    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (discardRecordingRef.current) return;
        void handleTranscribe(new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      discardRecordingRef.current = false;
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setVoiceError('无法访问麦克风，请检查录音权限或设备');
      stopRecordingResources();
    }
  };

  const handleStopRecording = () => {
    stopRecordingResources();
    setIsRecording(false);
  };

  const handleTranscribe = async (blob: Blob) => {
    setTranscribing(true);
    setVoiceError('');
    try {
      const res = await aiApi.transcribeAudio({
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType: blob.type,
        fileName: 'voice.webm',
      });
      if (res.success && res.text) {
        setVoiceText(res.text);
      } else {
        setVoiceError(res.error || '语音转写失败');
      }
    } catch {
      setVoiceError('语音转写失败');
    } finally {
      setTranscribing(false);
    }
  };

  const handleSave = async () => {
    const trimmedContent = content.trim();
    const trimmedUrl = url.trim();
    let finalContent: string;
    let title = noteTitle.trim();
    let usedFallback = false;

    if (captureType === 'link') {
      try {
        new URL(trimmedUrl);
      } catch {
        setUrlError('链接格式不正确，请输入完整 URL（如 https://example.com）');
        return;
      }
      setUrlError('');
      finalContent = `# ${title || '链接笔记'}

来源链接：${trimmedUrl}

## 摘要

${trimmedContent}

## 关键观点

- 

## 我的想法

- `;
      if (!title) title = '链接笔记';
    } else if (captureType === 'image') {
      if (!imageRelPath) return;
      const desc = imageDesc.trim();
      // alt 只放清洗后的简短说明；完整 OCR 文本保留在「说明」小节
      finalContent = `# ${title || '图片速记'}

![${sanitizeImageAlt(desc)}](vault-img://${imageRelPath})

## 说明

${desc}

## 我的想法

- `;
      if (!title) title = '图片速记';
    } else if (captureType === 'voice') {
      const raw = voiceText.trim();
      if (!raw) return;
      if (!title) title = '语音速记';
      const organized = await organizeContent(raw, title);
      finalContent = organized.content;
      usedFallback = organized.usedFallback;
    } else {
      if (!trimmedContent) return;
      if (!title) title = '速记笔记';
      const organized = await organizeContent(trimmedContent, title);
      finalContent = organized.content;
      usedFallback = organized.usedFallback;
    }

    onSave({
      title,
      content: finalContent,
      tags: [],
      sourceType: captureType === 'link' ? 'link' : 'quick_capture',
      sourceUrl: captureType === 'link' ? trimmedUrl : undefined,
      usedFallback,
    });

    onClose();
  };

  // 切换速记类型：录音中先停止并丢弃录音，避免麦克风在后台持续占用
  const handleSwitchCaptureType = (next: CaptureType) => {
    if (next === captureType) return;
    if (isRecording) {
      discardRecordingRef.current = true;
      stopRecordingResources();
      setIsRecording(false);
    }
    setCaptureType(next);
  };

  const saveDisabled =
    saving ||
    transcribing ||
    (captureType === 'link'
      ? !url.trim()
      : captureType === 'image'
        ? !imageRelPath
        : captureType === 'voice'
          ? !voiceText.trim()
          : !content.trim());

  const renderTemplateOptions = () => (
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
        {aiReady ? '已启用 AI 整理' : '当前未配置 AI，已使用本地模板整理'}
      </p>
    </div>
  );

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
            onClick={() => handleSwitchCaptureType('text')}
          >
            文本速记
          </button>
          <button
            className={`quick-capture-tab ${captureType === 'link' ? 'active' : ''}`}
            onClick={() => handleSwitchCaptureType('link')}
          >
            链接速记
          </button>
          <button
            className={`quick-capture-tab ${captureType === 'image' ? 'active' : ''}`}
            onClick={() => handleSwitchCaptureType('image')}
          >
            图片速记
          </button>
          <button
            className={`quick-capture-tab ${captureType === 'voice' ? 'active' : ''}`}
            onClick={() => handleSwitchCaptureType('voice')}
          >
            语音速记
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
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlError) setUrlError('');
                }}
                placeholder="https://..."
              />
              {urlError && <p className="quick-capture-error">{urlError}</p>}
            </div>
          )}

          {(captureType === 'text' || captureType === 'link') && (
            <div className="quick-capture-field">
              <label>{captureType === 'link' ? '备注' : '输入内容'}</label>
              <textarea
                ref={contentRef}
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
          )}

          {captureType === 'text' && renderTemplateOptions()}

          {captureType === 'image' && (
            <>
              <div className="quick-capture-field">
                <label>图片</label>
                <div className="quick-capture-image-picker">
                  <button
                    className="quick-capture-secondary-btn"
                    onClick={() => void handleSelectImage()}
                  >
                    选择图片
                  </button>
                  {aiReady && (
                    <button
                      className="quick-capture-secondary-btn"
                      onClick={() => void handleOcr()}
                      disabled={!imageRelPath || ocrLoading}
                    >
                      {ocrLoading ? '识别中…' : 'OCR 识别文字'}
                    </button>
                  )}
                </div>
                {imageRelPath && (
                  <div className="quick-capture-image-preview">
                    <img src={`vault-img://${imageRelPath}`} alt="图片预览" />
                  </div>
                )}
                {imageError && <p className="quick-capture-error">{imageError}</p>}
              </div>
              <div className="quick-capture-field">
                <label>图片说明</label>
                <textarea
                  value={imageDesc}
                  onChange={(e) => setImageDesc(e.target.value)}
                  placeholder="补充图片说明，或使用 OCR 自动识别..."
                  rows={5}
                />
              </div>
            </>
          )}

          {captureType === 'voice' && (
            <>
              {aiReady && (
                <div className="quick-capture-field">
                  <label>录音</label>
                  <div className="quick-capture-record-bar">
                    <button
                      className={`quick-capture-record-btn ${isRecording ? 'recording' : ''}`}
                      onClick={isRecording ? handleStopRecording : () => void handleStartRecording()}
                      disabled={transcribing}
                    >
                      {isRecording ? '停止录音' : '开始录音'}
                    </button>
                    {isRecording && (
                      <span className="quick-capture-record-time">
                        {formatRecordingTime(recordingSeconds)}
                      </span>
                    )}
                    {transcribing && (
                      <span className="quick-capture-record-status">转写中…</span>
                    )}
                  </div>
                  {voiceError && <p className="quick-capture-error">{voiceError}</p>}
                </div>
              )}
              <div className="quick-capture-field">
                <label>{aiReady ? '转写文本' : '粘贴语音转写文本'}</label>
                <textarea
                  value={voiceText}
                  onChange={(e) => setVoiceText(e.target.value)}
                  placeholder={
                    aiReady
                      ? '录音转写结果会填入此处，可编辑...'
                      : '粘贴语音转写文本...'
                  }
                  rows={6}
                />
              </div>
              {!aiReady && voiceError && <p className="quick-capture-error">{voiceError}</p>}
              {renderTemplateOptions()}
            </>
          )}
        </div>

        <div className="quick-capture-footer">
          <button className="quick-capture-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="quick-capture-save"
            onClick={() => void handleSave()}
            disabled={saveDisabled}
          >
            {saving ? 'AI 整理中…' : '保存为笔记'}
          </button>
        </div>
      </div>
    </div>
  );
};
