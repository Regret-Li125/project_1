import React, { useEffect, useState } from 'react';
import { aiApi } from '../api/aiApi';
import type { AIProvider } from '../types/note';

interface AISettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Feedback = { type: 'success' | 'error'; message: string } | null;

const DEFAULT_MODEL = 'gpt-4o-mini';

type ProviderPreset = {
  label: string;
  baseUrl: string;
  needsKey: boolean;
  modelPlaceholder: string;
};

// 云端 OpenAI 兼容服务需 API Key；本地服务（Ollama / LM Studio）免 Key。
const PROVIDER_PRESETS: Record<AIProvider, ProviderPreset> = {
  openai: {
    label: 'OpenAI 兼容（云端）',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    modelPlaceholder: DEFAULT_MODEL,
  },
  ollama: {
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    modelPlaceholder: '如 qwen2.5:7b',
  },
  lmstudio: {
    label: 'LM Studio（本地）',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    modelPlaceholder: '如 qwen2.5-7b-instruct',
  },
};

const PRESET_BASE_URLS = new Set(Object.values(PROVIDER_PRESETS).map((p) => p.baseUrl));

export const AISettingsDialog: React.FC<AISettingsDialogProps> = ({ isOpen, onClose }) => {
  // 表单状态
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState('');

  // 模型列表（来自已保存配置的 GET /models）
  const [models, setModels] = useState<string[]>([]);
  const [listingModels, setListingModels] = useState(false);
  const [modelsFeedback, setModelsFeedback] = useState<Feedback>(null);

  // 交互状态
  const [hydrating, setHydrating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);

  // isOpen 变化时重置表单与反馈（渲染期间根据 props 调整状态，React 推荐模式）
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setEnabled(false);
      setProvider('openai');
      setBaseUrl('');
      setModel('');
      setApiKeyInput('');
      setHasApiKey(false);
      setMaskedApiKey('');
      setModels([]);
      setListingModels(false);
      setModelsFeedback(null);
      setHydrating(true);
      setSaving(false);
      setTesting(false);
      setClearing(false);
      setConfirmClear(false);
      setSaveFeedback(null);
      setTestFeedback(null);
    }
  }

  // 打开时从主进程水合当前配置（hydrating 已在打开时的渲染期重置中置为 true）
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    aiApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setEnabled(cfg.enabled);
        setProvider(cfg.provider);
        setBaseUrl(cfg.baseUrl);
        setModel(cfg.model);
        setHasApiKey(cfg.hasApiKey);
        setMaskedApiKey(cfg.maskedApiKey);
      })
      .catch(() => {
        if (!cancelled) {
          setSaveFeedback({ type: 'error', message: '读取 AI 配置失败' });
        }
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
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

  // 清除 Key 的二次确认状态 3 秒后自动解除
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  // 保存成功反馈 3 秒后自动隐藏
  useEffect(() => {
    if (!saveFeedback || saveFeedback.type !== 'success') return;
    const timer = setTimeout(() => setSaveFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [saveFeedback]);

  if (!isOpen) return null;

  const busy = saving || testing || clearing || listingModels;

  // 切换提供方：baseUrl 跟随预设（用户自定义过地址则保留）；本地服务清掉云端默认模型名
  const handleProviderChange = (next: AIProvider) => {
    setProvider(next);
    setModels([]);
    setModelsFeedback(null);
    setBaseUrl((prev) => {
      const trimmed = prev.trim();
      return trimmed === '' || PRESET_BASE_URLS.has(trimmed)
        ? PROVIDER_PRESETS[next].baseUrl
        : prev;
    });
    if (!PROVIDER_PRESETS[next].needsKey) {
      setModel((prev) => (prev.trim() === '' || prev.trim() === DEFAULT_MODEL ? '' : prev));
    }
  };

  // 针对已保存的配置获取模型列表
  const handleListModels = async () => {
    setListingModels(true);
    setModelsFeedback(null);
    try {
      const result = await aiApi.listModels();
      if (result.success && result.models) {
        setModels(result.models);
        setModelsFeedback(
          result.models.length > 0
            ? { type: 'success', message: `已获取 ${result.models.length} 个模型` }
            : { type: 'error', message: '服务未返回任何模型' }
        );
      } else {
        setModels([]);
        setModelsFeedback({ type: 'error', message: result.error || '获取模型列表失败' });
      }
    } catch {
      setModels([]);
      setModelsFeedback({ type: 'error', message: '获取模型列表失败' });
    } finally {
      setListingModels(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveFeedback(null);
    const preset = PROVIDER_PRESETS[provider];
    // 地址留空回退当前 provider 预设；模型：云端回退默认，本地强制填写/选择
    const effectiveBaseUrl = baseUrl.trim() || preset.baseUrl;
    const effectiveModel = model.trim() || (preset.needsKey ? DEFAULT_MODEL : '');
    if (!preset.needsKey && !effectiveModel) {
      setSaving(false);
      setSaveFeedback({ type: 'error', message: '本地服务需填写或选择模型名称' });
      return;
    }
    try {
      const trimmedKey = apiKeyInput.trim();
      const result = await aiApi.saveConfig({
        enabled,
        provider,
        baseUrl: effectiveBaseUrl,
        model: effectiveModel,
        // 空串表示不修改已保存的 Key
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      });
      if (result.success) {
        setBaseUrl(effectiveBaseUrl);
        setModel(effectiveModel);
        setApiKeyInput('');
        // 刷新 Key 掩码状态
        const cfg = await aiApi.getConfig();
        setHasApiKey(cfg.hasApiKey);
        setMaskedApiKey(cfg.maskedApiKey);
        setSaveFeedback({ type: 'success', message: '已保存' });
      } else {
        setSaveFeedback({ type: 'error', message: result.error || '保存失败' });
      }
    } catch {
      setSaveFeedback({ type: 'error', message: '保存失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    // 第一次点击进入确认态，第二次点击才真正清除
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    setSaveFeedback(null);
    try {
      const result = await aiApi.clearApiKey();
      if (result.success) {
        setHasApiKey(false);
        setMaskedApiKey('');
        setApiKeyInput('');
        setSaveFeedback({ type: 'success', message: 'API Key 已清除' });
      } else {
        setSaveFeedback({ type: 'error', message: result.error || '清除失败' });
      }
    } catch {
      setSaveFeedback({ type: 'error', message: '清除失败，请重试' });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestFeedback(null);
    try {
      const result = await aiApi.testConnection();
      if (result.success) {
        setTestFeedback({
          type: 'success',
          message:
            typeof result.latencyMs === 'number'
              ? `连接成功，延迟 ${result.latencyMs} ms`
              : '连接成功',
        });
      } else {
        setTestFeedback({ type: 'error', message: result.error || '连接失败' });
      }
    } catch {
      setTestFeedback({ type: 'error', message: '连接失败，请重试' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="ai-settings-overlay" onClick={onClose}>
      <div className="ai-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ai-settings-header">
          <h2>AI 设置</h2>
          <button className="ai-settings-close" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="ai-settings-content">
          <div className="ai-settings-field">
            <label className="ai-settings-toggle-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="ai-settings-toggle-label">启用 AI 功能</span>
            </label>
            <p className="ai-settings-hint">关闭后所有 AI 功能自动降级为本地行为</p>
          </div>

          <div className="ai-settings-field">
            <label>服务提供方</label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
            >
              {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="ai-settings-hint">
              {PROVIDER_PRESETS[provider].needsKey
                ? '云端服务需要 API Key'
                : '本地服务无需 API Key，地址可自定义'}
            </p>
          </div>

          <div className="ai-settings-field">
            <label>API 地址</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={PROVIDER_PRESETS[provider].baseUrl}
              spellCheck={false}
            />
          </div>

          <div className="ai-settings-field">
            <label>模型</label>
            <div className="ai-settings-key-row">
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={PROVIDER_PRESETS[provider].modelPlaceholder}
                spellCheck={false}
                list="ai-model-options"
              />
              <datalist id="ai-model-options">
                {models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                type="button"
                className="ai-settings-test-btn"
                onClick={() => void handleListModels()}
                disabled={busy || hydrating}
              >
                {listingModels ? '获取中…' : '获取模型列表'}
              </button>
            </div>
            {modelsFeedback && (
              <p className={`ai-settings-model-feedback ${modelsFeedback.type}`}>
                {modelsFeedback.message}
              </p>
            )}
            <p className="ai-settings-hint">
              {PROVIDER_PRESETS[provider].needsKey
                ? '留空使用默认模型'
                : '本地服务需填写模型名称，可先获取列表后选择'}
            </p>
          </div>

          <div className="ai-settings-field">
            <label>API Key</label>
            <div className="ai-settings-key-row">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={hasApiKey ? maskedApiKey || '已保存' : 'sk-...'}
                spellCheck={false}
                autoComplete="off"
              />
              {hasApiKey && (
                <button
                  type="button"
                  className={`ai-settings-clear-key${confirmClear ? ' confirm' : ''}`}
                  onClick={() => void handleClearKey()}
                  disabled={busy}
                >
                  {clearing ? '清除中…' : confirmClear ? '确认清除？' : '清除 Key'}
                </button>
              )}
            </div>
            <p className="ai-settings-hint">
              {PROVIDER_PRESETS[provider].needsKey
                ? hasApiKey
                  ? '留空保存则不修改已保存的 Key'
                  : 'Key 保存后只显示掩码，不会回显明文'
                : '本地服务可留空；服务端有鉴权时可填写'}
            </p>
          </div>

          <div className="ai-settings-field">
            <div className="ai-settings-test-row">
              <button
                type="button"
                className="ai-settings-test-btn"
                onClick={() => void handleTest()}
                disabled={busy || hydrating}
              >
                {testing ? '正在测试…' : '测试连接'}
              </button>
              {testFeedback && (
                <span className={`ai-settings-test-result ${testFeedback.type}`}>
                  {testFeedback.message}
                </span>
              )}
            </div>
            <p className="ai-settings-hint">测试与模型列表针对已保存的配置，修改后请先保存</p>
          </div>

          <div className="ai-settings-notes">
            <ul>
              <li>API Key 仅加密保存在本机，不会上传到任何其他服务器。</li>
              <li>使用 AI 功能时，相关笔记内容会发送到你配置的服务，需要联网。</li>
              <li>未配置或关闭 AI 不影响普通笔记功能。</li>
              <li>本地模型（Ollama / LM Studio）无需 API Key，选择提供方后自动填充默认地址。</li>
              <li>图片 OCR 需要支持视觉的模型；语音转文字需要兼容 Whisper 的转写接口（多数本地服务不支持转写，会提示失败，不影响其他功能）。</li>
            </ul>
          </div>
        </div>

        <div className="ai-settings-footer">
          {saveFeedback && (
            <span className={`ai-settings-save-feedback ${saveFeedback.type}`}>
              {saveFeedback.message}
            </span>
          )}
          <button className="ai-settings-cancel" onClick={onClose}>
            关闭
          </button>
          <button
            className="ai-settings-save"
            onClick={() => void handleSave()}
            disabled={busy || hydrating}
          >
            {saving ? '正在保存…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};
