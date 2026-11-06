/**
 * 功能转换器的 HTTP 入口。
 *
 * 红线与 visual/* 一致：
 *   · inspect / preview / matrix / rules 全只读，绝不改数据
 *   · apply 才写盘，且必须 confirmed === true
 *   · 不让前端传一份「转换报告」下来直接落盘 —— 服务端重新算一遍，
 *     避免界面里的过期结果把工程写坏
 */
import path from 'node:path';
import {
  featureFromProject, featureFromCode, featureFromEffect, featureFromObject,
  readFeature, featureSummary,
} from '../convert/ir.mjs';
import {
  convert, conversionMatrix, applyConversion, convertedJava,
  listRules, convertDiagnostics,
} from '../convert/engine.mjs';
import { listTargets } from '../target/registry.mjs';
import { isProject } from '../project.mjs';

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
      if (size > 8 * 1024 * 1024) reject(new Error('请求体过大'));
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

/** 把界面传来的「来源」变成 IR。 */
function buildFeature(source = {}, fallbackRoot = '') {
  switch (source.type) {
    case 'project': {
      const root = source.root || fallbackRoot;
      if (!root) throw new Error('要选一个工程');
      if (!isProject(path.resolve(root))) throw new Error(`不是工程目录：${root}`);
      return featureFromProject(path.resolve(root), { targetId: source.from || '' });
    }
    case 'code':
      return featureFromCode(String(source.code || ''), {
        id: source.id || 'snippet', name: source.name || '粘贴的代码',
        targetId: source.from || '', summary: source.summary || '',
      });
    case 'effect':
      return featureFromEffect(String(source.id || ''), { targetId: source.from || '' });
    case 'file':
      return readFeature(String(source.path || ''), { targetId: source.from || '' });
    case 'json':
      return featureFromObject(source.data, { targetId: source.from || '' });
    default:
      throw new Error(`不认识的来源类型：${source.type}`);
  }
}

/**
 * 处理 convert/* 路由。
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleConvert(req, res, route, q, method) {
  if (!route.startsWith('convert/')) return false;

  try {
    if (route === 'convert/rules' && method === 'GET') {
      return ok(res, { rules: listRules(), diagnostics: convertDiagnostics(), targets: listTargets() });
    }

    if (route === 'convert/matrix' && method === 'GET') {
      return ok(res, { matrix: conversionMatrix() });
    }

    if (route === 'convert/inspect' && method === 'POST') {
      const body = await readBody(req);
      const feature = body.feature?.format === 'mcstudio.feature' ? body.feature : buildFeature(body.source || {}, body.root);
      return ok(res, { feature, summary: featureSummary(feature) });
    }

    if (route === 'convert/preview' && method === 'POST') {
      const body = await readBody(req);
      const feature = body.feature?.format === 'mcstudio.feature' ? body.feature : buildFeature(body.source || {}, body.root);
      const to = String(body.to || body.targetId || '');
      if (!to) return fail(res, 400, '要给目标 ID（to）');
      const report = convert(feature, { targetId: to, fromTargetId: body.from || undefined });
      if (!report.ok) return fail(res, 400, report.errors.join('；'), { report });
      return ok(res, { report, java: convertedJava(report) });
    }

    if (route === 'convert/apply' && method === 'POST') {
      const body = await readBody(req);
      if (body.confirmed !== true) return fail(res, 400, '应用会改工程数据，需要显式确认');
      const root = path.resolve(String(body.root || ''));
      if (!isProject(root)) return fail(res, 400, `不是工程目录：${root}`);
      const to = String(body.to || body.targetId || '');
      if (!to) return fail(res, 400, '要给目标 ID（to）');
      const feature = body.source ? buildFeature(body.source, root) : featureFromProject(root, { targetId: body.from || '' });
      const report = convert(feature, { targetId: to, fromTargetId: body.from || undefined });
      if (!report.ok) return fail(res, 400, report.errors.join('；'), { report });
      const applied = applyConversion(root, report, { confirmed: true, targetId: to });
      return ok(res, { applied, report });
    }

    return fail(res, 404, `未知接口：/${route}`);
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
