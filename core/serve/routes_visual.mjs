/**
 * 可视化积木的 HTTP 入口。
 *
 * 设计红线（与钩子一致）：
 *   · 预览接口只读、绝不改数据
 *   · 编译接口只返回代码，不写盘 —— 写盘走「生成」那条既有链路
 *   · 装库 / 删库这类改动数据的接口必须显式确认
 */
import fs from 'node:fs';
import path from 'node:path';
import * as P from '../project.mjs';
import { compileProgram, compileProject } from '../visual/compile.mjs';
import { decompile } from '../visual/decompile.mjs';
import {
  ensureBuiltin, loadLibraries, listLibraries, blockCatalog,
  createUserBlock, exportUserBlocks, userBlocksDir, projectBlocksDir,
} from '../visual/registry.mjs';
import {
  readLibrary, writeLibrary, installLibrary, validateLibrary,
} from '../visual/library.mjs';
import { libraryFromJar } from '../visual/modlib.mjs';

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

/**
 * 从请求里拿到工程根目录。
 *
 * ⚠️ server.mjs 传的 q 是普通对象（Object.fromEntries(searchParams)），
 *    不是 URLSearchParams —— 所以这里不能用 q.get()。
 */
function resolveProjectRoot(q) {
  const root = (q && (q.root || q['root'])) || '';
  if (!root) return null;
  return path.resolve(root);
}

/** 取查询参数（q 是普通对象） */
function qp(q, name) {
  if (!q) return '';
  const v = q[name];
  return v === undefined || v === null ? '' : String(v);
}

/**
 * 处理 visual/* 路由。
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleVisual(req, res, route, q, method) {
  if (!route.startsWith('visual/')) return false;

  try {
    // 积木清单（按分类）
    if (route === 'visual/blocks' && method === 'GET') {
      const root = resolveProjectRoot(q);
      const targetId = qp(q, 'targetId') || 'fabric-26.3';
      ensureBuiltin();
      const libs = loadLibraries(root);
      const cats = blockCatalog(targetId);
      return ok(res, { categories: cats, libraries: libs.installed.map((l) => ({ id: l.id, name: l.name, count: l.added.length })) });
    }

    // 已装的库
    if (route === 'visual/libraries' && method === 'GET') {
      const root = resolveProjectRoot(q);
      ensureBuiltin();
      return ok(res, { libraries: listLibraries(root) });
    }

    // 编译预览（只读，不写盘）
    if (route === 'visual/compile' && method === 'POST') {
      const body = await readBody(req);
      const root = resolveProjectRoot(q);
      ensureBuiltin();
      if (root) loadLibraries(root);
      const targetId = body.targetId || 'fabric-26.3';

      if (body.program) {
        const r = compileProgram(body.program, {
          targetId,
          pkg: body.pkg || 'com.example.mymod',
          methodName: body.methodName,
        });
        return ok(res, {
          ok: r.ok,
          code: r.code,
          warnings: r.warnings,
          errors: r.errors,
          methods: r.methods,
        });
      }
      if (body.project) {
        const r = compileProject(body.project, { targetId });
        return ok(res, {
          ok: r.ok,
          files: r.files,
          warnings: r.warnings,
          errors: r.errors,
        });
      }
      // 程序列表（界面上「编译预览」传的是这一个）
      if (Array.isArray(body.programs)) {
        const r = compileProject({ ...body, visual: { programs: body.programs } }, { targetId });
        return ok(res, {
          ok: r.ok,
          code: r.files?.map((f) => f.content || f.code || '').join('\n') || '',
          files: r.files,
          warnings: r.warnings,
          errors: r.errors,
        });
      }
      return fail(res, 400, '缺少 program、programs 或 project');
    }

    // Java → 积木（尽力而为）
    if (route === 'visual/decompile' && method === 'POST') {
      const body = await readBody(req);
      const root = resolveProjectRoot(q);
      ensureBuiltin();
      if (root) loadLibraries(root);
      const r = decompile(body.code || '', {
        targetId: body.targetId || 'fabric-26.3',
        op: body.op,
      });
      return ok(res, r);
    }

    // 从代码造自定义积木
    if (route === 'visual/custom-block' && method === 'POST') {
      const body = await readBody(req);
      const r = createUserBlock(body);
      if (!r.ok) return fail(res, 400, r.error);
      return ok(res, { block: { id: r.block.id, label: r.block.label, inputs: r.block.inputs } });
    }

    // 导出自定义积木为库（返回 JSON，不写盘）
    if (route === 'visual/export-blocks' && method === 'POST') {
      const body = await readBody(req);
      const lib = exportUserBlocks(body.ids || []);
      return ok(res, { library: lib });
    }

    // 装库（写盘，必须显式确认）
    if (route === 'visual/install-library' && method === 'POST') {
      const body = await readBody(req);
      if (body.confirmed !== true) {
        return fail(res, 400, '装库会修改磁盘文件，需要 confirmed === true');
      }
      const lib = body.library || (body.file ? readLibrary(body.file) : null);
      if (!lib) return fail(res, 400, '缺少 library 或 file');
      const v = validateLibrary(lib);
      if (!v.ok) return fail(res, 400, `库不合法：${v.errors.join('；')}`, { errors: v.errors });

      const scope = body.scope === 'project' ? 'project' : 'user';
      const dir = scope === 'project'
        ? projectBlocksDir(body.projectRoot)
        : userBlocksDir();
      if (!dir) return fail(res, 400, '缺少工程目录');
      const file = path.join(dir, `${lib.id}.mcblocks.json`);
      writeLibrary(lib, file);
      installLibrary(lib);
      return ok(res, { file, id: lib.id, blocks: lib.blocks.length });
    }

    // 读一个库文件（预览用）
    if (route === 'visual/library' && method === 'GET') {
      const file = qp(q, 'file');
      if (!file) return fail(res, 400, '缺少 file');
      const lib = readLibrary(path.resolve(file));
      return ok(res, { library: lib });
    }

    // 读工程的积木程序
    if (route === 'visual/program' && method === 'GET') {
      const root = resolveProjectRoot(q);
      if (!root) return fail(res, 400, '缺少 root');
      const data = P.loadProject(root);
      return ok(res, { programs: data.visual?.programs || [] });
    }

    // 保存工程的积木程序（整份替换）
    //
    // 界面上的积木树整体存进 project.visual.programs，
    // 「生成」时由 core/generator/visual.mjs 编译成 Java。
    if (route === 'visual/program' && method === 'PUT') {
      const body = await readBody(req);
      const root = body.root || resolveProjectRoot(q);
      if (!root) return fail(res, 400, '缺少 root');
      const programs = Array.isArray(body.programs) ? body.programs : [];
      const data = P.loadProject(root);
      if (!data.visual || typeof data.visual !== 'object') data.visual = { programs: [], libraries: [] };
      data.visual.programs = programs;
      P.saveProject(root, data);
      return ok(res, { saved: programs.length });
    }

    // 从 jar 生成积木库
    //
    // 这是「把任意 mod 变成可视化库」的入口（G4）：
    //   jar → 分析 → 数据型积木 + 行为型积木 + mod 专属积木 → .mcblocks.json
    //
    // 安全边界：
    //   · 只读 jar（不改它）
    //   · 只有 confirmed === true 才写盘
    //   · 生成的 Java 模板只用原版注册表 API 或 mod 自己的 API，
    //     不执行任何 jar 里的代码
    if (route === 'visual/library-from-jar' && method === 'POST') {
      const body = await readBody(req);
      const jar = body.jar || body.path || '';
      if (!jar) return fail(res, 400, '缺少 jar（mod jar 的路径）');
      const abs = path.resolve(jar);
      if (!fs.existsSync(abs)) return fail(res, 400, `找不到 jar：${abs}`);
      if (!/\.jar$/i.test(abs)) return fail(res, 400, '只支持 .jar 文件');

      const { library, warnings, target } = libraryFromJar(abs, {
        targetId: body.targetId || undefined,
        withApi: body.withApi !== false,
        apiLimit: Number(body.apiLimit) || 120,
      });

      // 写盘需要显式确认
      let file = null;
      if (body.confirmed === true) {
        const scope = body.scope === 'project' ? 'project' : 'user';
        const dir = scope === 'project'
          ? projectBlocksDir(body.projectRoot)
          : userBlocksDir();
        if (!dir) return fail(res, 400, '缺少工程目录');
        file = path.join(dir, `${library.id}.mcblocks.json`);
        writeLibrary(library, file);
        installLibrary(library);
      }

      // 提示要讲清三件事：目标、两类积木的不同编译要求、怎么补依赖
      const modId = library?.source?.modId || library?.id || '这个 mod';
      const hint = target
        ? `生成的积木只保证在「${target}」目标下能编译。`
          + `物品/方块/效果积木走原版注册表 API，工程里装上对应 mod 就能编译；`
          + `行为型积木和 mod 专属积木直接调 mod 的 API，`
          + `还得在工程的 localDeps 里挂上「${modId}」的 jar（compileOnly）。`
        : '没认出这个 mod 对应的目标：积木没有 Java 模板，需要手工补。';

      return ok(res, {
        library,
        warnings,
        target,
        file,
        written: !!file,
        hint,
        // 界面可以直接拿来填工程依赖
        suggestedDeps: target ? [{ name: modId, path: abs }] : [],
      });
    }

    return fail(res, 404, `未知路由：${route}`);
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
