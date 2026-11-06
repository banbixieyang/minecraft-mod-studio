/**
 * 积木编辑器 —— Scratch 式的可视化编程界面。
 *
 * 三栏布局：
 *   左：积木库（按分类，点一下就加到画布）
 *   中：画布（若干个程序，每个程序一个「事件帽」+ 一串语句）
 *   右：属性（选中积木的说明）+ 编译预览
 *
 * ## 与手写代码的关系（用户最关心的那点）
 *
 * 这里的每一条积木最终都编译成真 Java，写进工程的 custom/ 目录，
 * 跟手写的 Java 类一样参与构建。画布上点「编译预览」能立刻看到结果。
 *
 * ## 数据流
 *
 * **模型是唯一真相源。** V.programs 里存的就是完整数据。
 * 每次用户操作 → 直接改模型 → 重绘整个画布。
 * （反过来「改 DOM 再读回」会在重绘时丢数据，这个坑踩过。）
 */
import { api } from './api.js';
import { el, setChildren, setContent, fill, toast, modal, confirmBox } from './ui.js';
import {
  renderBlock, renderChain, setDefs, getDef, colorOf, DRAG_TYPE,
} from './visual-blocks.js';
import { makeGuideSteps } from './visual-guide.js';

const V = {
  ctx: null,
  host: null,
  categories: [],        // 后端给的积木清单（分类）
  defMap: new Map(),     // id → 定义
  programs: [],          // 积木程序（模型）
  selectedPath: null,    // 选中积木的模型路径
  targetId: 'fabric-26.3',
  dragging: null,       // { op, from: 'palette'|'canvas', path }
  dropPoint: null,      // 当前高亮的连接点
  filter: '',
  openCat: 'event',
  preview: null,
  libraries: [],
  /** 入门向导：{ open, step } */
  guide: { open: false, step: 0 },
};

export function renderVisualPanel(ctx) {
  V.ctx = ctx;
  V.host = el('div.full-panel.visual-panel');
  V.targetId = ctx.project?.target?.id || 'fabric-26.3';
  V.programs = [];
  V.selectedPath = null;

  fill(V.host,
    el('div.panel-bar', {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回'),
      el('h2.panel-title', { text: '积木编程' }),
      el('span.muted.small', { text: '拖积木拼程序，生成真 Java' }),
      el('div.spacer'),
      el('button.btn.ghost.small', {
        title: '第一次用？跟着一步步来',
        onclick: () => { V.guide.open = true; V.guide.step = 0; renderGuide(); },
      }, '❓ 入门'),
      el('button.btn.ghost.small', { onclick: openCustomBlock }, '代码造积木'),
      el('button.btn.ghost.small', { onclick: openExportBlocks }, '导出积木'),
      el('button.btn.ghost.small', { onclick: openLibraryManager }, '积木库'),
      el('button.btn.ghost.small', { onclick: () => refreshPreview() }, '编译预览'),
      el('button.btn.small', { onclick: () => savePrograms(true) }, '保存'),
    ),
  );

  const body = el('div.visual-body');
  V.host.append(body);

  const palette = el('div.visual-palette');
  const canvas = el('div.visual-canvas');
  const side = el('div.visual-side');

  setChildren(body, palette, canvas, side);
  V.paletteHost = palette;
  V.canvasHost = canvas;
  V.sideHost = side;

  // 拖出删除区：跟 Scratch 一样，把积木拖离脚本就丢掉。
  // 放在 body 上而不是 canvas 里 —— renderCanvas() 会清空 canvas。
  V.trashHost = el('div.vb-trash', {}, '🗑 拖到这里删除积木');
  body.append(V.trashHost);

  // 入门向导住在左栏最上面 —— 它讲的每一步都是「点左边哪儿」，
  // 放在积木盒上面，用户上下扫一眼就能对照着做。
  V.guideHost = el('div.vb-guide-host');
  palette.append(V.guideHost);

  // 参数编辑：事件委托（画布会频繁重绘，逐个绑定会漏）
  canvas.addEventListener('input', onEditInput);
  canvas.addEventListener('change', onEditChange);
  canvas.addEventListener('click', onEditBool);

  // 拖拽：整块画布一层委托。画布频繁重绘，逐块绑定会漏；
  // 而且连接点跨积木、跨容器，统一在顶层判断兼容性最稳。
  canvas.addEventListener('dragstart', onDragStart);
  canvas.addEventListener('dragover', onDragOver);
  canvas.addEventListener('drop', onDrop);
  canvas.addEventListener('dragend', onDragEnd);
  canvas.addEventListener('dragleave', (e) => {
    if (!canvas.contains(e.relatedTarget)) clearDropPoint();
  });
  // 在输入框里选文字时别把整块积木拖走
  canvas.addEventListener('mousedown', (e) => {
    const vb = e.target.closest?.('.vb');
    if (vb && e.target.closest('input,select,button')) {
      vb.dataset.tempNoDrag = '1';
      vb.setAttribute('draggable', 'false');
    }
  });
  canvas.addEventListener('mouseup', () => {
    canvas.querySelectorAll('.vb[data-temp-no-drag]').forEach((n) => {
      delete n.dataset.tempNoDrag;
      if (getDef(n.dataset.op)?.shape !== 'hat') n.setAttribute('draggable', 'true');
    });
  });
  V.trashHost.addEventListener('dragover', (e) => {
    if (!V.dragging || V.dragging.from !== 'canvas') return;
    e.preventDefault();
    V.trashHost.classList.add('vb-trash-hot');
    clearDropPoint();
  });
  V.trashHost.addEventListener('dragleave', () => V.trashHost.classList.remove('vb-trash-hot'));
  V.trashHost.addEventListener('drop', (e) => {
    e.preventDefault();
    V.trashHost.classList.remove('vb-trash-hot');
    const d = V.dragging;
    if (d?.from === 'canvas' && d.path) {
      detachAt(d.path);
      V.selectedPath = null;
      renderCanvas();
      renderSide();
      toast('已删除积木');
    }
    V.dragging = null;
  });

  renderSide();
  load();

  return V.host;
}

/**
 * 输入框改了 → 直接写回模型。
 *
 * ⚠️ 必须立刻写模型：画布任何一次重绘都是从模型重画的，
 *    只改 DOM 的话，重绘后这个值就没了。
 */
function onEditInput(e) {
  const input = e.target.closest?.('input.vb-input-field');
  if (!input) return;
  const node = nodeAt(input.closest('.vb')?.dataset.path);
  if (!node) return;
  const name = input.dataset.input;
  node.inputs[name] = {
    type: 'value',
    kind: input.dataset.kind || 'text',
    value: input.value,
  };
}

/** 下拉改了 → 写回模型 */
function onEditChange(e) {
  const sel = e.target.closest?.('select.vb-field-select');
  if (!sel) return;
  const node = nodeAt(sel.closest('.vb')?.dataset.path);
  if (!node) return;
  node.fields[sel.dataset.field] = sel.value;
}

/** 「真/假」按钮点了 → 写回模型 */
function onEditBool(e) {
  const chip = e.target.closest?.('button.vb-bool-chip');
  if (!chip) return;
  e.stopPropagation();
  const next = chip.dataset.value !== 'true';
  chip.dataset.value = next ? 'true' : 'false';
  chip.textContent = next ? '真' : '假';
  const node = nodeAt(chip.closest('.vb')?.dataset.path);
  if (!node) return;
  const name = chip.dataset.input;
  node.inputs[name] = { type: 'value', kind: 'boolean', value: next };
}

/** 拉积木清单 + 工程里的程序 */
async function load() {
  setContent(V.canvasHost, el('div.loading', { text: '加载积木库…' }));
  try {
    const root = V.ctx.root;
    const r = await api.visualBlocks(root, V.targetId);
    V.categories = r.categories || [];
    V.libraries = r.libraries || [];
    V.defMap = new Map();
    for (const c of V.categories) {
      for (const b of c.blocks || []) V.defMap.set(b.id, b);
    }
    setDefs([...V.defMap.values()]);
    renderPalette();

    // 没打开工程时也能玩积木 —— 只是不能存
    if (root) {
      const p = await api.visualProgram(root);
      V.programs = p.programs || [];
    } else {
      V.programs = [];
    }
    renderCanvas();
    renderSide();
    renderGuide();
  } catch (e) {
    setContent(V.canvasHost, el('div.empty-hint', { text: `加载失败：${e.message || e}` }));
  }
}

/**
 * 在模型里找第一个 op 匹配的节点。
 *
 * 向导要用它找到「刚才加的那条「对玩家说」」这类目标，
 * 然后直接改模型 —— 跟用户手点是一回事。
 *
 * ⚠️ 顶层是**数组**（一堆程序），所以这里必须先处理数组，
 *    不然在数组根上只查 op/next/body，永远找不到东西。
 */
function findNodeByOp(root, op) {
  if (!root || typeof root !== 'object') return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const r = findNodeByOp(item, op);
      if (r) return r;
    }
    return null;
  }
  if (root.op === op) return root;
  const byNext = findNodeByOp(root.next, op);
  if (byNext) return byNext;
  for (const slot of ['body', 'elseBody']) {
    for (const child of root[slot] || []) {
      const r = findNodeByOp(child, op);
      if (r) return r;
    }
  }
  return null;
}

/** 向导步骤表（只建一次，操作回调在这里注入） */
function guideSteps() {
  if (V._guideSteps) return V._guideSteps;
  V._guideSteps = makeGuideSteps({
    openCategory: (catId) => {
      V.openCat = catId;
      renderPalette();
    },
    addBlock: (op) => {
      const def = V.defMap.get(op);
      if (!def) { toast('这条积木在当前目标下没有实现', 'warn'); return; }
      addToCanvas(def);
    },
    setMessageText: (text) => {
      const node = findNodeByOp(V.programs, 'player.message');
      if (!node) { toast('先加一条「对玩家说」积木', 'warn'); return; }
      node.inputs = node.inputs || {};
      node.inputs.text = { type: 'value', kind: 'text', value: text };
      renderCanvas();
      renderSide();
      // 把光标放到那个框里，用户可以接着改自己的话
      setTimeout(() => {
        const inp = V.canvasHost?.querySelector('input.vb-input-field');
        inp?.focus();
        inp?.select();
      }, 60);
    },
    putInBody: (op) => {
      const holder = findNodeByOp(V.programs, 'flow.if') || findNodeByOp(V.programs, 'flow.if_else');
      if (!holder) { toast('先加一条「如果」积木', 'warn'); return; }
      const def = V.defMap.get(op);
      if (!def) { toast('这条积木在当前目标下没有实现', 'warn'); return; }
      holder.body = holder.body || [];
      holder.body.push(makeNode(def));
      renderCanvas();
      renderSide();
    },
    preview: () => { refreshPreview(); },
    save: () => { savePrograms(true); },
  });
  return V._guideSteps;
}

/** 入门向导面板 */
function renderGuide() {
  const host = V.guideHost;
  if (!host) return;
  if (!V.guide.open) { host.replaceChildren(); return; }

  const steps = guideSteps();
  const i = Math.max(0, Math.min(V.guide.step, steps.length - 1));
  const s = steps[i];

  const dots = el('div.vb-guide-dots');
  steps.forEach((_, k) => {
    dots.append(el('span.vb-guide-dot' + (k === i ? '.on' : k < i ? '.done' : ''), {
      title: `第 ${k + 1} 步`,
      onclick: () => { V.guide.step = k; renderGuide(); },
    }));
  });

  const actions = el('div.vb-guide-actions');
  if (s.action) {
    actions.append(el('button.btn.small.vb-guide-do', {
      title: '向导替你在界面上操作这一步',
      onclick: () => { s.action(); renderGuide(); },
    }, s.do || '带我做'));
  }
  actions.append(el('button.btn.ghost.small', {
    disabled: i === 0,
    onclick: () => { V.guide.step = Math.max(0, i - 1); renderGuide(); },
  }, '上一步'));
  // ⚠️ 最后一步的按钮是「完成」—— 它得能点，而且是收掉向导。
  //    早先按「到头了就禁用」处理，结果最后一步的按钮点不动，
  //    用户以为坏了（这个坑踩过）。
  actions.append(el('button.btn.small', {
    onclick: () => {
      if (s.last) { V.guide.open = false; renderGuide(); return; }
      V.guide.step = Math.min(steps.length - 1, i + 1);
      renderGuide();
    },
  }, s.last ? '完成' : '下一步'));

  // ⚠️ 必须用 setContent（清空后填），不能用 fill ——
  //    fill 是「追加」语义，每次重渲染都会叠一层新面板，
  //    于是 DOM 里躺着好几个向导，点「下一步」动的是最早那个，
  //    界面上却看着像没反应（这个坑踩过）。
  setContent(host, el('div.vb-guide', {},
    el('div.vb-guide-head', {},
      el('span.vb-guide-count', { text: `第 ${i + 1} / ${steps.length} 步` }),
      el('button.icon-btn.vb-guide-close', {
        title: '收起向导',
        onclick: () => { V.guide.open = false; renderGuide(); },
      }, '✕'),
    ),
    dots,
    el('div.vb-guide-title', { text: s.title }),
    el('div.vb-guide-body', { html: s.body }),
    s.tip ? el('div.vb-guide-tip', { text: s.tip }) : null,
    actions,
    el('button.vb-guide-skip', {
      onclick: () => { V.guide.open = false; renderGuide(); },
    }, '不用了，关闭向导'),
  ));
}

/**
 * 打开入门向导。
 *
 * 欢迎页那张「我想用积木搭」的卡会调这个 ——
 * 直接把人送进编辑器并开始教，比先让人读一篇文档友好。
 */
export function openVisualGuide() {
  V.guide.open = true;
  V.guide.step = 0;
  renderGuide();
}

/** 左侧积木库 */
function renderPalette() {
  const host = V.paletteHost;
  if (!host) return;

  const search = el('input.input.vb-search', {
    placeholder: '搜积木…',
    value: V.filter,
    oninput: (e) => {
      V.filter = e.target.value;
      renderPalette();
    },
  });

  const cats = el('div.vb-cats');
  const kw = V.filter.trim().toLowerCase();

  // 「常用」快捷区：条件判断和循环永远露在外面。
  // 之前默认只展开「事件」分类，小朋友根本找不到 if —— 这是最常被问到的一点。
  const byId = new Map();
  for (const c of V.categories) {
    for (const b of c.blocks || []) byId.set(b.id, b);
  }
  const QUICK_IDS = ['flow.if', 'flow.if_else', 'flow.repeat', 'logic.and', 'math.compare', 'player.message'];
  const quickList = el('div.vb-quick-list');
  for (const id of QUICK_IDS) {
    const b = byId.get(id);
    if (b) quickList.append(paletteItem(b, 'vb-quick-item'));
  }
  const quick = el('div.vb-quick', {},
    el('div.vb-quick-title', { text: '常用 · 条件与循环' }),
    quickList,
    el('div.vb-quick-tip', { text: '拖到积木上下的细线上就能插进去；六边形放条件槽，圆形放数字槽。' }),
  );

  for (const c of V.categories) {
    const blocks = (c.blocks || []).filter((b) => {
      if (!kw) return true;
      return `${b.label} ${b.id} ${b.description || ''}`.toLowerCase().includes(kw);
    });
    if (!blocks.length) continue;

    const isOpen = kw ? true : V.openCat === c.id;
    const cat = el('div.vb-cat');
    cat.append(el('button.vb-cat-head', {
      onclick: () => {
        V.openCat = isOpen ? '' : c.id;
        renderPalette();
      },
    },
      el('span.vb-cat-dot', { style: { background: c.color || colorOf(c.id) } }),
      el('span.vb-cat-label', { text: c.label || c.id }),
      el('span.vb-cat-count', { text: String(blocks.length) }),
    ));

    if (isOpen) {
      const list = el('div.vb-cat-list');
      for (const b of blocks) list.append(paletteItem(b));
      cat.append(list);
    }
    cats.append(cat);
  }

  // ⚠️ 用 replaceChildren 而不是 setChildren：
  //    setChildren 会把整个 host 清空重建，向导面板（在 host 第一位）会被冲掉。
  //    所以先把向导那个节点摘出来，再按顺序放回去。
  const guide = V.guideHost;
  host.replaceChildren(...(guide ? [guide, search, quick, cats] : [search, quick, cats]));
}

/** 积木库里的一条积木（点一下加到画布，也能拖） */
function paletteItem(b, cls = 'vb-palette-item') {
  const item = el(`div.${cls}`, {
    draggable: 'true',
    title: b.description || b.label,
    onclick: () => addToCanvas(b),
  });
  item.dataset.op = b.id;
  item.dataset.dragSource = 'palette';
  item.append(el('span.vb-palette-icon', { text: b.icon || '🧩' }));
  item.append(el('span.vb-palette-label', { text: b.label }));
  if (!b.supported) item.classList.add('vb-unsupported');
  if (b.requiresMod) {
    item.classList.add('vb-requires-mod');
    item.append(el('span.vb-mod-tag', { text: b.requiresMod }));
  }

  item.addEventListener('dragstart', (e) => {
    V.dragging = { op: b.id, from: 'palette' };
    e.dataTransfer.setData(DRAG_TYPE, b.id);
    e.dataTransfer.setData('text/plain', b.label || b.id);
    e.dataTransfer.effectAllowed = 'copy';
    item.classList.add('vb-dragging');
    V.canvasHost?.classList.add('vb-drag-now');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('vb-dragging');
    V.dragging = null;
    V.canvasHost?.classList.remove('vb-drag-now');
    V.trashHost?.classList.remove('vb-trash-visible', 'vb-trash-hot');
  });

  return item;
}

/** 中间画布 */
function renderCanvas() {
  const host = V.canvasHost;
  if (!host) return;

  const wrap = el('div.vb-canvas-inner');
  V.programs.forEach((prog, i) => {
    wrap.append(programCard(prog, i));
  });
  if (!V.programs.length) {
    wrap.append(el('div.empty-hint', {
      text: '还没有程序。左边点一个「事件」积木开始 —— 它是程序的起点。',
    }));
  }

  const add = el('div.vb-add-program');
  const evt = V.categories.find((c) => c.id === 'event');
  for (const b of (evt?.blocks || [])) {
    add.append(el('button.btn.ghost.small', {
      onclick: () => addProgram(b),
      title: b.description || b.label,
    }, `${b.icon || '▶'} ${b.label}`));
  }

  setContent(host, wrap, add);
}

/**
 * 一个程序 = 帽形积木 + 它的语句链。
 *
 * 路径约定（模型路径，指向 V.programs 里的位置）：
 *   `0`                第 0 个程序（帽形本身）
 *   `0.next`          帽形的下一条语句
 *   `0.next.next`     再下一条
 *   `0.next.body:body:0`  某条语句的 body 槽里的第 0 块
 *   `0.next.inputs:cond`   某条语句的 cond 槽里的积木
 */
function programCard(prog, index) {
  const card = el('div.vb-program');
  card.dataset.programIndex = String(index);
  const hatHost = el('div.vb-program-hat');
  const stackHost = el('div.vb-program-stack');

  // 事件帽是程序根，不能拖走；它下面的 next 链才是可编辑的脚本。
  const hat = renderBlock(prog, { path: String(index), draggable: false });
  hatHost.append(hat);

  // 语句链用统一渲染：每条前面有「插这里」连接点，末尾有「接后面」连接点。
  renderChain(stackHost, prog.next, `${index}.next`, {
    emptyAt: String(index),
    emptySlot: 'next',
    emptyText: '把积木拖到这里',
  });

  card.append(hatHost, stackHost);

  // 程序级操作
  const tools = el('div.vb-program-tools');
  tools.append(el('button.icon-btn', {
    title: '看这段程序编译成什么 Java',
    onclick: () => previewProgram(prog),
  }, '⌘'));
  tools.append(el('button.icon-btn', {
    title: '删除这个程序',
    onclick: async () => {
      if (!await confirmBox('删掉这个程序？')) return;
      V.programs.splice(index, 1);
      V.selectedPath = null;
      renderCanvas();
      renderSide();
    },
  }, '✕'));
  card.append(tools);

  card.addEventListener('click', onCanvasClick);
  return card;
}

/** 点一下积木 → 选中 → 右边显示属性 */
function onCanvasClick(e) {
  const vb = e.target.closest?.('.vb');
  if (!vb) {
    // 点空白处取消选中
    if (V.selectedPath) {
      V.selectedPath = null;
      renderCanvas();
      renderSide();
    }
    return;
  }
  // 点输入框/下拉/真伪按钮不算选中积木（它们自己处理编辑）
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;

  V.selectedPath = vb.dataset.path || null;
  for (const el2 of document.querySelectorAll('.vb-selected')) {
    el2.classList.remove('vb-selected');
  }
  vb.classList.add('vb-selected');
  renderSide();
}

/**
 * 找模型路径对应的节点。
 * @param {string} path
 * @returns {object|null}
 */
function nodeAt(path) {
  if (!path) return null;
  const segs = String(path).split('.');
  const idx = Number(segs[0]);
  let node = V.programs[idx];
  if (!node) return null;
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === 'next') {
      node = node.next;
    } else if (seg.startsWith('inputs:')) {
      const name = seg.slice('inputs:'.length);
      node = node.inputs?.[name];
    } else if (seg.startsWith('body:')) {
      // body:slot:index
      const [, slot, i2] = seg.split(':');
      node = (node[slot] || [])[Number(i2)];
    } else {
      return null;
    }
    if (!node) return null;
  }
  return node;
}

/** 找出某个节点的父容器信息（用于插入/删除） */
function parentOf(path) {
  const segs = String(path).split('.');
  const parentPath = segs.slice(0, -1).join('.');
  const last = segs[segs.length - 1];
  const parent = nodeAt(parentPath);
  if (!parent) return null;
  if (last === 'next') return { parent, kind: 'next', key: 'next' };
  if (last.startsWith('inputs:')) return { parent, kind: 'input', key: last.slice('inputs:'.length) };
  if (last.startsWith('body:')) {
    const [, slot, i] = last.split(':');
    return { parent, kind: 'body', slot, index: Number(i) };
  }
  return null;
}

/** 右侧属性面板 */
function renderSide() {
  const host = V.sideHost;
  if (!host) return;

  const sections = [];

  // 选中的积木
  const node = nodeAt(V.selectedPath);
  if (node) {
    const def = getDef(node.op);
    sections.push(el('div.vb-side-block', {},
      el('div.vb-side-title', {},
        el('span', { text: def?.icon || '🧩' }),
        el('span', { text: def?.label || node.op }),
      ),
      def?.description ? el('p.vb-side-desc', { text: def.description }) : null,
      def?.requiresMod ? el('div.vb-side-warn', {
        text: `这条积木需要安装 ${def.requiresMod} 这个 mod，并且工程要挂上它的 jar，否则编译不过。`,
      }) : null,
      def && !def.supported ? el('div.vb-side-warn', {
        text: def.hint || `这条积木在目标 ${V.targetId} 下还没有实现。`,
      }) : null,
      el('div.vb-side-hint', { text: '在积木上直接改参数；这里显示说明。' }),
      el('button.btn.ghost.small', { onclick: () => removeSelected() }, '删掉这条积木'),
    ));
  }

  // 编译预览
  const preview = el('div.vb-side-preview');
  sections.push(preview);
  V.preview = preview;

  // 统计
  sections.push(el('div.vb-side-stat', {},
    el('div.vb-side-title', { text: '工程概览' }),
    el('div.vb-stat-row', {}, el('span', { text: '程序数' }), el('strong', { text: String(V.programs.length) })),
    el('div.vb-stat-row', {}, el('span', { text: '积木种类' }), el('strong', { text: String(V.defMap.size) })),
    el('div.vb-stat-row', {}, el('span', { text: '目标' }), el('strong', { text: V.targetId })),
    el('div.vb-stat-row', {}, el('span', { text: '已装库' }), el('strong', { text: String(V.libraries.length) })),
    el('p.vb-side-hint', { text: '保存后点顶栏「生成」，这些积木会变成 custom/ 目录下的 Java 文件。' }),
  ));

  setContent(host, ...sections.filter(Boolean));
}

/** 删掉选中的积木 */
function removeSelected() {
  const path = V.selectedPath;
  if (!path) return;
  const info = parentOf(path);
  if (!info) {
    // 删的是程序本身
    const idx = Number(String(path).split('.')[0]);
    V.programs.splice(idx, 1);
  } else if (info.kind === 'next') {
    // 把这条从 next 链上摘掉（接上它的下一个）
    info.parent.next = info.parent.next?.next || null;
  } else if (info.kind === 'input') {
    info.parent.inputs[info.key] = { type: 'value', kind: 'text', value: '' };
  } else if (info.kind === 'body') {
    (info.parent[info.slot] || []).splice(info.index, 1);
  }
  V.selectedPath = null;
  renderCanvas();
  renderSide();
}

/** 加一条新程序（一个事件帽） */
function addProgram(def) {
  V.programs.push({
    op: def.id,
    inputs: {},
    fields: {},
    body: [],
    next: null,
    methodName: methodNameFor(def.id),
  });
  renderCanvas();
  renderSide();
  toast(`加了「${def.label}」`);
}

/** 加一条积木到画布 */
function addToCanvas(def) {
  const shape = def.shape;
  // 帽形不能加在已有程序里 —— 它是新的程序起点
  if (shape === 'hat') {
    addProgram(def);
    return;
  }

  const node = makeNode(def);
  const sel = nodeAt(V.selectedPath);

  // 值型积木（reporter / boolean）塞进选中积木的槽
  if (shape === 'reporter' || shape === 'boolean') {
    if (!sel) {
      toast('先点一个积木，再点这个值积木，它就放进那个槽里');
      return;
    }
    const slot = findFreeSlot(sel, def);
    if (!slot) {
      toast('这个位置放不下 —— 选一个带空槽的积木');
      return;
    }
    sel.inputs[slot.name] = node;
    renderCanvas();
    renderSide();
    return;
  }

  // 语句型：接到选中积木后面；没选就接到最后一个程序末尾
  const target = sel || tailOf(V.programs[V.programs.length - 1]);
  if (!target) {
    toast('先点一个事件积木开一段程序');
    return;
  }
  const tail = tailOf(target);
  if (tail) tail.next = node;
  else target.next = node;
  renderCanvas();
  renderSide();
}

/** 造一条积木实例（带上默认值） */
function makeNode(def) {
  const inputs = {};
  for (const i of def.inputs || []) {
    // 条件位要真积木或真假按钮，不填字面值
    if (i.accept?.includes('boolean')) {
      inputs[i.name] = { type: 'value', kind: 'boolean', value: false };
      continue;
    }
    inputs[i.name] = { type: 'value', kind: i.kind || 'text', value: i.default ?? '' };
  }
  const fields = {};
  for (const f of def.fields || []) fields[f.name] = f.default ?? '';
  return { op: def.id, inputs, fields };
}

/** 找选中积木里第一个能放下这个值型积木的槽 */
function findFreeSlot(node, def) {
  const d = getDef(node.op);
  const wantBool = def.shape === 'boolean';
  for (const i of d?.inputs || []) {
    const acc = i.accept || [];
    // 六边形条件积木只进条件槽；值积木能进任意值槽（数字/文本槽也行，
    // 跟 Scratch 里圆形积木能塞进圆形输入框一样），但不能进条件槽。
    if (wantBool && !acc.includes('boolean')) continue;
    if (!wantBool && acc.includes('boolean')) continue;
    const cur = node.inputs?.[i.name];
    if (cur && cur.op) continue;   // 槽里已经有积木就不抢
    return { name: i.name };
  }
  return null;
}

/** 找一条链的尾巴 */
function tailOf(node) {
  let cur = node;
  let guard = 0;
  while (cur?.next && guard++ < 200) cur = cur.next;
  return cur;
}

/** 从事件 id 推出方法名（和后端 METHOD_PREFIX 对齐） */
function methodNameFor(op) {
  const map = {
    'event.player_rightclick_block': 'on_player_rightclick_block',
    'event.entity_attack': 'on_entity_attack',
    'event.player_tick': 'on_player_tick',
    'event.server_tick': 'on_server_tick',
    'event.block_break': 'on_block_break',
    'event.item_use': 'on_item_use',
  };
  return map[op] || 'on_event';
}

/** 保存积木程序到工程 */
async function savePrograms(notify = false) {
  if (!V.ctx.root) {
    toast('还没打开工程，积木只存在于这个页面上。先打开或新建一个工程再保存。', 'error');
    return;
  }
  try {
    await api.saveVisualProgram(V.ctx.root, V.programs);
    if (notify) toast(`已保存 ${V.programs.length} 段程序`);
  } catch (e) {
    toast(`保存失败：${e.message || e}`, 'error');
  }
}

/** 编译预览：整份工程 */
async function refreshPreview() {
  if (!V.preview) return;
  setContent(V.preview, el('div.loading', { text: '编译中…' }));
  try {
    const r = await api.visualCompile({
      targetId: V.targetId,
      programs: V.programs,
      pkg: V.ctx.project?.meta?.pkg,
    });
    renderPreview(r);
  } catch (e) {
    setContent(V.preview, el('div.vb-side-warn', { text: `编译失败：${e.message || e}` }));
  }
}

/** 编译预览：单条程序 */
async function previewProgram(prog) {
  const r = await api.visualCompile({
    targetId: V.targetId,
    programs: [prog],
    pkg: V.ctx.project?.meta?.pkg,
  });
  const body = el('div.vb-preview-body');
  const m = modal({ title: '这段程序编译成什么', body, width: 720 });
  fillPreview(body, r);
  return m;
}

function renderPreview(r) {
  if (!V.preview) return;
  const body = el('div.vb-preview-body');
  fillPreview(body, r);
  setContent(V.preview,
    el('div.vb-side-title', { text: '编译预览' }),
    body,
  );
}

function fillPreview(body, r) {
  const items = [];
  if (r.errors?.length) {
    items.push(el('div.vb-side-warn', { text: `错误：${r.errors.join('；')}` }));
  }
  if (r.warnings?.length) {
    items.push(el('div.vb-side-warn', { text: `提醒：${r.warnings.join('；')}` }));
  }
  const code = r.files?.map((f) => f.content || f.code || '').join('\n') || r.code || '';
  if (code) {
    items.push(el('pre.vb-code', { text: code }));
  } else if (!r.errors?.length) {
    items.push(el('div.vb-side-hint', { text: '（没有可编译的内容）' }));
  }
  setContent(body, ...items);
}

/** ---------------- 拖拽（Scratch 连接模型） ---------------- */

/**
 * 把一次 drop 落点解析成统一描述。
 *
 * 连接点带完整 data-* 时优先用；同时兼容老行为 ——
 * 直接把 drop 派发到 .vb-body / .vb-program-stack / .vb-input-block 上
 * （界面测试和向导就是这么模拟拖放的）。
 */
function targetFromEvent(e) {
  const point = e.target.closest?.('.vb-drop-point');
  if (point) {
    const kind = point.dataset.drop === 'insert' ? 'before' : 'append';
    return {
      kind,
      at: point.dataset.at || '',
      slot: point.dataset.slot || '',
      el: point,
    };
  }

  const slot = e.target.closest?.('.vb-input-block');
  if (slot) {
    const owner = slot.closest('.vb');
    return {
      kind: 'input',
      at: slot.dataset.at || owner?.dataset.path || '',
      input: slot.dataset.input,
      accept: slot.dataset.accept || 'value',
      el: slot,
    };
  }

  const body = e.target.closest?.('.vb-body');
  if (body) {
    return {
      kind: 'append',
      at: body.closest('.vb')?.dataset.path || '',
      slot: body.dataset.slot || 'body',
      el: body,
    };
  }

  const stack = e.target.closest?.('.vb-program-stack');
  if (stack) {
    const idx = Number(stack.closest('.vb-program')?.dataset.programIndex);
    const prog = V.programs[idx];
    if (!prog) return null;
    // 找链尾的**模型路径**（非空链），空链则指向程序根的 next
    let cur = prog.next;
    let p = `${idx}.next`;
    let tail = '';
    let guard = 0;
    while (cur && cur.op && guard++ < 300) {
      tail = p;
      cur = cur.next;
      p += '.next';
    }
    return tail
      ? { kind: 'append', at: tail, slot: '', el: stack }
      : { kind: 'append', at: String(idx), slot: 'next', el: stack };
  }
  return null;
}

/**
 * 解析落点，带「最近连接」吸附。
 * Scratch 的 ConnectionDB 会按空间距离找最近的兼容连接，
 * 这里用 DOM 矩形做同样的近似：没精确落在细线上时，吸到最近的连接点。
 */
function resolveTarget(e) {
  const direct = targetFromEvent(e);
  if (direct) return direct;
  if (!e.clientY || !V.canvasHost) return null;
  let best = null;
  let bestD = Infinity;
  for (const n of V.canvasHost.querySelectorAll('.vb-drop-point')) {
    const r = n.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const dy = Math.abs((r.top + r.bottom) / 2 - e.clientY);
    const dx = e.clientX < r.left ? r.left - e.clientX : (e.clientX > r.right ? e.clientX - r.right : 0);
    const d = dy + dx * 0.5;
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best || bestD > 120) return null;
  return targetFromEvent({ target: best });
}

/** 类型检查：形状决定能不能连（跟 Scratch 的 check_ 数组一个意思） */
function dropIssue(def, target, drag) {
  if (!target) return null;
  // 不能把积木拖进它自己或自己的子孙里（会成环）
  if (drag?.from === 'canvas' && drag.path) {
    const p = drag.path;
    const at = String(target.at || '');
    if (at === p || at.startsWith(`${p}.`) || at.startsWith(`${p}:`)) {
      return '不能把积木拖进它自己里面';
    }
  }
  if (target.kind === 'input') {
    if (def.shape !== 'reporter' && def.shape !== 'boolean') return '值槽里只能放值积木或条件积木';
    if (def.shape === 'boolean' && target.accept !== 'boolean') return '六边形条件积木只能放进条件槽';
    if (def.shape === 'reporter' && target.accept === 'boolean') return '这个槽要放条件积木（六边形）';
    return null;
  }
  if (def.shape === 'hat') return '事件帽只能作为一段程序的起点';
  if (def.shape !== 'stack') return '语句链上只能放语句积木';
  return null;
}

/** 高亮当前可放置的连接点 */
function setDropPoint(node) {
  if (V.dropPoint === node) return;
  clearDropPoint();
  V.dropPoint = node;
  node?.classList.add('vb-drop-active');
}

function clearDropPoint() {
  V.dropPoint?.classList.remove('vb-drop-active');
  V.dropPoint = null;
  V.canvasHost?.querySelectorAll('.vb-drop-active').forEach((n) => n.classList.remove('vb-drop-active'));
}

function onDragStart(e) {
  const vb = e.target.closest?.('.vb');
  if (!vb || !V.canvasHost?.contains(vb)) return;
  const path = vb.dataset.path;
  if (!path || !vb.dataset.op) return;
  // 事件帽是程序根，拖走等于删整段程序 —— 不给拖，用卡片上的 ✕
  const def = getDef(vb.dataset.op);
  if (def?.shape === 'hat') { e.preventDefault(); return; }
  V.dragging = { op: vb.dataset.op, from: 'canvas', path };
  e.dataTransfer.setData(DRAG_TYPE, vb.dataset.op);
  e.dataTransfer.effectAllowed = 'move';
  vb.classList.add('vb-dragging');
  V.trashHost?.classList.add('vb-trash-visible');
  V.canvasHost?.classList.add('vb-drag-now');
}

function onDragOver(e) {
  // dragover 阶段浏览器不给读 dataTransfer 内容，所以靠 dragstart 记下的 op；
  // 测试/外部直接派发 dragover 时退化成尝试读取。
  const op = V.dragging?.op || e.dataTransfer.getData?.(DRAG_TYPE) || '';
  const def = getDef(op);
  if (!def) return;
  const target = resolveTarget(e);
  if (!target) { clearDropPoint(); return; }
  const drag = V.dragging || { from: 'palette', op };
  if (dropIssue(def, target, drag)) { clearDropPoint(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = drag.from === 'canvas' ? 'move' : 'copy';
  setDropPoint(target.el);
}

function onDrop(e) {
  const op = e.dataTransfer.getData(DRAG_TYPE) || V.dragging?.op || '';
  if (!op) return;
  const def = getDef(op);
  const target = resolveTarget(e);
  if (!def || !target) return;
  const drag = (V.dragging?.from === 'canvas' && V.dragging.path)
    ? V.dragging
    : { from: 'palette', op };

  const issue = dropIssue(def, target, drag);
  if (issue) {
    e.preventDefault();
    toast(issue, 'warn');
    clearDropPoint();
    V.dragging = null;
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  clearDropPoint();

  // ⚠️ 移动积木时，摘除会改变模型路径。所以先把落点解析成**对象引用**，
  //    再摘除，最后用引用拼接 —— 不能摘完再按旧路径找目标。
  const resolved = {
    kind: target.kind,
    slot: target.slot,
    inputName: target.input,
    beforeNode: target.kind === 'before' ? nodeAt(target.at) : null,
    beforeInfo: target.kind === 'before' ? parentOf(target.at) : null,
    appendNode: (target.kind === 'append' && !target.slot) ? nodeAt(target.at) : null,
    hostNode: (target.kind === 'append' && target.slot) ? nodeAt(target.at) : null,
    inputOwner: target.kind === 'input' ? nodeAt(target.at) : null,
  };

  let node;
  if (drag.from === 'canvas') {
    node = detachAt(drag.path);
    if (!node) { V.dragging = null; return; }
  } else {
    node = makeNode(def);
  }

  let done = false;
  if (resolved.kind === 'input' && resolved.inputOwner) {
    resolved.inputOwner.inputs = resolved.inputOwner.inputs || {};
    resolved.inputOwner.inputs[resolved.inputName] = node;
    done = true;
  } else if (resolved.kind === 'before' && resolved.beforeNode && resolved.beforeInfo) {
    done = insertBeforeNode(resolved.beforeInfo, resolved.beforeNode, node);
  } else if (resolved.kind === 'append') {
    done = appendNode(resolved, node);
  }

  V.dragging = null;
  V.selectedPath = null;
  V.canvasHost?.classList.remove('vb-drag-now');
  V.trashHost?.classList.remove('vb-trash-visible', 'vb-trash-hot');
  if (!done) toast('这个位置放不下', 'warn');
  renderCanvas();
  renderSide();
}

function onDragEnd() {
  V.dragging = null;
  clearDropPoint();
  V.canvasHost?.classList.remove('vb-drag-now');
  V.trashHost?.classList.remove('vb-trash-visible', 'vb-trash-hot');
  V.canvasHost?.querySelectorAll('.vb-dragging').forEach((n) => n.classList.remove('vb-dragging'));
}

/** 从模型里摘掉一条积木（连同它下面的一串），返回被摘下的节点 */
function detachAt(path) {
  const info = parentOf(path);
  if (!info) return null;
  if (info.kind === 'next') {
    const n = info.parent.next;
    info.parent.next = null;     // 整串一起带走（Scratch 的拖动语义）
    return n;
  }
  if (info.kind === 'input') {
    const n = info.parent.inputs?.[info.key];
    info.parent.inputs = info.parent.inputs || {};
    info.parent.inputs[info.key] = defaultValueFor(info.parent, info.key);
    return n || null;
  }
  if (info.kind === 'body') {
    const arr = info.parent[info.slot] || [];
    const n = arr[info.index];
    arr.splice(info.index, 1);
    return n || null;
  }
  return null;
}

/** 槽里积木被拖走后恢复成可直接打字的默认值 */
function defaultValueFor(owner, key) {
  const d = getDef(owner?.op);
  const inp = (d?.inputs || []).find((i) => i.name === key);
  if (inp?.accept?.includes('boolean')) return { type: 'value', kind: 'boolean', value: false };
  return { type: 'value', kind: inp?.kind || 'text', value: inp?.default ?? '' };
}

/** 插到某条语句之前 */
function insertBeforeNode(info, beforeNode, node) {
  const tail = tailOf(node);
  if (info.kind === 'next') {
    info.parent.next = node;
    tail.next = beforeNode;
    return true;
  }
  if (info.kind === 'body') {
    const arr = info.parent[info.slot] || (info.parent[info.slot] = []);
    const i = arr.indexOf(beforeNode);
    if (i < 0) return false;
    arr[i] = node;
    tail.next = beforeNode;
    return true;
  }
  return false;
}

/** 接到链尾 / 放进空容器 / 放进空程序 */
function appendNode(resolved, node) {
  if (resolved.slot) {
    const host = resolved.hostNode;
    if (!host) return false;
    if (resolved.slot === 'next') { host.next = node; return true; }
    if (!Array.isArray(host[resolved.slot])) host[resolved.slot] = [];
    host[resolved.slot].push(node);
    return true;
  }
  if (!resolved.appendNode) return false;
  resolved.appendNode.next = node;
  return true;
}

/** ---------------- 代码造积木（G5） ---------------- */

async function openCustomBlock() {
  const body = el('div.vb-custom-form');

  const name = el('input.input', { placeholder: '积木名字，比如「给玩家三颗钻石」' });
  const id = el('input.input', { placeholder: '积木 id，比如 mymod.give_diamond' });
  const code = el('textarea.input.vb-code-input', {
    placeholder: 'Java 代码模板，用 %参数名 占位：\nplayer.give(%item, %count);',
    rows: '8',
  });
  const paramName = el('input.input', { placeholder: '参数名，如 item' });
  const paramKind = el('select.input', {},
    el('option', { value: 'text', text: '文本' }),
    el('option', { value: 'number', text: '数字' }),
    el('option', { value: 'boolean', text: '真假' }),
  );
  const paramsBox = el('div.vb-params');
  const params = [];
  // 默认全目标：以前造出来的积木只挂在 fabric-26.3 上，换到 Forge 工程就没了
  const allTargets = el('input', { type: 'checkbox' });
  allTargets.checked = true;

  const addParam = () => {
    const p = { name: paramName.value.trim(), kind: paramKind.value, default: '' };
    if (!p.name) {
      toast('参数名不能为空');
      return;
    }
    if (params.some((x) => x.name === p.name)) {
      toast('参数名重复了');
      return;
    }
    params.push(p);
    paramName.value = '';
    paramsBox.append(el('div.vb-param-chip', {
      text: `%${p.name}（${p.kind === 'number' ? '数字' : p.kind === 'boolean' ? '真假' : '文本'}）`,
    }));
  };

  paramName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addParam(); } });

  fill(body,
    el('label.field-label', {}, el('span', { text: '积木名字' }), name),
    el('label.field-label', {}, el('span', { text: '积木 id' }), id),
    el('label.field-label', {}, el('span', { text: 'Java 代码模板' }), code),
    el('div.vb-param-row', {},
      el('span', { text: '参数' }),
      paramName,
      paramKind,
      el('button.btn.ghost.small', { onclick: addParam }, '+ 加参数'),
    ),
    paramsBox,
    el('label.vb-target-choice', {},
      allTargets,
      el('span', { text: '所有目标都能用（推荐，换工程 / 换加载器时积木不会消失）' }),
    ),
    el('p.muted.small', {
      text: '代码里的 %占位符 必须和参数一一对应。生成后这条积木会出现在「自定义」分类里。',
    }),
  );

  modal({
    title: '用代码造一条积木',
    body,
    width: 640,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '造出来',
        kind: 'primary',
        onClick: async () => {
          if (!name.value.trim() || !id.value.trim() || !code.value.trim()) {
            toast('名字、id、代码都要填');
            return false;
          }
          try {
            await api.visualCustomBlock({
              id: id.value.trim(),
              name: name.value.trim(),
              code: code.value,
              params,
              ...(allTargets.checked ? { allTargets: true } : { targetId: V.targetId }),
            });
            toast('造好了，正在刷新积木库…');
            await load();
            return true;
          } catch (e) {
            toast(`失败：${e.message || e}`, 'error');
            return false;
          }
        },
      },
    ],
  });
}

/** ---------------- 导出自定义积木（G5 的另一半） ---------------- */

/**
 * 把「代码造出来的积木」导出成 .mcblocks.json，交给别人用。
 *
 * 这是 G5「任何人都能把代码打包成可视化积木块」的完整闭环：
 *   写 Java → 造积木 → 导出库文件 → 别人装上就能拖着用。
 */
async function openExportBlocks() {
  const custom = [...V.defMap.values()].filter((b) => b.userDef);

  if (!custom.length) {
    modal({
      title: '导出自定义积木',
      body: el('div.vb-lib-list', {},
        el('p.muted.small', { text: '还没有用代码造出来的积木。' }),
        el('p.muted.small', { text: '点顶栏「代码造积木」，写一段 Java，给它起个名字，就能变成一条可拖拽的积木。' }),
      ),
      width: 560,
    });
    return;
  }

  const picked = new Set(custom.map((b) => b.id));
  const body = el('div.vb-lib-list');

  const list = el('div.vb-export-list');
  for (const b of custom) {
    const cb = el('input', { type: 'checkbox', checked: true });
    cb.addEventListener('change', () => {
      if (cb.checked) picked.add(b.id);
      else picked.delete(b.id);
    });
    list.append(el('label.vb-export-item', {},
      cb,
      el('span.vb-export-name', { text: b.label }),
      el('span.muted.small', { text: ` ${b.id}` }),
    ));
  }
  body.append(
    el('p.muted.small', { text: '勾选要分享的积木，导出成一个 .mcblocks.json 文件 —— 别人装上就能用。' }),
    list,
  );

  modal({
    title: '导出自定义积木',
    body,
    width: 600,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '导出',
        kind: 'primary',
        onClick: async () => {
          const ids = [...picked];
          if (!ids.length) {
            toast('一条都没勾');
            return false;
          }
          try {
            const r = await api.visualExportBlocks(ids);
            const blob = new Blob([JSON.stringify(r.library, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${r.library.id}.mcblocks.json`;
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(`导出了 ${ids.length} 条积木`);
            return true;
          } catch (e) {
            toast(`导出失败：${e.message || e}`, 'error');
            return false;
          }
        },
      },
    ],
  });
}

/** ---------------- 积木库管理 ---------------- */

async function openLibraryManager() {
  const body = el('div.vb-lib-list');
  const m = modal({ title: '积木库', body, width: 620 });

  const render = async () => {
    try {
      // 扩展状态拉不到也不能让整个弹窗挂掉 —— 它是补充信息，不是主流程
      const [r, ext] = await Promise.all([
        api.visualLibraries(V.ctx.root),
        api.visualExtensions().catch(() => null),
      ]);
      const libs = r.libraries || [];
      const extBox = ext ? el('div.vb-ext-box', {},
        el('div.vb-ext-title', {
          text: `扩展：${ext.targets.length} 个目标 / ${ext.packs.length} 个专属积木包`,
        }),
        el('div.muted.small', {
          text: `目标 ${ext.targets.map((t) => t.id).join('、') || '无'}；`
            + `专属包 ${ext.packs.map((p) => p.id).join('、') || '无'}`,
        }),
        el('div.muted.small', {
          text: '把 .mjs 放进 ~/.mcstudio/targets 或 ~/.mcstudio/modpacks 就能加新目标 / 新积木包，详见《09 · 扩展与工具包》。',
        }),
        ...(ext.diagnostics || []).map((d) => el('div.vb-side-warn', {
          text: `${d.kind === 'target' ? '目标' : '积木包'}扩展提示：${d.text}`,
        })),
      ) : null;
      setContent(body,
        el('p.muted.small', {
          text: '库就是「积木包」。装了之后里面的积木会出现在左侧分类里，任何工程都能用。',
        }),
        ...libs.map((l) => el('div.vb-lib-item', {},
          el('div.vb-lib-name', {},
            el('strong', { text: l.name || l.id }),
            el('span.muted.small', { text: ` ${l.blockCount ?? l.blocks?.length ?? 0} 条` }),
          ),
          el('span.muted.small', { text: l.source || '' }),
        )),
        el('div.vb-lib-add', {},
          el('button.btn.small', { onclick: () => { m.close(); openFromJar(); } }, '从 mod jar 生成库'),
          el('button.btn.ghost.small', { onclick: () => { m.close(); openCustomBlock(); } }, '代码造积木'),
        ),
        ...(extBox ? [extBox] : []),
      );
    } catch (e) {
      setContent(body, el('div.vb-side-warn', { text: `读取失败：${e.message || e}` }));
    }
  };
  render();
}

/** 从 jar 生成库 */
function openFromJar() {
  const path = el('input.input', { placeholder: 'mod jar 的完整路径，如 C:/mods/goety.jar' });
  const body = el('div.vb-from-jar', {},
    el('label.field-label', {}, el('span', { text: 'jar 路径' }), path),
    el('p.muted.small', {
      text: '工具会读这个 jar，把里面的物品、方块、效果和能调用的功能变成积木。'
        + '读 jar 不会执行里面的任何代码，只解析类结构和注册表。',
    }),
    el('div.vb-jar-result'),
  );
  const result = body.querySelector('.vb-jar-result');

  modal({
    title: '从 mod jar 生成积木库',
    body,
    width: 640,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '生成',
        kind: 'primary',
        onClick: async () => {
          if (!path.value.trim()) {
            toast('要填 jar 路径');
            return false;
          }
          setContent(result, el('div.loading', { text: '分析 jar…' }));
          try {
            const r = await api.visualLibraryFromJar({
              jar: path.value.trim(),
              targetId: V.targetId,
            });
            setContent(result,
              el('div.vb-side-title', { text: `生成了 ${r.library?.blocks?.length || 0} 条积木` }),
              el('p.vb-side-hint', { text: r.hint || '' }),
              ...(r.warnings || []).slice(0, 6).map((w) => el('div.vb-side-hint', { text: `· ${w}` })),
              el('button.btn.primary.small', {
                onclick: async () => {
                  try {
                    await api.visualInstallLibrary({
                      library: r.library,
                      confirmed: true,
                      scope: 'user',
                    });
                    toast('库已装好，正在刷新…');
                    await load();
                  } catch (e) {
                    toast(`装库失败：${e.message || e}`, 'error');
                  }
                },
              }, '装上这个库'),
            );
            return false;   // 不关掉，让用户看清结果再决定
          } catch (e) {
            setContent(result, el('div.vb-side-warn', { text: `失败：${e.message || e}` }));
            return false;
          }
        },
      },
    ],
  });
}
