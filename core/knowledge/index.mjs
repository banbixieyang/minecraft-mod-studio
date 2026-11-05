/**
 * 知识库索引与检索。
 *
 * 检索粒度是「章节」不是「文档」。原因很实际：
 *   - 一篇 3000 字的速查里命中一段，按文档返回等于把整篇塞给 AI，
 *     上下文被无关段落挤爆，回答反而变差；
 *   - 按章节返回，界面能直接跳到那一段，AI 也只拿到那一段。
 *
 * 分词不引词典：中文按二元组切（「物品注册」→ 物品/品注/注册），
 * 英文按词。够用，且不会因为某个分词库把 "ItemStack" 拆错。
 * 代价是偶尔有噪音命中，用「标题命中加权」压下去。
 */
import fs from 'node:fs';
import { parseDoc } from './parse.mjs';
import { scanDocs, knowledgeSources } from './sources.mjs';

const CJK = /[\u4e00-\u9fff]/;

export function tokenize(text) {
  const out = [];
  const s = String(text || '').toLowerCase();
  for (const m of s.matchAll(/[a-z][a-z0-9_.]{1,}/g)) out.push(m[0]);
  const runs = s.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 文档全文里找一段能当结果摘要的话 */
function snippetOf(text, qTokens, max = 140) {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  if (!plain) return '';
  let at = -1;
  for (const t of qTokens) {
    const i = plain.toLowerCase().indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return plain.slice(0, max) + (plain.length > max ? '…' : '');
  const start = Math.max(0, at - 50);
  const s = plain.slice(start, start + max);
  return (start > 0 ? '…' : '') + s + (start + max < plain.length ? '…' : '');
}

let cache = null;

function signature(docs) {
  let maxMtime = 0;
  let total = 0;
  for (const d of docs) {
    maxMtime = Math.max(maxMtime, d.mtime);
    total += d.size;
  }
  return `${docs.length}|${Math.round(maxMtime)}|${total}`;
}

/**
 * 载入并建索引。带缓存：知识库不是频繁变动的东西，
 * 但 learned 会随分析增长，所以用「文件数 + 最新 mtime + 总字节」当签名。
 */
export function loadKnowledge({ force = false } = {}) {
  const scanned = scanDocs();
  const sig = signature(scanned);
  if (!force && cache && cache.sig === sig) return cache;

  const docs = [];
  for (const meta of scanned) {
    let raw;
    try {
      raw = fs.readFileSync(meta.path, 'utf8');
    } catch {
      continue;
    }
    const doc = parseDoc(raw, {
      id: meta.id,
      name: meta.name,
      category: meta.category,
      sub: meta.sub,
      source: meta.kind,
      sourceLabel: meta.sourceLabel,
      path: meta.path,
    });
    // front matter 没写分类时，用目录推断的那个
    if (!doc.category || doc.category === '其他') doc.category = meta.category;
    doc.sub = doc.sub || meta.sub;
    // front matter 里写了 platform 就以它为准；没写就用来源扫出来的默认值
    doc.platform = doc.platform || meta.platform || '';
    doc.mtime = meta.mtime;
    docs.push(doc);
  }

  // id 撞车兜底。byId 是 Map，重名会让前一篇被后一篇悄悄盖掉 ——
  // 表现是「点目录里 A，打开的是 B」，比报错难查得多。这里宁可给个后缀。
  const seenIds = new Map();
  for (const doc of docs) {
    const n = seenIds.get(doc.id) || 0;
    seenIds.set(doc.id, n + 1);
    if (n) doc.id = `${doc.id}-${n + 1}`;
  }

  // 倒排表：token → [{doc, sec, tf, head}]
  const postings = new Map();
  const sections = [];
  for (const doc of docs) {
    // 文档标题对整篇都有效 ——「示例模组 分析笔记」里的「示例模组」，
    // 只有第 0 段（标题就是章节标题）能靠章节标题命中，后面几段全漏。
    // 所以标题词并进每一章的标题词集：命中标题 = 整篇相关，这是最强的信号。
    const titleTokens = new Set(tokenize(doc.title));
    for (const t of tokenize((doc.tags || []).join(' '))) titleTokens.add(t);
    doc.titleTokens = titleTokens;
    doc.sections.forEach((sec, si) => {
      const idx = sections.length;
      const headTokens = new Set([...tokenize(sec.heading || ''), ...titleTokens]);
      const bodyTokens = tokenize(sec.text || '');
      const counts = new Map();
      for (const t of bodyTokens) counts.set(t, (counts.get(t) || 0) + 1);
      for (const t of headTokens) counts.set(t, (counts.get(t) || 0) + 2);
      const entry = { doc, sec, si, idx, headTokens, counts, len: bodyTokens.length };
      sections.push(entry);
      for (const t of counts.keys()) {
        let arr = postings.get(t);
        if (!arr) postings.set(t, (arr = []));
        arr.push(idx);
      }
    });
  }

  const byId = new Map(docs.map((d) => [d.id, d]));
  cache = {
    sig,
    docs,
    byId,
    sections,
    postings,
    sources: knowledgeSources(),
    stats: {
      docs: docs.length,
      sections: sections.length,
      tokens: postings.size,
      byCategory: countBy(docs, (d) => d.category),
      bySource: countBy(docs, (d) => d.sourceLabel || d.source),
    },
  };
  return cache;
}

function countBy(list, fn) {
  const out = {};
  for (const x of list) {
    const k = fn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function invalidate() {
  cache = null;
}

/** 文档目录（不含正文，界面左侧树用） */
export function listDocs() {
  const kb = loadKnowledge();
  return {
    sources: kb.sources,
    stats: kb.stats,
    docs: kb.docs
      .map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        sub: d.sub,
        order: d.order,
        tags: d.tags,
        level: d.level,
        evidence: d.evidence,
        platform: d.platform,
        summary: d.summary,
        source: d.source,
        sourceLabel: d.sourceLabel,
        sections: d.sections.length,
      }))
      // 指南按 author 排的手工顺序走，其余按标题
      .sort((a, b) => (a.order || 999) - (b.order || 999) || a.title.localeCompare(b.title, 'zh')),
  };
}

export function getDoc(id) {
  const kb = loadKnowledge();
  return kb.byId.get(id) || null;
}

/**
 * 检索。
 * 分数 = Σ(词频对数 × 是否命中标题) ，再按章节长度做轻微衰减，
 * 最后对「整串原文出现」加一次成，避免散词命中压过精确命中。
 */
export function search(query, opts = {}) {
  const kb = loadKnowledge();
  const { limit = 10, category, source, minScore = 0.01, preferPlatform = '' } = opts;
  const q = String(query || '').trim();
  if (!q) return { query: q, hits: [], total: 0 };

  const qTokens = [...new Set(tokenize(q))];
  if (!qTokens.length) return { query: q, hits: [], total: 0 };

  const scores = new Map(); // sectionIdx → score
  for (const t of qTokens) {
    const arr = kb.postings.get(t);
    if (!arr) continue;
    for (const idx of arr) {
      const e = kb.sections[idx];
      const tf = e.counts.get(t) || 0;
      if (!tf) continue;
      const w = (1 + Math.log(tf)) * (e.headTokens.has(t) ? 4 : 1);
      scores.set(idx, (scores.get(idx) || 0) + w);
    }
  }

  const qLower = q.toLowerCase();
  const raw = [];
  for (const [idx, score] of scores) {
    const e = kb.sections[idx];
    const d = e.doc;
    if (category && d.category !== category) continue;
    if (source && d.source !== source) continue;
    let s = score / (1 + Math.log(1 + e.len / 60));
    if ((e.sec.text || '').toLowerCase().includes(qLower)) s *= 1.8;
    // 平台对齐度：问 Fabric 的事却命中 Spigot 的写法，是最典型的答非所问。
    // 这里只调权重不过滤 —— 平台中立的构建知识（java-build / intake）不该被丢掉。
    if (preferPlatform && d.platform) {
      s *= d.platform === preferPlatform ? 1.6 : 0.45;
    }
    if (s < minScore) continue;
    raw.push({ e, s });
  }
  raw.sort((a, b) => b.s - a.s);

  // 同一篇最多留 3 段，且第 2 段起要打折。
  // 只靠「最多 3 段」是不够的：标题命中会把整篇抬起来，前三条全变成同一篇的
  // 相邻章节，界面上一片重复，AI 那边也等于只拿到一篇。打折让别家能挤进来。
  const perDoc = new Map();
  const ranked = [];
  for (const item of raw) {
    const n = perDoc.get(item.e.doc.id) || 0;
    if (n >= 3) continue;
    perDoc.set(item.e.doc.id, n + 1);
    if (n > 0) item.s *= Math.pow(0.55, n);
    ranked.push(item);
  }
  ranked.sort((a, b) => b.s - a.s);

  const hits = [];
  for (const { e, s } of ranked) {
    if (hits.length >= limit) break;
    // 章节标题和文档标题相同时不重复显示，界面上那行会变成「标题 · 标题」
    const heading = e.sec.heading && e.sec.heading !== e.doc.title ? e.sec.heading : '';
    hits.push({
      docId: e.doc.id,
      title: e.doc.title,
      category: e.doc.category,
      source: e.doc.source,
      sourceLabel: e.doc.sourceLabel,
      platform: e.doc.platform,
      evidence: e.doc.evidence,
      heading,
      /** 章节在文档里的序号。用序号而不是标题回查，重名标题也不会取错段。 */
      si: e.si,
      path: e.sec.path,
      snippet: snippetOf(`${e.sec.heading}\n${e.sec.text}`, qTokens),
      score: Math.round(s * 100) / 100,
    });
  }
  return { query: q, hits, total: raw.length };
}

/**
 * 把检索结果拼成给 AI 的上下文。
 *
 * 每条都带来源和证据等级 —— 模型能看见「这条是内置速查、这条是专家包」，
 * 回答里也就更容易说清依据。超出预算的截断而不是丢掉，保证末尾也有内容。
 */
export function buildContext(query, opts = {}) {
  const { budget = 6000, limit = 6, preferPlatform = '' } = opts;
  const { hits } = search(query, { limit, preferPlatform });
  if (!hits.length) return { text: '', sources: [], chars: 0 };

  const kb = loadKnowledge();
  const parts = [];
  const sources = [];
  let used = 0;

  hits.forEach((h, i) => {
    const doc = kb.byId.get(h.docId);
    const sec = doc?.sections[h.si] || doc?.sections[0];
    let body = (sec?.text || '').trim();
    // 平台必须跟着资料进上下文：权重只是排序，模型自己还得看见「这篇是 26.3 的」，
    // 否则 Forge 工程里偶尔混进一条 Fabric 片段，它照样会照抄。
    const header = `【资料 ${i + 1}】${h.title}${h.heading ? ` · ${h.heading}` : ''}\n来源：${h.sourceLabel}${h.platform ? ` · 平台 ${h.platform}` : ''}${h.evidence ? ` · 证据 ${h.evidence}` : ''}\n`;
    const room = budget - used - header.length;
    if (room <= 200) return;
    if (body.length > room) body = `${body.slice(0, room)}\n…（后略）`;
    parts.push(header + body);
    used += header.length + body.length;
    sources.push({
      n: i + 1,
      docId: h.docId,
      title: h.title,
      heading: h.heading,
      sourceLabel: h.sourceLabel,
      evidence: h.evidence,
    });
  });

  return { text: parts.join('\n\n---\n\n'), sources, chars: used };
}

/** 全库扫一遍，找引用了某类 API 的段落 —— 给「这个类还能这么用」提示 */
export function relatedTo(code, limit = 5) {
  const kb = loadKnowledge();
  const tokens = [...new Set(tokenize(code))].filter((t) => t.length > 3 || CJK.test(t));
  const scores = new Map();
  for (const t of tokens) {
    const arr = kb.postings.get(t);
    if (!arr) continue;
    for (const idx of arr) scores.set(idx, (scores.get(idx) || 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([idx]) => {
      const e = kb.sections[idx];
      return {
        docId: e.doc.id,
        title: e.doc.title,
        heading: e.sec.heading,
        snippet: snippetOf(e.sec.text, tokens, 100),
      };
    });
}
