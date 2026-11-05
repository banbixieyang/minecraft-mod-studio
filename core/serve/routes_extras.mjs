/**
 * 扩展路由：包库（library/*）与分析（analyze/*）。
 *
 * 单独一个文件，是因为这两块的能力会一直长 —— 全塞进 server.mjs 很快就没法看了。
 * server.mjs 只在路由分发处加一行，剩下的都归这里。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as P from '../project.mjs';
import { listPacks, getPack, savePack, overwritePack, deletePack, movePack, exportPack, importPack, libraryScopes } from '../library/store.mjs';
import { capturePack } from '../library/capture.mjs';
import { applyPack, previewApply } from '../library/apply.mjs';
import { EFFECTS, getEffect, effectToPack, effectsForAbility } from '../library/effects.mjs';
import { renderText } from '../library/pack.mjs';
import { analyze, reportToPack, reportSummary, closeReport } from '../analyze/report.mjs';
import { openSource } from '../analyze/sources.mjs';
import {
  MAX_UPLOAD, saveJarBytes, listImportedJars, removeImportedJar, isNestedJarEntry,
} from '../analyze/imports.mjs';

// ---------- 小工具（和 server.mjs 里那套一致，故意各自独立） ----------

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const ok = (res, data = {}) => json(res, 200, { ok: true, ...data });
const fail = (res, code, message) => json(res, code, { ok: false, error: String(message) });

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON：${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 上传走原始二进制，不经过上面那套 JSON 解析。
 * 超限时不再往内存里攒，但把流读完再回一个明确的 JSON 错误 ——
 * 直接 destroy 连接的话，浏览器只会看到「网络错误」，不知道是文件太大。
 */
function readBinaryBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { over = true; return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function formatMb(n) {
  return `${Math.round(n / 1024 / 1024)} MB`;
}

// ---------- 分析报告缓存 ----------
// 分析一次要读几十兆 jar、解析上百个 class，界面来回切标签不该重跑。
// 用「路径 + 修改时间 + 大小」当 key，文件一变就自动失效。
const reportCache = new Map();

function cacheKey(abs) {
  try {
    const st = fs.statSync(abs);
    return `${abs}|${st.mtimeMs}|${st.size}`;
  } catch {
    return abs;
  }
}

function getReport(abs) {
  const key = cacheKey(abs);
  const hit = reportCache.get(key);
  if (hit) return hit;
  const report = analyze(abs);
  reportCache.set(key, report);
  // 只留最近 6 份，避免同时分析多个大包时内存涨
  if (reportCache.size > 6) {
    const oldest = [...reportCache.keys()][0];
    const r = reportCache.get(oldest);
    closeReport(r);
    reportCache.delete(oldest);
  }
  return report;
}

// ---------- 常用目录扫描 ----------

function mcDirs() {
  const out = [];
  const appData = process.env.APPDATA;
  if (appData) {
    const dot = path.join(appData, '.minecraft');
    out.push(path.join(dot, 'mods'));
    const verDir = path.join(dot, 'versions');
    if (fs.existsSync(verDir)) {
      try {
        for (const v of fs.readdirSync(verDir)) out.push(path.join(verDir, v, 'mods'));
      } catch {
        /* 权限问题就跳过 */
      }
    }
  }
  return out;
}

/** 找一些「用户大概率想分析的 jar」 */
function recentJars(root) {
  const out = [];
  const push = (file, label) => {
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return;
      out.push({ name: path.basename(file), path: file, label, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* ignore */
    }
  };

  // 1) 编辑器自己工程的构建产物
  const projRoot = root ? path.dirname(path.resolve(root)) : null;
  const projectsDir = projRoot && path.basename(projRoot) === 'projects' ? projRoot : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../projects');
  if (fs.existsSync(projectsDir)) {
    for (const name of fs.readdirSync(projectsDir)) {
      const libs = path.join(projectsDir, name, 'build/libs');
      if (!fs.existsSync(libs)) continue;
      for (const f of fs.readdirSync(libs)) {
        if (!f.endsWith('.jar')) continue;
        if (f.includes('-sources') || f.includes('-dev') || f.includes('-javadoc')) continue;
        push(path.join(libs, f), `${name}（本机构建）`);
      }
    }
  }

  // 2) 游戏 mods 目录
  for (const dir of mcDirs()) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jar') || f.endsWith('.disabled')) continue;
        push(path.join(dir, f), '游戏 mods 目录');
      }
    } catch {
      /* ignore */
    }
  }

  // 3) 桌面 / 下载
  for (const d of ['Desktop', 'Downloads']) {
    const dir = path.join(os.homedir(), d);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jar')) continue;
        push(path.join(dir, f), d);
      }
    } catch {
      /* ignore */
    }
  }

  // 4) 浏览器拖进来、已经落到导入缓存的 jar
  for (const f of listImportedJars()) push(f.path, '已导入');

  // 去重 + 最近的排前面
  const seen = new Set();
  return out
    .filter((x) => (seen.has(x.path) ? false : seen.add(x.path)))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 40);
}

/** 目录浏览：给界面一个能点进去的列表 */
function browse(dir) {
  let target = dir;
  if (!target) {
    // 没给目录就从盘符 / 主目录开始
    if (process.platform === 'win32') {
      const drives = [];
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const d = `${letter}:\\`;
        if (fs.existsSync(d)) drives.push({ name: d, path: d });
      }
      return { dir: '', parent: null, dirs: drives, jars: [] };
    }
    return { dir: '', parent: null, dirs: [{ name: os.homedir(), path: os.homedir() }], jars: [] };
  }

  target = path.resolve(target);
  const dirs = [];
  const jars = [];
  let parent = path.dirname(target);
  if (parent === target) parent = '';

  const ents = fs.readdirSync(target, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(target, e.name);
    if (e.isDirectory()) {
      dirs.push({ name: e.name, path: full });
    } else if (/\.(jar|zip)$/i.test(e.name)) {
      try {
        const st = fs.statSync(full);
        jars.push({ name: e.name, path: full, size: st.size });
      } catch {
        /* ignore */
      }
    }
    if (dirs.length > 400) break;
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  jars.sort((a, b) => b.size - a.size);
  return { dir: target, parent, dirs, jars };
}

// ---------- 路由 ----------

/**
 * 处理 library/* 与 analyze/*。
 * 返回 true 表示已处理（调用方不要再往下走）。
 */
export async function handleExtras(req, res, route, q) {
  const method = req.method;

  // ==================== 包库 ====================
  if (route === 'library/packs' && method === 'GET') {
    const { packs, shadowed } = listPacks(q.root);
    return ok(res, {
      packs: packs.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        desc: p.desc,
        tags: p.tags,
        scope: p.scope,
        writable: p.writable,
        createdAt: p.createdAt,
        origin: p.origin,
        requires: p.requires,
        summary: p.summary,
        error: p.error,
      })),
      shadowed,
      dirs: libraryScopes(q.root).map((s) => ({ scope: s.scope, dir: s.dir, writable: s.writable })),
    });
  }

  if (route === 'library/pack' && method === 'GET') {
    const pack = getPack(q.root, q.id);
    if (!pack) return fail(res, 404, `找不到包 ${q.id}`);
    return ok(res, { pack });
  }

  if (route === 'library/effects' && method === 'GET') {
    return ok(res, {
      effects: EFFECTS.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        desc: e.desc,
        tags: e.tags,
        abilities: e.abilities,
        params: e.params,
      })),
    });
  }

  if (route === 'library/effect-pack' && method === 'POST') {
    const body = await readBody(req);
    const eff = getEffect(body.id);
    if (!eff) return fail(res, 404, `没有这个效果模板：${body.id}`);
    return ok(res, { pack: effectToPack(eff, body.overrides || {}) });
  }

  if (route === 'library/capture' && method === 'POST') {
    const body = await readBody(req);
    if (!body.root) return fail(res, 400, '缺少 root');
    const project = P.loadProject(body.root);
    const pack = capturePack(project, {
      root: body.root,
      types: body.types || {},
      closure: body.closure || 'full',
      hooks: body.hooks || [],
      jsHooks: body.jsHooks || [],
      name: body.name,
      desc: body.desc,
      id: body.id,
      tags: body.tags || [],
      params: body.params || [],
    });
    const missing = pack.__missing || [];
    delete pack.__missing;
    return ok(res, { pack, missing });
  }

  if (route === 'library/save' && method === 'POST') {
    const body = await readBody(req);
    if (!body.pack) return fail(res, 400, '缺少 pack');
    const saved = body.overwrite
      ? overwritePack(body.root, body.pack, body.scope || 'project')
      : savePack(body.root, body.pack, body.scope || (body.root ? 'project' : 'user'));
    return ok(res, { pack: saved });
  }

  if (route === 'library/import' && method === 'POST') {
    const body = await readBody(req);
    if (!body.text) return fail(res, 400, '缺少包文本');
    const pack = importPack(body.root, body.text, body.scope || 'project');
    return ok(res, { pack });
  }

  if (route === 'library/export' && method === 'GET') {
    const { filename, text } = exportPack(q.root, q.id);
    return ok(res, { filename, text });
  }

  if (route === 'library/delete' && method === 'POST') {
    const body = await readBody(req);
    deletePack(body.root, body.id, body.scope);
    return ok(res, {});
  }

  if (route === 'library/move' && method === 'POST') {
    const body = await readBody(req);
    const pack = movePack(body.root, body.id, body.to);
    return ok(res, { pack });
  }

  if (route === 'library/preview' && method === 'POST') {
    const body = await readBody(req);
    const project = P.loadProject(body.root);
    const pack = body.pack || getPack(body.root, body.id);
    if (!pack) return fail(res, 404, '找不到包');
    return ok(res, { preview: previewApply(project, pack, { params: body.params || {} }) });
  }

  if (route === 'library/apply' && method === 'POST') {
    const body = await readBody(req);
    const project = P.loadProject(body.root);
    const pack = body.pack || getPack(body.root, body.id);
    if (!pack) return fail(res, 404, '找不到包');
    const report = applyPack(body.root, project, pack, {
      params: body.params || {},
      onConflict: body.onConflict || 'rename',
      withCode: body.withCode !== false,
      withFiles: body.withFiles !== false,
    });
    P.saveProject(body.root, project);
    return ok(res, { report });
  }

  // ==================== 分析 ====================
  // ---------- 直接导入：拖进来的 jar 落到缓存，之后仍走按路径分析的老链路 ----------
  if (route === 'analyze/upload' && method === 'POST') {
    const display = String(req.headers['x-file-name'] || 'mod.jar');
    const buf = await readBinaryBody(req, MAX_UPLOAD);
    if (!buf) return fail(res, 413, `文件超过 ${formatMb(MAX_UPLOAD)} 上限`);
    try {
      const saved = saveJarBytes(buf, display);
      return ok(res, { ...saved, label: '已导入' });
    } catch (e) {
      return fail(res, 400, `导入失败：${e.message}`);
    }
  }

  if (route === 'analyze/uploads' && method === 'GET') {
    return ok(res, { jars: listImportedJars() });
  }

  if (route === 'analyze/upload-remove' && method === 'POST') {
    const body = await readBody(req);
    try {
      return ok(res, removeImportedJar(body.path));
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  // 有些包把依赖 mod 打进 META-INF/jars/ 或 jarjar/，外层分析看不到里面。
  // 单独抽出来变成一个普通导入文件，就能用同一套界面逐个分析。
  if (route === 'analyze/extract-inner' && method === 'POST') {
    const body = await readBody(req);
    const abs = path.resolve(String(body.path || ''));
    const entry = String(body.entry || '');
    if (!fs.existsSync(abs)) return fail(res, 400, '外层 jar 不存在');
    if (!isNestedJarEntry(entry)) return fail(res, 400, '这不是允许展开的内嵌 jar 条目');
    try {
      const src = openSource(abs);
      const buf = src.read(entry);
      src.close?.();
      const saved = saveJarBytes(buf, path.basename(entry));
      return ok(res, { ...saved, label: `内嵌 · ${path.basename(path.dirname(entry))}` });
    } catch (e) {
      return fail(res, 400, `展开失败：${e.message}`);
    }
  }

  // sources jar 里真的带 .java，能直接读，不需要反编译。纯文本只读接口。
  if (route === 'analyze/source' && method === 'POST') {
    const body = await readBody(req);
    const abs = path.resolve(String(body.path || ''));
    const entry = String(body.entry || '');
    if (!fs.existsSync(abs)) return fail(res, 400, 'jar 不存在');
    if (!/\.java$/i.test(entry) || entry.includes('..') || entry.startsWith('/') || entry.startsWith('\\')) {
      return fail(res, 400, '只能读 jar 里的 .java 源码文件');
    }
    try {
      const src = openSource(abs);
      const text = src.readText(entry);
      src.close?.();
      if (text === null) return fail(res, 404, 'jar 里没有这个文件');
      return ok(res, { entry, text });
    } catch (e) {
      return fail(res, 400, `读取失败：${e.message}`);
    }
  }

  if (route === 'analyze/browse' && method === 'GET') {
    try {
      return ok(res, browse(q.dir || ''));
    } catch (e) {
      return fail(res, 400, `读不了这个目录：${e.message}`);
    }
  }

  if (route === 'analyze/recent' && method === 'GET') {
    return ok(res, { jars: recentJars(q.root) });
  }

  if (route === 'analyze' && method === 'POST') {
    const body = await readBody(req);
    const p = String(body.path || '').trim();
    if (!p) return fail(res, 400, '请给一个 jar 或目录路径');
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) return fail(res, 400, `路径不存在：${abs}`);
    try {
      const report = getReport(abs);
      return ok(res, { report: reportSummary(report) });
    } catch (e) {
      return fail(res, 400, `分析失败：${e.message}`);
    }
  }

  if (route === 'analyze/to-pack' && method === 'POST') {
    const body = await readBody(req);
    const abs = path.resolve(String(body.path || ''));
    if (!fs.existsSync(abs)) return fail(res, 400, '路径不存在，可能文件被移动了');
    const report = getReport(abs);

    // 勾选了「能力」的话，把对应的效果模板代码一起打包
    const effectIds = body.effectIds || [];
    // 工程信息：生成的代码要用工程自己的 modId 和包名，否则编不过
    let projectModId = '';
    let projectPkg = '';
    if (body.root) {
      try {
        const proj = P.loadProject(body.root);
        projectModId = proj?.meta?.id || '';
        projectPkg = proj?.meta?.pkg || '';
      } catch { /* 工程还没建好也不影响导出 */ }
    }
    const pack = await reportToPack(report, body.selection || {}, {
      name: body.name,
      desc: body.desc,
      id: body.id,
      tags: body.tags,
      overrides: body.overrides || {},
      projectModId,
      projectPkg,
    });
    const usedEffects = [];
    const effectParams = body.effectParams || {};
    for (const eid of effectIds) {
      const eff = getEffect(eid);
      if (!eff) continue;
      usedEffects.push(eff.name);
      // 参数：模板默认值优先，用户覆盖值其次。生成阶段就把 {{key}} 替换干净，
      // 这样导出的包里 Java 代码不带占位符，不依赖安装时再传参。
      const defaults = {};
      for (const pr of eff.params || []) defaults[pr.key] = pr.default;
      const vals = { ...defaults, ...(effectParams[eid] || {}) };
      for (const j of eff.java || []) {
        pack.content.java.push({ target: j.target || 'init', name: eff.name, code: renderText(j.code, vals) });
      }
    }
    if (usedEffects.length) pack.desc += `；附带可编译效果：${usedEffects.join('、')}`;

    return ok(res, { pack });
  }

  if (route === 'analyze/effects-for' && method === 'GET') {
    return ok(res, { effects: effectsForAbility(q.ability || '') });
  }

  return false;
}
