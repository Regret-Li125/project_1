import type { AICaptureMode, AIConfigPublic, AIProvider } from '../types/note';

/**
 * AI 能力桥接层（Phase 3）。
 *
 * 契约（由 electron/preload.cjs 暴露的 window.aiApi 实现）：
 * - 所有 AI 调用经主进程转发到 OpenAI 兼容接口（baseUrl 可配置，默认 https://api.openai.com/v1）。
 * - provider 为 openai（云端）时需配置 API Key；ollama / lmstudio 等本地服务免 Key。
 * - AI 未配置或已禁用时，所有方法返回 { success: false, error: 'AI 未配置或已禁用' }，
 *   渲染层据此降级到本地模板/手动流程。
 * - API Key 由主进程用 safeStorage 加密保存，渲染层只能看到掩码版本。
 */
type AIDesktopApi = {
  getConfig: () => Promise<AIConfigPublic>;
  saveConfig: (cfg: {
    enabled: boolean;
    provider: AIProvider;
    baseUrl: string;
    model: string;
    /** 传入则更新 Key；不传或空串表示保持已有 Key */
    apiKey?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  clearApiKey: () => Promise<{ success: boolean; error?: string }>;
  testConnection: () => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
  listModels: () => Promise<{ success: boolean; models?: string[]; error?: string }>;
  organizeText: (input: {
    content: string;
    mode: AICaptureMode;
    title?: string;
  }) => Promise<{ success: boolean; markdown?: string; error?: string }>;
  summarize: (input: {
    content: string;
    maxLength?: number;
  }) => Promise<{ success: boolean; summary?: string; error?: string }>;
  suggestTags: (input: {
    title: string;
    content: string;
    existingTags: string[];
    max?: number;
  }) => Promise<{ success: boolean; tags?: string[]; error?: string }>;
  /** 弹系统对话框选择图片并复制进 vault attachments/，返回 vault 相对路径（如 attachments/xxx.png） */
  selectImageToVault: () => Promise<{ canceled: boolean; relPath?: string; error?: string }>;
  ocrImage: (input: { relPath: string }) => Promise<{ success: boolean; text?: string; error?: string }>;
  transcribeAudio: (input: {
    data: Uint8Array;
    mimeType: string;
    fileName: string;
  }) => Promise<{ success: boolean; text?: string; error?: string }>;
};

declare global {
  interface Window {
    aiApi: AIDesktopApi;
  }
}

const AI_NOT_CONFIGURED = 'AI 未配置或已禁用';
const AI_UNSUPPORTED = '当前环境不支持 AI 功能（需在桌面应用内运行）';

const disabledConfig: AIConfigPublic = {
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasApiKey: false,
  maskedApiKey: '',
};

const unsupported = <T extends { success: boolean; error?: string }>(): T =>
  ({ success: false, error: AI_UNSUPPORTED }) as T;

export { AI_NOT_CONFIGURED, AI_UNSUPPORTED };

/** AI 是否可用：已启用 + 已选模型 +（云端需 Key / 本地服务免 Key） */
export const isAIReady = (cfg: AIConfigPublic): boolean =>
  cfg.enabled && cfg.model.length > 0 && (cfg.hasApiKey || cfg.provider !== 'openai');

export const aiApi: AIDesktopApi = {
  getConfig: async () => {
    if (window.aiApi) return window.aiApi.getConfig();
    return disabledConfig;
  },

  saveConfig: async (cfg) => {
    if (window.aiApi) return window.aiApi.saveConfig(cfg);
    return unsupported();
  },

  clearApiKey: async () => {
    if (window.aiApi) return window.aiApi.clearApiKey();
    return unsupported();
  },

  testConnection: async () => {
    if (window.aiApi) return window.aiApi.testConnection();
    return unsupported();
  },

  listModels: async () => {
    if (window.aiApi) return window.aiApi.listModels();
    return unsupported();
  },

  organizeText: async (input) => {
    if (window.aiApi) return window.aiApi.organizeText(input);
    return unsupported();
  },

  summarize: async (input) => {
    if (window.aiApi) return window.aiApi.summarize(input);
    return unsupported();
  },

  suggestTags: async (input) => {
    if (window.aiApi) return window.aiApi.suggestTags(input);
    return unsupported();
  },

  selectImageToVault: async () => {
    if (window.aiApi) return window.aiApi.selectImageToVault();
    return { canceled: true, error: AI_UNSUPPORTED };
  },

  ocrImage: async (input) => {
    if (window.aiApi) return window.aiApi.ocrImage(input);
    return unsupported();
  },

  transcribeAudio: async (input) => {
    if (window.aiApi) return window.aiApi.transcribeAudio(input);
    return unsupported();
  },
};
