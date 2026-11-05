/**
 * 通用 DOM 工具。没有框架，也不需要。
 */

/** 建元素：el('div.cls#id', {attr}, ...children) */
export function el(spec, attrs = {}, ...children) {
  // 防呆：第二个参数是「属性对象」。
  // 万一有人把子节点写在了第二个位置（el('div.card', el('div.card-head', …))），
  // Object.entries(节点) 会枚举出它的子元素，结果整块内容变成属性、悄悄消失。
  // 这里把它挪回子节点位置，避免内容无声无息地丢掉。
  if (attrs instanceof Node) {
    children.unshift(attrs);
    attrs = {};
  }
  const [tagPart, ...classes] = String(spec).split('.');
  const [tag, id] = tagPart.includes('#') ? tagPart.split('#') : [tagPart, null];
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = `${node.className} ${v}`.trim();
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readonly') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function setChildren(node, ...children) {
  clear(node);
  for (const c of children.flat(9)) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

/**
 * 追加子节点，自动跳过 null / undefined / false。
 *
 * 为什么需要这个：原生 `node.append(null)` 会插入一个内容为 "null" 的文本节点。
 * 而「有条件地渲染一段」最自然的写法就是 `cond ? el(...) : null`，
 * 一旦用了 append 就会在界面上留下一行 null。所有条件渲染一律走这里。
 */
export function fill(node, ...children) {
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * 清空后重新填 —— 用于「每次重渲染都复用同一个容器」的场景。
 *
 * 和 fill 的区别只有一行，但搞混的后果很具体：知识库目录每渲染一次就把整棵树
 * 再追加一遍，46 篇变成 92 项，点哪个都像是点到了旧的那份；
 * 正文区则会把「载入中…」「左边选一篇看」永远留在页面上。
 * 新写的界面如果容器是常驻的，用这个，不要用 fill。
 */
export function setContent(node, ...children) {
  node.replaceChildren();
  return fill(node, ...children);
}

// ---------------- 提示 ----------------
let toastHost = null;

export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div.toasts');
    document.body.append(toastHost);
  }
  const item = el(`div.toast.${kind}`, {}, el('span', { text: message }));
  toastHost.append(item);
  requestAnimationFrame(() => item.classList.add('in'));
  setTimeout(() => {
    item.classList.remove('in');
    setTimeout(() => item.remove(), 260);
  }, ms);
  return item;
}

// ---------------- 对话框 ----------------
export function modal({ title, body, actions = [], width = 520 }) {
  const host = el('div.modal-host');
  const close = () => host.remove();
  const box = el('div.modal', { style: { width: `${width}px` } });
  box.append(
    el('div.modal-head', {}, el('h3', { text: title }), el('button.icon-btn', { onclick: close, title: '关闭', text: '✕' })),
    el('div.modal-body', {}, body),
  );
  if (actions.length) {
    const bar = el('div.modal-foot');
    for (const a of actions) {
      bar.append(
        el(`button.btn${a.kind ? '.' + a.kind : ''}`, {
          onclick: async () => {
            const r = await a.onClick?.();
            if (r !== false) close();
          },
        }, a.label),
      );
    }
    box.append(bar);
  }
  host.append(box);
  host.addEventListener('mousedown', (e) => {
    if (e.target === host) close();
  });
  document.body.append(host);
  return { close, box };
}

export function confirmBox(message, { title = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: el('p.confirm-text', { text: message }),
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => resolve(false) },
        { label: '确定', kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
      width: 420,
    });
    m.box.addEventListener('remove', () => resolve(false));
  });
}

export function promptBox(label, value = '', { title = '输入', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const input = el('input.input', { value, placeholder });
    const m = modal({
      title,
      body: el('label.field-label', {}, el('span', { text: label }), input),
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => resolve(null) },
        { label: '确定', kind: 'primary', onClick: () => resolve(input.value.trim()) },
      ],
      width: 420,
    });
    setTimeout(() => input.focus(), 30);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        resolve(input.value.trim());
        m.close();
      }
    });
  });
}

// ---------------- 杂项 ----------------
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${s % 60} 秒`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
