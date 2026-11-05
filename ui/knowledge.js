/**
 * 学习中心：内置指南 + 26.3 速查 + 任务卡 + 专家库 + 学习记录。
 *
 * 设计上刻意做成「一本书」而不是「一堆搜索结果」：
 * 左栏是目录（按分类分组，指南带序号），右栏是正文。
 * 搜索时左栏临时换成命中列表，清空搜索就回到目录。
 *
 * 代码块右上角有「问 AI」—— 看到不认识的写法不用切出去查，
 * 直接把这段甩给 AI 问一句。
 */
import { api } from './api.js';
import { el, fill, setContent, toast, debounce, confirmBox } from './ui.js';
import { renderMarkdown } from './md.js';

const K = {
  docs: [],
  sources: [],
  stats: null,
  currentId: null,
  query: '',
  hits: null,
  host: null,
  ctx: null,
  cache: new Map(),
  /** 从别处（AI 的引用来源）跳过来时，指定要打开哪篇哪节 */
  pending: null,
};

export function openKnowledgeDoc(id, heading) {
  K.pending = { id, heading };
}

const CAT_ORDER = ['指南', '任务卡', '速查', '学习记录', '我的笔记', '专家库 · API', '专家库 · 规则', '其他'];

const EVIDENCE_LABEL = {
  'verified-26.3': { text: '实编验证', cls: 'ev-verified', title: '本机 Fabric 26.3 上编译通过' },
  'verified-forge-1.20.1': { text: 'Forge 实编', cls: 'ev-verified', title: '本机 Forge 1.20.1 上编译通过' },
  official: { text: '官方文档', cls: 'ev-official', title: '来自官方文档' },
  inferred: { text: '版本推断', cls: 'ev-inferred', title: '从相邻版本推断，未逐条复核' },
};

const PLATFORM_LABEL = {
  fabric: 'Fabric 26.3', forge: 'Forge 1.20.1',
  neoforge: 'NeoForge', paper: 'Paper', spigot: 'Spigot',
};
const platformLabel = (p) => PLATFORM_LABEL[p] || p;

function evidenceBadge(ev) {
  if (!ev) return null;
  const known = EVIDENCE_LABEL[ev];
  const text = known ? known.text : ev;
  return el('span.ev-badge', { text, title: known?.title || ev, class: `ev-badge ${known?.cls || ''}` });
}

/** 目录里只给「非默认平台」打标，否则 Fabric 那几十篇全是徽标，反而看不清 */
function platformTag(p) {
  if (!p || p === 'fabric') return null;
  return el('span.tag', { text: platformLabel(p), title: `适用于 ${platformLabel(p)} 的资料` });
}

function askAI(ctx, question) {
  if (ctx.onAskAI) ctx.onAskAI(question);
  else toast('AI 面板未接入', 'warn');
}

export function renderKnowledgePanel(ctx) {
  K.ctx = ctx;
  K.host = el('div.full-panel.kb-panel');

  const searchInput = el('input.kb-search', {
    placeholder: '搜一下：注册物品 / 时运 / mixin 注入…',
    value: K.query,
    oninput: debounce((e) => {
      K.query = e.target.value.trim();
      runSearch();
    }, 220),
  });

  fill(
    K.host,
    el(
      'div.panel-bar',
      {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回编辑'),
      el('h2.panel-title', { text: '学习中心' }),
      el('div.spacer'),
      searchInput,
      el('button.btn.ghost.small', {
        text: '重新扫描',
        title: '知识库是从磁盘扫出来的，新增了笔记或专家包后点这里',
        onclick: async () => {
          await api.knowledgeReload();
          K.cache.clear();
          await loadList();
          toast('知识库已重新扫描');
        },
      }),
      el('button.btn.ghost.small', { text: '问 AI', onclick: () => askAI(ctx, '') }),
    ),
  );

  K.treeHost = el('div.kb-tree');
  K.articleHost = el('div.kb-article', {}, el('div.empty', { text: '左边选一篇看' }));
  K.statsHost = el('div.kb-stats');

  fill(
    K.host,
    el(
      'div.panel-body.two-col',
      {},
      el('div.kb-side', {}, K.statsHost, K.treeHost),
      K.articleHost,
    ),
  );

  loadList();
  return K.host;
}

async function loadList() {
  try {
    const r = await api.knowledgeList();
    K.docs = r.docs || [];
    K.sources = r.sources || [];
    K.stats = r.stats || null;
    renderStats();
    renderTree();
    // 从 AI 引用跳进来的优先；否则默认打开第一篇指南，别让人对着空白发呆
    if (K.pending) {
      const { id, heading } = K.pending;
      K.pending = null;
      openDoc(id, heading);
      return;
    }
    if (K.currentId) {
      // 面板被重渲染（切换视图回来、工程数据变化等）时，articleHost 是全新的空节点。
      // 不重新打开当前文档，右边就会一直空白 —— 之前只在 currentId 为空时才打开。
      openDoc(K.currentId);
    } else {
      const first = K.docs.find((d) => d.category === '指南') || K.docs[0];
      if (first) openDoc(first.id);
    }
  } catch (e) {
    setContent(K.treeHost, el('div.error-text', { text: `知识库读不出来：${e.message}` }));
  }
}

function renderStats() {
  if (!K.stats) return;
  const parts = [];
  for (const [label, n] of Object.entries(K.stats.bySource || {})) parts.push(`${label} ${n}`);
  fill(
    K.statsHost,
    el('div.kb-stat-line', { text: `${K.stats.docs} 篇 · ${K.stats.sections} 节` }),
    el('div.kb-stat-sub', { text: parts.join(' / ') }),
    K.sources.some((s) => s.kind === 'expert')
      ? el('div.kb-stat-hint', { text: '已接入本机 MC 开发专家包' })
      : el('div.kb-stat-hint.muted', { text: '没检测到专家包，只用内置内容' }),
  );
}

function renderTree() {
  if (K.hits) return renderHits();
  const box = el('div');
  const groups = new Map();
  for (const d of K.docs) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category).push(d);
  }
  const cats = [...groups.keys()].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  for (const cat of cats) {
    const list = groups.get(cat);
    fill(box, el('div.kb-cat', {}, el('span', { text: cat }), el('span.kb-cat-n', { text: String(list.length) })));
    for (const d of list) {
      fill(
        box,
        el(
          `div.kb-item${d.id === K.currentId ? '.active' : ''}`,
          {
            onclick: () => openDoc(d.id),
            title: d.summary || d.title,
          },
          el('span.kb-item-title', { text: d.title }),
          d.evidence ? evidenceBadge(d.evidence) : null,
          platformTag(d.platform),
        ),
      );
    }
  }
  setContent(K.treeHost, box);
}

function renderHits() {
  const box = el('div');
  fill(
    box,
    el('div.kb-cat', {}, el('span', { text: `搜索「${K.query}」` }), el('span.kb-cat-n', { text: String(K.hits.length) })),
  );
  if (!K.hits.length) {
    fill(box, el('div.empty.small', { text: '没找到。换个说法试试，或者去问 AI。' }));
  }
  for (const h of K.hits) {
    fill(
      box,
      el(
        'div.kb-hit',
        {
          onclick: () => openDoc(h.docId, h.heading),
        },
        el('div.kb-hit-title', {}, el('span', { text: h.title }), h.heading ? el('span.kb-hit-sub', { text: h.heading }) : null),
        el('div.kb-hit-snip', { text: h.snippet }),
        el('div.kb-hit-meta', { text: `${h.sourceLabel}${h.evidence ? ` · ${h.evidence}` : ''}${h.platform ? ` · ${platformLabel(h.platform)}` : ''}` }),
      ),
    );
  }
  setContent(K.treeHost, box);
}

const runSearch = () => {
  const q = K.query;
  if (!q) {
    K.hits = null;
    renderTree();
    return;
  }
  api
    .knowledgeSearch(q, {
      limit: 15,
      platform: K.ctx?.project?.target?.platform || '',
      root: K.ctx?.root || '',
    })
    .then((r) => {
      K.hits = r.hits || [];
      renderHits();
    })
    .catch((e) => {
      toast(`搜索失败：${e.message}`, 'error');
    });
};

async function openDoc(id, focusHeading) {
  K.currentId = id;
  renderTree();
  setContent(K.articleHost, el('div.empty', { text: '载入中…' }));
  let doc = K.cache.get(id);
  if (!doc) {
    try {
      const r = await api.knowledgeDoc(id);
      doc = r.doc;
      K.cache.set(id, doc);
    } catch (e) {
      setContent(K.articleHost, el('div.error-text', { text: `打不开：${e.message}` }));
      return;
    }
  }
  renderArticle(doc, focusHeading);
}

function renderArticle(doc, focusHeading) {
  const head = el(
    'div.kb-article-head',
    {},
    el('h1.kb-article-title', { text: doc.title }),
    el(
      'div.kb-article-meta',
      {},
      el('span.pill', { text: doc.category }),
      el('span.pill', { text: doc.sourceLabel }),
      doc.platform ? el('span.pill', { text: `平台：${platformLabel(doc.platform)}` }) : null,
      evidenceBadge(doc.evidence),
      doc.level ? el('span.pill', { text: doc.level }) : null,
      ...(doc.tags || []).map((t) => el('span.tag', { text: t })),
      el('div.spacer'),
      doc.source === 'learned' || doc.source === 'user'
        ? el('button.btn.ghost.tiny', {
            text: '删除这篇',
            onclick: async () => {
              const yes = await confirmBox(`删除「${doc.title}」？只删这篇笔记，不会影响别的。`);
              if (!yes) return;
              try {
                await api.knowledgeDelete(doc.id);
                K.cache.delete(doc.id);
                K.currentId = null;
                toast('已删除');
                await loadList();
              } catch (e) {
                toast(e.message, 'error');
              }
            },
          })
        : null,
    ),
    el('div.kb-article-summary', { text: doc.summary || '' }),
  );

  const body = el('div.kb-article-body');
  const opts = {
    onAskAI: (q) => askAI(K.ctx, q),
    onInstallHook: (code) => K.ctx.onInstallHook?.(code, 'knowledge'),
  };

  for (const sec of doc.sections) {
    if (sec.heading && sec.heading !== doc.title) {
      const lv = Math.min(Math.max(sec.level, 2), 4);
      body.appendChild(el(`h${lv}.md-h.kb-sec`, { text: sec.heading, 'data-heading': sec.heading }));
    }
    if (sec.text) body.appendChild(renderMarkdown(sec.text, opts));
  }

  setContent(K.articleHost, head, body);
  K.articleHost.scrollTop = 0;

  if (focusHeading) {
    const target = [...body.querySelectorAll('.kb-sec')].find((n) => n.getAttribute('data-heading') === focusHeading);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      target.classList.add('kb-sec-flash');
      setTimeout(() => target.classList.remove('kb-sec-flash'), 1400);
    }
  }
}
