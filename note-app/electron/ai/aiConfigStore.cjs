const fs = require('node:fs/promises');
const path = require('node:path');
const { app, safeStorage } = require('electron');

// AI 功能默认关闭；渲染层在拿到该默认值时应降级到本地行为。
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_PROVIDER = 'openai';
// 云端 OpenAI 兼容服务需 API Key；本地服务（Ollama / LM Studio）免 Key。
const AI_PROVIDERS = new Set(['openai', 'ollama', 'lmstudio']);

// safeStorage 不可用时的明文兜底前缀，用于读取时区分加密与明文两种存储形态。
const PLAINTEXT_PREFIX = 'plain:';

function maskApiKey(key) {
  if (!key) return '';
  // 短 Key 整体掩码，避免 slice(-4) 泄露完整内容
  if (key.length <= 8) return '****';
  const prefix = key.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}****${key.slice(-4)}`;
}

class AIConfigStore {
  constructor() {
    this.configPath = null;
    this.cache = null; // { enabled, provider, baseUrl, model, apiKeyEncrypted }
  }

  _configPath() {
    if (!this.configPath) {
      this.configPath = path.join(app.getPath('userData'), 'ai-config.json');
    }
    return this.configPath;
  }

  _normalizeBaseUrl(baseUrl) {
    if (typeof baseUrl !== 'string') return DEFAULT_BASE_URL;
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_BASE_URL;
  }

  _normalizeProvider(provider) {
    return AI_PROVIDERS.has(provider) ? provider : DEFAULT_PROVIDER;
  }

  _normalizeModel(model, provider) {
    const trimmed = typeof model === 'string' ? model.trim() : '';
    if (trimmed) return trimmed;
    // 云端回退默认模型；本地服务不臆测模型名，留空后由设置界面强制选择
    return this._normalizeProvider(provider) === 'openai' ? DEFAULT_MODEL : '';
  }

  _encryptKey(apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(apiKey).toString('base64');
    }
    console.warn('safeStorage encryption unavailable, storing AI API key as plaintext');
    return PLAINTEXT_PREFIX + apiKey;
  }

  _decryptKey(stored) {
    if (!stored) return '';
    if (stored.startsWith(PLAINTEXT_PREFIX)) {
      return stored.slice(PLAINTEXT_PREFIX.length);
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (error) {
      console.warn('Failed to decrypt AI API key:', error);
      return '';
    }
  }

  async _atomicWrite(absPath, content) {
    const tempPath = `${absPath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    try {
      await fs.rename(tempPath, absPath);
    } catch (error) {
      // Windows: rename fails with EPERM/EEXIST when the target already
      // exists; only then fall back to removing the target first.
      if (!error || (error.code !== 'EPERM' && error.code !== 'EEXIST')) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      await fs.rm(absPath, { force: true });
      await fs.rename(tempPath, absPath);
    }
  }

  async load() {
    if (this.cache) return this.cache;
    let cfg = {
      enabled: false,
      provider: DEFAULT_PROVIDER,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      apiKeyEncrypted: '',
    };
    try {
      const raw = await fs.readFile(this._configPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const provider = this._normalizeProvider(parsed.provider);
        cfg = {
          enabled: parsed.enabled === true,
          provider,
          baseUrl: this._normalizeBaseUrl(parsed.baseUrl),
          model: this._normalizeModel(parsed.model, provider),
          apiKeyEncrypted: typeof parsed.apiKeyEncrypted === 'string' ? parsed.apiKeyEncrypted : '',
        };
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        console.warn('Failed to read AI config, using defaults:', error);
      }
    }
    this.cache = cfg;
    return cfg;
  }

  // cfg: { enabled, provider, baseUrl, model, apiKey? }；apiKey 不传或空串表示保持已有 Key。
  async save(cfg) {
    const current = await this.load();
    const provider = this._normalizeProvider(cfg && cfg.provider);
    const next = {
      enabled: cfg && cfg.enabled === true,
      provider,
      baseUrl: this._normalizeBaseUrl(cfg && cfg.baseUrl),
      model: this._normalizeModel(cfg && cfg.model, provider),
      apiKeyEncrypted: current.apiKeyEncrypted,
    };
    if (cfg && typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0) {
      next.apiKeyEncrypted = this._encryptKey(cfg.apiKey);
    }
    await this._atomicWrite(this._configPath(), JSON.stringify(next, null, 2));
    this.cache = next;
    return next;
  }

  async getDecryptedKey() {
    const cfg = await this.load();
    return this._decryptKey(cfg.apiKeyEncrypted);
  }

  async clearKey() {
    const current = await this.load();
    const next = { ...current, apiKeyEncrypted: '' };
    await this._atomicWrite(this._configPath(), JSON.stringify(next, null, 2));
    this.cache = next;
  }

  // 暴露给渲染进程的配置视图，不含明文 API Key。
  async getPublicConfig() {
    const cfg = await this.load();
    const apiKey = this._decryptKey(cfg.apiKeyEncrypted);
    return {
      enabled: cfg.enabled,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasApiKey: apiKey.length > 0,
      maskedApiKey: maskApiKey(apiKey),
    };
  }
}

module.exports = {
  aiConfigStore: new AIConfigStore(),
};
