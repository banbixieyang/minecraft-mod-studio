/**
 * 工程模型 —— 编辑器的数据层。
 *
 * 一个「工程」就是一个完整的 Gradle 工程目录，编辑器数据存在 .studio/project.json。
 * 除 project.json 之外的一切文件都是「产出」，可以随时由数据重新生成。
 *
 * 这个模块不关心任何平台细节，平台差异全部交给 target 适配器。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { isValidId, validateId, uniqueId } from './ids.mjs';

export const STUDIO_DIR = '.studio';
export const DATA_FILE = 'project.json';
export const DATA_VERSION = 1;

/** 工程内所有路径都相对于工程根，统一用正斜杠 */
export function rel(...parts) {
  return parts.join('/').replace(/\\/g, '/');
}

export function hashOf(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 取某个目标的默认配置。
 *
 * 用动态 import 是为了避开循环依赖：target/registry 会用到工程模型，
 * 工程模型再静态 import registry 就成环了。
 * 这里是同步场景（blankProject 不是 async），所以用 createRequire。
 */
function targetDefaults(targetId) {
  if (!targetId) return null;
  try {
    const req = createRequire(import.meta.url);
    const { getTarget } = req('./target/registry.mjs');
    const t = getTarget(targetId);
    return t ? { ...t.defaults, id: t.id } : null;
  } catch {
    return null;
  }
}

/** 空白工程模板 */
function blankProject(meta = {}) {
  // 目标配置：优先用 meta.target（可能是字符串 id 或对象），
  // 否则按 id 从适配器取 defaults —— 这样只传 { id } 也不会丢字段。
  const rawTarget = meta.target;
  const targetId = typeof rawTarget === 'string'
    ? rawTarget
    : (rawTarget?.id || 'fabric-26.3');
  const defaults = targetDefaults(targetId) || {
    id: 'fabric-26.3',
    platform: 'fabric',
    mcVersion: '26.3',
    loaderVersion: '0.19.5',
    apiVersion: '0.164.0+26.3',
    javaVersion: 25,
  };
  const override = typeof rawTarget === 'object' && rawTarget ? rawTarget : {};

  return {
    studioVersion: DATA_VERSION,
    meta: {
      name: meta.name || '我的模组',
      id: meta.id || 'mymod',
      pkg: meta.pkg || 'com.example.mymod',
      version: meta.version || '0.1.0',
      authors: meta.authors || '',
      description: meta.description || '',
      license: meta.license || 'MIT',
      icon: meta.icon || '',
    },
    // target 由所选目标适配器的 defaults 整体提供。额外字段（forgeVersion / mappingChannel /
    // forgeGradleVersion 之类）原样保留，工程模型不认识也不该丢 —— 适配器 scaffold 要用。
    // ⚠️ meta.target 只覆盖它写了的字段，不能整体替换 ——
    //    否则只传 { id: 'forge-1.20.1' } 会把 javaVersion 之类的默认值全丢掉，
    //    生成出 languageVersion = undefined 的 build.gradle。
    target: {
      ...defaults,
      ...override,
      // 兼容旧调用：把 defaults 摊在 meta 顶层（早期 CLI / 脚本这么干）
      ...(meta.platform && !rawTarget
        ? {
            id: `${meta.platform}-${meta.mcVersion || ''}`.replace(/-$/, ''),
            platform: meta.platform,
            mcVersion: meta.mcVersion || '26.3',
            ...(meta.loaderVersion ? { loaderVersion: meta.loaderVersion } : {}),
            ...(meta.apiVersion ? { apiVersion: meta.apiVersion } : {}),
            ...(meta.javaVersion ? { javaVersion: meta.javaVersion } : {}),
          }
        : {}),
    },
    // 内容条目：contentTypeId -> entry[]，完全由模块决定有哪些类型
    entries: {},
    // 生成文件的指纹，用于检测「用户手改过生成区」
    files: {},
    // 自由扩展位：模块可以往这里写自己的状态
    state: {},
    // 生成钩子配置
    hooks: { java: [], js: [] },
    // 本地 mod 依赖：[{ name, path }]，path 是 jar 的绝对路径。
    // 用途：积木库里的某些积木要调用某个 mod 的 API
    //（比如 Goety 专属积木），那工程编译时就得把那个 mod 的 jar 挂上，
    // 否则生成的代码引用 com.Polarice3.Goety.* 编译不过。
    localDeps: [],
    // 可视化积木：程序（积木树）+ 装进这个工程的积木库
    // programs 里每项是一棵积木树；根必须是帽形（事件）积木。
    visual: { programs: [], libraries: [] },
  };
}

export function projectDir(root) {
  return path.resolve(root);
}

export function dataPath(root) {
  return path.join(projectDir(root), STUDIO_DIR, DATA_FILE);
}

/** 判断目录是不是一个工程 */
export function isProject(root) {
  return fs.existsSync(dataPath(root));
}

/** 新建工程（只写数据，不生成代码，代码由 pipeline 负责） */
export function createProject(root, meta) {
  const dir = projectDir(root);
  if (isProject(dir)) throw new Error(`目录已是一个工程：${dir}`);
  const data = blankProject(meta);
  const err = validateMeta(data.meta);
  if (err) throw new Error(err);
  fs.mkdirSync(path.join(dir, STUDIO_DIR), { recursive: true });
  fs.writeFileSync(dataPath(dir), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export function validateMeta(meta) {
  const idErr = validateId(meta.id);
  if (idErr) return `模组 id 不合法：${idErr}`;
  if (!meta.name || !String(meta.name).trim()) return '模组名称不能为空';
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(meta.pkg)) {
    return '包名格式应为 com.example.mymod（小写，至少两段，用点分隔）';
  }
  if (!/^\d+\.\d+\.\d+/.test(meta.version)) return '版本号格式应为 0.1.0';
  return null;
}

export function loadProject(root) {
  const file = dataPath(root);
  if (!fs.existsSync(file)) throw new Error(`不是工程目录（缺少 ${STUDIO_DIR}/${DATA_FILE}）：${root}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`工程数据损坏：${e.message}`);
  }
  return migrate(data);
}

/** 版本迁移：老工程数据升级到当前结构 */
function migrate(data) {
  if (!data.entries) data.entries = {};
  if (!data.files) data.files = {};
  if (!data.state) data.state = {};
  if (!data.hooks) data.hooks = { java: [], js: [] };
  // 老工程没有 target.id，按 platform + mcVersion 补一个，多目标解析才不会退回默认值
  if (data.target && !data.target.id) {
    data.target.id = `${data.target.platform || 'fabric'}-${data.target.mcVersion || ''}`.replace(/-$/, '');
  }
  if (data.hooks && !Array.isArray(data.hooks.java)) data.hooks.java = [];
  if (data.hooks && !Array.isArray(data.hooks.js)) data.hooks.js = [];
  // 老工程没有 localDeps（本地 mod 依赖）
  if (!Array.isArray(data.localDeps)) data.localDeps = [];
  // 老工程没有 visual（可视化积木程序）
  if (!data.visual || typeof data.visual !== 'object') data.visual = { programs: [], libraries: [] };
  if (!Array.isArray(data.visual.programs)) data.visual.programs = [];
  if (!Array.isArray(data.visual.libraries)) data.visual.libraries = [];
  data.studioVersion = DATA_VERSION;
  return data;
}

export function saveProject(root, data) {
  const file = dataPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 先写临时文件再改名，避免写一半断电留下坏文件
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return data;
}

// ---------------- 条目 CRUD ----------------

export function listEntries(data, type) {
  return data.entries[type] || [];
}

export function findEntry(data, type, id) {
  return listEntries(data, type).find((e) => e.id === id) || null;
}

export function takenIds(data, type) {
  return new Set(listEntries(data, type).map((e) => e.id));
}

/** 建议一个不冲突的 id（用于「新建」按钮直接给个默认值） */
export function suggestId(data, type, base = 'new_item') {
  const baseOk = isValidId(base) ? base : 'new_item';
  return uniqueId(baseOk, takenIds(data, type));
}

export function addEntry(data, type, entry, index = -1) {
  if (!data.entries[type]) data.entries[type] = [];
  const list = data.entries[type];
  const idErr = validateId(entry.id);
  if (idErr) throw new Error(`标识符不合法：${idErr}`);
  if (list.some((e) => e.id === entry.id)) {
    throw new Error(`标识符 "${entry.id}" 已被同类型条目占用`);
  }
  if (index < 0 || index >= list.length) list.push(entry);
  else list.splice(index, 0, entry);
  return entry;
}

export function updateEntry(data, type, id, patch) {
  const list = data.entries[type] || [];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) throw new Error(`找不到条目 ${type}/${id}`);
  if (patch.id && patch.id !== id) {
    const idErr = validateId(patch.id);
    if (idErr) throw new Error(`标识符不合法：${idErr}`);
    if (list.some((e) => e.id === patch.id)) throw new Error(`标识符 "${patch.id}" 已存在`);
  }
  list[i] = { ...list[i], ...patch };
  return list[i];
}

export function removeEntry(data, type, id) {
  const list = data.entries[type] || [];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

export function moveEntry(data, type, id, delta) {
  const list = data.entries[type] || [];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (i === j) return false;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
  return true;
}

// ---------------- 生成文件指纹 ----------------

/**
 * 记录生成的文件内容。下次生成时用它判断用户是否手改过。
 * 返回 { changed: [...] } —— 被用户改过的文件列表。
 */
export function recordGenerated(data, filePath, content) {
  if (!data.files) data.files = {};
  data.files[filePath] = { hash: hashOf(content), at: Date.now() };
}

export function wasHandEdited(data, filePath, currentContent) {
  const rec = data.files?.[filePath];
  if (!rec) return false; // 从没生成过，不算用户改过
  return rec.hash !== hashOf(currentContent);
}

export function forgetFile(data, filePath) {
  if (data.files) delete data.files[filePath];
}

// ---------------- 统计 ----------------

export function summarize(data, contentTypes) {
  const out = { total: 0, byType: {} };
  for (const t of contentTypes || Object.keys(data.entries)) {
    const n = listEntries(data, typeof t === 'string' ? t : t.id).length;
    out.byType[typeof t === 'string' ? t : t.id] = n;
    out.total += n;
  }
  return out;
}

/** 工程健康检查：跨条目引用是否有效 */
export function lintReferences(data) {
  const problems = [];
  const items = new Set(listEntries(data, 'item').map((e) => e.id));
  const blocks = new Set(listEntries(data, 'block').map((e) => e.id));
  const all = new Set([...items, ...blocks]);

  for (const r of listEntries(data, 'recipe')) {
    for (const slot of r.slots || []) {
      if (slot && slot.item && !slot.item.startsWith('#') && !all.has(stripNs(slot.item))) {
        problems.push({ level: 'warn', type: 'recipe', id: r.id, msg: `配方材料 ${slot.item} 不在本模组中（原版物品请确认 id 正确）` });
      }
    }
  }
  for (const l of listEntries(data, 'loot')) {
    if (l.block && !blocks.has(stripNs(l.block))) {
      problems.push({ level: 'warn', type: 'loot', id: l.id, msg: `战利品表绑定的方块 ${l.block} 不存在` });
    }
  }
  for (const w of listEntries(data, 'worldgen')) {
    if (w.block && !blocks.has(stripNs(w.block))) {
      problems.push({ level: 'error', type: 'worldgen', id: w.id, msg: `矿物生成指向的方块 ${w.block} 不存在` });
    }
    // 26.x 的 OreFeature 在 size < 4 时不产生任何方块（本机实测）。
    // 这是 26.x 独有的限制，1.20.1 的 minecraft:ore 没有，别拿去卡别的版本。
    if (/^26\./.test(String(data.target?.mcVersion || '')) && Number(w.size) < 4) {
      problems.push({ level: 'error', type: 'worldgen', id: w.id, msg: `size 必须 ≥ 4，否则该矿物一个都不会生成（26.x 引擎限制）` });
    }
  }
  return problems;
}

export function stripNs(s) {
  return String(s).includes(':') ? String(s).split(':')[1] : String(s);
}

export { blankProject };
