/**
 * 轻量 markdown 渲染。
 *
 * 不引第三方库（整个项目零依赖），也不做完整的 markdown 规范 ——
 * 知识库里的文档是我们自己写的，用到的就那几种：标题、段落、代码块、
 * 列表、表格、引用、行内代码/加粗/链接。
 *
 * 安全底线：所有文本走 textContent，不用 innerHTML。
 * 知识库里有一部分是「分析别人 mod」自动生成的，内容来自外部 jar，
 * 拼 HTML 就等于给外部输入开了个注入口子。
 */
import { el } from './ui.js';

/** 行内标记：code / 粗体 / 斜体 / 链接 */
function inline(text) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('`')) {
      frag.appendChild(el('code.inline', { text: tok.slice(1, -1) }));
    } else if (tok.startsWith('**')) {
      frag.appendChild(el('strong', { text: tok.slice(2, -2) }));
    } else if (tok.startsWith('*')) {
      frag.appendChild(el('em', { text: tok.slice(1, -1) }));
    } else {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mm) {
        frag.appendChild(
          el('a', {
            text: mm[1],
            href: mm[2],
            target: '_blank',
            rel: 'noreferrer',
            onclick: (e) => {
              // 只放行 http(s)，其余（javascript: 之类）当普通文字
              if (!/^https?:/i.test(mm[2])) {
                e.preventDefault();
              }
            },
          }),
        );
      } else {
        frag.appendChild(document.createTextNode(tok));
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function codeBlock(lang, code, opts) {
  const body = el('pre.code-body', {}, el('code', { text: code }));
  const copyBtn = el('button.btn.ghost.tiny', {
    text: '复制',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = '已复制';
        setTimeout(() => {
          copyBtn.textContent = '复制';
        }, 1200);
      } catch {
        copyBtn.textContent = '复制失败';
      }
    },
  });
  const btns = [copyBtn];
  if (opts.onAskAI) {
    btns.push(
      el('button.btn.ghost.tiny', {
        text: '问 AI',
        onclick: () => opts.onAskAI(`这段代码在做什么？有没有跟当前工程版本不匹配的地方？\n\n\`\`\`${lang}\n${code}\n\`\`\``),
      }),
    );
  }
  // 只有 Java 片段能插进 Java 锚点；json / gradle 之类给这个按钮只会误导
  if (opts.onInstallHook && String(lang || '').toLowerCase() === 'java') {
    btns.push(
      el('button.btn.ghost.tiny', {
        text: '装成钩子',
        title: '预览并确认后，把这段 Java 装成当前工程的代码钩子',
        onclick: () => opts.onInstallHook(code),
      }),
    );
  }
  return el('div.code-block', {}, el('div.code-head', {}, el('span.code-lang', { text: lang || 'text' }), el('div.spacer'), ...btns), body);
}

/**
 * 主入口。
 * @param {string} text markdown 原文
 * @param {{onAskAI?: (q: string) => void}} opts
 */
export function renderMarkdown(text, opts = {}) {
  const wrap = el('div.md-body');
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let buf = [];

  const flushParagraph = () => {
    const t = buf.join('\n').trim();
    buf = [];
    if (!t) return;
    if (/^\s*>/.test(t)) {
      const inner = t
        .split('\n')
        .map((l) => l.replace(/^\s*>\s?/, ''))
        .join('\n');
      wrap.appendChild(el('blockquote.md-quote', {}, renderMarkdown(inner, opts)));
      return;
    }
    wrap.appendChild(el('p', {}, inline(t)));
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushParagraph();
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      wrap.appendChild(codeBlock(lang, code.join('\n'), opts));
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushParagraph();
      const level = h[1].length;
      wrap.appendChild(el(`h${Math.min(level + 1, 5)}.md-h`, { text: h[2].trim() }));
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      wrap.appendChild(el('hr.md-hr'));
      i++;
      continue;
    }

    // 表格：连续的 | 行
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const cells = (row) =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells); // 第二行是 |---|
      const table = el('table.md-table');
      const thead = el('thead');
      const tr = el('tr');
      for (const c of head) tr.appendChild(el('th', {}, inline(c)));
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = el('tbody');
      for (const r of body) {
        const row = el('tr');
        for (let k = 0; k < head.length; k++) row.appendChild(el('td', {}, inline(r[k] || '')));
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      wrap.appendChild(el('div.md-table-wrap', {}, table));
      continue;
    }

    // 列表
    const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      flushParagraph();
      const ordered = /\d+\./.test(li[1]);
      const list = el(ordered ? 'ol.md-list' : 'ul.md-list');
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        list.appendChild(el('li', {}, inline(m[2])));
        i++;
      }
      wrap.appendChild(list);
      continue;
    }

    // 空行：段落结束
    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    buf.push(line);
    i++;
  }
  flushParagraph();
  return wrap;
}
