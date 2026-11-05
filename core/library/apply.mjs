/**
 * 安装 —— 把 Pack 装进工程。
 *
 * 最容易出错的地方是 id：你从 A 工程抓的 ruby_sword，装进 B 工程时
 * B 工程可能已经有 ruby_sword 了。硬塞会撞，跳过又等于没装。
 * 所以这里做**自动改名 + 引用同步**：
 *   ruby_sword → ruby_sword_2
 * 并且包里所有指向 ruby_sword 的地方（配方材料、掉落表、进度图标…）一起改成 ruby_sword_2。
 *
 * 命名空间也会跟着换：从 fallen 抓的包装进 mymod，fallen:ruby 变 mymod:ruby。
 * 但**包外的引用**（那个 mod 里包里没带走的东西）保持原样，只在报告里列出来提醒你。
 */
import fs from 'node:fs';
import path from 'node:path';
import { addEntry, suggestId } from '../project.mjs';
import { renderPack } from './pack.mjs';

const DATA_URL_PNG = /^data:image\/png;base64,(.+)$/;

/** 收集工程里已有的所有 id（按类型） */
function takenByType(project) {
  const out = new Map();
  for (const [type, list] of Object.entries(project.entries || {})) {
    out.set(type, new Set((list || []).map((e) => e.id)));
  }
  return out;
}

/**
 * 算出改名方案。
 * 返回 { map: {type: {old:new}}, renames: [{type, from, to}], skipped: [...] }
 */
export function planApply(project, pack, opts = {}) {
  const onConflict = opts.onConflict || 'rename';
  const taken = takenByType(project);
  const map = {};
  const renames = [];
  const skipped = [];

  for (const [type, list] of Object.entries(pack.content?.entries || {})) {
    if (!taken.has(type)) taken.set(type, new Set());
    const set = taken.get(type);
    map[type] = {};
    for (const e of list || []) {
      if (!e || !e.id) continue;
      if (opts.idMap?.[type]?.[e.id]) {
        map[type][e.id] = opts.idMap[type][e.id];
        set.add(opts.idMap[type][e.id]);
        continue;
      }
      if (!set.has(e.id)) {
        map[type][e.id] = e.id;
        set.add(e.id);
        continue;
      }
      if (onConflict === 'skip') {
        skipped.push({ type, id: e.id });
        continue;
      }
      if (onConflict === 'overwrite') {
        map[type][e.id] = e.id;
        continue;
      }
      const next = suggestId(project, type, e.id);
      map[type][e.id] = next;
      set.add(next);
      renames.push({ type, from: e.id, to: next });
    }
  }
  return { map, renames, skipped };
}

/** 建一个「旧 id → 新 id」的全局查找表（跨类型，同名同改） */
function buildRenameLookup(plan, oldNs, newNs) {
  const byId = new Map();
  for (const [type, m] of Object.entries(plan.map)) {
    for (const [from, to] of Object.entries(m)) {
      if (from !== to) byId.set(from, to);
    }
  }
  return (value) => {
    if (typeof value !== 'string') return value;
    let s = value;

    // 1) 资源路径里的命名空间整体搬家（assets/<ns>/…  data/<ns>/…）
    if (oldNs && newNs && oldNs !== newNs) {
      const m = s.match(/^(assets|data)\/([^/]+)\//);
      if (m && m[2] === oldNs) s = s.replace(`/${oldNs}/`, `/${newNs}/`);
    }

    // 2) 精确 id（含带命名空间的写法）
    if (byId.has(s)) return byId.get(s);
    if (oldNs && newNs) {
      const pref = `${oldNs}:`;
      if (s.startsWith(pref)) {
        const bare = s.slice(pref.length);
        if (byId.has(bare)) return `${newNs}:${byId.get(bare)}`;
        // 包外引用：ns 还是换掉，至少指向导入后的工程
        return `${newNs}:${bare}`;
      }
    }
    return s;
  };
}

/** 递归重写任意 JSON 结构里的字符串 */
function rewriteTree(node, fn) {
  if (typeof node === 'string') return fn(node);
  if (Array.isArray(node)) return node.map((x) => rewriteTree(x, fn));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewriteTree(v, fn);
    return out;
  }
  return node;
}

/** 找出包里引用了「包外内容」的地方，用于提醒 */
function findExternalRefs(rendered, oldNs) {
  const inside = new Set();
  for (const list of Object.values(rendered.content?.entries || {})) {
    for (const e of list || []) inside.add(e.id);
  }
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      const m = v.match(/^([a-z0-9_.-]+):([a-z0-9_/.-]+)$/);
      if (m && m[1] !== 'minecraft' && m[1] === oldNs && !inside.has(m[2])) out.add(v);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  };
  walk(rendered.content?.entries || {});
  return [...out];
}

/**
 * 把包装进工程。**会修改 project 对象**，由调用方负责 saveProject。
 *
 * opts:
 *   params      参数值
 *   onConflict  'rename'（默认）| 'skip' | 'overwrite'
 *   idMap       手工指定改名
 *   withCode    是否带上代码（默认 true）
 *   withFiles   是否带上额外文件（默认 true）
 *   root        工程根，写 JS 钩子和贴图要用
 */
export function applyPack(root, project, pack, opts = {}) {
  const rendered = renderPack(pack, opts.params || {});
  const oldNs = pack.origin?.ns || '';
  const newNs = project.meta.id;
  const plan = planApply(project, rendered, opts);
  const rewrite = buildRenameLookup(plan, oldNs, newNs);

  const report = {
    packId: pack.id,
    packName: pack.name,
    added: {},
    renames: plan.renames,
    skipped: plan.skipped,
    java: 0,
    js: 0,
    files: [],
    textures: [],
    externalRefs: findExternalRefs(rendered, oldNs),
    missingParams: rendered.__missingParams || [],
    warnings: [],
  };

  // ---- 1. 内容条目 ----
  for (const [type, list] of Object.entries(rendered.content?.entries || {})) {
    const skippedIds = new Set(plan.skipped.filter((s) => s.type === type).map((s) => s.id));
    for (const raw of list || []) {
      if (skippedIds.has(raw.id)) continue;
      const newId = plan.map[type]?.[raw.id];
      if (!newId) continue;
      const entry = rewriteTree(raw, rewrite);
      entry.id = newId;

      const existing = (project.entries[type] || []).find((e) => e.id === newId);
      if (existing && opts.onConflict === 'overwrite') {
        Object.assign(existing, entry);
        report.added[type] = report.added[type] || [];
        report.added[type].push({ id: newId, overwritten: true });
        continue;
      }
      try {
        addEntry(project, type, entry);
        report.added[type] = report.added[type] || [];
        report.added[type].push({ id: newId, from: raw.id });
      } catch (e) {
        report.warnings.push(`条目 ${type}/${raw.id} 未能加入：${e.message}`);
      }
    }
  }

  // ---- 2. Java 钩子 ----
  if (opts.withCode !== false) {
    if (!project.hooks) project.hooks = { java: [], js: [] };
    if (!Array.isArray(project.hooks.java)) project.hooks.java = [];
    for (const h of rendered.content?.java || []) {
      const code = rewrite(h.code || '');
      if (!String(code).trim()) continue;
      project.hooks.java.push({
        id: `${pack.id}_${report.java}`,
        name: h.name || `${pack.name} · ${h.target || 'init'}`,
        target: h.target || 'init',
        code,
        enabled: true,
        fromPack: pack.id,
      });
      report.java++;
    }

    // ---- 3. JS 钩子 ----
    if (!Array.isArray(project.hooks.js)) project.hooks.js = [];
    for (const h of rendered.content?.js || []) {
      const code = rewrite(h.code || '');
      if (!String(code).trim()) continue;
      const dir = path.join(path.resolve(root), '.studio', 'hooks');
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `${pack.id}_${report.js}.mjs`;
      fs.writeFileSync(path.join(dir, fileName), code, 'utf8');
      project.hooks.js.push({
        id: `${pack.id}_js${report.js}`,
        path: `.studio/hooks/${fileName}`,
        stage: 'beforeWrite',
        enabled: true,
        fromPack: pack.id,
      });
      report.js++;
    }
  }

  // ---- 4. 额外文件 ----
  if (opts.withFiles !== false) {
    const rootAbs = path.resolve(root);
    for (const f of rendered.content?.files || []) {
      if (!f || !f.path) continue;
      const rel = rewrite(String(f.path));
      const abs = path.join(rootAbs, rel);
      if (!abs.startsWith(rootAbs)) {
        report.warnings.push(`文件路径越界，已跳过：${f.path}`);
        continue;
      }
      if (fs.existsSync(abs) && f.createOnly !== false) {
        report.warnings.push(`文件已存在，按「只创建不覆盖」跳过：${rel}`);
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(f.content ?? ''), 'utf8');
      report.files.push(rel);
    }

    // ---- 5. 贴图 ----
    for (const t of rendered.content?.textures || []) {
      if (!t || !t.path) continue;
      const m = String(t.dataUrl || '').match(DATA_URL_PNG);
      if (!m) continue;
      let rel = rewrite(String(t.path));
      // 贴图路径里的命名空间也要跟着搬（rewrite 只处理了开头，这里兜一层）
      if (oldNs && newNs && oldNs !== newNs) rel = rel.split(`/${oldNs}/`).join(`/${newNs}/`);
      const abs = path.join(rootAbs, rel);
      if (!abs.startsWith(rootAbs)) {
        report.warnings.push(`贴图路径越界，已跳过：${t.path}`);
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(m[1], 'base64'));
      report.textures.push(rel);
    }
  }

  if (report.missingParams.length) {
    report.warnings.push(`包里有未填的参数：${report.missingParams.join('、')}`);
  }
  if (report.externalRefs.length) {
    report.warnings.push(`引用了原工程里没被带走的内容：${report.externalRefs.slice(0, 6).join('、')}`);
  }
  return report;
}

/**
 * 只试算，不落地。界面在确认前用它展示「会改哪些名字」。
 */
export function previewApply(project, pack, opts = {}) {
  const rendered = renderPack(pack, opts.params || {});
  const plan = planApply(project, rendered, opts);
  const counts = {};
  for (const [type, list] of Object.entries(rendered.content?.entries || {})) {
    counts[type] = (list || []).length;
  }
  return {
    counts,
    renames: plan.renames,
    skipped: plan.skipped,
    java: (rendered.content?.java || []).length,
    js: (rendered.content?.js || []).length,
    files: (rendered.content?.files || []).length,
    textures: (rendered.content?.textures || []).length,
    externalRefs: findExternalRefs(rendered, pack.origin?.ns || ''),
    missingParams: rendered.__missingParams || [],
  };
}
