/**
 * 知识库（knowledge/*）与 AI（ai/*）的路由。
 *
 * 和 routes_extras 一样单独成文件：这两块会一直长，塞回 server.mjs 就别看了。
 */
import fs from 'node:fs';

import * as P from '../project.mjs';
import { listDocs, getDoc, search, invalidate } from '../knowledge/index.mjs';
import { learnReport, listLearned, removeDoc } from '../knowledge/learned.mjs';
import { PRESETS, publicAiConfig, saveAiConfig } from '../ai/config.mjs';
import { prepareAsk, ask, testConnection } from '../ai/chat.mjs';
import { assertConfigReady, streamComplete } from '../ai/providers.mjs';
import { analyze, closeReport } from '../analyze/report.mjs';

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

// SSE：边生成边推。写出去的头就收不回来了，所以这里的异常一律转成
// event: error，绝不能让外层 catch 再试图发一次 HTTP 400。
function sseOpen(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sseSend(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* 连接已经断了，没必要再报 */
  }
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

function loadProjectSafe(root) {
  if (!root) return null;
  try {
    return P.loadProject(root);
  } catch {
    return null;
  }
}

export async function handleKnowledge(req, res, route, q) {
  // ---------------- 知识库 ----------------
  if (route === 'knowledge/list') {
    const kb = listDocs();
    return ok(res, { ...kb, learned: listLearned() });
  }

  if (route === 'knowledge/doc') {
    const id = q.id;
    const doc = id ? getDoc(id) : null;
    if (!doc) return fail(res, 404, '没找到这篇文档');
    return ok(res, {
      doc: {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        sub: doc.sub,
        tags: doc.tags,
        level: doc.level,
        evidence: doc.evidence,
        platform: doc.platform,
        summary: doc.summary,
        source: doc.source,
        sourceLabel: doc.sourceLabel,
        path: doc.path,
        sections: doc.sections,
        plain: doc.plain,
      },
    });
  }

  if (route === 'knowledge/search') {
    const query = q.q || '';
    const category = q.category || undefined;
    const source = q.source || undefined;
    const limit = Math.min(40, Number(q.limit) || 12);
    // 检索也要按工程平台加权，不能只有 AI 上下文享受这个待遇：
    // 在 Forge 工程里搜「注册物品」，排在前面的应该是 Forge 签名而不是 26.3 的。
    let preferPlatform = String(q.platform || '').trim();
    if (!preferPlatform && q.root) {
      try { preferPlatform = P.loadProject(q.root)?.target?.platform || ''; } catch { /* 不是工程就按平台中立检索 */ }
    }
    return ok(res, search(query, { limit, category, source, preferPlatform }));
  }

  if (route === 'knowledge/reload') {
    invalidate();
    return ok(res, { reloaded: true, stats: listDocs().stats });
  }

  // ---------------- 分析沉淀 ----------------
  if (route === 'knowledge/learn') {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      return fail(res, 400, e.message);
    }
    const target = String(body.path || '').trim();
    if (!target) return fail(res, 400, '要沉淀哪个分析结果？给我一个 jar 或目录的路径');
    if (!fs.existsSync(target)) return fail(res, 400, `路径不存在：${target}`);

    let report;
    try {
      report = await analyze(target);
    } catch (e) {
      return fail(res, 500, `分析失败：${e.message}`);
    }
    try {
      const saved = learnReport(report);
      return ok(res, { id: saved.id, title: saved.title, path: saved.path, stats: listDocs().stats });
    } catch (e) {
      // 别让沉淀阶段的异常冒到外层被当成「请求参数错误 400」，
      // 那是服务端自己出问题，说清楚才查得到。
      return fail(res, 500, `沉淀失败：${e.message}`);
    } finally {
      closeReport(report);
    }
  }

  if (route === 'knowledge/delete') {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      return fail(res, 400, e.message);
    }
    try {
      return ok(res, removeDoc(String(body.id || '')));
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  // ---------------- AI ----------------
  if (route === 'ai/config') {
    if (req.method === 'GET') return ok(res, { config: publicAiConfig(), presets: PRESETS });
    try {
      const body = await readBody(req);
      const config = saveAiConfig(body || {});
      return ok(res, { config });
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  if (route === 'ai/test') {
    try {
      const r = await testConnection();
      return ok(res, r);
    } catch (e) {
      return fail(res, 400, e.message, { code: e.code || 'unknown', detail: e.detail || '' });
    }
  }

  if (route === 'ai/chat') {
    let body = {};
    try {
      body = await readBody(req);
    } catch (e) {
      return fail(res, 400, e.message);
    }
    const project = loadProjectSafe(body.root);
    const args = {
      question: body.question,
      history: Array.isArray(body.history) ? body.history : [],
      project,
      useKnowledge: body.useKnowledge !== false,
    };

    if (body.stream) {
      // 能在写头之前拦下的错误（空问题 / 没配 key）就走 HTTP 400，
      // 前端可以按普通错误处理，不用解析 SSE。
      let prep;
      try {
        prep = prepareAsk(args);
        assertConfigReady(prep.cfg);
      } catch (e) {
        return fail(res, 400, e.message, { code: e.code || 'unknown', detail: e.detail || '' });
      }

      sseOpen(res);
      sseSend(res, 'meta', {
        sources: prep.sources,
        usedKnowledge: Boolean(prep.sources.length),
        model: prep.cfg.model,
      });

      const ac = new AbortController();
      let clientGone = false;
      // 用 res 的 close，不用 req 的：请求体读完 req 就会 emit close，
      // 拿它判断「用户断开了」会把每一次正常流式都掐掉。
      res.on('close', () => {
        if (!res.writableEnded) {
          clientGone = true;
          ac.abort();
        }
      });

      const startedAt = Date.now();
      try {
        for await (const ev of streamComplete({
          config: prep.cfg,
          messages: prep.messages,
          system: prep.system,
          signal: ac.signal,
        })) {
          if (clientGone) break;
          if (ev.type === 'delta') sseSend(res, 'delta', { text: ev.text });
          else if (ev.type === 'done') {
            sseSend(res, 'done', {
              model: ev.model,
              usage: ev.usage,
              stopped: ev.stopped,
              ms: Date.now() - startedAt,
            });
          }
        }
      } catch (e) {
        if (!clientGone) {
          sseSend(res, 'error', { code: e.code || 'unknown', error: String(e.message || e), detail: e.detail || '' });
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
      return;
    }

    try {
      const r = await ask(args);
      return ok(res, r);
    } catch (e) {
      return fail(res, 400, e.message, { code: e.code || 'unknown', detail: e.detail || '' });
    }
  }

  return false;
}
