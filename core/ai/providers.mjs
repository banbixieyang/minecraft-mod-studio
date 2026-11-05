/**
 * AI 接口适配。
 *
 * 三家的协议不一样，但对上层只暴露 `chatComplete`（整段）和
 * `streamComplete`（流式，产出 delta/done）：
 *   openai     POST {baseUrl}/chat/completions   Authorization: Bearer
 *   anthropic  POST {baseUrl}/v1/messages        x-api-key + anthropic-version
 *   ollama     POST {baseUrl}/api/chat           不需要 key
 *
 * 错误必须分类清楚：用户最常遇到的是「key 没填」「key 错的」「连不上」，
 * 这三种要给出完全不同的下一步动作。一律抛 "请求失败" 等于没说。
 */
export class AiError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.detail = detail;
  }
}

function joinUrl(base, suffix) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!b) throw new AiError('no-config', '还没填接口地址（baseUrl）');
  return b + suffix;
}

function withTimeout(ms) {
  const ac = new AbortController();
  let fired = false;
  // 超时用标志位记，不靠事后猜错误文本：abort(reason) 抛出来的是 reason 本身，
  // 名字可能是 Error、信息可能被服务端换成别的，认文本会误判成「网络不通」。
  const timer = setTimeout(() => {
    fired = true;
    ac.abort(new Error('timeout'));
  }, ms);
  return { signal: ac.signal, done: () => clearTimeout(timer), timedOut: () => fired };
}

/** 网络层错误分类。流式与整段返回共用，免得两条路径的判断慢慢漂移。 */
function networkError(e, url) {
  const msg = String(e?.message || e);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return new AiError('network', `域名解析不了，检查接口地址：${url}`);
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return new AiError('network', `连不上 ${url}。本地模型的话，先确认服务已经起来（ollama serve）。`);
  }
  return new AiError('network', `请求发不出去：${msg}`);
}

function timeoutError(timeoutMs) {
  return new AiError('timeout', `请求超时（${Math.round(timeoutMs / 1000)} 秒）。模型服务可能很慢，或者地址不通。`);
}

/** HTTP 状态码分类，同样共用。把服务端报错原文带出来比编一句「请求失败」有用。 */
function httpError(res, text, url) {
  let detail = String(text || '').slice(0, 600);
  try {
    const j = JSON.parse(text);
    detail = j?.error?.message || j?.message || j?.error || detail;
  } catch {
    /* 非 JSON 就用原文 */
  }
  if (res.status === 401 || res.status === 403) {
    return new AiError('unauthorized', `key 被拒了（HTTP ${res.status}）。检查 key 是否有效、有没有过期。`, String(detail));
  }
  if (res.status === 404) {
    return new AiError('bad-endpoint', `接口不存在（HTTP 404）。很可能是 baseUrl 或模型名不对：${url}`, String(detail));
  }
  if (res.status === 429) {
    return new AiError('rate-limit', '被限流了（HTTP 429）。等一会儿再试，或换更小的模型。', String(detail));
  }
  if (res.status >= 500) {
    return new AiError('server', `模型服务自己出错了（HTTP ${res.status}）。`, String(detail));
  }
  return new AiError('http', `HTTP ${res.status}`, String(detail));
}

async function postJson(url, headers, body, timeoutMs) {
  const t = withTimeout(timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: t.signal,
    });
  } catch (e) {
    t.done();
    if (t.timedOut() || e?.name === 'AbortError' || /aborted/i.test(String(e?.message))) throw timeoutError(timeoutMs);
    throw networkError(e, url);
  }
  t.done();

  const text = await res.text();
  if (!res.ok) throw httpError(res, text, url);

  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('bad-response', '返回的不是 JSON。是不是把网页地址填成接口地址了？', text.slice(0, 300));
  }
}

/** 统一成 {role, content} 数组 */
function normalizeMessages(messages, system) {
  const out = [];
  for (const m of messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').trim();
    if (content) out.push({ role, content });
  }
  // Anthropic 要求首条是 user
  while (out.length && out[0].role !== 'user') out.shift();
  return { list: out, system: String(system || '') };
}

/** 公共前置校验。路由层在写 SSE 响应头之前也会调一次，好把 no-key 走成 HTTP 400。 */
export function assertConfigReady(config) {
  const cfg = config || {};
  const provider = cfg.provider || 'openai';
  if (!cfg.baseUrl) throw new AiError('no-config', '还没填接口地址（baseUrl）');
  if (!cfg.model) throw new AiError('no-config', '还没填模型名');
  if (provider !== 'ollama' && !cfg.apiKey) {
    throw new AiError('no-key', '还没配 API key。点右上角设置填一个，或者切到 Ollama 用本地模型。');
  }
  return cfg;
}

function prepareChat({ config, messages, system }) {
  const cfg = assertConfigReady(config);
  const provider = cfg.provider || 'openai';
  const { list, system: sys } = normalizeMessages(messages, system);
  if (!list.length) throw new AiError('empty', '没有可发送的内容');
  const maxTokens = Number(cfg.maxTokens) || 4096;
  const temperature = Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : 0.2;
  return { cfg, provider, list, sys, maxTokens, temperature };
}

/**
 * 三家的请求形状集中在这里：整段返回和流式共用同一份 spec。
 * 否则以后加个字段只改一条路径，另一条就悄悄不一致了。
 */
function requestSpec(provider, cfg, list, sys, maxTokens, temperature, stream) {
  if (provider === 'anthropic') {
    return {
      url: joinUrl(cfg.baseUrl, '/v1/messages'),
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        messages: list,
        ...(sys ? { system: sys } : {}),
        ...(stream ? { stream: true } : {}),
      },
    };
  }
  if (provider === 'ollama') {
    return {
      url: joinUrl(cfg.baseUrl, '/api/chat'),
      headers: {},
      body: {
        model: cfg.model,
        stream: Boolean(stream),
        messages: sys ? [{ role: 'system', content: sys }, ...list] : list,
        options: { temperature, num_predict: maxTokens },
      },
    };
  }
  return {
    url: joinUrl(cfg.baseUrl, '/chat/completions'),
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: {
      model: cfg.model,
      messages: sys ? [{ role: 'system', content: sys }, ...list] : list,
      max_tokens: maxTokens,
      temperature,
      stream: Boolean(stream),
    },
  };
}

/**
 * 主入口（整段返回）。
 * @returns {{text: string, usage: object, model: string}}
 */
export async function chatComplete({ config, messages, system, timeoutMs = 120000 }) {
  const { cfg, provider, list, sys, maxTokens, temperature } = prepareChat({ config, messages, system });
  const spec = requestSpec(provider, cfg, list, sys, maxTokens, temperature, false);

  if (provider === 'anthropic') {
    const json = await postJson(spec.url, spec.headers, spec.body, timeoutMs);
    const text = (json.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (!text) throw new AiError('bad-response', '模型返回了空内容', JSON.stringify(json).slice(0, 300));
    return {
      text,
      model: json.model || cfg.model,
      usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
    };
  }

  if (provider === 'ollama') {
    const json = await postJson(spec.url, spec.headers, spec.body, timeoutMs);
    const text = String(json.message?.content || '').trim();
    if (!text) {
      throw new AiError(
        'bad-response',
        '本地模型返回空内容。先确认模型拉下来了：ollama list；再确认模型名对得上。',
        JSON.stringify(json).slice(0, 300),
      );
    }
    return {
      text,
      model: json.model || cfg.model,
      usage: { input: json.prompt_eval_count ?? 0, output: json.eval_count ?? 0 },
    };
  }

  // 默认走 OpenAI 兼容协议
  const json = await postJson(spec.url, spec.headers, spec.body, timeoutMs);
  const choice = (json.choices || [])[0];
  const text = String(choice?.message?.content ?? choice?.text ?? '').trim();
  if (!text) throw new AiError('bad-response', '模型返回了空内容', JSON.stringify(json).slice(0, 300));
  return {
    text,
    model: json.model || cfg.model,
    usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
  };
}

// ============================================================
// 流式输出
// ============================================================

/**
 * 按行切响应体。Ollama 是 NDJSON（一行一个 JSON），另两家是 SSE。
 * 统一交出「行」，由 streamComplete 决定怎么解帧 —— 三种协议差在内容不在传输。
 */
async function* readLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line) yield line;
      }
    }
    buf += decoder.decode();
  } finally {
    try { await reader.cancel(); } catch { /* 已结束或已中止 */ }
    reader.releaseLock();
  }
  if (buf.trim()) yield buf.replace(/\r$/, '');
}

function sseLine(line) {
  if (line.startsWith(':')) return null; // 注释 / 心跳
  if (line.startsWith('data:')) return { kind: 'data', value: line.slice(5).replace(/^ /, '') };
  if (line.startsWith('event:')) return { kind: 'event', value: line.slice(6).trim() };
  return null;
}

/**
 * 打开一条流。超时只约束「等到响应头」：长回答可能持续几分钟，
 * 不能因为总时长到了就掐断用户已经读到一半的内容。
 */
async function openStream(spec, timeoutMs, signal) {
  const ac = new AbortController();
  const flags = { timedOut: false, callerAborted: false };
  const timer = setTimeout(() => {
    flags.timedOut = true;
    ac.abort(new Error('timeout'));
  }, timeoutMs);
  const onCallerAbort = () => {
    flags.callerAborted = true;
    ac.abort();
  };
  if (signal) {
    if (signal.aborted) onCallerAbort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onCallerAbort);
  };

  try {
    const res = await fetch(spec.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...spec.headers },
      body: JSON.stringify(spec.body),
      signal: ac.signal,
    });
    clearTimeout(timer); // 首字节已到
    if (!res.ok) {
      const text = await res.text();
      cleanup();
      throw httpError(res, text, spec.url);
    }
    if (!res.body) {
      cleanup();
      throw new AiError('bad-response', '模型服务没有返回响应体，可能不支持流式输出。');
    }
    return { res, cleanup, flags };
  } catch (e) {
    cleanup();
    if (flags.callerAborted) throw new AiError('aborted', '已停止');
    if (e instanceof AiError) throw e;
    if (flags.timedOut || e?.name === 'AbortError' || /aborted/i.test(String(e?.message))) throw timeoutError(timeoutMs);
    throw networkError(e, spec.url);
  }
}

/**
 * 流式对话，产出 {type:'delta', text} 若干，最后一条 {type:'done', model, usage, stopped}。
 * signal 用于用户点「停止」：直接 return，已产出的文字由调用方保留。
 */
export async function* streamComplete({ config, messages, system, timeoutMs = 120000, signal } = {}) {
  const { cfg, provider, list, sys, maxTokens, temperature } = prepareChat({ config, messages, system });
  const spec = requestSpec(provider, cfg, list, sys, maxTokens, temperature, true);
  const { res, cleanup, flags } = await openStream(spec, timeoutMs, signal);

  const ndjson = provider === 'ollama';
  const usage = { input: 0, output: 0 };
  let model = cfg.model;
  let finished = false;

  try {
    for await (const line of readLines(res.body)) {
      let data;
      if (ndjson) {
        data = line;
      } else {
        const p = sseLine(line);
        if (!p) continue;
        if (p.kind === 'event') continue; // 帧类型在 data.type 里，不靠 event 行
        data = p.value;
        if (data === '[DONE]') { finished = true; break; }
      }
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue; // 网关偶尔塞心跳或非 JSON 行，跳过即可
      }
      if (j?.error) {
        throw new AiError('server', `模型服务报错：${j.error.message || j.error.type || JSON.stringify(j.error).slice(0, 200)}`);
      }

      if (provider === 'ollama') {
        if (j.message?.content) yield { type: 'delta', text: j.message.content };
        if (j.model) model = j.model;
        if (j.done) {
          usage.input = j.prompt_eval_count ?? 0;
          usage.output = j.eval_count ?? 0;
          finished = true;
          break;
        }
      } else if (provider === 'anthropic') {
        if (j.type === 'message_start') {
          model = j.message?.model || model;
          usage.input = j.message?.usage?.input_tokens ?? 0;
        } else if (j.type === 'content_block_delta' && j.delta?.text) {
          yield { type: 'delta', text: j.delta.text };
        } else if (j.type === 'message_delta') {
          usage.output = j.usage?.output_tokens ?? 0;
        } else if (j.type === 'message_stop') {
          finished = true;
          break;
        }
      } else {
        const d = j.choices?.[0]?.delta;
        if (d?.content) yield { type: 'delta', text: d.content };
        if (j.model) model = j.model;
        if (j.usage) {
          usage.input = j.usage.prompt_tokens ?? usage.input;
          usage.output = j.usage.completion_tokens ?? usage.output;
        }
      }
    }
  } catch (e) {
    if (flags.callerAborted || e?.code === 'aborted') return; // 用户主动停止，不算错误
    if (e instanceof AiError) throw e;
    if (flags.timedOut || e?.name === 'AbortError' || /aborted/i.test(String(e?.message))) throw timeoutError(timeoutMs);
    throw networkError(e, spec.url);
  } finally {
    cleanup();
  }

  if (flags.callerAborted) return;
  yield { type: 'done', model, usage, stopped: !finished };
}

/**
 * 连通性自检：发一句最短的话，只关心通不通。
 * 比让用户「先问个真的问题看看」友好 —— 失败时错误就在设置页显示。
 */
export async function ping(config) {
  const started = Date.now();
  const r = await chatComplete({
    config: { ...config, maxTokens: 32 },
    messages: [{ role: 'user', content: '回复两个字：可用' }],
    timeoutMs: 30000,
  });
  return { ok: true, ms: Date.now() - started, model: r.model, reply: r.text.slice(0, 40) };
}
