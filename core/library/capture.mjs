/**
 * 捕获 —— 从当前工程里把东西打包成 Pack。
 *
 * 难点不是「把选中的条目抄出来」，而是**闭包**：
 * 你选了红宝石剑，它引用 tier=ruby，tier 又可能被别的物品用；
 * 你选了矿物生成，它指向 ruby_ore 方块；方块又有掉落表……
 * 少拿一个，装到别的工程里就是断链。
 *
 * 所以默认走 full 闭包：凡是「值等于本工程某条目 id」的引用都递归拉进来。
 * 想只要自己勾的那些，传 closure: 'none'。
 */
import fs from 'node:fs';
import path from 'node:path';
import { makePack } from './pack.mjs';
import { listContentTypes } from '../modules/registry.mjs';
import { toDisplay } from '../ids.mjs';

/** 按类型建立 id 索引 */
function buildIndex(project) {
  const byType = new Map(); // type -> Set(id)
  const all = new Map(); // id -> Set(type)
  for (const [type, list] of Object.entries(project.entries || {})) {
    const set = new Set();
    for (const e of list || []) {
      if (!e || !e.id) continue;
      set.add(e.id);
      if (!all.has(e.id)) all.set(e.id, new Set());
      all.get(e.id).add(type);
    }
    byType.set(type, set);
  }
  return { byType, all };
}

/** 字段名 → 猜测它引用哪种内容 */
function guessTypes(key, declared) {
  if (declared) return [declared];
  const k = String(key).toLowerCase();
  if (k.includes('block')) return ['block'];
  if (k.includes('recipe')) return ['recipe'];
  if (k.includes('tier') || k.includes('material')) return ['tier', 'armorMaterial'];
  return ['item', 'block'];
}

function stripNs(v, ns) {
  const s = String(v).trim();
  if (s.startsWith(`${ns}:`)) return s.slice(ns.length + 1);
  return s;
}

/**
 * 扫一条条目，找出它引用了哪些本工程条目。
 * 返回 [{ type, id }]
 */
function refsOf(entry, { index, fields, ns }) {
  const out = [];
  const fieldMap = new Map((fields || []).map((f) => [f.key, f]));

  const visit = (value, key) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
      return;
    }
    if (typeof value !== 'string') return;
    const bare = stripNs(value, ns);
    if (!bare || bare.includes(':') || bare.includes('.')) return; // 带命名空间或路径的不当引用
    if (!index.all.has(bare)) return;

    const declared = fieldMap.get(key)?.type === 'ref' ? fieldMap.get(key).refType : null;
    const cands = guessTypes(key, declared);
    const hit = cands.find((t) => index.byType.get(t)?.has(bare));
    if (hit) {
      out.push({ type: hit, id: bare });
      return;
    }
    // 猜到的不对就退回全类型找；只有唯一命中才认，避免歧义
    const types = [...(index.all.get(bare) || [])];
    if (types.length === 1) out.push({ type: types[0], id: bare });
  };

  for (const [k, v] of Object.entries(entry)) {
    if (k === 'id') continue;
    visit(v, k);
  }
  return out;
}

const TEXTURE_DIRS = {
  item: 'item',
  block: 'block',
};

/**
 * 把「用户自己画的」贴图读出来塞进包。
 * 自动改色 / 矿石合成的贴图不用带 —— 装到新工程会按当时的配色重新生成，
 * 反而是好事（换了配色主题也跟得上）。
 */
function collectTextures(project, root, pickedByType) {
  const ns = project.meta.id;
  const out = [];
  for (const [type, entries] of Object.entries(pickedByType)) {
    const dir = TEXTURE_DIRS[type];
    if (!dir) continue;
    for (const e of entries) {
      if (!e.texture || e.texture.mode !== 'custom') continue;
      const rel = `src/main/resources/assets/${ns}/textures/${dir}/${e.id}.png`;
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      try {
        const buf = fs.readFileSync(abs);
        out.push({ path: rel, dataUrl: `data:image/png;base64,${buf.toString('base64')}` });
      } catch {
        /* 读不出来就当没有，生成时还会再补一张 */
      }
    }
  }
  return out;
}

/**
 * 从工程捕获一个 Pack。
 *
 * opts:
 *   root        工程根（用于查模块字段定义与贴图文件）
 *   types       { item: ['ruby_sword'], recipe: [...] }
 *   closure     'full' | 'strong' | 'none'   默认 full
 *   hooks       要一起打包的 Java 钩子 id 列表（project.hooks.java 里的 id）
 *   jsHooks     要一起打包的 JS 钩子 id 列表
 *   name/id/desc/tags/params  包的元信息
 */
export function capturePack(project, opts = {}) {
  const root = opts.root || '.';
  const ns = project.meta.id;
  const index = buildIndex(project);
  const typeDefs = new Map(listContentTypes(root).map((t) => [t.id, t]));
  const closure = opts.closure || 'full';

  const want = new Map(); // type -> Set(id)
  for (const [type, ids] of Object.entries(opts.types || {})) {
    const set = new Set();
    for (const id of ids || []) if (id) set.add(String(id));
    if (set.size) want.set(type, set);
  }

  const findEntry = (type, id) => (project.entries[type] || []).find((e) => e.id === id) || null;
  // want 是「要带走什么」，expanded 是「哪些已经展开过依赖」。
  // 两者必须分开：用户勾的条目一开始就在 want 里，但仍然要展开它的依赖。
  const expanded = new Set();
  const missing = [];

  /** 拉一个条目（含依赖）进 picked */
  const pull = (type, id, depth = 0) => {
    const key = `${type}:${id}`;
    if (expanded.has(key)) return;
    expanded.add(key);

    const entry = findEntry(type, id);
    if (!entry) {
      missing.push(key);
      return;
    }
    if (!want.has(type)) want.set(type, new Set());
    want.get(type).add(id);
    if (closure === 'none' || depth > 8) return;

    const def = typeDefs.get(type);
    const refs = refsOf(entry, { index, fields: def?.fields || [], ns });
    for (const r of refs) {
      if (closure === 'strong') {
        // 只跟 ref 字段（真正的强依赖）
        const field = (def?.fields || []).find((f) => f.type === 'ref' && f.refType === r.type);
        if (!field) continue;
      }
      pull(r.type, r.id, depth + 1);
    }
  };

  for (const [type, ids] of [...want.entries()]) {
    for (const id of [...ids]) pull(type, id, 0);
  }

  // 组装条目
  const entries = {};
  const pickedByType = {};
  for (const [type, ids] of want) {
    const list = [];
    for (const id of ids) {
      const e = findEntry(type, id);
      if (!e) continue;
      list.push(JSON.parse(JSON.stringify(e)));
    }
    if (list.length) {
      entries[type] = list;
      pickedByType[type] = list;
    }
  }

  if (!Object.keys(entries).length && !(opts.hooks || []).length && !(opts.jsHooks || []).length) {
    throw new Error('没有选中任何内容，包会是空的');
  }

  // Java / JS 钩子
  const java = [];
  for (const hid of opts.hooks || []) {
    const h = (project.hooks?.java || []).find((x) => x.id === hid || x.name === hid);
    if (h) java.push({ target: h.target || 'init', name: h.name || hid, code: h.code });
  }
  const js = [];
  for (const hid of opts.jsHooks || []) {
    const h = (project.hooks?.js || []).find((x) => x.id === hid || x.path === hid);
    if (!h) continue;
    let code = '';
    try {
      const abs = path.isAbsolute(h.path) ? h.path : path.join(root, h.path);
      code = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    js.push({ path: path.basename(h.path), code });
  }

  const name = String(opts.name || '').trim() || defaultName(entries);
  const pack = makePack({
    id: opts.id,
    name,
    desc: opts.desc ?? defaultDesc(entries, java, js),
    kind: opts.kind,
    tags: opts.tags || [],
    author: project.meta.authors || '',
    origin: {
      kind: 'capture',
      ns,
      name: project.meta.name,
      at: Date.now(),
    },
    requires: {
      platform: [project.target.platform],
      mcVersion: [project.target.mcVersion],
      contentTypes: Object.keys(entries),
    },
    params: opts.params || [],
    content: {
      entries,
      java,
      js,
      textures: collectTextures(project, root, pickedByType),
    },
  });

  pack.__missing = missing;
  return pack;
}

function defaultName(entries) {
  const types = Object.keys(entries);
  if (!types.length) return '未命名代码片段';
  const first = types[0];
  const list = entries[first];
  if (list.length === 1) return toDisplay(list[0].id) || list[0].id;
  return `${toDisplay(list[0].id)} 等 ${types.reduce((n, t) => n + entries[t].length, 0)} 项`;
}

function defaultDesc(entries, java, js) {
  const parts = [];
  const count = Object.values(entries).reduce((n, l) => n + l.length, 0);
  if (count) parts.push(`${count} 项内容`);
  if (java.length) parts.push(`${java.length} 段 Java`);
  if (js.length) parts.push(`${js.length} 段 JS`);
  return `从工程捕获：${parts.join(' + ')}`;
}

/**
 * 只捕获代码：把当前所有的钩子代码打成一个「效果」包。
 * 这是「我写了一段逻辑，想复用」最直接的路径。
 */
export function captureHooks(project, opts = {}) {
  return capturePack(project, {
    ...opts,
    types: {},
    closure: 'none',
    hooks: opts.hooks || (project.hooks?.java || []).map((h) => h.id).filter(Boolean),
    jsHooks: opts.jsHooks || (project.hooks?.js || []).map((h) => h.id).filter(Boolean),
  });
}
