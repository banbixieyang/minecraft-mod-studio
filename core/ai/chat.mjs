/**
 * 对话主流程。
 * 只做三件事：读配置 → 拼上下文 → 调模型。检索和协议都在别处，
 * 这里保持薄，方便以后换 UI（桌面端、VSCode 插件）时直接复用。
 */
import { loadAiConfig } from './config.mjs';
import { buildRequest } from './context.mjs';
import { AiError, chatComplete, ping } from './providers.mjs';

/**
 * 拼好一次提问的上下文。整段返回和流式共用同一份，
 * 否则「同一个问题两种回答依据」这种事很难查。
 */
export function prepareAsk({ question, history = [], project = null, useKnowledge = true, config } = {}) {
  const q = String(question || '').trim();
  if (!q) throw new AiError('empty', '问题不能为空');

  const cfg = config || loadAiConfig();
  const { system, messages, sources } = buildRequest({
    question: q,
    history,
    project,
    useKnowledge,
    hits: cfg.knowledgeHits,
    budget: cfg.knowledgeBudget,
  });
  return { cfg, system, messages, sources };
}

export async function ask({ question, history = [], project = null, useKnowledge = true, config } = {}) {
  const { cfg, system, messages, sources } = prepareAsk({ question, history, project, useKnowledge, config });

  const startedAt = Date.now();
  const result = await chatComplete({ config: cfg, messages, system });
  return {
    text: result.text,
    model: result.model,
    usage: result.usage,
    sources,
    ms: Date.now() - startedAt,
    usedKnowledge: Boolean(sources.length),
  };
}

export async function testConnection(config) {
  const cfg = config || loadAiConfig();
  return ping(cfg);
}

export { AiError };
