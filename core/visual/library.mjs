/**
 * 积木库格式（.mcblocks.json）。
 *
 * 一个库 = 一组积木定义 + 元信息。
 * 三层查找，先到先得：
 *   1. 内置库（代码里注册的）
 *   2. 工程库（<工程>/.studio/blocks/）
 *   3. 用户库（~/.mcstudio/blocks/）
 *
 * 库文件格式：
 * {
 *   "format": "mcblocks",
 *   "version": 1,
 *   "id": "goety-base",
 *   "name": "Goety 基础库",
 *   "description": "…",
 *   "source": { "type": "mod", "modId": "goety" },
 *   "categories": [ { "id": "spell", "label": "法术", "icon": "✦" } ],
 *   "blocks": [ { …积木定义… } ]
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerBlocks, unregisterBySource, allBlocks, registerCategories, unregisterCategoriesBySource } from './blocks.mjs';

export const LIB_FORMAT = 'mcblocks';
export const LIB_VERSION = 1;

/** 库的来源标识前缀，避免不同库之间 id 撞车 */
export function sourceTag(libId) {
  return `lib:${libId}`;
}

/**
 * 校验一个库对象。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateLibrary(lib) {
  const errors = [];
  const warnings = [];
  if (!lib || typeof lib !== 'object') {
    return { ok: false, errors: ['库不是合法对象'], warnings };
  }
  if (lib.format !== LIB_FORMAT) {
    errors.push(`格式标识不对，应为 "${LIB_FORMAT}"，实际是 "${lib.format}"`);
  }
  if (!lib.id) errors.push('库缺少 id');
  if (!lib.name) warnings.push('库没有名字，会显示为 id');
  if (!Array.isArray(lib.blocks)) {
    errors.push('库缺少 blocks 数组');
  } else if (!lib.blocks.length) {
    warnings.push('库里没有积木');
  } else {
    const seen = new Set();
    for (const b of lib.blocks) {
      if (!b || !b.id) { errors.push('有积木缺少 id'); continue; }
      if (seen.has(b.id)) errors.push(`积木 id 重复：${b.id}`);
      seen.add(b.id);
      if (!b.shape) errors.push(`积木 ${b.id} 缺少 shape`);
      if (!b.java || !Object.keys(b.java).length) {
        warnings.push(`积木 ${b.id} 没有 Java 实现`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 装一个库进注册表。
 * @param {object} lib 库对象
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite] 同 id 积木是否覆盖
 * @returns {{ok:boolean, added:string[], skipped:string[], errors:string[], warnings:string[]}}
 */
export function installLibrary(lib, opts = {}) {
  const v = validateLibrary(lib);
  if (!v.ok) {
    return { ok: false, added: [], skipped: [], errors: v.errors, warnings: v.warnings };
  }
  const tag = sourceTag(lib.id);
  // 先卸掉同源旧版，保证「重装库」能更新
  unregisterBySource(tag);
  unregisterCategoriesBySource(tag);
  const r = registerBlocks(lib.blocks, { source: tag, overwrite: opts.overwrite !== false });
  // 分类元信息也要登记 —— 否则界面上只能显示内部 id（"goety-soul"）
  registerCategories((lib.categories || []).map((c) => ({ ...c, source: tag })));
  return {
    ok: true,
    added: r.added,
    skipped: r.skipped.map((s) => `${s.id}（${s.why}）`),
    errors: v.errors,
    warnings: [...v.warnings, ...r.skipped.map((s) => `积木 ${s.id} ${s.why}`)],
  };
}

/** 卸载一个库 */
export function uninstallLibrary(libId) {
  return unregisterBySource(sourceTag(libId));
}

/**
 * 写库到磁盘。
 * @param {object} lib 库对象
 * @param {string} filePath 目标文件
 */
export function writeLibrary(lib, filePath) {
  const v = validateLibrary(lib);
  if (!v.ok) throw new Error(`库不合法：${v.errors.join('；')}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(lib, null, 2), 'utf8');
  return filePath;
}

/**
 * 读库。
 * @param {string} filePath
 */
export function readLibrary(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let lib;
  try {
    lib = JSON.parse(raw);
  } catch (e) {
    throw new Error(`库文件不是合法 JSON：${e.message}`);
  }
  return lib;
}

/**
 * 扫目录找所有库文件。
 * @param {string} dir
 * @returns {object[]} 库对象列表（读失败的用 error 字段带出来）
 */
export function scanLibraries(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.mcblocks.json')) continue;
    const full = path.join(dir, f);
    try {
      const lib = readLibrary(full);
      out.push({ ...lib, _file: full });
    } catch (e) {
      out.push({ id: f.replace(/\.mcblocks\.json$/, ''), name: f, error: e.message, _file: full, blocks: [] });
    }
  }
  return out;
}

/**
 * 扫目录并全部装进注册表。
 * @param {string} dir
 * @param {object} [opts]
 */
export function installAllFromDir(dir, opts = {}) {
  const libs = scanLibraries(dir);
  const results = [];
  for (const lib of libs) {
    if (lib.error) {
      results.push({ id: lib.id, ok: false, errors: [lib.error], added: [], skipped: [], warnings: [] });
      continue;
    }
    const r = installLibrary(lib, opts);
    results.push({ ...r, id: lib.id, name: lib.name });
  }
  return results;
}

/**
 * 从注册表里导出当前所有积木为一个库（用于「把装进来的库打包带走」）。
 * @param {object} opts
 * @param {string} opts.id 库 id
 * @param {string} opts.name 库名
 * @param {string[]} [opts.sources] 只导出这些来源的积木
 */
export function exportLibrary(opts = {}) {
  const blocks = allBlocks().filter((b) => {
    if (!opts.sources) return b.source && b.source.startsWith('lib:');
    return opts.sources.includes(b.source);
  });
  const cats = new Map();
  for (const b of blocks) {
    if (!cats.has(b.category)) cats.set(b.category, { id: b.category, label: b.category });
  }
  return {
    format: LIB_FORMAT,
    version: LIB_VERSION,
    id: opts.id || 'my-library',
    name: opts.name || '我的积木库',
    description: opts.description || '',
    source: opts.source || { type: 'user' },
    categories: [...cats.values()],
    blocks: blocks.map((b) => ({
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
      requiresMod: b.requiresMod,
      unverified: b.unverified,
    })),
  };
}
