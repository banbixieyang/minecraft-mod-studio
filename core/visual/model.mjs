/**
 * 积木数据模型 —— 积木树的定义、构造与校验。
 *
 * 积木用「树 + 序列」双结构（Scratch 的经典做法）：
 *   · 树：inputs 里可以嵌套另一个积木（值型积木塞进槽里）
 *   · 序列：stack 积木用 next 串起来，body 型积木用 body 数组装子积木
 *
 * 形状（shape）决定嵌套规则：
 *   hat       帽形 —— 程序起点，一段程序只能有一个
 *   stack     积木 —— 语句，能接 next
 *   reporter  圆角 —— 值，能塞进 inputs
 *   boolean   六边形 —— 条件，能塞进 inputs
 */

/** 合法形状 */
export const SHAPES = ['hat', 'stack', 'reporter', 'boolean'];

/** 值的种类 */
export const VALUE_KINDS = ['text', 'number', 'boolean', 'entity', 'block', 'item', 'blockRef', 'menu', 'json'];

/**
 * 造一个积木。
 * @param {string} op 积木定义 id
 * @param {object} [init] 初始化字段
 */
export function block(op, init = {}) {
  const b = {
    op,
    inputs: init.inputs ? { ...init.inputs } : {},
    fields: init.fields ? { ...init.fields } : {},
  };
  if (init.body) b.body = init.body.map((x) => x);
  // 容器型积木可以有多个 body 槽（if/else 的 else 分支等）
  // 用 def.bodySlots 声明有哪些槽，但这里不依赖定义 —— 直接透传已知槽。
  for (const slot of ['elseBody', 'body2']) {
    if (Array.isArray(init[slot])) b[slot] = init[slot].map((x) => x);
  }
  if (init.next !== undefined) b.next = init.next;
  return b;
}

/** 造一个「纯值」（不是积木，只是槽里的字面量） */
export function value(kind, v) {
  return { type: 'value', kind, value: v };
}

/**
 * 递归遍历积木树。
 * @param {object|object[]} node 积木或积木数组
 * @param {(b:object, parent:object|null, key:string)=>void} fn
 */
export function walk(node, fn, parent = null, key = '') {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, fn, parent, key);
    return;
  }
  if (!node.op) return;
  fn(node, parent, key);
  for (const [k, v] of Object.entries(node.inputs || {})) {
    if (v && v.op) walk(v, fn, node, `inputs.${k}`);
  }
  if (node.body) walk(node.body, fn, node, 'body');
  for (const slot of ['elseBody', 'body2']) {
    if (node[slot]) walk(node[slot], fn, node, slot);
  }
  if (node.next) walk(node.next, fn, node, 'next');
}

/** 统计积木数量（界面显示用） */
export function countBlocks(node) {
  let n = 0;
  walk(node, () => { n++; });
  return n;
}

/** 深拷贝积木树 */
export function cloneBlocks(node) {
  if (!node) return node;
  if (Array.isArray(node)) return node.map(cloneBlocks);
  const out = { op: node.op };
  if (node.inputs) {
    out.inputs = {};
    for (const [k, v] of Object.entries(node.inputs)) {
      out.inputs[k] = v && v.op ? cloneBlocks(v) : { ...v };
    }
  }
  if (node.fields) out.fields = { ...node.fields };
  if (node.body) out.body = node.body.map(cloneBlocks);
  for (const slot of ['elseBody', 'body2']) {
    if (node[slot]) out[slot] = node[slot].map(cloneBlocks);
  }
  if (node.next) out.next = cloneBlocks(node.next);
  return out;
}

/**
 * 校验积木树，返回问题清单。
 * 故意不抛异常 —— 界面要能显示「哪一块坏了」，而不是整个白屏。
 *
 * @param {object} root 根积木
 * @param {(id:string)=>object|null} lookup 积木定义查找函数
 */
export function validate(root, lookup) {
  const problems = [];
  const seenHats = [];

  walk(root, (b, parent, key) => {
    const def = lookup(b.op);
    if (!def) {
      problems.push({ op: b.op, level: 'error', msg: `未知积木「${b.op}」` });
      return;
    }
    if (!SHAPES.includes(def.shape)) {
      problems.push({ op: b.op, level: 'error', msg: `积木「${b.op}」的形状定义非法` });
    }
    if (def.shape === 'hat') {
      seenHats.push(b);
      // ⚠️ 帽形的 next 链是它的语句序列（程序根就是帽形，next 往下接语句），
      //    所以这里**不能**报「帽形后面不能接语句」。
      //    真正要报的是：帽形的 body 槽里不该再出现帽形（事件不能嵌套事件）。
      for (const slot of ['body', 'elseBody', 'body2']) {
        const inner = b[slot];
        if (!Array.isArray(inner)) continue;
        for (const child of inner) {
          const cdef = lookup(child?.op);
          if (cdef?.shape === 'hat') {
            problems.push({ op: child.op, level: 'error', msg: '事件积木不能嵌套在另一个事件里' });
          }
        }
      }
    }
    // 检查必填输入槽
    for (const inp of def.inputs || []) {
      const slot = b.inputs?.[inp.name];
      if (!slot) {
        if (inp.required) {
          problems.push({ op: b.op, level: 'error', msg: `积木「${def.label || b.op}」缺少必填参数 ${inp.name}` });
        }
        continue;
      }
      // 槽里塞的值类型对不对
      if (slot.op) {
        const sdef = lookup(slot.op);
        if (!sdef) {
          problems.push({ op: slot.op, level: 'error', msg: `未知积木「${slot.op}」` });
        } else {
          if (inp.accept && !inp.accept.includes(sdef.shape)) {
            problems.push({
              op: slot.op, level: 'error',
              msg: `积木「${def.label || b.op}」的 ${inp.name} 槽不能放「${sdef.label || slot.op}」`,
            });
          }
        }
      } else if (slot.kind && inp.kind && slot.kind !== inp.kind && inp.kind !== 'any') {
        // 类型不匹配 —— 只警告，默认值兜住
        problems.push({
          op: b.op, level: 'warn',
          msg: `积木「${def.label || b.op}」的 ${inp.name} 期望 ${inp.kind}，实际是 ${slot.kind}`,
        });
      }
    }
    // 检查未知的输入槽
    const known = new Set((def.inputs || []).map((x) => x.name));
    for (const k of Object.keys(b.inputs || {})) {
      if (!known.has(k)) {
        problems.push({ op: b.op, level: 'warn', msg: `积木「${def.label || b.op}」有多余的槽 ${k}` });
      }
    }
  });

  if (seenHats.length > 1) {
    problems.push({ op: '(root)', level: 'error', msg: '一段程序只能有一个起点' });
  }
  return problems;
}

/**
 * 找一段程序里所有的「帽」（事件起点）。
 * @param {object} root
 * @param {(id:string)=>object|null} [lookup] 积木定义查找（不给就按 id 判断）
 */
export function findHats(root, lookup = null) {
  const hats = [];
  walk(root, (b) => {
    const def = lookup ? lookup(b.op) : null;
    if (def ? def.shape === 'hat' : /^event\./.test(String(b.op || ''))) {
      hats.push(b);
    }
  });
  return hats;
}

/**
 * 把若干积木接成一条语句链。
 */
export function chain(list) {
  const arr = list.filter(Boolean);
  for (let i = 0; i < arr.length - 1; i++) arr[i].next = arr[i + 1];
  if (arr.length) arr[arr.length - 1].next = null;
  return arr[0] || null;
}

/** 把一条语句链拆成数组 */
export function unchain(first) {
  const out = [];
  let cur = first;
  const guard = new Set();
  while (cur && cur.op && !guard.has(cur)) {
    guard.add(cur);
    out.push(cur);
    cur = cur.next;
  }
  return out;
}
