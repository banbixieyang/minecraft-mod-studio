/**
 * 功能中间表示（Feature IR）—— 转换器只认这一种形状。
 *
 * 为什么不直接改 project.json / pack：
 *   同一个「功能」可能来自工程、分享包、一段 Java、效果库、积木程序，
 *   甚至是一个任意 mod 的分析产物。让规则面对统一形状，规则才写得短、
 *   才能被第三方复用。IR 是纯 JSON，能存文件、能过 HTTP、能进 CI。
 *
 *   {
 *     format:'mcstudio.feature', version:1,
 *     id, name, kind, tags, summary,
 *     origin: { type, path, targetId, platform, mcVersion },
 *     requires: { platform:[], mcVersion:[], mods:[], modules:[], contentTypes:[] },
 *     content: {
 *       entries:  { <contentType>: [entry...] },   // 平台无关：生成器按目标出资源
 *       java:     [{ name, target, code }],        // 代码钩子 / 效果实现
 *       programs: [ programTree ],                // 积木程序：平台无关
 *       files:    [{ path, content, createOnly }], // 直接生成的资源/源码（方言相关）
 *       deps:     [{ name, path }],               // compileOnly jar
 *       lang:     { zh_cn:{}, en_us:{} },
 *     },
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProject, isProject } from '../project.mjs';
import { EFFECTS, getEffect } from '../library/effects.mjs';
import { listTargets } from '../target/registry.mjs';

export const FEATURE_FORMAT = 'mcstudio.feature';
export const FEATURE_VERSION = 1;

export function blankFeature(meta = {}) {
  return {
    format: FEATURE_FORMAT,
    version: FEATURE_VERSION,
    id: meta.id || 'feature',
    name: meta.name || '未命名功能',
    kind: meta.kind || 'mixed',
    tags: meta.tags || [],
    summary: meta.summary || '',
    origin: {
      type: meta.type || 'code',
      path: meta.path || '',
      targetId: meta.targetId || '',
      platform: meta.platform || '',
      mcVersion: meta.mcVersion || '',
    },
    requires: { platform: [], mcVersion: [], mods: [], modules: [], contentTypes: [], ...(meta.requires || {}) },
    content: {
      entries: {}, java: [], programs: [], files: [], deps: [], lang: {},
      ...(meta.content || {}),
    },
  };
}

function normRequires(r) {
  const out = { platform: [], mcVersion: [], mods: [], modules: [], contentTypes: [] };
  if (!r || typeof r !== 'object') return out;
  for (const k of Object.keys(out)) {
    const v = r[k];
    out[k] = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  }
  return out;
}

/** 工程 → IR。entries / hooks / 积木程序 / 依赖都带出来，但不带生成产物。 */
export function featureFromProject(input, opts = {}) {
  const p = typeof input === 'string' ? loadProject(input) : input;
  if (!p || !p.meta) throw new Error('不是合法工程数据');
  const targetId = opts.targetId || p.target?.id || '';
  const f = blankFeature({
    id: p.meta.id,
    name: p.meta.name || p.meta.id,
    kind: 'mixed',
    type: 'project',
    path: typeof input === 'string' ? input : '',
    targetId,
    platform: p.target?.platform || '',
    mcVersion: p.target?.mcVersion || '',
    summary: `${p.meta.name}：${Object.values(p.entries || {}).reduce((n, a) => n + (a?.length || 0), 0)} 个内容`,
  });
  f.content.entries = JSON.parse(JSON.stringify(p.entries || {}));
  f.content.java = (p.hooks?.java || []).map((h) => ({
    name: h.name || '钩子', target: h.target || 'init', code: String(h.code || ''),
  }));
  f.content.programs = JSON.parse(JSON.stringify(p.visual?.programs || []));
  f.content.deps = (p.localDeps || []).map((d) => ({ ...d }));
  return f;
}

/** 分享包 → IR（effectToPack / analyze reportToPack 的产物都能进）。 */
export function featureFromPack(pack, opts = {}) {
  if (!pack || typeof pack !== 'object') throw new Error('不是合法分享包');
  const req = normRequires(pack.requires);
  const f = blankFeature({
    id: pack.id || 'pack',
    name: pack.name || pack.id || '分享包',
    kind: pack.kind || 'mixed',
    type: 'pack',
    path: opts.path || '',
    targetId: opts.targetId || '',
    platform: req.platform[0] || '',
    mcVersion: req.mcVersion[0] || '',
    requires: { ...req, mods: [...req.mods, ...(pack.origin?.modId ? [pack.origin.modId] : [])] },
    summary: pack.desc || '',
    tags: pack.tags || [],
  });
  const c = pack.content || {};
  f.content.entries = JSON.parse(JSON.stringify(c.entries || {}));
  f.content.java = (c.java || []).map((h) => ({ name: h.name || '钩子', target: h.target || 'init', code: String(h.code || '') }));
  f.content.files = (c.files || []).map((x) => ({ ...x }));
  f.content.lang = JSON.parse(JSON.stringify(c.lang || {}));
  return f;
}

/** 一段 Java → IR。转换单个效果/钩子时最常用。 */
export function featureFromCode(code, meta = {}) {
  const f = blankFeature({
    id: meta.id || 'snippet',
    name: meta.name || '代码片段',
    kind: meta.kind || 'effect',
    type: 'code',
    path: meta.path || '',
    targetId: meta.targetId || '',
    platform: meta.platform || '',
    mcVersion: meta.mcVersion || '',
    summary: meta.summary || '',
    tags: meta.tags || [],
  });
  f.content.java.push({ name: meta.name || '代码片段', target: meta.target || 'init', code: String(code || '') });
  return f;
}

/** 内置效果库 → IR。{{param}} 用默认值填好，得到一个能直接看的成品。 */
export function featureFromEffect(effectId, meta = {}) {
  const e = getEffect(effectId) || EFFECTS.find((x) => x.id === effectId);
  if (!e) throw new Error(`找不到效果：${effectId}（可用：${EFFECTS.map((x) => x.id).slice(0, 5).join(', ')}…）`);
  const values = Object.fromEntries((e.params || []).map((p) => [p.key, p.default]));
  const render = (s) => String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
  const f = blankFeature({
    id: e.id, name: e.name, kind: 'effect', type: 'effect',
    targetId: meta.targetId || 'fabric-26.3',
    platform: meta.platform || 'fabric',
    mcVersion: meta.mcVersion || '26.3',
    summary: e.desc || '',
    tags: e.tags || [],
  });
  f.content.java = (e.java || []).map((h) => ({ name: h.name || e.name, target: h.target || 'init', code: render(h.code) }));
  f.requires.mods = (e.abilities || []).slice();
  return f;
}

/** 自动认格式：IR / 分享包 / 工程数据 / 积木库。 */
export function featureFromObject(obj, meta = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('输入不是对象');
  if (obj.format === FEATURE_FORMAT) return obj;
  if (obj.format === 'mcstudio.pack' || obj.content?.entries || obj.content?.java) return featureFromPack(obj, meta);
  if (obj.meta && obj.entries) return featureFromProject(obj, meta);
  if (obj.format === 'mcblocks' && Array.isArray(obj.blocks)) {
    const f = blankFeature({ id: obj.id, name: obj.name, kind: 'blocks', type: 'library', ...meta });
    // 积木库的 java 模板是「按目标分派」的，天生跨平台：只登记成文件，交给 blocks 规则判定
    f.content.files = obj.blocks.map((b) => ({ path: `block/${b.id}.json`, content: JSON.stringify(b.java || {}) }));
    return f;
  }
  throw new Error('认不出输入格式（支持 mcstudio.feature / mcstudio.pack / project.json / mcblocks）');
}

/** 从文件或工程目录读 IR。.java/.txt 当代码，其余当 JSON。 */
export function readFeature(src, meta = {}) {
  const p = path.resolve(String(src || ''));
  if (!fs.existsSync(p)) throw new Error(`路径不存在：${p}`);
  if (fs.statSync(p).isDirectory()) {
    if (!isProject(p)) throw new Error(`不是工程目录（缺少 .studio/project.json）：${p}`);
    return featureFromProject(p, meta);
  }
  const text = fs.readFileSync(p, 'utf8');
  if (/\.(java|txt)$/i.test(p)) return featureFromCode(text, { ...meta, path: p, name: path.basename(p) });
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error(`${p} 不是合法 JSON：${e.message}`); }
  return featureFromObject(obj, { ...meta, path: p });
}

/** 没写源目标时，按 requires.platform + mcVersion 猜一个已登记目标。 */
export function inferTargetId(feature, hint = '') {
  if (hint) return String(hint);
  if (feature?.origin?.targetId) return String(feature.origin.targetId);
  const pf = String(feature?.requires?.platform?.[0] || feature?.origin?.platform || '').toLowerCase();
  const mv = String(feature?.requires?.mcVersion?.[0] || feature?.origin?.mcVersion || '').toLowerCase();
  const alias = { neoforge: 'forge', quilt: 'fabric' };
  const wanted = alias[pf] || pf;
  const all = listTargets();
  const exact = all.find((t) => (!wanted || t.platform === wanted) && (!mv || t.mcVersion === mv));
  if (exact) return exact.id;
  const byPlatform = all.find((t) => !wanted || t.platform === wanted);
  return byPlatform?.id || all[0]?.id || '';
}

/**
 * 把 IR 摊平成「部件」，规则按 part id 报告 & 回填。
 * 部件顺序固定，报告里的 id 才能跨次稳定（测试/界面对照用）。
 */
export function collectParts(feature) {
  const c = feature?.content || {};
  const parts = [];
  for (const [type, list] of Object.entries(c.entries || {})) {
    (Array.isArray(list) ? list : []).forEach((entry, i) => {
      parts.push({ id: `entry/${type}/${i}`, kind: 'entry', label: `${type} · ${entry?.id || i}`, data: entry, type });
    });
  }
  (c.java || []).forEach((j, i) => {
    parts.push({ id: `java/${i}`, kind: 'java', label: j?.name || `代码 ${i}`, code: String(j?.code || ''), data: j });
  });
  (c.programs || []).forEach((prog, i) => {
    parts.push({ id: `program/${i}`, kind: 'program', label: `积木程序 ${i + 1} · ${prog?.op || ''}`, data: prog });
  });
  (c.files || []).forEach((f, i) => {
    parts.push({ id: `file/${i}`, kind: 'file', label: f?.path || `文件 ${i}`, path: f?.path || '', code: String(f?.content || ''), data: f });
  });
  (c.deps || []).forEach((d, i) => {
    parts.push({ id: `dep/${i}`, kind: 'dep', label: d?.name || `依赖 ${i}`, data: d });
  });
  if (Object.keys(c.lang || {}).length) {
    parts.push({ id: 'lang', kind: 'lang', label: '语言文件', data: c.lang });
  }
  parts.push({ id: 'requires', kind: 'requires', label: '适用平台/版本', data: feature?.requires || {} });
  return parts;
}

/** 按 part id 回填；返回是否命中。 */
export function setPart(feature, partId, patch = {}) {
  const c = feature.content;
  let m;
  if ((m = /^entry\/([^/]+)\/(\d+)$/.exec(partId))) {
    const list = c.entries?.[m[1]];
    if (!list || !list[Number(m[2])]) return false;
    list[Number(m[2])] = patch.data ?? { ...list[Number(m[2])], ...patch.merge };
    return true;
  }
  if ((m = /^java\/(\d+)$/.exec(partId))) {
    const j = c.java?.[Number(m[1])];
    if (!j) return false;
    if ('code' in patch) j.code = patch.code;
    if ('todo' in patch && Array.isArray(patch.todo) && patch.todo.length) {
      // 多条规则可能同时给同一部件加提示，别互相覆盖，也别重复加。
      const lines = patch.todo.map((s) => `// TODO(转换): ${s}`);
      const existing = String(j.code || '').split('\n').filter((l) => l.includes('TODO(转换)'));
      const fresh = lines.filter((l) => !existing.includes(l));
      if (fresh.length) j.code = [...fresh, j.code].join('\n');
    }
    if ('data' in patch) c.java[Number(m[1])] = patch.data;
    return true;
  }
  if ((m = /^program\/(\d+)$/.exec(partId))) {
    if (!c.programs?.[Number(m[1])]) return false;
    if ('data' in patch) c.programs[Number(m[1])] = patch.data;
    return true;
  }
  if ((m = /^file\/(\d+)$/.exec(partId))) {
    const f = c.files?.[Number(m[1])];
    if (!f) return false;
    if ('code' in patch) f.content = patch.code;
    if ('path' in patch) f.path = patch.path;
    if ('data' in patch) c.files[Number(m[1])] = patch.data;
    return true;
  }
  if ((m = /^dep\/(\d+)$/.exec(partId))) {
    if (!c.deps?.[Number(m[1])]) return false;
    if ('data' in patch) c.deps[Number(m[1])] = patch.data;
    return true;
  }
  if (partId === 'requires' && 'data' in patch) { feature.requires = patch.data; return true; }
  if (partId === 'lang' && 'data' in patch) { c.lang = patch.data; return true; }
  return false;
}

export function featureSummary(feature) {
  const parts = collectParts(feature);
  const byKind = {};
  for (const p of parts) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  return { id: feature.id, name: feature.name, kind: feature.kind, total: parts.length, byKind, parts: parts.map((p) => ({ id: p.id, kind: p.kind, label: p.label })) };
}
