/**
 * 轻量代码编辑器：textarea 叠在高亮层上。
 *
 * 不引 CodeMirror / Monaco 的理由很简单：要能离线跑、要能塞进任何壳里，
 * 而且我们的场景只需要关键词高亮 + 行号 + Tab 缩进。
 */
import { el, setChildren } from './ui.js';

const JAVA_KEYWORDS = /\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|record|var)\b/g;
const JAVA_TYPES = /\b(String|Integer|Boolean|Object|List|Map|Set|Optional|Override|Item|Block|ItemStack|Identifier|Component|Level|Player|ServerPlayer|ItemStack|Properties)\b/g;

function highlight(code, lang) {
  let s = escape(code);
  if (lang === 'java') {
    s = s
      .replace(/(\/\/[^\n]*)/g, '<span class="c-comment">$1</span>')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="c-comment">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="c-string">$1</span>')
      .replace(JAVA_KEYWORDS, '<span class="c-key">$1</span>')
      .replace(JAVA_TYPES, '<span class="c-type">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?F?)\b/g, '<span class="c-num">$1</span>');
  } else if (lang === 'json') {
    s = s
      .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="c-key">$1</span>:')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="c-string">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="c-key">$1</span>')
      .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="c-num">$1</span>');
  } else if (lang === 'js') {
    s = s
      .replace(/(\/\/[^\n]*)/g, '<span class="c-comment">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="c-string">$1</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|of|in|new|class|export|default|import|from|await|async|try|catch|throw|typeof)\b/g, '<span class="c-key">$1</span>');
  }
  return s;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function langOf(path) {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.json')) return 'json';
  if (/\.(mjs|js)$/.test(path)) return 'js';
  return 'text';
}

/**
 * 创建一个代码编辑器。
 * @returns { node, getValue(), setValue(v), onChange(fn) }
 */
export function createCodeEditor({ value = '', path = '', readOnly = false, onSave } = {}) {
  const lang = langOf(path);
  const pre = el('pre.code-highlight');
  const codeEl = el('code');
  pre.append(codeEl);

  const ta = el('textarea.code-input', { spellcheck: 'false', wrap: 'off' });
  ta.value = value;
  if (readOnly) ta.readOnly = true;

  const gutter = el('div.code-gutter');
  const wrap = el('div.code-editor', {}, gutter, el('div.code-scroll', {}, pre, ta));

  const paint = () => {
    const text = ta.value;
    codeEl.innerHTML = highlight(text, lang) + '\n';
    const lines = text.split('\n').length;
    setChildren(gutter);
    for (let i = 1; i <= lines; i++) gutter.append(el('div', { text: String(i) }));
    syncScroll();
  };

  const syncScroll = () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  };

  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('input', paint);

  // Tab 缩进、自动补右括号
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      ta.value = `${ta.value.slice(0, s)}    ${ta.value.slice(en)}`;
      ta.selectionStart = ta.selectionEnd = s + 4;
      paint();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave?.(ta.value);
    }
    if (e.key === 'Enter') {
      // 保持缩进
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const indent = (ta.value.slice(lineStart, s).match(/^\s*/) || [''])[0];
      if (indent) {
        e.preventDefault();
        ta.value = `${ta.value.slice(0, s)}\n${indent}${ta.value.slice(ta.selectionEnd)}`;
        ta.selectionStart = ta.selectionEnd = s + 1 + indent.length;
        paint();
      }
    }
  });

  paint();

  return {
    node: wrap,
    getValue: () => ta.value,
    setValue: (v) => {
      ta.value = v;
      paint();
    },
    focus: () => ta.focus(),
  };
}

/**
 * 代码查看/编辑弹窗。
 */
export async function openCodeModal({ path, value, readOnly = false, onSave, extraActions = [] }) {
  const { modal, toast } = await import('./ui.js');
  const editor = createCodeEditor({ value, path, readOnly, onSave: (v) => save(v) });

  let saving = false;
  const save = async (v) => {
    if (!onSave || saving) return;
    saving = true;
    try {
      await onSave(v);
      toast('已保存', 'ok', 1500);
    } catch (e) {
      toast(`保存失败：${e.message}`, 'error');
    } finally {
      saving = false;
    }
  };

  const m = modal({
    title: path,
    body: el('div.code-modal-body', {}, editor.node),
    actions: [
      ...extraActions,
      { label: '关闭', kind: 'ghost' },
      ...(readOnly ? [] : [{ label: '保存 (Ctrl+S)', kind: 'primary', onClick: () => save(editor.getValue()) }]),
    ],
    width: Math.min(1000, window.innerWidth - 80),
  });

  setTimeout(() => editor.focus(), 60);
  return m;
}
