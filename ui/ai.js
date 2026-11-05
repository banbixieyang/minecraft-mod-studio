/**
 * AI 助手面板。
 *
 * 三件事：
 *   1. 让它看得懂你在做什么 —— 请求里带上当前工程摘要；
 *   2. 让它答得有依据 —— 每次提问先去知识库检索，把命中段落连同来源一起送过去；
 *   3. 让它出错时能自救 —— 未配置 / key 错 / 连不上，三种情况给三种指引。
 *
 * 回答里的代码块可以一键复制；引用来源点一下能跳回学习中心那一段。
 *
 * 输出是流式的：期间只往一个纯文本节点追加，发送键变「停止」；
 * 收到 done（或用户停止）后才整篇换成 markdown 渲染。
 */
import { api } from './api.js';
import { el, fill, setContent, toast, modal } from './ui.js';
import { renderMarkdown } from './md.js';

const A = {
  messages: [],
  busy: false,
  config: null,
  presets: [],
  useKnowledge: true,
  host: null,
  ctx: null,
  /** 从别的面板带过来的草稿（比如在学习中心点「问 AI」） */
  draft: '',
  /** 正在输出的那个纯文本节点：增量只改它，不整篇重绘 markdown */
  liveText: null,
  sendBtn: null,
  streamCtl: null,
};

export function setAiDraft(text) {
  A.draft = String(text || '');
}

export function renderAiPanel(ctx) {
  A.ctx = ctx;
  A.host = el('div.full-panel.ai-panel');

  const statusChip = el('span.ai-status');
  const kbToggle = el('label.ai-toggle', {
    title: '关掉后 AI 不看知识库，只靠通用知识回答（会慢一点、准一点看运气）',
  });
  const kbBox = el('input', {
    type: 'checkbox',
    checked: A.useKnowledge,
    onchange: (e) => {
      A.useKnowledge = e.target.checked;
    },
  });
  fill(kbToggle, kbBox, el('span', { text: '查知识库' }));

  fill(
    A.host,
    el(
      'div.panel-bar',
      {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回编辑'),
      el('h2.panel-title', { text: 'AI 助手' }),
      statusChip,
      el('div.spacer'),
      kbToggle,
      el('button.btn.ghost.small', { text: '清空对话', onclick: () => {
        A.messages = [];
        paintThread();
      } }),
      el('button.btn.ghost.small', { text: '设置', onclick: () => openSettings() }),
    ),
  );

  A.thread = el('div.ai-thread');
  A.input = el('textarea.ai-input', {
    placeholder: '问点什么：怎么做一个挖矿翻倍的镐子？这个报错什么意思？',
    rows: 3,
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
  });
  // 只绑一次。el() 用的是 addEventListener，事后再改 node.onclick 会变成
  // 「第二个 handler」——点一次触发两次，还会在 send() 中途把行为改成 abort。
  A.sendBtn = el('button.btn.primary.ai-send', {
    text: '发送',
    onclick: () => { if (A.busy) A.streamCtl?.abort(); else send(); },
  });

  fill(
    A.host,
    A.thread,
    el('div.ai-composer', {}, A.input, el('div.ai-composer-foot', {}, el('span.field-hint', { text: 'Enter 发送 · Shift+Enter 换行' }), el('div.spacer'), A.sendBtn)),
  );

  loadConfig(statusChip).then(() => {
    if (A.draft) {
      A.input.value = A.draft;
      A.draft = '';
      A.input.focus();
    }
    paintThread();
    if (A.config && !A.config.hasKey && A.config.needsKey) openSettings(true);
  });

  return A.host;
}

async function loadConfig(statusChip) {
  try {
    const r = await api.aiConfig();
    A.config = r.config;
    A.presets = r.presets || [];
  } catch {
    A.config = null;
  }
  const c = A.config;
  setContent(
    statusChip,
    el('span.pill.tiny', {
      text: c ? (c.needsKey && !c.hasKey ? '未配置 key' : c.model || '?') : '不可用',
      title: c ? `${c.provider} · ${c.baseUrl}` : '',
    }),
  );
}

function paintThread() {
  const box = el('div.ai-messages');
  A.liveText = null;
  if (!A.messages.length) {
    fill(
      box,
      el(
        'div.ai-welcome',
        {},
        el('h3', { text: '我是 MC Studio 的助手' }),
        el('p', { text: '我知道这个版本的坑，也能读到左边「学习中心」里的指南与速查。问的时候把「你想让游戏发生什么」说清楚就行。' }),
        el('div.ai-chips', {},
          ...[
            '怎么做一个挖矿掉落翻倍的镐子？',
            '26.3 注册物品要注意什么？',
            '我的盔甲做出来穿不上，为什么？',
            '帮我看看这段代码有没有问题',
          ].map((q) => el('button.ai-chip', { text: q, onclick: () => {
            A.input.value = q;
            A.input.focus();
          } })),
        ),
      ),
    );
  }
  for (const m of A.messages) {
    if (m.role === 'user') {
      fill(box, el('div.ai-msg.user', {}, el('div.ai-bubble', {}, el('div.ai-text', { text: m.content }))));
    } else if (m.role === 'error') {
      fill(box, el('div.ai-msg.sys', {}, el('div.ai-error', {}, el('div.ai-error-title', { text: m.title || '出错了' }), el('div.ai-error-body', { text: m.content }), m.action ? el('button.btn.ghost.small', { text: m.action.label, onclick: m.action.run }) : null)));
    } else {
      const bubble = el('div.ai-bubble');
      if (m.streaming) {
        // 流式期间用纯文本：每个 delta 都重解析一遍 markdown 会抖，也没必要
        A.liveText = el('pre.ai-stream-text', { text: m.content });
        bubble.appendChild(A.liveText);
      } else {
        bubble.appendChild(renderMarkdown(m.content || '（没有内容）', {
          onAskAI: (q) => { A.input.value = q; A.input.focus(); },
          onInstallHook: (code) => A.ctx?.onInstallHook?.(code, 'ai'),
        }));
      }
      const metaBits = [];
      if (m.streaming) metaBits.push('正在输出…');
      if (m.stopped) metaBits.push('已停止');
      if (m.model) metaBits.push(m.model);
      if (m.ms) metaBits.push(`${(m.ms / 1000).toFixed(1)}s`);
      if (m.usage?.input) metaBits.push(`in ${m.usage.input} / out ${m.usage.output || 0}`);
      fill(
        box,
        el(
          'div.ai-msg.assistant',
          {},
          bubble,
          m.sources?.length
            ? el('div.ai-sources', {}, el('span.ai-sources-label', { text: '依据：' }), ...m.sources.map((s) =>
                el('button.ai-source', {
                  text: s.heading ? `${s.title} · ${s.heading}` : s.title,
                  title: `${s.sourceLabel}${s.evidence ? ` · ${s.evidence}` : ''}`,
                  onclick: () => A.ctx.onOpenDoc?.(s.docId, s.heading),
                })))
            : null,
          metaBits.length ? el('div.ai-meta', { text: metaBits.join(' · ') }) : null,
        ),
      );
    }
  }
  setContent(A.thread, box);
  A.thread.scrollTop = A.thread.scrollHeight;
}

function setBusyUI(busy) {
  if (!A.sendBtn) return;
  A.sendBtn.textContent = busy ? '停止' : '发送';
  A.sendBtn.classList.toggle('stopping', busy);
}

function pushError(e) {
  const msg = String(e.message || e);
  let title = '请求失败';
  let action = null;
  if (/key|401|403/i.test(msg) || e.code === 'no-key' || e.code === 'unauthorized') {
    title = 'key 有问题';
    action = { label: '检查设置', run: () => openSettings(true) };
  } else if (/连不上|ECONNREFUSED|network|超时/i.test(msg) || e.code === 'network' || e.code === 'timeout') {
    title = '连不上模型服务';
    action = { label: '检查设置', run: () => openSettings(true) };
  }
  A.messages.push({ role: 'error', title, content: msg, action });
}

async function send() {
  if (A.busy) return;
  const q = A.input.value.trim();
  if (!q) return;
  if (!A.config || (A.config.needsKey && !A.config.hasKey)) {
    openSettings(true);
    return;
  }

  // 先算历史再推入本轮消息：占位回答不能混进 history
  const history = A.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const reply = { role: 'assistant', content: '', sources: [], streaming: true };
  A.messages.push({ role: 'user', content: q }, reply);
  A.input.value = '';
  A.busy = true;
  setBusyUI(true);
  paintThread();

  let failure = null;
  let stopped = false;
  const ctl = api.aiChatStream(
    { question: q, history, root: A.ctx.root, useKnowledge: A.useKnowledge },
    {
      onMeta: (d) => {
        reply.sources = d.sources || [];
        if (d.model) reply.model = d.model;
      },
      onDelta: (t) => {
        reply.content += t;
        if (A.liveText) A.liveText.textContent = reply.content;
        A.thread.scrollTop = A.thread.scrollHeight;
      },
      onDone: (d) => {
        if (d.model) reply.model = d.model;
        reply.usage = d.usage;
        reply.ms = d.ms;
        reply.stopped = Boolean(d.stopped);
      },
      onError: (e) => { failure = e; },
    },
  );
  A.streamCtl = ctl;

  try {
    const r = await ctl.done;
    stopped = Boolean(r?.stopped);
  } catch (e) {
    failure = e;
  }

  reply.streaming = false;
  if (stopped) reply.stopped = true;
  if (failure && !reply.content) {
    // 一个字都没出来就别留个空气泡，直接换成错误卡片
    const idx = A.messages.indexOf(reply);
    if (idx >= 0) A.messages.splice(idx, 1);
  }
  if (failure) pushError(failure);

  A.busy = false;
  A.streamCtl = null;
  setBusyUI(false);
  paintThread();
}

function openSettings(firstRun = false) {
  const c = A.config || {};
  const state = {
    preset: c.preset || 'openai',
    provider: c.provider || 'openai',
    baseUrl: c.baseUrl || '',
    model: c.model || '',
    apiKey: '',
    maxTokens: c.maxTokens || 4096,
    temperature: c.temperature ?? 0.2,
    knowledgeHits: c.knowledgeHits ?? 6,
  };

  const presetSel = el('select.input', {
    onchange: (e) => {
      const p = A.presets.find((x) => x.id === e.target.value);
      if (!p) return;
      state.preset = p.id;
      state.provider = p.provider;
      state.baseUrl = p.baseUrl;
      state.model = p.model;
      baseUrlInput.value = p.baseUrl;
      modelInput.value = p.model;
      setContent(hintBox, el('div.field-hint', { text: p.hint || '' }));
    },
  });
  for (const p of A.presets) {
    presetSel.appendChild(el('option', { value: p.id, text: p.label, selected: p.id === state.preset }));
  }

  const baseUrlInput = el('input.input', { value: state.baseUrl, oninput: (e) => { state.baseUrl = e.target.value.trim(); } });
  const modelInput = el('input.input', { value: state.model, oninput: (e) => { state.model = e.target.value.trim(); } });
  const keyInput = el('input.input', {
    type: 'password',
    placeholder: c.hasKey ? `已保存 ${c.keyHint}（留空则不修改）` : 'sk-...',
    oninput: (e) => { state.apiKey = e.target.value.trim(); },
  });
  const hintBox = el('div');
  const testOut = el('div.field-hint');

  const body = el(
    'div.ai-settings',
    {},
    field('接口预设', presetSel),
    field('接口地址', baseUrlInput, 'OpenAI 兼容的都填到 /v1 为止，例如 https://api.deepseek.com/v1'),
    field('模型', modelInput, '填服务端认的模型名'),
    field('API Key', keyInput, c.configPath ? `存在 ${c.configPath}，不会上传到任何地方` : '只存在本机'),
    el('div.field-row', {},
      field('最大输出 token', el('input.input', { type: 'number', value: state.maxTokens, oninput: (e) => { state.maxTokens = Number(e.target.value); } })),
      field('温度', el('input.input', { type: 'number', step: '0.1', min: '0', max: '2', value: state.temperature, oninput: (e) => { state.temperature = Number(e.target.value); } })),
    ),
    hintBox,
    el('div.ai-test-row', {},
      el('button.btn.ghost.small', {
        text: '测试连接',
        onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true;
          setContent(testOut, el('span.field-hint', { text: '测试中…' }));
          try {
            // 先保存再测，否则测的是旧配置
            await api.aiSaveConfig(state);
            const r = await api.aiTest();
            setContent(testOut, el('span.ok-text', { text: `通了，${r.ms}ms，模型回：${r.reply}` }));
          } catch (err) {
            setContent(testOut, el('span.error-text', { text: err.message }));
          } finally {
            btn.disabled = false;
          }
        },
      }),
      testOut,
    ),
  );

  const p0 = A.presets.find((x) => x.id === state.preset);
  if (p0?.hint) setContent(hintBox, el('div.field-hint', { text: p0.hint }));

  modal({
    title: firstRun ? '先配一个模型' : 'AI 设置',
    body,
    width: 620,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '保存',
        kind: 'primary',
        onClick: async () => {
          try {
            const r = await api.aiSaveConfig(state);
            A.config = r.config;
            const chip = A.host?.querySelector('.ai-status');
            if (chip) {
              setContent(chip, el('span.pill.tiny', { text: A.config.needsKey && !A.config.hasKey ? '未配置 key' : A.config.model }));
            }
            toast('已保存');
            paintThread();
            return true;
          } catch (e) {
            toast(e.message, 'error');
            return false;
          }
        },
      },
    ],
  });
}

function field(label, input, hint) {
  return el('label.field', {}, el('span.field-label', { text: label }), input, hint ? el('div.field-hint', { text: hint }) : null);
}
