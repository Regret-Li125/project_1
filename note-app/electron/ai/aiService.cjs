const fs = require('node:fs/promises');
const path = require('node:path');
const { aiConfigStore } = require('./aiConfigStore.cjs');
const { vaultFileStore } = require('../storage/vaultFileStore.cjs');

const AI_NOT_CONFIGURED_ERROR = 'AI 未配置或已禁用';
const REQUEST_TIMEOUT_MS = 30000;
// 语音转写耗时随音频长度增长，单独放宽超时。
const TRANSCRIBE_TIMEOUT_MS = 120000;
const MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const ORGANIZE_MODE_DIRECTIVES = {
  study: '整理为学习笔记：提炼核心概念与要点解析，保留关键示例，并给出小节总结。',
  meeting: '整理为会议纪要：包含会议主题、讨论要点、决议事项与待办任务等小节。',
  project: '整理为项目笔记：包含项目背景、目标、当前进展、风险与问题、下一步计划等小节。',
  action_items: '整理为行动项清单：提取所有待办事项，用 Markdown 任务列表（- [ ]）逐条列出并按主题分组；原文中的负责人、截止时间等信息请一并保留。',
  knowledge: '整理为知识点笔记：包含定义、核心要点、关联概念与延伸阅读方向等小节。',
};

function toMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRequestError(error) {
  if (error && error.name === 'AbortError') {
    return '请求超时，请检查网络或 AI 服务地址';
  }
  const message = toMessage(error);
  if (error instanceof TypeError) {
    // undici 的网络层失败（DNS、连接拒绝等）以 TypeError 形式抛出
    return `网络请求失败：${message}`;
  }
  return message || '未知错误';
}

async function readErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      const message = parsed && parsed.error && (parsed.error.message || parsed.error.code);
      if (message) return String(message).slice(0, 200);
    } catch {
      // 非 JSON 错误响应，直接截取原文
    }
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

function extractMessageContent(data) {
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return null;
  const { content } = message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
    return text || null;
  }
  return null;
}

function stripOuterCodeFence(text) {
  const match = text.match(/^```[A-Za-z-]*\s*\n([\s\S]*?)\n?```\s*$/);
  return match ? match[1].trim() : text;
}

// AI 未启用、模型为空或（仅云端）未配置 API Key 时返回 null，调用方据此统一降级。
// 本地服务（Ollama / LM Studio）无需 API Key。
async function requireActiveConfig() {
  const cfg = await aiConfigStore.load();
  if (!cfg || cfg.enabled !== true) return null;
  if (!cfg.model) return null;
  const apiKey = await aiConfigStore.getDecryptedKey();
  if (cfg.provider === 'openai' && !apiKey) return null;
  return { baseUrl: cfg.baseUrl, model: cfg.model, apiKey };
}

function notConfigured() {
  return { success: false, error: AI_NOT_CONFIGURED_ERROR };
}

async function chatComplete(cfg, messages, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model || cfg.model,
        messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`AI 服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }

  const data = await response.json();
  const content = extractMessageContent(data);
  if (!content || !content.trim()) {
    throw new Error('AI 服务返回了空内容');
  }
  return content.trim();
}

async function testConnection() {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${cfg.baseUrl}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(normalizeRequestError(error));
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) {
      // 部分 OpenAI 兼容服务不实现 /models，退化为一次最小 chat 请求
      await chatComplete(cfg, [{ role: 'user', content: 'ping' }], { maxTokens: 1 });
    } else if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(`AI 服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
    }
    return { success: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    console.error('AI testConnection failed:', error);
    return { success: false, error: toMessage(error), latencyMs: Date.now() - startedAt };
  }
}

async function organizeText(input) {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const modeDirective = ORGANIZE_MODE_DIRECTIVES[input.mode] || ORGANIZE_MODE_DIRECTIVES.knowledge;
    const systemPrompt = [
      '你是一位专业的中文笔记整理助手。请将用户提供的原始文本整理为结构清晰的 Markdown 笔记。',
      `整理类型：${modeDirective}`,
      '要求：',
      '1. 使用恰当的 Markdown 标题层级划分小节；',
      '2. 保留原文的关键信息与事实，不要虚构内容；',
      '3. 语言简洁、条理清晰；',
      '4. 只输出 Markdown 正文，不要输出额外解释，不要用代码块包裹全文。',
    ].join('\n');
    const titleLine = input.title ? `笔记标题：${input.title}\n\n` : '';
    const markdown = await chatComplete(cfg, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${titleLine}原始文本：\n${input.content}` },
    ], { temperature: 0.3 });
    return { success: true, markdown: stripOuterCodeFence(markdown) };
  } catch (error) {
    console.error('AI organizeText failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

async function summarize(input) {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const maxLength = Number.isFinite(input.maxLength) && input.maxLength > 0
      ? Math.floor(input.maxLength)
      : 200;
    const summary = await chatComplete(cfg, [
      {
        role: 'system',
        content: `你是一位专业的中文摘要助手。请为用户提供的文本撰写一段简洁的中文摘要，长度控制在 ${maxLength} 字以内。只输出摘要正文，不要输出标题或额外说明。`,
      },
      { role: 'user', content: input.content },
    ], { temperature: 0.3 });
    return { success: true, summary };
  } catch (error) {
    console.error('AI summarize failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

// 容错解析模型返回的标签：优先提取 JSON 数组，失败时退化为提取引号包裹的字符串。
function parseTagCandidates(raw) {
  const candidates = [];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) candidates.push(...parsed);
    } catch {
      // JSON 不合法时走引号提取
    }
  }
  if (candidates.length === 0) {
    const quoted = raw.match(/"([^"\n]+)"|'([^'\n]+)'/g) || [];
    for (const item of quoted) {
      candidates.push(item.slice(1, -1));
    }
  }
  return candidates;
}

async function suggestTags(input) {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const max = Number.isFinite(input.max) && input.max > 0 ? Math.floor(input.max) : 5;
    const existing = new Set(
      (Array.isArray(input.existingTags) ? input.existingTags : [])
        .map((tag) => String(tag).trim().toLowerCase())
    );
    const systemPrompt = [
      '你是一位中文知识管理助手。请根据笔记标题与内容推荐最合适的标签。',
      `要求：推荐不超过 ${max} 个标签；标签为简短的词语（1~4 个字/词）；不要包含 # 前缀。`,
      '只输出一个 JSON 字符串数组，例如 ["效率","笔记"]，不要输出任何其他内容。',
    ].join('\n');
    const raw = await chatComplete(cfg, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `标题：${input.title || '（无标题）'}\n\n内容：\n${input.content}` },
    ], { temperature: 0.2 });

    const seen = new Set();
    const tags = [];
    for (const candidate of parseTagCandidates(raw)) {
      if (typeof candidate !== 'string') continue;
      const tag = candidate.trim().replace(/^#+/, '').trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key) || existing.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= max) break;
    }
    return { success: true, tags };
  } catch (error) {
    console.error('AI suggestTags failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

async function ocrImage(input) {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const vaultRoot = path.resolve(vaultFileStore.getStoragePath());
    const absPath = path.resolve(vaultRoot, input.relPath);
    if (absPath !== vaultRoot && !absPath.startsWith(vaultRoot + path.sep)) {
      return { success: false, error: 'Invalid image path' };
    }
    const mime = IMAGE_MIME_BY_EXT[path.extname(absPath).toLowerCase()];
    if (!mime) {
      return { success: false, error: '不支持的图片格式' };
    }
    let data;
    try {
      data = await fs.readFile(absPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { success: false, error: '图片文件不存在' };
      }
      throw error;
    }
    if (data.length > MAX_OCR_IMAGE_BYTES) {
      return { success: false, error: '图片过大（超过 20MB）' };
    }
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    const text = await chatComplete(cfg, [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请识别并提取这张图片中的全部文字。要求：保持原有的换行与段落结构；只输出识别到的文字内容，不要输出额外说明；若图片中没有文字，输出空字符串。',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]);
    return { success: true, text };
  } catch (error) {
    console.error('AI ocrImage failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

async function transcribeAudio(input) {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const data = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
    if (data.length === 0) {
      return { success: false, error: '音频数据为空' };
    }
    if (data.length > MAX_AUDIO_BYTES) {
      return { success: false, error: '音频文件过大（超过 25MB）' };
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([data], { type: input.mimeType || 'application/octet-stream' }),
      input.fileName || 'audio.webm'
    );
    form.append('model', 'whisper-1');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(normalizeRequestError(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(`AI 服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
    }

    const result = await response.json();
    const text = result && typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) {
      throw new Error('AI 服务返回了空内容');
    }
    return { success: true, text };
  } catch (error) {
    console.error('AI transcribeAudio failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

// GET /models 获取模型列表（Ollama / LM Studio 的 /v1/models 均兼容 OpenAI 格式）。
async function listModels() {
  const cfg = await requireActiveConfig();
  if (!cfg) return notConfigured();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${cfg.baseUrl}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(normalizeRequestError(error));
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(`AI 服务返回错误（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
    }
    const data = await response.json();
    const models = Array.isArray(data && data.data)
      ? data.data
          .filter((item) => item && typeof item.id === 'string')
          .map((item) => item.id)
      : [];
    return { success: true, models };
  } catch (error) {
    console.error('AI listModels failed:', error);
    return { success: false, error: toMessage(error) };
  }
}

module.exports = {
  aiService: {
    testConnection,
    listModels,
    organizeText,
    summarize,
    suggestTags,
    ocrImage,
    transcribeAudio,
  },
};
