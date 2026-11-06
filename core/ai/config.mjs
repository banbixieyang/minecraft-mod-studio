/**
 * AI 配置。
 *
 * 存本地 `~/.mcstudio/ai.json`，不进工程、不进 git —— key 不该跟着代码跑。
 * 前端永远拿不到明文 key：读配置的接口只回「配没配、后四位是多少」，
 * 这样界面能显示状态，浏览器里翻不到凭据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { mcstudioHome } from '../knowledge/sources.mjs';

export function aiConfigPath() {
  return path.join(mcstudioHome(), 'ai.json');
}

/**
 * 预设。不是「推荐你去用哪家」，是「这几家的接口形状不一样，选一个帮你填好」。
 * baseUrl 都能改，所以挂自建网关、本地 vLLM、公司内网代理都没问题。
 */
export const PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '任何 OpenAI 兼容接口都能用：DeepSeek、Kimi、通义、OpenRouter、本地 vLLM、公司网关。改 baseUrl 即可。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'OpenAI 兼容协议。国内直连，价格低，写 Java 够用。',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5-coder:7b',
    hint: '完全离线，不用 key。先 ollama pull 一个代码模型。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    hint: '走 /v1/messages 协议，和 OpenAI 那套不通用。',
  },
];

const DEFAULTS = {
  preset: 'openai',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  maxTokens: 4096,
  temperature: 0.2,
  /** 每次提问带几段知识库资料 */
  knowledgeHits: 6,
  /** 资料总字符预算，太大反而挤掉问题本身 */
  knowledgeBudget: 6000,
};

export function loadAiConfig() {
  const file = aiConfigPath();
  let saved = {};
  if (fs.existsSync(file)) {
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      saved = {};
    }
  }
  const cfg = { ...DEFAULTS, ...saved };
  // 环境变量兜底：CI 或临时试用时不用写文件
  if (!cfg.apiKey && process.env.MCSTUDIO_AI_KEY) cfg.apiKey = process.env.MCSTUDIO_AI_KEY;
  if (process.env.MCSTUDIO_AI_BASE) cfg.baseUrl = process.env.MCSTUDIO_AI_BASE;
  if (process.env.MCSTUDIO_AI_MODEL) cfg.model = process.env.MCSTUDIO_AI_MODEL;
  return cfg;
}

/** 给界面看的版本：key 只留后四位 */
export function publicAiConfig() {
  const cfg = loadAiConfig();
  const key = cfg.apiKey || '';
  return {
    preset: cfg.preset,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    temperature: cfg.temperature,
    knowledgeHits: cfg.knowledgeHits,
    knowledgeBudget: cfg.knowledgeBudget,
    hasKey: Boolean(key),
    keyHint: key ? `****${key.slice(-4)}` : '',
    /** ollama 不需要 key，界面据此不提示「去配 key」 */
    needsKey: cfg.provider !== 'ollama',
    configPath: aiConfigPath(),
  };
}

export function saveAiConfig(patch = {}) {
  const cur = loadAiConfig();
  const next = { ...cur };
  for (const k of ['preset', 'provider', 'baseUrl', 'model', 'apiKey', 'maxTokens', 'temperature', 'knowledgeHits', 'knowledgeBudget']) {
    if (patch[k] === undefined) continue;
    next[k] = patch[k];
  }
  next.maxTokens = Math.min(32000, Math.max(256, Number(next.maxTokens) || DEFAULTS.maxTokens));
  next.temperature = Math.min(2, Math.max(0, Number(next.temperature)));
  next.knowledgeHits = Math.min(20, Math.max(0, Number(next.knowledgeHits) || 0));
  next.knowledgeBudget = Math.min(30000, Math.max(0, Number(next.knowledgeBudget) || 0));
  next.baseUrl = String(next.baseUrl || '').replace(/\/+$/, '');

  const cfgPath = aiConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  // 这里存的是 API key；类 Unix 上默认 0644 会让同机其它用户读到。
  fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(cfgPath, 0o600); } catch { /* 文件系统不支持权限就跳过 */ }
  }
  return publicAiConfig();
}
