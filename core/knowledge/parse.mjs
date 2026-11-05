/**
 * 知识文档解析。
 *
 * 为什么自己写而不上个 markdown 库：这里要的不是「渲染成 HTML」，
 * 而是两件很具体的事 ——
 *   1. 检索要按「章节」而不是按「文件」切。整篇 3000 字丢进检索，
 *      命中一段也定位不到，AI 拿到的上下文还会被无关段落挤爆。
 *   2. 界面要能按层级出目录、把代码块单独拎出来加按钮。
 * 两件事共用同一份结构，所以解析只做一次，两边都用。
 *
 * 完整 markdown 规范里有一大堆我们用不上的东西（引用式链接、脚注、
 * HTML 内联……），不做。做的是：标题、段落、代码块、列表、表格、引用。
 */

/**
 * 正文里允许的 front matter：
 * ---
 * title: 从零到出 jar
 * category: 指南
 * order: 1
 * tags: 入门,流程
 * evidence: verified-26.3
 * ---
 */
export function splitFrontMatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: text };
  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^\s*([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (!val) continue;
    if (/^\[.*\]$/.test(val)) {
      val = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    meta[key] = val;
  }
  return { meta, body };
}

/** 代码块的语言标记白名单，认不出的一律当纯文本 */
const LANGS = new Set([
  'java', 'json', 'js', 'javascript', 'mjs', 'bash', 'sh', 'gradle', 'groovy',
  'xml', 'yaml', 'yml', 'properties', 'toml', 'text', 'md',
]);

/**
 * 按标题切章节。
 *
 * 代码块里的 `# 注释` 不是标题 —— 必须先记住自己是不是在围栏里，
 * 否则一段 Java 注释就能把文档切成好几段。
 */
export function splitSections(body) {
  const lines = String(body || '').split('\n');
  const sections = [];
  let cur = { level: 0, heading: '', path: [], lines: [], code: [] };
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (text || cur.heading) {
      sections.push({
        level: cur.level,
        heading: cur.heading,
        path: cur.path.join(' / '),
        text,
        code: cur.code,
      });
    }
    cur = { level: cur.level, heading: cur.heading, path: cur.path, lines: [], code: [] };
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        inCode = false;
        const source = codeBuf.join('\n');
        cur.code.push({ lang: codeLang, content: source });
        // 围栏要留在正文里，不能只留裸代码：
        //   - 检索要找类名和方法名，跳过代码等于废掉一半命中；
        //   - 界面靠围栏才知道这段是代码，才给得上「复制」「问 AI」；
        //   - AI 拿到的片段里带围栏，它也就知道哪部分是代码而不是解释。
        cur.lines.push(`\`\`\`${codeLang}\n${source}\n\`\`\``);
        codeBuf = [];
        codeLang = '';
      } else {
        inCode = true;
        const tag = line.trim().slice(3).trim().toLowerCase();
        codeLang = LANGS.has(tag) ? tag : tag ? 'text' : '';
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      const level = h[1].length;
      const heading = h[2].trim();
      // path 是「你在文档的哪个位置」，给检索结果做定位用
      const path = cur.path.slice(0, Math.max(0, level - 1));
      cur.level = level;
      cur.heading = heading;
      cur.path = [...path, heading];
      continue;
    }
    cur.lines.push(line);
  }
  if (inCode && codeBuf.length) {
    const source = codeBuf.join('\n');
    cur.code.push({ lang: codeLang, content: source });
    cur.lines.push(`\`\`\`${codeLang}\n${source}\n\`\`\``);
  }
  flush();
  return sections.filter((s) => s.text || s.code.length);
}

/** 一句话摘要：第一段不是标题、不是元信息的正文 */
export function summarize(body, max = 120) {
  const lines = String(body || '').split('\n');
  let inCode = false;
  const buf = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('---')) {
      if (buf.length) break;
      continue;
    }
    buf.push(t.replace(/^[-*+]\s+/, ''));
  }
  const s = buf.join(' ').replace(/[*_`]/g, '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 解析一篇文档。
 * 返回的 sections 同时供「检索」和「渲染」使用 —— 渲染时前端按 level/heading
 * 重建层级，代码块单独上色。
 */
export function parseDoc(raw, info = {}) {
  const { meta, body } = splitFrontMatter(raw);
  const sections = splitSections(body);
  const firstHeading = sections.find((s) => s.level === 1)?.heading || sections[0]?.heading || '';
  const title = meta.title || firstHeading || info.name || info.id || '(无题)';

  return {
    id: info.id || '',
    title,
    category: meta.category || info.category || '其他',
    sub: meta.sub || info.sub || '',
    order: Number(meta.order || 0) || 0,
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? String(meta.tags).split(',').map((s) => s.trim()) : [],
    level: meta.level || '',
    /** 文档适用平台：fabric / forge / 空（平台中立）。检索据此加权。 */
    platform: String(meta.platform || '').trim(),
    evidence: meta.evidence || '',
    summary: meta.summary || summarize(body),
    source: info.source || '',
    sourceLabel: info.sourceLabel || '',
    path: info.path || '',
    sections,
    /** 纯文本，给「整篇塞进上下文」的兜底用法 */
    plain: sections.map((s) => (s.heading ? `## ${s.heading}\n` : '') + s.text).join('\n\n'),
  };
}
