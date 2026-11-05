/**
 * 分析引擎「扩展系统」—— 让引擎像 MC 的 mod 一样加载新工具来拓宽能力。
 *
 * 为什么需要：基础分析器只认原版那套（物品/方块/原版配方/材质…），但别人的
 * mod 常有自己的体系（Goety 的仪式配方、聚晶、套装词条）。把这些硬写进核心
 * 既臃肿又只对个别包有用。所以做成「扩展」：
 *
 *   每个扩展 = 一个独立文件夹，里面 index.mjs 默认导出一个「扩展描述对象」：
 *     {
 *       id, name, order,
 *       match: (meta) => boolean,          // 只对命中的 jar 激活（别的包不加载它）
 *       contentTypes: { 聚晶: {label,icon} }, // 新增的「内容类型」（拆解台分组 + 报告计数）
 *       fields: { 聚晶: [{key,label,kind}] }, // 拆解台里可编辑的字段
 *       analyze: (ctx) => ({ contents, warnings }), // 真正的解析：读 jar 资源
 *       onExport: (ctx) => ({ files, java, warnings }), // 可选：导出时追加产物
 *     }
 *
 * 引擎启动时自动扫描本目录下的 index.mjs 并加载（顶层 await 一次性装好，等价于
 * MC 启动时把 mod 全加载）。analyzed() 时只运行 match() 命中的扩展。新增一种 mod
 * 的支持 = 拖一个文件夹进来，核心代码零改动。
 *
 * onExport 是第二层扩展点：分析时只能「读出内容」，但有些 mod 的数值不在条目里
 * （比如 Forge 配置 —— 改值要落到 toml 文件或运行时代码才生效）。
 * onExport 让扩展能在导出这一步按「用户改了哪些值」生成对应的产物，
 * 同样不需要改核心代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function discover() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(HERE, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const idx = path.join(HERE, d.name, 'index.mjs');
    if (!fs.existsSync(idx)) continue;
    try {
      const mod = await import(pathToFileURL(idx).href);
      const def = mod.default;
      if (def && def.id) out.push(def);
    } catch (e) {
      console.warn(`[mcstudio:ext] 加载扩展失败 ${d.name}: ${e.message}`);
    }
  }
  out.sort((a, b) => (a.order || 0) - (b.order || 0));
  return out;
}

// 顶层 await：模块加载时把扩展一次性装上（MC 启动时把 mod 全加载好）。
export const EXTENSIONS = await discover();

/** 对当前 jar 生效的扩展（无 match 的视为通用扩展，始终激活） */
export function activeExtensions(meta) {
  const m = meta || {};
  return EXTENSIONS.filter((e) => typeof e.match !== 'function' || e.match(m));
}

/** 聚合所有扩展声明的内容类型标签 + 可编辑字段，供报告/拆解台读取 */
export function extensionMetadata() {
  const types = {};
  const fields = {};
  for (const e of EXTENSIONS) {
    for (const [t, def] of Object.entries(e.contentTypes || {})) {
      if (!types[t]) types[t] = def;
    }
    for (const [t, flds] of Object.entries(e.fields || {})) {
      if (Array.isArray(flds)) fields[t] = (fields[t] || []).concat(flds);
    }
  }
  return { types, fields };
}

/**
 * 导出时的扩展钩子。
 *
 * ctx = {
 *   report,          // 分析报告（含 contents）
 *   selection,       // 用户勾选了哪些条目 { type: [id] }
 *   overrides,       // 用户改了哪些字段 { type: { id: { key: value } } }
 *   pack,            // 已经组装好的包（扩展可以往里加东西）
 * }
 * 返回 { files:[], java:[], warnings:[] }，由 reportToPack 合并进包里。
 */
export async function runExportHooks(ctx) {
  const files = [];
  const java = [];
  const warnings = [];
  const meta = ctx?.report?.meta || {};
  for (const ext of activeExtensions(meta)) {
    if (typeof ext.onExport !== 'function') continue;
    try {
      const r = await ext.onExport(ctx);
      if (r && Array.isArray(r.files)) files.push(...r.files);
      if (r && Array.isArray(r.java)) java.push(...r.java);
      if (r && Array.isArray(r.warnings)) warnings.push(...r.warnings);
    } catch (e) {
      warnings.push(`扩展「${ext.name || ext.id}」导出失败：${e.message}`);
    }
  }
  return { files, java, warnings };
}
