/**
 * 模块注册表 —— 扩展性的第一层。
 *
 * 一个模块 = modules/<name>/ 目录 + 里面的 module.json。
 * 引擎启动时扫描这里，把模块声明的「内容类型」全部注册进界面与生成管线。
 * 新增一种内容类型（比如「药水效果」「附魔」「结构」）不需要改引擎任何代码。
 *
 * module.json 契约：
 * {
 *   "id": "core-item",
 *   "name": "物品",
 *   "version": "1.0.0",
 *   "contentTypes": [{
 *     "id": "item",                    // 唯一，同时是 project.entries 的 key
 *     "label": "物品",
 *     "group": "内容",                  // 界面左侧分组
 *     "icon": "▣",
 *     "singular": "物品",
 *     "fields": [ ...字段定义... ],
 *     "generate": "./generate.mjs"     // 可选：模块自带的额外产出
 *   }]
 * }
 *
 * 字段定义：
 * { key, label, type, ... }
 * type ∈ text | textarea | number | select | checkbox | id | list | grid9 | tags | texture
 * 其余可选：options[{value,label}], default, min, max, step, hint, placeholder,
 *          required, readonly, showIf:{field, in:[...], equals}, columns
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODULES_DIR = path.resolve(HERE, '../../modules');

/** 模块可以放在引擎目录下，也可以放在工程目录的 .studio/modules 里（工程私有模块） */
export function moduleDirs(projectRoot) {
  const dirs = [{ dir: MODULES_DIR, scope: 'builtin' }];
  if (projectRoot) {
    const local = path.join(projectRoot, '.studio', 'modules');
    if (fs.existsSync(local)) dirs.push({ dir: local, scope: 'project' });
  }
  return dirs;
}

let cache = null;

export function listModules(projectRoot) {
  if (!projectRoot && cache) return cache;
  const modules = [];
  const seen = new Set();

  for (const { dir, scope } of moduleDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const manifestPath = path.join(dir, name, 'module.json');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        console.warn(`[modules] 跳过 ${name}：module.json 解析失败 — ${e.message}`);
        continue;
      }
      if (!manifest.id || seen.has(manifest.id)) continue;
      seen.add(manifest.id);
      manifest.__dir = path.join(dir, name);
      manifest.__scope = scope;
      modules.push(manifest);
    }
  }
  modules.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
  if (!projectRoot) cache = modules;
  return modules;
}

/** 摊平成内容类型列表，附带所属模块信息 */
export function listContentTypes(projectRoot) {
  const out = [];
  for (const m of listModules(projectRoot)) {
    for (const ct of m.contentTypes || []) {
      out.push({
        ...ct,
        moduleId: m.id,
        moduleName: m.name,
        scope: m.__scope,
        moduleDir: m.__dir,
      });
    }
  }
  return out;
}

export function getContentType(projectRoot, typeId) {
  return listContentTypes(projectRoot).find((t) => t.id === typeId) || null;
}

/** 清缓存（装了新模块后调用） */
export function invalidate() {
  cache = null;
}

/**
 * 加载某个内容类型自带的生成器。
 * 生成器模块导出：export default { emit(ctx) { ... } }
 * ctx 见 pipeline.mjs 里构造的 moduleCtx。
 */
export async function loadGenerator(contentType) {
  if (!contentType.generate) return null;
  const file = path.join(contentType.moduleDir, contentType.generate);
  if (!fs.existsSync(file)) return null;
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return mod.default || mod;
}

/** 校验模块声明的字段是否自洽 */
export function validateContentType(ct) {
  const errs = [];
  if (!ct.id) errs.push('缺少 id');
  if (!ct.label) errs.push('缺少 label');
  if (!Array.isArray(ct.fields) || !ct.fields.length) errs.push('缺少 fields');
  const keys = new Set();
  for (const f of ct.fields || []) {
    if (!f.key) errs.push('字段缺少 key');
    if (keys.has(f.key)) errs.push(`字段 key 重复：${f.key}`);
    keys.add(f.key);
    if (f.type === 'select' && !Array.isArray(f.options)) errs.push(`字段 ${f.key} 是 select 但没有 options`);
  }
  if (!keys.has('id')) errs.push('必须声明一个 key 为 "id" 的字段');
  return errs;
}

/** 新建内容类型时用的空条目 */
export function blankEntry(ct, id) {
  const e = { id };
  for (const f of ct.fields || []) {
    if (f.key === 'id') continue;
    e[f.key] = f.default !== undefined ? f.default : f.type === 'checkbox' ? false : f.type === 'number' ? (f.min ?? 0) : '';
  }
  return e;
}
