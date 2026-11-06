/**
 * 积木库注册表 —— 三层查找。
 *
 *   1. 内置库（builtin.mjs，代码里注册）
 *   2. 工程库（<工程>/.studio/blocks/*.mcblocks.json）
 *   3. 用户库（~/.mcstudio/blocks/*.mcblocks.json）
 *
 * 后装的覆盖先装的（同 id 积木），这样用户可以改内置积木的行为。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerBlocks, allBlocks, getBlock, blocksByCategory, isBuiltinInstalled, markBuiltinInstalled, allCategories } from './blocks.mjs';
import { builtinBlocks, BUILTIN_CATEGORIES } from './builtin.mjs';
import { RAW_JAVA_BLOCK, clearDecompileCache } from './decompile.mjs';
import { installAllFromDir, scanLibraries } from './library.mjs';
import { SIGNATURES } from './compile.mjs';

/** 用户级积木库目录 */
export function userBlocksDir() {
  return path.join(os.homedir(), '.mcstudio', 'blocks');
}

/** 工程级积木库目录 */
export function projectBlocksDir(projectRoot) {
  return path.join(projectRoot, '.studio', 'blocks');
}

/**
 * 装内置积木。重复调用安全。
 */
export function ensureBuiltin() {
  if (isBuiltinInstalled()) return;
  registerBlocks([RAW_JAVA_BLOCK, ...builtinBlocks()], { source: 'builtin' });
  markBuiltinInstalled();
}

/**
 * 装某个工程的库 + 用户库。
 * @param {string} [projectRoot]
 * @returns {{installed:object[], errors:string[]}}
 */
export function loadLibraries(projectRoot) {
  ensureBuiltin();
  const installed = [];
  const errors = [];

  // 用户库先装，工程库后装 —— 工程里覆盖用户设置
  for (const [label, dir] of [
    ['用户库', userBlocksDir()],
    ['工程库', projectRoot ? projectBlocksDir(projectRoot) : null],
  ]) {
    if (!dir) continue;
    if (!fs.existsSync(dir)) continue;
    const results = installAllFromDir(dir);
    for (const r of results) {
      if (r.ok) installed.push({ ...r, label });
      else errors.push(`${label} ${r.id}：${r.errors.join('；')}`);
    }
  }
  clearDecompileCache();
  return { installed, errors };
}

/**
 * 全部可用的库（给界面显示「装了哪些库」）。
 */
export function listLibraries(projectRoot) {
  const out = [];
  const dirs = [
    { label: '用户库', dir: userBlocksDir(), scope: 'user' },
  ];
  if (projectRoot) dirs.push({ label: '工程库', dir: projectBlocksDir(projectRoot), scope: 'project' });
  for (const d of dirs) {
    for (const lib of scanLibraries(d.dir)) {
      out.push({
        id: lib.id,
        name: lib.name || lib.id,
        description: lib.description || '',
        scope: d.scope,
        scopeLabel: d.label,
        blockCount: (lib.blocks || []).length,
        error: lib.error || null,
        file: lib._file,
      });
    }
  }
  return out;
}

/**
 * 给界面用的积木清单（按分类分组）。
 * @param {string} targetId 当前目标
 */
export function blockCatalog(targetId) {
  ensureBuiltin();
  const byCat = blocksByCategory();
  const cats = [];
  const meta = new Map(allCategories().map((c) => [c.id, c]));

  // 先放内置分类（保证顺序稳定）
  for (const c of BUILTIN_CATEGORIES) {
    const list = byCat.get(c.id) || [];
    if (!list.length) continue;
    cats.push({ ...c, blocks: list.map((b) => serializeBlock(b, targetId, c.color)) });
  }
  // 再放库带来的分类
  //
  // ⚠️ 分类名要用库里的友好名（"Goety · 灵魂能量"），
  //    不能直接显示内部 id（"goety-soul"）—— 小朋友看不懂。
  //    库没登记分类信息时才退回 id。
  for (const [cid, list] of byCat) {
    if (BUILTIN_CATEGORIES.some((c) => c.id === cid)) continue;
    const m = meta.get(cid);
    const color = m?.color || '';
    cats.push({
      id: cid,
      label: m?.label || cid,
      icon: m?.icon || '📦',
      color: color || '#6e6e78',
      blocks: list.map((b) => serializeBlock(b, targetId, color)),
    });
  }
  return cats;
}

/**
 * 序列化一条积木定义给前端。
 * @param {object} b 积木定义
 * @param {string} targetId 当前目标
 * @param {string} [catColor] 分类颜色（积木本体用它着色）
 */
function serializeBlock(b, targetId, catColor = '') {
  const tpl = b.java?.[targetId] || null;
  // 事件帽形积木没有 java 模板 —— 它们的事件签名在 compile.mjs 的 SIGNATURES 里。
  // 只要签名存在就算支持。
  const isEvent = b.shape === 'hat';
  const supported = !!tpl || !!b.userDef || (isEvent && hasSignature(b.id));
  return {
    id: b.id,
    category: b.category,
    color: catColor || null,
    shape: b.shape,
    label: b.label,
    icon: b.icon,
    description: b.description,
    inputs: b.inputs || [],
    fields: b.fields || [],
    source: b.source,
    supported,
    // 没实现的积木在界面上标灰
    hint: supported ? null : `这条积木在当前目标（${targetId}）下还没有实现`,
    // 需要装某个 mod 才能编译（比如 Goety 专属积木）
    requiresMod: b.requiresMod || null,
    userDef: b.userDef || null,
    // 容器槽：界面要靠它画 C 型槽，不然用户没法往 if 里放积木。
    // ⚠️ 不能让前端自己猜 —— 前端拿不到 java 模板。
    //    显式声明的 bodySlots 优先，没声明就从模板里的 %body / %elseBody 标记推。
    bodySlots: bodySlotsOf(b, tpl),
  };
}

/**
 * 算出这条积木有哪些容器槽。
 *
 * 两种来源：
 *   · 定义里显式写了 bodySlots（如 flow.if_else 的 body + elseBody）
 *   · 模板里有 %body / %elseBody / %body2 标记（如 flow.if 只有 %body）
 */
function bodySlotsOf(b, tpl) {
  const explicit = b.bodySlots;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const t = tpl || Object.values(b.java || {})[0] || '';
  const found = [];
  for (const slot of ['body', 'elseBody', 'body2']) {
    if (new RegExp(`%${slot}\\b`).test(t)) found.push(slot);
  }
  return found;
}

/** 这个事件积木有没有签名定义 */
function hasSignature(op) {
  return !!SIGNATURES[op];
}

/**
 * 从一段代码造一个自定义积木。
 *
 * 这是「任何人都能把代码打包成积木」的入口：
 * 用户给一段 Java、一个名字、几个参数，工具把它变成一条积木。
 *
 * @param {object} opts
 * @param {string} opts.id 积木 id
 * @param {string} opts.name 积木显示名
 * @param {string} opts.code Java 代码模板（用 %param 占位）
 * @param {Array} [opts.params] 参数定义 [{name, kind, default}]
 * @param {string} [opts.category]
 * @param {string} [opts.description]
 * @param {string} [opts.targetId] 只在这个目标下可用
 * @returns {{ok:boolean, block?:object, error?:string}}
 */
export function createUserBlock(opts = {}) {
  const id = String(opts.id || '').trim();
  const name = String(opts.name || '').trim();
  const code = String(opts.code || '').trim();

  if (!id) return { ok: false, error: '积木 id 不能为空' };
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/.test(id)) {
    return { ok: false, error: '积木 id 只能包含字母、数字、下划线和点' };
  }
  if (!name) return { ok: false, error: '积木名字不能为空' };
  if (!code) return { ok: false, error: '代码不能为空' };

  const params = opts.params || [];
  const targetId = opts.targetId || 'fabric-26.3';

  // 参数必须在代码里被用到，且占位符要合法
  const declared = new Set();
  for (const p of params) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name || '')) {
      return { ok: false, error: `参数名「${p.name}」不合法` };
    }
    if (declared.has(p.name)) {
      return { ok: false, error: `参数名「${p.name}」重复` };
    }
    declared.add(p.name);
    // 代码里要真的用到这个参数（%name 或 %{name} 都算）
    if (!new RegExp(`%\\{?${p.name}\\}?\\b`).test(code)) {
      return { ok: false, error: `代码里没有用到参数 %${p.name}` };
    }
  }
  // 代码里不能有未声明的占位符
  const used = [...code.matchAll(/%\{?(\w+)\}?/g)].map((m) => m[1]);
  for (const u of used) {
    if (!declared.has(u)) {
      return { ok: false, error: `代码里的 %${u} 没有对应的参数定义` };
    }
  }

  const def = {
    id,
    category: opts.category || 'custom',
    shape: opts.shape || 'stack',
    label: name,
    icon: opts.icon || '🧩',
    description: opts.description || '',
    inputs: params.map((p) => ({
      name: p.name,
      kind: p.kind || 'text',
      default: p.default ?? '',
      required: p.required !== false,
    })),
    fields: [],
    java: { [targetId]: code },
    userDef: {
      code,
      params: params.map((p) => ({ ...p })),
      targetId,
      createdAt: new Date().toISOString(),
    },
  };

  const r = registerBlocks([def], { source: 'custom', overwrite: true });
  if (!r.added.length) {
    return { ok: false, error: `注册失败：${r.skipped.map((s) => s.why).join('；')}` };
  }
  clearDecompileCache();
  return { ok: true, block: getBlock(id) };
}

/**
 * 把自定义积木导成库（用户可以分享给别人）。
 * @param {string[]} ids 要导出的自定义积木 id
 */
export function exportUserBlocks(ids) {
  const blocks = ids
    .map((id) => getBlock(id))
    .filter((b) => b && b.userDef)
    .map((b) => ({
      id: b.id,
      category: b.category,
      shape: b.shape,
      label: b.label,
      icon: b.icon,
      description: b.description,
      inputs: b.inputs,
      fields: b.fields,
      java: b.java,
      userDef: b.userDef,
      requiresMod: b.requiresMod || null,
    }));
  return {
    format: 'mcblocks',
    version: 1,
    id: 'my-custom-blocks',
    name: '我的自定义积木',
    description: '从代码打包出来的积木',
    source: { type: 'user' },
    categories: [{ id: 'custom', label: '自定义', icon: '🧩' }],
    blocks,
  };
}
