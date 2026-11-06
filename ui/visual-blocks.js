/**
 * 积木的 DOM 渲染。
 *
 * 一个积木 = 一个 div，形状分四种：
 *   hat      帽形 —— 程序起点
 *   stack    积木 —— 语句，能接 next
 *   reporter 圆角 —— 值，能塞进 inputs
 *   boolean  六边形 —— 条件，能塞进 inputs
 *
 * ## 数据流（重要）
 *
 * **数据模型是唯一真相源，DOM 只是它的渲染结果。**
 *
 * 每条渲染出来的积木都带一个「模型路径」（data-path），
 * 形如 `0.next.next.inputs.text` —— 指向它在模型里的位置。
 * 用户的任何编辑（改输入框、拖积木、点真/假）都通过路径
 * 找到模型节点并**直接改模型**，然后重绘。
 *
 * 为什么不反过来（改 DOM 再读回）：
 *   改 DOM 再读回，遇到「重绘」就会丢数据 ——
 *   用户改了输入框 → 又加了一条积木 → 重绘从模型拿数据，
 *   而模型里还是旧值，改动凭空消失。
 *   这个坑真的踩过（探针测出来「预览里没有小朋友你好」）。
 */

/** 形状 → CSS 类 */
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

/**
 * 积木定义表（id → 定义）。
 * 由 visual.js 从后端拉好后塞进来。
 */
let defs = new Map();

export function setDefs(list) {
  defs = new Map();
  for (const d of list || []) defs.set(d.id, d);
}

export function getDef(id) {
  return defs.get(id) || null;
}

/** 分类颜色 */
export function colorOf(category) {
  return CATEGORY_COLOR[category] || '#5a6472';
}

/**
 * 渲染一条积木。
 *
 * @param {object} node 积木实例 { op, inputs, fields, body, elseBody, next }
 * @param {object} opts
 * @param {string}  [opts.path]  模型路径（写进 data-path）
 * @param {string}  [opts.dragSource] 拖拽来源标记（'palette' 或 'canvas'）
 * @returns {HTMLElement}
 */
export function renderBlock(node, opts = {}) {
  const def = defs.get(node.op);
  const shell = document.createElement('div');
  shell.className = `vb ${SHAPE_CLASS[def?.shape] || 'vb-stack'}`;
  // 颜色优先用后端给的分类色（库的分类也可能带自己的颜色），
  // 没有就退回前端按分类 id 的映射。
  const color = def?.color || colorOf(def?.category);
  shell.style.setProperty('--vb-color', color);

  // 没实现的积木标灰 —— 让用户知道「这条在当前目标下编译不了」
  if (def && !def.supported) shell.classList.add('vb-unsupported');
  // 依赖某个 mod 的积木打个角标
  if (def?.requiresMod) {
    shell.classList.add('vb-requires-mod');
    shell.title = `需要安装 ${def.requiresMod} 这个 mod 才能编译`;
  }

  shell.dataset.op = node.op || '';
  if (opts.path !== undefined) shell.dataset.path = opts.path;
  if (opts.dragSource) shell.dataset.dragSource = opts.dragSource;

  // ---------- 积木头（标签 + 参数槽） ----------
  const head = document.createElement('div');
  head.className = 'vb-head';

  if (def?.icon) {
    const icon = document.createElement('span');
    icon.className = 'vb-icon';
    icon.textContent = def.icon;
    head.append(icon);
  }

  // 标签里带 %name 的占位 —— 那些位置要换成真正的输入控件
  const parts = splitLabel(def?.label || node.op || '');
  for (const part of parts) {
    if (part.text !== undefined) {
      if (!part.text) continue;
      const span = document.createElement('span');
      span.className = 'vb-text';
      span.textContent = part.text;
      head.append(span);
      continue;
    }
    // %name —— 找对应的输入定义
    const inp = (def?.inputs || []).find((i) => i.name === part.name);
    head.append(renderInput(node, inp, part.name));
  }

  // 菜单字段（%mode 之类）—— 放在标签后面
  for (const f of def?.fields || []) {
    head.append(renderField(node, f));
  }

  shell.append(head);

  // ---------- 容器（body 槽） ----------
  // bodySlots 由后端给出（registry.mjs 的 serializeBlock 算好了）：
  // 显式声明的优先，没声明就从 java 模板里的 %body / %elseBody 标记推。
  const slots = def?.bodySlots?.length ? def.bodySlots : [];
  for (const slotName of slots) {
    const slot = document.createElement('div');
    slot.className = `vb-body vb-body-${slotName}`;
    slot.dataset.slot = slotName;
    const kids = node[slotName] || [];
    kids.forEach((kid, i) => {
      slot.append(renderBlock(kid, {
        dragSource: 'canvas',
        path: childPath(opts.path, `body:${slotName}:${i}`),
      }));
    });
    // 空容器给一个提示，放得进去
    if (!kids.length) {
      const hint = document.createElement('div');
      hint.className = 'vb-body-hint';
      hint.textContent = slotName === 'elseBody' ? '放「否则」的积木' : '把积木拖到这里';
      slot.append(hint);
    }
    shell.append(slot);
  }

  return shell;
}

/** 拼子路径 */
function childPath(parent, seg) {
  return parent === undefined || parent === null ? seg : `${parent}.${seg}`;
}

/**
 * 渲染一个输入槽。
 *
 * 槽分三类：
 *   · 值槽（text/number/...）—— 一个小输入框
 *   · 条件槽（accept 含 boolean）—— 空槽，可以放条件积木，也可以点「真/假」
 *   · 值积木槽（accept 含 reporter）—— 空槽，放值型积木
 *
 * ⚠️ 能放积木的槽**永远**要有 .vb-input-block 这个容器 ——
 *    之前只在「槽里已经有积木」时才加这个类，导致空槽根本没法接收拖进来的积木。
 */
function renderInput(node, inp, name) {
  const wrap = document.createElement('span');
  wrap.className = 'vb-input';
  wrap.dataset.input = name;

  if (!inp) {
    // 定义里没这个输入（标签与 inputs 不一致）—— 原样显示占位符
    wrap.classList.add('vb-input-raw');
    wrap.textContent = `%${name}`;
    return wrap;
  }

  const cur = node.inputs?.[name];

  // ---- 能放积木的槽 ----
  const accept = inp.accept || [];
  if (accept.includes('boolean') || accept.includes('reporter')) {
    const isBool = accept.includes('boolean');
    const holder = document.createElement('span');
    holder.className = `vb-input-block${isBool ? ' vb-input-bool' : ''}`;
    holder.dataset.kind = isBool ? 'boolean' : 'reporter';

    if (cur && cur.op) {
      holder.append(renderBlock(cur, { dragSource: 'canvas' }));
    } else if (isBool) {
      // 空条件槽：给一个「真/假」的小按钮，点一下就能切换
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'vb-bool-chip';
      chip.dataset.input = name;
      chip.dataset.value = cur?.value === true ? 'true' : 'false';
      chip.textContent = chip.dataset.value === 'true' ? '真' : '假';
      holder.append(chip);
    } else {
      const ph = document.createElement('span');
      ph.className = 'vb-slot-empty';
      ph.textContent = '放积木';
      holder.append(ph);
    }
    wrap.append(holder);
    return wrap;
  }

  // ---- 普通值槽 ----
  const kind = inp.kind || 'text';
  const input = document.createElement('input');
  input.className = 'vb-input-field';
  input.type = kind === 'number' ? 'number' : 'text';
  input.value = cur?.value ?? inp.default ?? '';
  input.dataset.input = name;
  input.dataset.kind = kind;
  input.placeholder = inp.default ?? '';
  wrap.append(input);
  return wrap;
}

/** 渲染一个菜单字段（下拉） */
function renderField(node, f) {
  const wrap = document.createElement('span');
  wrap.className = 'vb-field';

  const sel = document.createElement('select');
  sel.className = 'vb-field-select';
  sel.dataset.field = f.name;

  const cur = node.fields?.[f.name] ?? f.default;
  const options = f.options || [];
  for (const opt of options) {
    const o = document.createElement('option');
    // 选项可以是字符串，也可以是 { value, label }
    const value = (opt && typeof opt === 'object') ? opt.value : opt;
    const label = (opt && typeof opt === 'object') ? (opt.label ?? opt.value) : opt;
    o.value = String(value);
    o.textContent = String(label);
    sel.append(o);
  }
  // 当前值不在选项里（库换了 / 老工程）—— 补一个进去，别让用户看到空白
  const curVal = (cur && typeof cur === 'object') ? cur.value : cur;
  if (curVal !== undefined && curVal !== null && ![...sel.options].some((o) => o.value === String(curVal))) {
    const o = document.createElement('option');
    o.value = String(curVal);
    o.textContent = String(curVal);
    sel.append(o);
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
