/**
 * AI 接入回归测试。
 *
 * 跑法：node tests/ai.mjs
 *
 * 不起真模型 —— 用一个本地 HTTP 端点假冒三家服务，验证的是「协议形状对不对、
 * 错误分得清不清、key 会不会漏给前端」。这些正是接错时最难查的地方：
 * 真接口报个 401，界面上却写「请求失败」，用户会去改模型名。
 *
 * 所有请求都打 127.0.0.1 的临时端口，不联网。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import 业务模块之前设好 —— mcstudioHome() 每次调用都读 env
const TMP_HOME = path.join(os.tmpdir(), `mcstudio-ai-test-${Date.now()}`);
process.env.MCSTUDIO_HOME = TMP_HOME;
fs.mkdirSync(TMP_HOME, { recursive: true });
// 环境变量兜底会盖掉文件配置，测试里先清掉，免得你机器上设了 MCSTUDIO_AI_KEY 影响结果
delete process.env.MCSTUDIO_AI_KEY;
delete process.env.MCSTUDIO_AI_BASE;
delete process.env.MCSTUDIO_AI_MODEL;

const { loadAiConfig, publicAiConfig, saveAiConfig, aiConfigPath, PRESETS } = await import('../core/ai/config.mjs');
const { chatComplete, streamComplete, assertConfigReady, ping, AiError } = await import('../core/ai/providers.mjs');
const { ask } = await import('../core/ai/chat.mjs');
const { buildSystemPrompt, buildRequest } = await import('../core/ai/context.mjs');

let failed = 0;
const ok = (cond, msg, detail) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${detail ? `  → ${detail}` : ''}`);
  if (!cond) failed++;
};

/** 断言某次调用抛了指定 code 的 AiError */
async function expectError(code, fn, label, check) {
  try {
    await fn();
    ok(false, label, '没有抛错');
    return null;
  } catch (e) {
    const good = e instanceof AiError && e.code === code;
    ok(good, label, good ? '' : `${e?.code || e?.name}: ${e?.message}`);
    if (good && check) check(e);
    return e;
  }
}

// ---------------- mock 服务 ----------------
let requests = [];
let handler = () => ({ status: 200, body: {} });

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  const entry = { url: req.url, method: req.method, headers: req.headers, body };
  requests.push(entry);

  const r = handler(entry) || {};
  if (r.delay) await new Promise((s) => setTimeout(s, r.delay));
  if (r.hang) return; // 永不回应，用来测超时
  // 流式：按帧写出，帧间留一点间隔，好让「中途停止」有时间发生
  if (r.streamFrames) {
    res.writeHead(r.status ?? 200, { 'content-type': r.contentType || 'text/event-stream' });
    for (const f of r.streamFrames) {
      if (res.destroyed) return;
      res.write(f);
      if (r.frameDelay) await new Promise((s) => setTimeout(s, r.frameDelay));
    }
    res.end();
    return;
  }
  const payload = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
  res.writeHead(r.status ?? 200, { 'content-type': r.contentType || 'application/json' });
  res.end(payload);
});

await new Promise((s) => server.listen(0, '127.0.0.1', s));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
const last = () => requests[requests.length - 1];

const replyOpenai = (text = '好用') => ({
  body: {
    id: 'chatcmpl-x',
    model: 'gpt-4o-mini',
    choices: [{ index: 0, message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  },
});

// ---------------- 1. 配置 ----------------
console.log('\n[1] 配置与凭据');
ok(PRESETS.length >= 4, '内置了多种预设', PRESETS.map((p) => p.id).join('/'));
ok(aiConfigPath().startsWith(TMP_HOME), '配置写进临时 home，没污染真实目录');

const pub0 = publicAiConfig();
ok(pub0.provider === 'openai' && pub0.hasKey === false, '默认是无 key 的 openai');
ok(pub0.checks === undefined, '没把内部字段漏出去');

saveAiConfig({ apiKey: 'sk-test-abcd1234', baseUrl: `${BASE}/v1/`, model: 'gpt-4o-mini', maxTokens: 100, temperature: 9, knowledgeHits: 999 });
const pub1 = publicAiConfig();
ok(pub1.hasKey === true, '存了 key 后 hasKey=true');
ok(pub1.keyHint === '****1234', 'key 只回后四位', pub1.keyHint);
ok(JSON.stringify(pub1).includes('sk-test-abcd1234') === false, '明文 key 没回给前端');
ok(pub1.baseUrl === `${BASE}/v1`, 'baseUrl 去掉了结尾斜杠', pub1.baseUrl);
ok(pub1.maxTokens === 256, 'maxTokens 下限夹到 256', String(pub1.maxTokens));
ok(pub1.temperature === 2, 'temperature 上限夹到 2', String(pub1.temperature));
ok(pub1.knowledgeHits === 20, 'knowledgeHits 上限夹到 20', String(pub1.knowledgeHits));

const onDisk = JSON.parse(fs.readFileSync(aiConfigPath(), 'utf8'));
ok(onDisk.apiKey === 'sk-test-abcd1234', 'key 落盘了（在用户目录，不在工程里）');

// 环境变量兜底：换一个干净的 home，只看 env
const TMP2 = path.join(os.tmpdir(), `mcstudio-ai-env-${Date.now()}`);
fs.mkdirSync(TMP2, { recursive: true });
process.env.MCSTUDIO_HOME = TMP2;
process.env.MCSTUDIO_AI_KEY = 'sk-env-9999';
process.env.MCSTUDIO_AI_MODEL = 'env-model';
const fromEnv = loadAiConfig();
ok(fromEnv.apiKey === 'sk-env-9999' && fromEnv.model === 'env-model', '环境变量能兜底');
process.env.MCSTUDIO_HOME = TMP_HOME;
delete process.env.MCSTUDIO_AI_KEY;
delete process.env.MCSTUDIO_AI_MODEL;

// ---------------- 2. OpenAI 协议 ----------------
console.log('\n[2] OpenAI 兼容协议');
handler = () => replyOpenai('好用');
const cfgOpenai = { provider: 'openai', baseUrl: `${BASE}/v1`, apiKey: 'sk-x', model: 'gpt-4o-mini' };
const r1 = await chatComplete({ config: cfgOpenai, messages: [{ role: 'user', content: '能用吗' }], system: 'SYS-提示' });
ok(last().url === '/v1/chat/completions', '打到 /chat/completions', last().url);
ok(last().headers.authorization === 'Bearer sk-x', '用 Bearer 认证');
ok(last().body.messages[0].role === 'system' && last().body.messages[0].content === 'SYS-提示', 'system 放进 messages 首条');
ok(last().body.stream === false, '关掉了流式');
ok(r1.text === '好用', '取到了 choices[0].message.content');
ok(r1.usage.input === 11 && r1.usage.output === 7, 'token 用量映射正确', JSON.stringify(r1.usage));

// ---------------- 3. Anthropic 协议 ----------------
console.log('\n[3] Anthropic 协议');
handler = () => ({
  body: {
    model: 'claude-sonnet-4-5',
    content: [
      { type: 'text', text: '甲' },
      { type: 'text', text: '乙' },
    ],
    usage: { input_tokens: 3, output_tokens: 4 },
  },
});
const cfgAnth = { provider: 'anthropic', baseUrl: BASE, apiKey: 'sk-ant', model: 'claude-sonnet-4-5' };
const r2 = await chatComplete({ config: cfgAnth, messages: [{ role: 'user', content: 'hi' }], system: 'SYS-提示' });
ok(last().url === '/v1/messages', '打到 /v1/messages', last().url);
ok(last().headers['x-api-key'] === 'sk-ant', '用 x-api-key 认证');
ok(last().headers['anthropic-version'] === '2023-06-01', '带了 anthropic-version');
ok(last().body.system === 'SYS-提示', 'system 是顶层字段，不进 messages');
ok(last().body.messages.every((m) => m.role !== 'system'), 'messages 里没有 system');
ok(last().body.max_tokens === 4096, 'max_tokens 是必填的，默认 4096');
ok(r2.text === '甲\n乙', '多段 content 拼起来了', JSON.stringify(r2.text));
ok(r2.usage.input === 3 && r2.usage.output === 4, '用量按 input/output_tokens 映射');

// 首条必须 user —— 历史从一句 assistant 开头时要被丢掉
await chatComplete({
  config: cfgAnth,
  messages: [
    { role: 'assistant', content: '你好' },
    { role: 'user', content: '继续' },
  ],
});
ok(last().body.messages[0].role === 'user', '开头是 assistant 的历史被裁掉');

// ---------------- 4. Ollama ----------------
console.log('\n[4] Ollama 本地');
handler = () => ({
  body: { model: 'qwen2.5-coder:7b', message: { role: 'assistant', content: '本地的' }, prompt_eval_count: 5, eval_count: 9 },
});
const r3 = await chatComplete({ config: { provider: 'ollama', baseUrl: BASE, model: 'qwen2.5-coder:7b' }, messages: [{ role: 'user', content: 'hi' }], system: 'SYS' });
ok(last().url === '/api/chat', '打到 /api/chat', last().url);
ok(!last().headers.authorization && !last().headers['x-api-key'], '不需要 key');
ok(last().body.messages[0].role === 'system', 'system 混在 messages 里（ollama 没有顶层 system）');
ok(last().body.options?.num_predict === 4096, 'num_predict 跟着 maxTokens 走');
ok(r3.text === '本地的', '取到了 message.content');
ok(r3.usage.input === 5 && r3.usage.output === 9, '用量按 *_eval_count 映射');

// ---------------- 5. 错误分类 ----------------
console.log('\n[5] 错误分类');
const cfgBase = { provider: 'openai', baseUrl: `${BASE}/v1`, apiKey: 'sk-x', model: 'm' };
const one = (msg = 'x') => chatComplete({ config: cfgBase, messages: [{ role: 'user', content: msg }] });

handler = () => ({ status: 401, body: { error: { message: 'Incorrect API key provided' } } });
await expectError('unauthorized', () => one(), '401 → unauthorized', (e) =>
  ok(/Incorrect API key/.test(e.detail), '把服务端原文带出来了'),
);

handler = () => ({ status: 404, body: { error: { message: 'model not found' } } });
await expectError('bad-endpoint', () => one(), '404 → bad-endpoint');

handler = () => ({ status: 429, body: { error: { message: 'rate limited' } } });
await expectError('rate-limit', () => one(), '429 → rate-limit');

handler = () => ({ status: 500, body: { error: { message: 'boom' } } });
await expectError('server', () => one(), '500 → server');

handler = () => ({ status: 200, contentType: 'text/html', body: '<!doctype html><html>登录</html>' });
await expectError('bad-response', () => one(), '200 返回 HTML → bad-response');

handler = () => ({ status: 200, body: { choices: [{ message: { content: '' } }] } });
await expectError('bad-response', () => one(), '空内容 → bad-response');

// 没填 key 时不该发请求
const beforeNoKey = requests.length;
await expectError('no-key', () => chatComplete({ config: { ...cfgBase, apiKey: '' }, messages: [{ role: 'user', content: 'x' }] }), '没配 key → no-key');
ok(requests.length === beforeNoKey, 'no-key 时根本没发请求出去');

// 连不上：先开一个端口再关掉，拿到必定拒绝的地址
const dead = http.createServer(() => {});
await new Promise((s) => dead.listen(0, '127.0.0.1', s));
const deadPort = dead.address().port;
await new Promise((s) => dead.close(s));
handler = () => replyOpenai();
await expectError(
  'network',
  () => chatComplete({ config: { ...cfgBase, baseUrl: `http://127.0.0.1:${deadPort}/v1` }, messages: [{ role: 'user', content: 'x' }] }),
  '连不上 → network',
);

// 超时：服务端不回应
handler = () => ({ hang: true });
await expectError(
  'timeout',
  () => chatComplete({ config: cfgBase, messages: [{ role: 'user', content: 'x' }], timeoutMs: 300 }),
  '不回应 → timeout',
);

// ---------------- 6. 上下文与提问 ----------------
console.log('\n[6] 拼上下文与提问');
handler = () => replyOpenai('先 setId，再 register。');
requests = [];

const project = {
  meta: { name: '陨落', id: 'fallen', pkg: 'com.example.fallen', platform: 'fabric', mcVersion: '26.3' },
  entries: { item: [{ id: 'ruby' }, { id: 'ruby_sword' }], block: [{ id: 'ruby_ore' }] },
  hooks: { java: [{ anchor: 'AFTER_DAMAGE' }], js: [] },
};
const ans = await ask({ question: '注册物品要写什么？', project, config: { ...cfgBase, knowledgeHits: 4, knowledgeBudget: 5000 } });
ok(ans.text.includes('setId'), '拿回了模型的内容');
ok(ans.sources.length > 0, '带回了引用来源', `${ans.sources.length} 条`);
ok(ans.usedKnowledge === true, 'usedKnowledge 标记正确');
ok(typeof ans.ms === 'number' && ans.ms >= 0, '带了耗时');

const sys = last().body.messages[0].content;
ok(sys.includes('本机实测的平台事实'), 'system 里写了平台事实');
ok(sys.includes('漏 setId'), '平台事实里带上了实测的坑');
ok(sys.includes('【资料 1】'), '资料带编号，便于引用', '');
ok(sys.includes('陨落') && sys.includes('fallen'), '工程摘要进去了');
ok(sys.includes('item:ruby_sword'), '列出了已有条目 id');
ok(/来源：/.test(sys), '资料带来源标注');

const convo = last().body.messages;
ok(convo[convo.length - 1].content === '注册物品要写什么？', '最后一个 message 是当前问题');
ok(convo[0].role === 'system', 'system 在最前');

// 历史只带最近 8 轮
const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `旧问题${i}` }));
await ask({ question: '新问题', history, useKnowledge: false, config: cfgBase });
const m2 = last().body.messages;
ok(m2.length === 10, '历史裁到 8 条（+system+当前问题）', String(m2.length));
ok(m2[m2.length - 1].content === '新问题', '裁的是旧的，留的是当前问题');
ok(!m2.some((m) => m.content === '旧问题0'), '最早的那条被丢掉了');

// 关掉知识库检索
const sysNoKb = last().body.messages[0].content;
ok(sysNoKb.includes('这次没有检索到相关资料'), '关掉检索时明确告知模型没有资料');

// 直接拼 system：不传知识时也要有兜底说明
const s2 = buildSystemPrompt({ project: null, knowledge: null });
ok(s2.includes('没有检索到相关资料'), '无资料时给出「可能是通用知识」的提醒');
ok(s2.includes('全限定名'), '规则里要求钩子代码用全限定名');

// 多目标：Forge 工程不能拿 Fabric 26.3 的事实，否则 AI 会很有信心地写出不存在的 API
const forgeProject = {
  meta: { name: '陨落 Forge 版', id: 'fallen_forge', pkg: 'com.example.fallen' },
  target: { id: 'forge-1.20.1', platform: 'forge', mcVersion: '1.20.1', forgeVersion: '47.4.0', javaVersion: 17 },
  entries: {},
  hooks: { java: [], js: [] },
};
const sysForge = buildSystemPrompt({ project: forgeProject, knowledge: null });
ok(sysForge.includes('Forge 1.20.1') && sysForge.includes('DeferredRegister'), 'Forge 工程拿到的是 Forge 事实');
ok(!sysForge.includes('漏 setId'), '不会把 26.3 的 setId 事实塞给 Forge 工程');
ok(sysForge.includes('forge-1.20.1') && sysForge.includes('JDK 17'), '工程摘要读的是顶层 target，不是 meta.platform');
ok(!sysForge.includes('专精 Fabric 26.3'), '开头不再写死 Fabric');
const sysFab = buildSystemPrompt({ project, knowledge: null });
// Fabric 的「不要用 Forge 写法」规则里本来就会提到 Forge 类名，
// 所以判据用事实段的标题，不用关键词出现与否。
ok(sysFab.includes('漏 setId') && !sysFab.includes('核实过的平台事实（Forge'), 'Fabric 工程仍拿 26.3 事实');

const bare = buildRequest({ question: 'q', useKnowledge: false });
ok(bare.sources.length === 0 && !bare.system.includes('【资料 1】'), '不检索时不塞资料');

// ping
handler = () => replyOpenai('可用');
const p = await ping({ ...cfgBase, maxTokens: 32 });
ok(p.ok === true && p.reply === '可用', 'ping 通了');
ok(last().body.max_tokens === 32, 'ping 用很小的 max_tokens');

// ---------------- 7. 流式输出 ----------------
console.log('\n[7] 流式：三家协议');
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const sseEvent = (event, obj) => `event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`;
const ndjson = (obj) => `${JSON.stringify(obj)}\n`;

async function collect(gen) {
  const deltas = [];
  let done = null;
  for await (const ev of gen) {
    if (ev.type === 'delta') deltas.push(ev.text);
    else if (ev.type === 'done') done = ev;
  }
  return { text: deltas.join(''), deltas, done };
}
const q1 = [{ role: 'user', content: '写两句' }];

// OpenAI 兼容：SSE + [DONE]，中间夹一个心跳注释
handler = () => ({
  streamFrames: [
    ': heartbeat\n\n',
    sse({ model: 'gpt-stream', choices: [{ delta: { content: '第一' } }] }),
    sse({ choices: [{ delta: { content: '第二' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
    'data: [DONE]\n\n',
  ],
});
const r7 = await collect(streamComplete({ config: cfgOpenai, messages: q1, system: 'SYS' }));
ok(last().body.stream === true, '流式请求打开了 stream');
ok(last().headers.accept === 'text/event-stream', '带了 SSE 的 accept 头');
ok(last().body.messages[0].content === 'SYS', '流式也把 system 放在首条');
ok(r7.text === '第一第二', 'SSE delta 拼成完整文本', r7.text);
ok(r7.done && !r7.done.stopped, '收到 done 且是正常收尾');
ok(r7.done?.model === 'gpt-stream', 'model 从流里更新了', r7.done?.model);
ok(r7.done?.usage.input === 7 && r7.done?.usage.output === 3, 'usage 从流里取到了', JSON.stringify(r7.done?.usage));

// Anthropic：event: 帧 + message_start / delta / message_stop
handler = () => ({
  streamFrames: [
    sseEvent('message_start', { type: 'message_start', message: { model: 'claude-stream', usage: { input_tokens: 9 } } }),
    sseEvent('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: '甲' } }),
    sseEvent('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: '乙' } }),
    sseEvent('message_delta', { type: 'message_delta', usage: { output_tokens: 4 } }),
    sseEvent('message_stop', { type: 'message_stop' }),
  ],
});
const r8 = await collect(streamComplete({ config: cfgAnth, messages: q1 }));
ok(last().body.stream === true, 'Anthropic 也开了 stream');
ok(r8.text === '甲乙', 'content_block_delta 拼起来了', r8.text);
ok(r8.done?.usage.input === 9 && r8.done?.usage.output === 4, 'input/output_tokens 分别取到', JSON.stringify(r8.done?.usage));
ok(r8.done?.model === 'claude-stream', 'Anthropic 的 model 也从流里更新', r8.done?.model);

// Ollama：NDJSON，不是 SSE
const cfgOllama = { provider: 'ollama', baseUrl: BASE, model: 'qwen2.5-coder:7b' };
handler = () => ({
  contentType: 'application/x-ndjson',
  streamFrames: [
    ndjson({ model: 'qwen2.5-coder:7b', message: { role: 'assistant', content: '本地' }, done: false }),
    ndjson({ message: { role: 'assistant', content: '流式' }, done: false }),
    ndjson({ done: true, prompt_eval_count: 5, eval_count: 8 }),
  ],
});
const r9 = await collect(streamComplete({ config: cfgOllama, messages: q1, system: 'SYS' }));
ok(last().body.stream === true, 'Ollama 开了 stream');
ok(last().body.messages[0].role === 'system', 'Ollama 的 system 仍在 messages 里');
ok(r9.text === '本地流式', 'NDJSON 增量拼起来了', r9.text);
ok(r9.done?.usage.input === 5 && r9.done?.usage.output === 8, 'done 帧的用量取到了', JSON.stringify(r9.done?.usage));

// 服务端中途截断：仍要发 done，但标 stopped，别让前端一直转圈
handler = () => ({ streamFrames: [sse({ choices: [{ delta: { content: '半句' } }] })] });
const r10 = await collect(streamComplete({ config: cfgOpenai, messages: q1 }));
ok(r10.done?.stopped === true, '没有 [DONE] 时标记 stopped（提示可能被截断）');

// ---------------- 8. 流式：错误分类与中止 ----------------
console.log('\n[8] 流式：错误分类与中止');
for (const [status, code] of [[401, 'unauthorized'], [404, 'bad-endpoint'], [429, 'rate-limit'], [500, 'server']]) {
  handler = () => ({ status, body: { error: { message: 'boom' } } });
  await expectError(code, () => collect(streamComplete({ config: cfgOpenai, messages: q1 })), `HTTP ${status} → ${code}`);
}

handler = () => ({ streamFrames: [sse({ error: { type: 'overloaded_error', message: '忙' } })] });
await expectError('server', () => collect(streamComplete({ config: cfgOpenai, messages: q1 })), '流中途的 error 帧 → server');

await expectError('no-key', () => collect(streamComplete({
  config: { provider: 'openai', baseUrl: BASE, model: 'm' }, messages: q1,
})), '流式没配 key → no-key');
await expectError('no-config', () => assertConfigReady({ provider: 'openai', apiKey: 'x', model: 'm' }), '缺 baseUrl → no-config');

// 超时只约束「等到响应头」：挂住不给任何字节
handler = () => ({ hang: true });
await expectError('timeout', () => collect(streamComplete({ config: cfgOpenai, messages: q1, timeoutMs: 250 })), '首字节超时 → timeout');

// 用户中途停止：generator 正常结束，不再产出后续 delta，也不当成错误
const ac = new AbortController();
handler = () => ({
  frameDelay: 60,
  streamFrames: [
    sse({ choices: [{ delta: { content: '一' } }] }),
    sse({ choices: [{ delta: { content: '二' } }] }),
    sse({ choices: [{ delta: { content: '三' } }] }),
    'data: [DONE]\n\n',
  ],
});
const kept = [];
let abortErr = null;
try {
  for await (const ev of streamComplete({ config: cfgOpenai, messages: q1, signal: ac.signal })) {
    if (ev.type === 'delta') { kept.push(ev.text); ac.abort(); }
  }
} catch (e) {
  abortErr = e;
}
ok(!abortErr, '中途停止不算错误', abortErr ? String(abortErr.message) : '');
ok(kept.length >= 1 && kept.length < 3, '停止后没有继续产出全部 delta', kept.join(''));

// ---------------- 9. SSE 路由（端到端） ----------------
// 上面测的是协议适配，这里测编辑器自己的 /api/ai/chat 有没有把事件按序推给前端。
console.log('\n[9] SSE 路由：事件顺序与错误转发');
const { createServer } = await import('../core/serve/server.mjs');
const app = createServer();
await new Promise((s) => app.listen(0, '127.0.0.1', s));
const APP = `http://127.0.0.1:${app.address().port}`;
const postChat = (payload) => fetch(`${APP}/api/ai/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const parseEvents = (raw) => [...raw.matchAll(/^event: (\S+)\ndata: (.*)$/gm)]
  .map((m) => ({ event: m[1], data: m[2] }));

handler = () => ({
  streamFrames: [
    sse({ choices: [{ delta: { content: 'A' } }] }),
    sse({ choices: [{ delta: { content: 'B' } }] }),
    'data: [DONE]\n\n',
  ],
});
const sres = await postChat({ question: '注册物品要注意什么', stream: true, useKnowledge: true });
ok(sres.status === 200 && /text\/event-stream/.test(sres.headers.get('content-type') || ''), 'SSE 响应头正确');
const evs = parseEvents(await sres.text());
ok(evs[0]?.event === 'meta', '第一个事件是 meta');
ok(JSON.parse(evs[0]?.data || '{}').sources?.length > 0, 'meta 里带了检索来源');
ok(evs.filter((e) => e.event === 'delta').map((e) => JSON.parse(e.data).text).join('') === 'AB', 'delta 按序推给前端');
ok(evs.at(-1)?.event === 'done' && JSON.parse(evs.at(-1).data).stopped === false, '最后发 done 且不是截断');

// 头已经写出去了，上游报错只能走 SSE error，不能让外层再发一次 HTTP 400
handler = () => ({ status: 401, body: { error: { message: 'bad key' } } });
const eres = await postChat({ question: 'hi', stream: true, useKnowledge: false });
const errRaw = await eres.text();
ok(eres.status === 200 && /event: error/.test(errRaw), '上游 401 转成 event: error（没有二次 HTTP 响应）');
ok(/"code":"unauthorized"/.test(errRaw), 'error 事件带了错误分类', errRaw.slice(0, 160));

app.closeAllConnections();
await new Promise((s) => app.close(s));

// ---------------- 收尾 ----------------
server.closeAllConnections();
await new Promise((s) => server.close(s));

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
