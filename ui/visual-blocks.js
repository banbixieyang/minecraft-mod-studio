/**
 * 积木的 DOM 渲染 —— 按 Scratch 的连接模型组织。
 *
 * Scratch 有四种连接点（见 scratch-blocks 的 core/connection.js）：
 *   INPUT_VALUE   值输入口（圆形/方形/六边形凹槽）  ← OUTPUT_VALUE
 *   OUTPUT_VALUE  值积木的凸头（reporter / boolean）
 *   NEXT_STATEMENT     语句底下的凸槽              ← PREVIOUS_STATEMENT
 *   PREVIOUS_STATEMENT 语句顶上的缺口
 * 另外 C 型积木（if / repeat）有一个「嘴」，if-else 有两个（E 型）。
 *
 * 我们照这个模型渲染，但不画 SVG，而是用 DOM 上的连接点标记：
 *   .vb-insert  语句之前（插到链中间，对应 NEXT/PREVIOUS 配对）
 *   .vb-append  链的末尾（接在最后一条下面）
 *   .vb-input-block 值输入口（可嵌值型/条件型积木）
 *   .vb-body    C 型 / E 型的「嘴」，里面是一条完整语句链
 *
 * ## 数据流（重要）
 *
 * **数据模型是唯一真相源，DOM 只是它的渲染结果。**
 * 每条渲染出来的积木都带一个「模型路径」（data-path），形如
 * `0.next.next.inputs:cond.inputs:a` —— 能一路指到任意深度的嵌套节点。
 * 任何编辑都通过路径改模型再重绘；反过来「改 DOM 再读回」在重绘时会丢值
 * （这个坑真的踩过）。
 */

/** 形状 → CSS 类（形状本身就是类型提示，跟 Scratch 一样） */
const SHAPE_CLASS = {
  hat: 'vb-hat',
  stack: 'vb-stack',
  reporter: 'vb-reporter',
  boolean: 'vb-boolean',
};

/** 分类 → 颜色（不同分类一个颜色，小朋友好认） */
const CATEGORY_COLOR = {
  event: '#c94f4f',
  player: '#4a7fd4',
  world: '#4aa36b',
  block: '#8a6bd4',
  flow: '#d4882a',
  logic: '#3aa8a0',
  math: '#c96f9e',
  text: '#6b7a8f',
  var: '#b58a2b',
  custom: '#5a6472',
  raw: '#7b8494',
  misc: '#5a6472',
};

/** 拖拽载荷的 MIME */
export const DRAG_TYPE = 'application/x-mcstudio-block';

/** 积木定义表（id → 定义），由 visual.js 从后端拉好后塞进来 */
let defs = new Map();

export function setDefs(list) {
  defs = new Map();
  for (const d of list || []) defs.set(d.id, d);
}

export function getDef(id) {
  return defs.get(id) || null;
}

export function colorOf(category) {
  return CATEGORY_COLOR[category] || '#5a6472';
}

/** 小工具：造元素并挂属性 */
function h(tag, cls, attrs = {}, children = []) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of children) n.append(c);
  return n;
}

/** 拼子路径 */
export function childPath(parent, seg) {
  return parent === undefined || parent === null || parent === '' ? seg : `${parent}.${seg}`;
}

/**
 * 渲染一个连接点标记。
 * 属性全部写进 dataset，拖拽引擎读它决定往哪儿放。
 */
function dropPoint(kind, attrs, text) {
  const n = h('div', `vb-drop-point vb-${kind}`, {
    'data-drop': kind,
    ...attrs,
  });
  if (text) n.append(h('span', 'vb-drop-hint', { text }));
  return n;
}

/**
 * 渲染一条积木。
 *
 * @param {object} node 积木实例 { op, inputs, fields, body, elseBody, next }
 * @param {object} opts
 * @param {string}  [opts.path]       模型路径（写进 data-path）
 * @param {boolean} [opts.draggable]  是否可拖动（默认 true）
 * @param {boolean} [opts.inChain]    是否处在语句链上（有上缺口/下凸槽）
 */
export function renderBlock(node, opts = {}) {
  const def = defs.get(node.op);
  const shape = def?.shape || 'stack';
  const shell = h('div', `vb ${SHAPE_CLASS[shape] || 'vb-stack'}${opts.inChain ? ' vb-in-chain' : ''}`, {
    'data-op': node.op || '',
    draggable: opts.draggable === false ? false : true,
  });
  shell.style.setProperty('--vb-color', def?.color || colorOf(def?.category));

  if (def && !def.supported) shell.classList.add('vb-unsupported');
  if (def?.requiresMod) {
    shell.classList.add('vb-requires-mod');
    shell.title = `需要安装 ${def.requiresMod} 这个 mod 才能编译`;
  }
  if (opts.path !== undefined && opts.path !== null) shell.dataset.path = opts.path;

  // ---------- 积木头（标签 + 参数槽 + 菜单） ----------
  const head = h('div', 'vb-head');
  if (def?.icon) head.append(h('span', 'vb-icon', { text: def.icon }));
  for (const part of splitLabel(def?.label || node.op || '')) {
    if (part.text !== undefined) {
      if (part.text) head.append(h('span', 'vb-text', { text: part.text }));
    } else {
      head.append(renderInput(node, (def?.inputs || []).find((i) => i.name === part.name), part.name, opts.path));
    }
  }
  for (const f of def?.fields || []) head.append(renderField(node, f));
  shell.append(head);

  // ---------- C 型 / E 型容器的「嘴」 ----------
  // bodySlots 由后端 registry.mjs 算好（显式声明优先，否则从模板 %body 推断）。
  for (const slotName of def?.bodySlots || []) {
    const slot = h('div', `vb-body vb-body-${slotName}`, { 'data-slot': slotName });
    const kids = node[slotName] || [];
    renderSequence(slot, kids, childPath(opts.path, `body:${slotName}`), {
      emptyAt: opts.path,
      emptySlot: slotName,
      emptyText: slotName === 'elseBody' ? '把「否则」的积木拖到这里' : '把积木拖到这里',
    });
    shell.append(slot);
  }

  return shell;
}

/**
 * 渲染一条语句链（沿 next 一路走），展平成兄弟 DOM 节点。
 *
 * 每条语句前面有一个「插到这里」的连接点，末尾有一个「接在后面」的连接点。
 * 这样能像 Scratch 一样把积木插进链的**中间**，而不是只能接链尾。
 *
 * @param {HTMLElement} host   容纳这些节点的容器
 * @param {object} first       链首节点
 * @param {string} firstPath   链首的模型路径
 * @param {object} opts
 * @param {string} [opts.emptyAt]    链为空时，append 指向的宿主路径
 * @param {string} [opts.emptySlot]  链为空时，append 写入的字段名（'next' 或容器名）
 * @param {string} [opts.emptyText]  空链提示
 * @returns {string} 链尾节点的路径（空链返回 ''）
 */
export function renderChain(host, first, firstPath, opts = {}) {
  let cur = first;
  let path = firstPath;
  let guard = 0;
  let tailPath = '';
  while (cur && cur.op && guard++ < 300) {
    host.append(dropPoint('insert', {
      'data-at': path,
      'data-kind': 'statement',
    }));
    host.append(renderBlock(cur, { path, inChain: true }));
    tailPath = path;
    cur = cur.next;
    path = childPath(path, 'next');
  }
  if (!tailPath) {
    host.append(dropPoint('append', {
      'data-at': opts.emptyAt ?? '',
      'data-slot': opts.emptySlot ?? 'next',
      'data-kind': 'statement',
    }, opts.emptyText || '把积木拖到这里'));
  } else {
    host.append(dropPoint('append', {
      'data-at': tailPath,
      'data-kind': 'statement',
    }));
  }
  return tailPath;
}

/**
 * 渲染容器里的序列。
 *
 * ⚠️ 序列有两种历史形态，都必须支持：
 *   · 数组本身是序列（每个元素独立）—— 界面往 body 拖积木就是这个形态
 *   · 第一个元素的 next 链继续往下 —— 反编译器产出的是这个形态
 * 编译器 compileSequence() 同样兼容两种，这里逐个元素走 next 链渲染。
 */
export function renderSequence(host, list, basePath, opts = {}) {
  const arr = Array.isArray(list) ? list : [];
  let rendered = 0;
  arr.forEach((first, i) => {
    if (!first || !first.op) return;
    const p = `${basePath}:${i}`;
    const tail = renderChain(host, first, p, {
      emptyText: opts.emptyText,
      emptyAt: opts.emptyAt,
      emptySlot: opts.emptySlot,
    });
    if (tail) rendered++;
  });
  if (!rendered) {
    host.append(dropPoint('append', {
      'data-at': opts.emptyAt ?? '',
      'data-slot': opts.emptySlot ?? 'body',
      'data-kind': 'statement',
    }, opts.emptyText || '把积木拖到这里'));
  }
}

/**
 * 渲染一个输入槽。
 *
 * 跟 Scratch 一样，**所有值槽都能嵌积木**：
 *   · 数字/文本槽 → 圆形/方形，放 reporter
 *   · 条件槽（accept 含 boolean）→ 六边形，放 boolean
 * 槽里没积木时保留原来的输入框 / 真假按钮（可直接打字），
 * 一旦拖进积木就被替换掉；把积木拖走会自动恢复默认输入框。
 */
function renderInput(node, inp, name, ownerPath) {
  const wrap = h('span', 'vb-input', { 'data-input': name });
  if (!inp) return h('span', 'vb-input vb-input-raw', { text: `%${name}` });

  const cur = node.inputs?.[name];
  const accept = inp.accept || [];
  const isBool = accept.includes('boolean');
  // 条件积木只能放进明确声明 boolean 的槽；值积木能放进任意值槽
  const acceptAttr = isBool ? 'boolean' : (accept.includes('reporter') ? 'reporter' : 'value');

  const holder = h('span', `vb-input-block${isBool ? ' vb-input-bool' : ''}`, {
    'data-drop': 'input',
    'data-at': ownerPath ?? '',
    'data-input': name,
    'data-accept': acceptAttr,
    'data-kind': inp.kind || 'text',
  });

  if (cur && cur.op) {
    // 槽里已经嵌了积木 —— 递归渲染，并给它完整路径（支持无限嵌套）
    holder.append(renderBlock(cur, {
      path: childPath(ownerPath, `inputs:${name}`),
      inChain: false,
    }));
    wrap.append(holder);
    return wrap;
  }

  if (isBool) {
    const chip = h('button', 'vb-bool-chip', {
      type: 'button',
      'data-input': name,
      'data-value': cur?.value === true ? 'true' : 'false',
      draggable: false,
    });
    chip.textContent = cur?.value === true ? '真' : '假';
    holder.append(chip);
  } else {
    // 普通值槽：保留可编辑的输入框，同时它所在的 holder 能接收拖进来的值积木
    const input = h('input', 'vb-input-field', {
      type: inp.kind === 'number' ? 'number' : 'text',
      'data-input': name,
      'data-kind': inp.kind || 'text',
      placeholder: inp.default ?? '',
      draggable: false,
    });
    input.value = cur?.value ?? inp.default ?? '';
    holder.append(input);
  }
  wrap.append(holder);
  return wrap;
}

/** 渲染一个菜单字段（下拉） */
function renderField(node, f) {
  const wrap = h('span', 'vb-field');
  const sel = h('select', 'vb-field-select', { 'data-field': f.name, draggable: false });
  const cur = node.fields?.[f.name] ?? f.default;
  for (const opt of f.options || []) {
    const value = (opt && typeof opt === 'object') ? opt.value : opt;
    const label = (opt && typeof opt === 'object') ? (opt.label ?? opt.value) : opt;
    sel.append(h('option', '', { value: String(value), text: String(label) }));
  }
  const curVal = (cur && typeof cur === 'object') ? cur.value : cur;
  if (curVal !== undefined && curVal !== null && ![...sel.options].some((o) => o.value === String(curVal))) {
    sel.append(h('option', '', { value: String(curVal), text: String(curVal) }));
  }
  sel.value = String(curVal ?? '');
  wrap.append(sel);
  return wrap;
}

/**
 * 把标签拆成「文字」和「%占位符」两类的序列。
 * 例：「给玩家 %count 个 %item」→ [文字"给玩家 ", %count, 文字" 个 ", %item]
 */
export function splitLabel(label) {
  const out = [];
  const re = /%\{?(\w+)\}?/g;
  let last = 0;
  let m;
  while ((m = re.exec(label)) !== null) {
    if (m.index > last) out.push({ text: label.slice(last, m.index) });
    out.push({ name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < label.length) out.push({ text: label.slice(last) });
  return out;
}
