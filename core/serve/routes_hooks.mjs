/**
 * 代码钩子的 HTTP 入口。
 *
 * 设计红线：**任何写盘都必须由用户显式确认**。
 * 预览接口只读、绝不改数据；安装接口强制要求 confirmed === true，
 * 即便前端逻辑写错、AI 自己发了个请求，也不会把代码塞进工程。
 */
import * as P from '../project.mjs';
import { preview } from '../generator/pipeline.mjs';
import { ANCHORS } from '../hooks/hooks.mjs';
import { getTarget } from '../target/registry.mjs';
import {
  inspectHookCode,
  validAnchor,
  findAnchorPreview,
  makeHookRecord,
  isDuplicate,
} from '../hooks/inspect.mjs';

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
const fail = (res, code, message, extra = {}) => json(res, code, { ok: false, error: String(message), ...extra });

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) reject(new Error('请求体过大'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON：${e.message}`));
      }
    });
    req.on('error', reject);
  });
}

function openProject(root) {
  if (!root) throw new Error('缺少工程路径');
  if (!P.isProject(root)) throw new Error(`不是 MC Studio 工程：${root}`);
  return P.loadProject(root);
}

/** 目标详情：预览框要显示「这是哪个平台哪个版本的工程」 */
function targetInfo(project) {
  const t = project.target || {};
  let label = `${t.platform || '?'} ${t.mcVersion || '?'}`;
  try {
    const a = getTarget(t.id || `${t.platform}-${t.mcVersion}`);
    label = a.label;
  } catch {
    /* 老工程或未知目标，用原始字段就行 */
  }
  return { id: t.id || '', platform: t.platform || '', mcVersion: t.mcVersion || '', label };
}

async function previewHook(res, body) {
  const project = openProject(body.root);
  const target = String(body.target || 'init');
  if (!validAnchor(target)) return fail(res, 400, `未知锚点「${target}」`, { anchors: ANCHORS.map((a) => a.id) });

  const code = String(body.code || '');
  const inspection = inspectHookCode(code, project);
  let placement = { file: '', found: false, context: '', injected: '' };
  try {
    const files = await preview(body.root);
    placement = findAnchorPreview(files, target, code);
  } catch (e) {
    inspection.warnings.push(`没法预演生成结果：${e.message}`);
  }

  return ok(res, {
    project: { name: project.meta.name, id: project.meta.id, root: body.root },
    target: targetInfo(project),
    anchors: ANCHORS,
    anchor: target,
    inspection,
    placement,
    duplicate: isDuplicate(project, code),
    existingHooks: (project.hooks?.java || []).length,
    // 前端据此决定「确认」按钮是否可点
    installable: inspection.errors.length === 0 && !isDuplicate(project, code),
  });
}

async function addHook(res, body) {
  // 服务端红线：没有明确确认，一律不写
  if (body.confirmed !== true) {
    return fail(res, 400, '缺少用户确认（confirmed），代码没有写入工程');
  }
  const project = openProject(body.root);
  const code = String(body.code || '');
  const target = String(body.target || 'init');
  if (!validAnchor(target)) return fail(res, 400, `未知锚点「${target}」`);

  const inspection = inspectHookCode(code, project);
  if (inspection.errors.length) return fail(res, 400, inspection.errors.join('；'), { inspection });
  if (isDuplicate(project, code)) return fail(res, 409, '这段钩子已经装过了，没有重复添加', { duplicate: true });

  if (!project.hooks) project.hooks = { java: [], js: [] };
  if (!Array.isArray(project.hooks.java)) project.hooks.java = [];
  const hook = makeHookRecord({ code, target, name: body.name, source: body.source || 'ai' });
  project.hooks.java.push(hook);
  P.saveProject(body.root, project);

  return ok(res, {
    hook,
    totalHooks: project.hooks.java.length,
    // 只写进工程配置，不碰生成文件。用户还得自己点「生成」。
    note: '钩子已加入工程配置。点「生成」才会写进 Java 源码，再「构建 jar」才会生效。',
  });
}

async function removeHook(res, body) {
  const project = openProject(body.root);
  const before = (project.hooks?.java || []).length;
  if (!Array.isArray(project.hooks?.java)) return fail(res, 400, '工程里没有 Java 钩子');
  project.hooks.java = project.hooks.java.filter((h) => h.id !== body.id);
  if (project.hooks.java.length === before) return fail(res, 404, `找不到钩子 ${body.id}`);
  P.saveProject(body.root, project);
  return ok(res, { removed: body.id, totalHooks: project.hooks.java.length });
}

/**
 * @returns {false} 表示这个路由不归我管，交回 server.mjs 继续分发
 */
export async function handleHooks(req, res, route, q) {
  const method = req.method;

  if (route === 'hooks/list' && method === 'GET') {
    try {
      const project = openProject(q.root);
      return ok(res, { hooks: project.hooks?.java || [], target: targetInfo(project) });
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  if (route === 'hooks/preview' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      return await previewHook(res, body);
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  if (route === 'hooks/add' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      return await addHook(res, body);
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  if (route === 'hooks/remove' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      return await removeHook(res, body);
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  return false;
}
