/**
 * 本地 HTTP 服务。
 *
 * 引擎与界面之间的唯一通道。设计原则：
 *  - 界面是纯静态文件，可以被任何壳（浏览器 / Electron / VSCode WebView）加载
 *  - 所有能力都走 /api，壳不需要知道任何引擎细节
 *  - 不引第三方依赖，只用 node:http
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

import * as P from '../project.mjs';
import { listTargets, getTarget } from '../target/registry.mjs';
import { listContentTypes, listModules, blankEntry, validateContentType, invalidate } from '../modules/registry.mjs';
import { preflight, preview, generate } from '../generator/pipeline.mjs';
import { runGradle, tailJob, getJob, findArtifacts, extractErrors, hasWrapper, detectJava, platformInfo } from '../build/gradle.mjs';
import { listVanilla, PRESETS, toDataUrl, upscale, readVanilla, decodeFromFile } from './texture_helpers.mjs';
import { previewTexture } from '../generator/textures.mjs';
import { ANCHORS, jsHookTemplate } from '../hooks/hooks.mjs';
import { openInBlockbench, writeBbmodel } from './blockbench.mjs';
import { handleExtras } from './routes_extras.mjs';
import { handleKnowledge } from './routes_kb.mjs';
import { handleHooks } from './routes_hooks.mjs';
import { handleVisual } from './routes_visual.mjs';
import { handleConvert } from './routes_convert.mjs';
import { assertRuntime } from '../runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(HERE, '../../ui');
const ROOT_DIR = path.resolve(HERE, '../..');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function ok(res, data = {}) {
  json(res, 200, { ok: true, ...data });
}

function fail(res, code, message) {
  json(res, code, { ok: false, error: String(message) });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 32 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 只允许访问工程目录内的文件，防目录穿越 */
function safeJoin(root, rel) {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('路径越界');
  return abs;
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.join(UI_DIR, rel);
  if (!abs.startsWith(UI_DIR) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  const buf = fs.readFileSync(abs);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(buf);
}

// ============================================================
// 路由
// ============================================================

/** 允许的 Gradle 任务：build 接口以前把 task 名整个交给客户端，等于开放任意脚本执行。 */
const ALLOWED_TASKS = new Set(['build', 'compileJava', 'compileTestJava', 'test', 'clean', 'jar', 'check', 'tasks']);

/** 是不是一个真正的工程目录（有 .studio/project.json）。 */
function requireProject(root, label = '目录') {
  const dir = path.resolve(String(root || ''));
  if (!P.isProject(dir)) {
    const e = new Error(`${label}不是 MC Studio 工程目录：${dir}`);
    e.status = 400;
    throw e;
  }
  return dir;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * 写请求统一守卫。
 *
 * 服务只监听 127.0.0.1，但「只本机可达」不等于安全：浏览器里的任意网页都能
 * 向 127.0.0.1 发简单 POST。两道闸：
 *   · 带 Origin 的请求必须与本机同源（跨站 POST 一定带 Origin）
 *   · 带正文的写请求必须是 application/json —— 跨站想发这个类型就得先过
 *     CORS 预检，而本服务不返回任何 CORS 头，预检直接失败。
 * 没有 Origin 的命令行 / curl 请求仍可用，但必须显式声明 JSON 类型。
 * jar 上传是二进制流，走自己的大小 / ZIP 头 / 文件名校验，这里只放行 Origin。
 */
function guardWrite(req, route) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

  const origin = String(req.headers.origin || '');
  if (origin) {
    const host = String(req.headers.host || '');
    const port = req.socket?.localPort;
    const allowed = new Set([`http://${host}`, `https://${host}`]);
    if (port) {
      allowed.add(`http://localhost:${port}`);
      allowed.add(`http://127.0.0.1:${port}`);
      allowed.add(`http://[::1]:${port}`);
    }
    if (!allowed.has(origin)) throw httpError(403, `跨站请求被拒绝（Origin: ${origin}）`);
  }

  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
  if (!hasBody) return;
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (route === 'analyze/upload') return; // 二进制上传由 routes_extras 自己校验
  if (ct !== 'application/json') {
    throw httpError(403, '写接口只接受 application/json；拒绝跨站简单请求');
  }
}

export function createServer() {
  assertRuntime();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);

    try {
      if (p.startsWith('/api/')) {
        const route = p.slice(5);
        guardWrite(req, route);
        await handleApi(req, res, route, q, url);
        return;
      }
      serveStatic(res, p);
    } catch (e) {
      fail(res, e.status || 400, e.message);
    }
  });
}

async function handleApi(req, res, route, q, url) {
  const method = req.method;

  // 包库与分析这两块单独成文件，能力会一直长，不适合塞在这里
  if (route === 'analyze' || route.startsWith('library/') || route.startsWith('analyze/')) {
    const handled = await handleExtras(req, res, route, q);
    if (handled !== false) return;
  }

  // 知识库与 AI 同理
  if (route.startsWith('knowledge/') || route.startsWith('ai/')) {
    const handled = await handleKnowledge(req, res, route, q);
    if (handled !== false) return;
  }

  // 代码钩子（AI / 学习中心的代码块经预览确认后落到这里）
  if (route.startsWith('hooks/')) {
    const handled = await handleHooks(req, res, route, q);
    if (handled !== false) return;
  }

  // 可视化积木
  if (route.startsWith('visual/')) {
    const handled = await handleVisual(req, res, route, q, method);
    if (handled !== false) return;
  }

  // 功能转换器（跨版本 / 跨加载器）
  if (route.startsWith('convert/')) {
    const handled = await handleConvert(req, res, route, q, method);
    if (handled !== false) return;
  }

  // ---------- 基础 ----------
  if (route === 'health') {
    const java = await detectJava();
    return ok(res, {
      ...platformInfo(),
      java,
      projectsDir: PROJECTS_DIR,
      version: '0.1.0',
    });
  }

  if (route === 'targets') return ok(res, { targets: listTargets() });

  if (route === 'modules') {
    const types = listContentTypes(q.root).map((t) => ({
      id: t.id,
      label: t.label,
      singular: t.singular || t.label,
      group: t.group || '内容',
      icon: t.icon || '◆',
      moduleId: t.moduleId,
      moduleName: t.moduleName,
      scope: t.scope,
      fields: t.fields,
    }));
    return ok(res, {
      types,
      modules: listModules(q.root).map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.description,
        scope: m.__scope,
        types: (m.contentTypes || []).map((c) => c.id),
      })),
    });
  }

  if (route === 'reload-modules' && method === 'POST') {
    invalidate();
    return ok(res, { count: listModules().length });
  }

  if (route === 'anchors') return ok(res, { anchors: ANCHORS, jsTemplate: jsHookTemplate() });

  // ---------- 工程 ----------
  if (route === 'projects' && method === 'GET') {
    const list = [];
    if (fs.existsSync(PROJECTS_DIR)) {
      for (const name of fs.readdirSync(PROJECTS_DIR)) {
        const dir = path.join(PROJECTS_DIR, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        if (!P.isProject(dir)) continue;
        try {
          const d = P.loadProject(dir);
          list.push({ root: dir, name: d.meta.name, id: d.meta.id, version: d.meta.version, target: d.target });
        } catch {
          /* 坏工程跳过 */
        }
      }
    }
    return ok(res, { projects: list, dir: PROJECTS_DIR });
  }

  if (route === 'projects' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim() || '我的模组';
    const id = String(body.id || '').trim() || 'mymod';
    const slug = id.replace(/[^a-z0-9_]/g, '');
    const dir = path.join(PROJECTS_DIR, slug);
    if (fs.existsSync(dir)) throw new Error(`已存在同名工程目录：${slug}`);
    const target = getTarget(body.target || 'fabric-26.3');
    const data = P.createProject(dir, {
      name,
      id,
      pkg: body.pkg || `com.example.${slug}`,
      version: body.version || '0.1.0',
      authors: body.authors || '',
      description: body.description || '',
      license: body.license || 'MIT',
      // defaults 整份保留：不同平台的专属字段（forgeVersion / mappingChannel / ...）由适配器自己读
      target: { ...target.defaults, id: target.id },
    });
    // 立刻把骨架生成出来，用户打开就是可构建状态
    const report = await generate(dir, { clientModsDir: body.clientModsDir || '' });
    return ok(res, { root: dir, project: data, report });
  }

  if (route === 'project' && method === 'GET') {
    if (!q.root) throw new Error('缺少 root 参数');
    const data = P.loadProject(q.root);
    const types = listContentTypes(q.root);
    return ok(res, {
      root: path.resolve(q.root),
      project: data,
      types,
      hasWrapper: hasWrapper(q.root),
      glyph: (() => {
        try {
          return findArtifacts(q.root);
        } catch {
          return [];
        }
      })(),
    });
  }

  if (route === 'project/meta' && method === 'PUT') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const err = P.validateMeta({ ...data.meta, ...body.meta });
    if (err) throw new Error(err);
    data.meta = { ...data.meta, ...body.meta };
    P.saveProject(body.root, data);
    return ok(res, { meta: data.meta });
  }

  if (route === 'project/delete' && method === 'POST') {
    const body = await readBody(req);
    const dir = path.resolve(String(body.root || ''));
    // 字符串前缀判断会被 <projects>-evil 这类同级目录绕过；用真实路径关系。
    const rel = path.relative(PROJECTS_DIR, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length !== 1) {
      throw new Error('只能删除 projects 目录下的一级工程');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return ok(res);
  }

  // ---------- 条目 ----------
  if (route === 'entries' && method === 'GET') {
    const data = P.loadProject(q.root);
    if (q.type) return ok(res, { entries: P.listEntries(data, q.type) });
    return ok(res, { entries: data.entries });
  }

  if (route === 'entries' && method === 'POST') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const ct = listContentTypes(body.root).find((t) => t.id === body.type);
    if (!ct) throw new Error(`未知内容类型：${body.type}`);
    const entry = body.entry || blankEntry(ct, P.suggestId(data, body.type, body.baseId || `new_${body.type}`));
    P.addEntry(data, body.type, entry, body.index ?? -1);
    P.saveProject(body.root, data);
    return ok(res, { entry });
  }

  if (route === 'entries' && method === 'PUT') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const entry = P.updateEntry(data, body.type, body.id, body.patch || {});
    P.saveProject(body.root, data);
    return ok(res, { entry });
  }

  if (route === 'entries' && method === 'DELETE') {
    const data = P.loadProject(q.root);
    const done = P.removeEntry(data, q.type, q.id);
    P.saveProject(q.root, data);
    return ok(res, { removed: done });
  }

  if (route === 'entries/move' && method === 'POST') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const moved = P.moveEntry(data, body.type, body.id, Number(body.delta) || 0);
    P.saveProject(body.root, data);
    return ok(res, { moved });
  }

  if (route === 'entries/duplicate' && method === 'POST') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const src = P.findEntry(data, body.type, body.id);
    if (!src) throw new Error('找不到要复制的条目');
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = P.suggestId(data, body.type, `${src.id}_copy`);
    if (copy.nameZh) copy.nameZh = `${copy.nameZh} 副本`;
    P.addEntry(data, body.type, copy, -1);
    P.saveProject(body.root, data);
    return ok(res, { entry: copy });
  }

  // ---------- 生成 ----------
  if (route === 'preflight' && method === 'POST') {
    const body = await readBody(req);
    return ok(res, await preflight(body.root));
  }

  if (route === 'generate' && method === 'POST') {
    const body = await readBody(req);
    const report = await generate(body.root, { force: !!body.force, clientModsDir: body.clientModsDir });
    return ok(res, { report });
  }

  if (route === 'preview' && method === 'GET') {
    const files = await preview(q.root);
    const only = q.path;
    if (only) {
      const f = files.find((x) => x.path === only);
      return ok(res, { file: f || null });
    }
    return ok(res, {
      count: files.length,
      files: files.map((f) => ({ path: f.path, size: f.size })),
    });
  }

  // ---------- 文件读写（代码编辑区） ----------
  if (route === 'file' && method === 'GET') {
    const abs = safeJoin(q.root, q.path);
    if (!fs.existsSync(abs)) return ok(res, { exists: false, content: '' });
    const buf = fs.readFileSync(abs);
    const isText = /\.(java|json|gradle|properties|md|txt|mjs|js|css|html|toml|yml|yaml)$/i.test(abs);
    return ok(res, { exists: true, content: isText ? buf.toString('utf8') : '', binary: !isText, size: buf.length });
  }

  if (route === 'file' && method === 'PUT') {
    const body = await readBody(req);
    const root = requireProject(body.root, '写入目标');
    const abs = safeJoin(root, body.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body.content ?? '', 'utf8');
    // 手改生成文件后，指纹会不一致，下次生成会提示冲突 —— 这是预期行为
    return ok(res, { path: body.path });
  }

  if (route === 'tree' && method === 'GET') {
    const root = path.resolve(q.root);
    const sub = q.path || 'src/main/java';
    const base = safeJoin(root, sub);
    if (!fs.existsSync(base)) return ok(res, { tree: [] });
    const walk = (dir, depth) => {
      const out = [];
      if (depth > 8) return out;
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        const st = fs.statSync(abs);
        if (st.isDirectory()) {
          out.push({ type: 'dir', name, path: rel, children: walk(abs, depth + 1) });
        } else {
          out.push({ type: 'file', name, path: rel, size: st.size });
        }
      }
      out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
      return out;
    };
    return ok(res, { tree: walk(base, 0), base: sub });
  }

  // ---------- 贴图 ----------
  if (route === 'textures/vanilla') {
    return ok(res, { vanilla: listVanilla(), presets: PRESETS });
  }

  if (route === 'textures/preview' && method === 'POST') {
    const body = await readBody(req);
    const data = P.loadProject(body.root);
    const entry = body.entry || P.findEntry(data, body.type, body.id);
    if (!entry) throw new Error('找不到条目');
    const img = previewTexture(entry, body.type, data);
    if (!img) return ok(res, { dataUrl: null });
    return ok(res, { dataUrl: toDataUrl(img), width: img.width, height: img.height });
  }

  if (route === 'textures/file' && method === 'GET') {
    const abs = safeJoin(q.root, q.path);
    if (!fs.existsSync(abs)) return ok(res, { dataUrl: null });
    const buf = fs.readFileSync(abs);
    return ok(res, { dataUrl: `data:image/png;base64,${buf.toString('base64')}` });
  }

  if (route === 'textures/file' && method === 'PUT') {
    const body = await readBody(req);
    const abs = safeJoin(body.root, body.path);
    const m = String(body.dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
    if (!m) throw new Error('只接受 PNG 的 data URL');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(m[1], 'base64'));
    return ok(res, { path: body.path });
  }

  if (route === 'textures/upscale' && method === 'POST') {
    const body = await readBody(req);
    const abs = safeJoin(body.root, body.path);
    if (!fs.existsSync(abs)) throw new Error('文件不存在');
    const img = decodeFromFile(abs);
    return ok(res, { dataUrl: toDataUrl(upscale(img, Math.max(1, Math.min(16, Number(body.factor) || 8)))) });
  }

  // ---------- 构建 ----------
  if (route === 'build' && method === 'POST') {
    const body = await readBody(req);
    const task = String(body.task || 'build');
    if (!ALLOWED_TASKS.has(task)) throw new Error(`不允许的 Gradle 任务：${task}`);
    const root = requireProject(body.root, '构建目标');
    const job = runGradle(root, task);
    return ok(res, { job: { id: job.id, task: job.task } });
  }

  if (route === 'build/tail') {
    const job = tailJob(q.root, Number(q.since) || 0);
    return ok(res, { job });
  }

  if (route === 'build/artifacts') {
    return ok(res, { artifacts: findArtifacts(q.root), errors: extractErrors(getJob(q.root)) });
  }

  // ---------- Blockbench ----------
  if (route === 'blockbench/model' && method === 'POST') {
    const body = await readBody(req);
    const info = writeBbmodel(body.root, body.type, body.id, body.texturePath);
    return ok(res, info);
  }

  if (route === 'blockbench/open' && method === 'POST') {
    const body = await readBody(req);
    const info = writeBbmodel(body.root, body.type, body.id, body.texturePath);
    const launched = await openInBlockbench(info.file);
    return ok(res, { ...info, launched });
  }

  // ---------- 模块脚手架：给想写模块的人一个起点 ----------
  if (route === 'modules/scaffold' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!/^[a-z][a-z0-9_]{1,47}$/.test(id)) throw new Error('模块 id 只能小写字母数字下划线');
    const dir = path.join(ROOT_DIR, 'modules', id);
    if (fs.existsSync(dir)) throw new Error('同名模块已存在');
    fs.mkdirSync(dir, { recursive: true });
    const typeId = body.typeId || `${id}_entry`;
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify(
        {
          id,
          name: body.name || id,
          version: '1.0.0',
          order: 100,
          author: body.author || '',
          description: body.description || '',
          contentTypes: [
            {
              id: typeId,
              label: body.label || body.name || id,
              singular: body.label || body.name || id,
              group: body.group || '自定义',
              icon: '★',
              fields: [
                { key: 'id', label: '标识符', type: 'id', required: true },
                { key: 'nameZh', label: '中文名', type: 'text', required: true },
              ],
              generate: './generate.mjs',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'generate.mjs'),
      `/**
 * ${body.name || id} 的生成器。
 *
 * ctx 提供：
 *   project   整个工程数据
 *   entries(t) 取某类型的所有条目
 *   addFile(p, c) 额外产出一个文件
 *   nsId(v)   短名补全成 "你的modid:短名"
 *   ns / pkg  当前工程的命名空间与包名
 */
export default {
  emit(ctx) {
    const list = ctx.entries('${typeId}');
    if (!list.length) return;

    // 例：为每个条目产出一个 json
    // for (const e of list) {
    //   ctx.addFile(\`src/main/resources/data/\${ctx.ns}/${typeId}/\${e.id}.json\`,
    //     JSON.stringify({ id: ctx.nsId(e.id), name: e.nameZh }, null, 2));
    // }
  },
};
`,
      'utf8',
    );
    invalidate();
    return ok(res, { dir, typeId });
  }

  fail(res, 404, `未知接口：/${route}`);
}

export function start(port = 4173, host = '127.0.0.1') {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://${host}:${actual}` });
    });
  });
}
