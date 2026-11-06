/**
 * MC Studio 命令行 · 积木工具箱。
 *
 * 界面里的能力以前只能通过 HTTP 用，接不了 CI、写不进脚本。
 * 这里把同一批引擎函数包成命令，界面和命令行共用一条代码路径：
 *
 *   node studio.mjs blocks list      [--target ID] [--root 工程] [--json]
 *   node studio.mjs blocks compile   <工程目录> [--target ID] [--out 文件] [--json]
 *   node studio.mjs blocks from-jar  <jar> [--out 库文件] [--target ID] [--no-api] [--no-pack]
 *   node studio.mjs blocks validate  <库文件...> [--json]
 *   node studio.mjs blocks install   <库文件> [--scope user|project] [--root 工程]
 *   node studio.mjs blocks new       --name 名字 --id id --code 'Java 代码' [--param item:text] [--target ID]
 *   node studio.mjs blocks targets   [--json]
 *   node studio.mjs blocks packs     [--json]
 *
 * 所有命令返回 { exitCode, lines, data }，不自己打印 ——
 * 这样 uitest / 单元测试能直接断言结果，不用抓 stdout。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { listTargets, targetDiagnostics, BUILTIN_TARGETS_DIR } from '../target/registry.mjs';
import { listPacks, packDiagnostics, matchingPacks } from '../visual/modpacks/registry.mjs';
import { blockCatalog, loadLibraries, userBlocksDir, projectBlocksDir, createUserBlock, exportUserBlocks } from '../visual/registry.mjs';
import { compileProject } from '../visual/compile.mjs';
import { libraryFromJar } from '../visual/modlib.mjs';
import { readLibrary, writeLibrary, validateLibrary } from '../visual/library.mjs';
import { lintLibrary, lintSummary } from '../visual/lint.mjs';
import { loadProject, dataPath } from '../project.mjs';

/** 简单参数解析：--key value / --flag / 位置参数。重复 key 会收成数组（--param 用） */
export function parseArgs(argv = []) {
  const positional = [];
  const opts = {};
  const put = (key, value) => {
    if (opts[key] === undefined) opts[key] = value;
    else if (Array.isArray(opts[key])) opts[key].push(value);
    else opts[key] = [opts[key], value];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !String(next).startsWith('--')) { put(key, String(next)); i += 1; }
    else put(key, true);
  }
  return { positional, opts };
}

function result(exitCode, lines, data = null) {
  return { exitCode, lines, data };
}

function fail(msg) {
  return result(1, [`  ✗ ${msg}`], { error: msg });
}

/**
 * 按**显示宽度**补齐，而不是字符数。
 * 中文 / 全角占两格，padEnd(16) 会把「Fabric 26.3（外部示例）」挤歪。
 */
function pad(s, width) {
  const str = String(s ?? '');
  let w = 0;
  for (const ch of str) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, width - w));
}

function knownTargetIds() {
  return listTargets().map((t) => t.id);
}

function resolveTarget(opts) {
  const ids = knownTargetIds();
  const id = opts.target || opts.targetId || 'fabric-26.3';
  if (!ids.includes(id)) {
    return { error: `未知目标 "${id}"，可选：${ids.join(', ')}` };
  }
  return { id };
}

function readJson(file) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) throw new Error(`文件不存在：${p}`);
  return { p, obj: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

export const HELP = `
MC Studio 积木工具箱

  blocks list      列可用积木（含装了的库）
  blocks compile   <工程>    把工程里的积木程序编成 Java
  blocks from-jar  <jar>     把任意 mod jar 转成积木库
  blocks validate  <库...>   分享前体检：占位符 / 容器槽 / 目标覆盖
  blocks install   <库>      把库装进用户目录或当前工程
  blocks new       用一段 Java 代码造一条积木并导出成库
  blocks targets   列出目标（含外部自动发现的）
  blocks packs     列出 mod 专属积木包（含外部自动发现的）

通用参数：--target <id>  --root <工程目录>  --out <文件>  --json
`;

/**
 * 执行一个子命令。
 * @param {string} sub 子命令
 * @param {string[]} argv 该子命令之后的所有参数
 */
export async function blocksCommand(sub, argv = []) {
  const { positional, opts } = parseArgs(argv);
  switch (sub) {
    case 'help': case '': case undefined:
      return result(0, HELP.trim().split('\n'));

    case 'targets': return cmdTargets(opts);
    case 'packs': return cmdPacks(opts);
    case 'list': return cmdList(opts);
    case 'compile': return cmdCompile(positional, opts);
    case 'from-jar': return cmdFromJar(positional, opts);
    case 'validate': case 'lint': return cmdValidate(positional, opts);
    case 'install': return cmdInstall(positional, opts);
    case 'new': return cmdNew(opts);
    default:
      return fail(`未知子命令 "${sub}"。跑 node studio.mjs blocks help 看用法。`);
  }
}

/* ------------------------------------------------------------------ targets */
function cmdTargets(opts) {
  const targets = listTargets();
  const diags = targetDiagnostics();
  const data = { targets, diagnostics: diags, builtinDir: BUILTIN_TARGETS_DIR };
  if (opts.json) return result(0, [], data);
  const lines = [`  已登记 ${targets.length} 个目标：`, ''];
  for (const t of targets) {
    lines.push(`  ${pad(t.id, 18)} ${pad(t.label, 26)} ${pad(t.platform, 10)} MC ${pad(t.mcVersion, 8)} JDK ${pad(t.javaVersion, 3)} ${t.builtin ? '内置' : '外部'}`);
  }
  lines.push('', `  内置目录：${BUILTIN_TARGETS_DIR}`);
  lines.push(`  外部目录：${path.join(os.homedir(), '.mcstudio', 'targets')} 或 MCSTUDIO_TARGETS`);
  if (diags.length) { lines.push('', '  诊断：'); for (const d of diags) lines.push(`    ! ${d}`); }
  return result(0, lines, data);
}

/* -------------------------------------------------------------------- packs */
function cmdPacks(opts) {
  const packs = listPacks();
  const diags = packDiagnostics();
  const preview = opts.mod ? matchingPacks({ meta: { id: opts.mod }, mainNs: opts.mod }) : [];
  const data = { packs, diagnostics: diags, matching: opts.mod ? preview.map((p) => p.id) : undefined };
  if (opts.json) return result(0, [], data);
  const lines = [`  已登记 ${packs.length} 个 mod 专属积木包：`, ''];
  for (const p of packs) {
    lines.push(`  ${pad(p.id, 18)} ${pad(p.label, 30)} modIds: ${(p.modIds || []).join(',') || '-'}  ${p.builtin ? '内置' : '外部'}`);
  }
  lines.push('', '  放新包：~/.mcstudio/modpacks/<名字>.mjs（导出 pack 对象）');
  if (opts.mod) lines.push(`  对 "${opts.mod}" 命中：${preview.length ? preview.map((p) => p.id).join(', ') : '（无）'}`);
  if (diags.length) { lines.push('', '  诊断：'); for (const d of diags) lines.push(`    ! ${d}`); }
  return result(0, lines, data);
}

/* --------------------------------------------------------------------- list */
function cmdList(opts) {
  const t = resolveTarget(opts);
  if (t.error) return fail(t.error);
  const root = opts.root ? path.resolve(opts.root) : null;
  const libs = loadLibraries(root);
  const cats = blockCatalog(t.id);
  const blocks = cats.flatMap((c) => c.blocks.map((b) => ({ ...b, categoryLabel: c.label })));
  const filtered = opts.category ? blocks.filter((b) => b.category === opts.category) : blocks;
  const data = { target: t.id, categories: cats, blocks: filtered, libraries: libs };
  if (opts.json) return result(0, [], data);
  const lines = [`  目标 ${t.id}：${cats.length} 个分类 / ${blocks.length} 条积木`, ''];
  for (const c of cats) {
    lines.push(`  ${pad(c.id, 24)} ${pad(c.label, 28)} ${String(c.blocks.length).padStart(3)} 条`);
  }
  if (opts.category) {
    lines.push('', `  分类 ${opts.category} 的积木：`);
    for (const b of filtered) lines.push(`    ${b.id.padEnd(38)} ${b.shape.padEnd(9)} ${b.supported ? '' : '（当前目标未实现）'}${b.label}`);
  }
  if (libs.errors.length) for (const e of libs.errors) lines.push(`  ! ${e}`);
  return result(0, lines, data);
}

/* ------------------------------------------------------------------ compile */
function cmdCompile(positional, opts) {
  const root = positional[0] || opts.root;
  if (!root) return fail('要给工程目录：node studio.mjs blocks compile <工程目录>');
  const dir = path.resolve(root);
  if (!fs.existsSync(dataPath(dir))) {
    return fail(`不是工程目录（缺少 .studio/project.json）：${dir}`);
  }
  let project;
  try { project = loadProject(dir); } catch (e) { return fail(e.message); }
  const t = resolveTarget(opts);
  if (t.error) return fail(t.error);
  const programs = project.visual?.programs || [];
  const targetId = opts.target || opts.targetId || project.target?.id || t.id;
  if (!programs.length) {
    const empty = { ok: true, targetId, code: '', files: [], warnings: [], errors: [], programs: 0 };
    if (opts.json) return result(0, [], empty);
    return result(0, [
      `  工程里还没有积木程序：${dir}`,
      '  在界面的「积木」面板搭一段并保存，或用 --root 指向别的工程。',
    ], empty);
  }
  loadLibraries(dir);
  const r = compileProject({ ...project, visual: project.visual }, { targetId });
  const code = (r.files || []).map((f) => f.content || f.code || '').join('\n');
  const data = { ok: r.ok, targetId, code, files: r.files, warnings: r.warnings, errors: r.errors };
  if (!r.ok || r.errors.length) {
    return result(1, [`  ✗ 编译失败：${r.errors.join('；') || '未知错误'}`, ...r.warnings.map((w) => `  · ${w}`)], data);
  }
  if (opts.out) {
    const out = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, code, 'utf8');
  }
  if (opts.json) return result(0, [], data);
  const lines = [
    `  ✓ 编译通过：${(project.visual?.programs || []).length} 段程序，${code.split('\n').length} 行 Java`,
    `  目标 ${targetId}${opts.out ? `，已写到 ${path.resolve(opts.out)}` : ''}`,
  ];
  for (const w of r.warnings) lines.push(`  · ${w}`);
  if (!opts.out) lines.push('', '  —— 生成的代码 ——', ...code.split('\n').map((l) => '  ' + l));
  return result(0, lines, data);
}

/* ----------------------------------------------------------------- from-jar */
function cmdFromJar(positional, opts) {
  const jar = positional[0];
  if (!jar) return fail('要给 jar 路径：node studio.mjs blocks from-jar <jar>');
  const p = path.resolve(jar);
  if (!fs.existsSync(p)) return fail(`jar 不存在：${p}`);
  const t = resolveTarget(opts);
  if (t.error) return fail(t.error);
  let out;
  try {
    out = libraryFromJar(p, {
      targetId: opts.target || opts.targetId || undefined,
      withApi: opts['no-api'] ? false : undefined,
      withPack: opts['no-pack'] ? false : undefined,
    });
  } catch (e) {
    return fail(`生成失败：${e.message}`);
  }
  const lib = out.library;
  const v = lintLibrary(lib, { knownTargets: knownTargetIds() });
  if (opts.out) {
    const dest = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(lib, null, 2), 'utf8');
  }
  const data = { library: lib, warnings: out.warnings, lint: v, out: opts.out ? path.resolve(opts.out) : null };
  if (opts.json) return result(0, [], data);
  const lines = [
    `  ✓ ${lib.name}：${lib.blocks.length} 条积木 / ${lib.categories.length} 个分类，目标 ${out.target || '未定'}`,
    ...(opts.out ? [`  已写到 ${path.resolve(opts.out)}`] : []),
  ];
  for (const w of out.warnings.slice(0, 10)) lines.push(`  · ${w}`);
  if (v.errors.length) {
    lines.push('', `  体检发现 ${v.errors.length} 个问题（建议修完再分享）：`);
    for (const e of v.errors.slice(0, 8)) lines.push(`    ! ${e}`);
  }
  return result(0, lines, data);
}

/* ----------------------------------------------------------------- validate */
function cmdValidate(positional, opts) {
  const files = positional.length ? positional : [];
  if (!files.length) return fail('要给至少一个库文件：node studio.mjs blocks validate <库文件...>');
  const known = knownTargetIds();
  const results = [];
  let bad = 0;
  const lines = [];
  for (const f of files) {
    let obj;
    try { obj = readJson(f).obj; } catch (e) { bad += 1; lines.push(`  ✗ ${f}：${e.message}`); results.push({ file: f, error: e.message }); continue; }
    const r = lintLibrary(obj, { knownTargets: known });
    if (!r.ok) bad += 1;
    results.push({ file: f, ...r });
    lines.push(...lintSummary(r, f));
    lines.push('');
  }
  const data = { ok: bad === 0, results };
  if (opts.json) return result(bad ? 1 : 0, [], data);
  lines.unshift(`  体检 ${files.length} 个库：${bad ? `${bad} 个有问题` : '全部通过'}`, '');
  return result(bad ? 1 : 0, lines, data);
}

/* ------------------------------------------------------------------ install */
function cmdInstall(positional, opts) {
  const file = positional[0];
  if (!file) return fail('要给库文件：node studio.mjs blocks install <库文件>');
  let lib;
  try { lib = readJson(file).obj; } catch (e) { return fail(e.message); }
  const v = validateLibrary(lib);
  if (!v.ok) return fail(`库不合法：${v.errors.join('；')}`);
  const scope = opts.scope || 'user';
  if (!['user', 'project'].includes(scope)) return fail(`--scope 只能是 user 或 project，收到 "${scope}"`);
  if (scope === 'project' && !opts.root) return fail('装到工程要同时给 --root <工程目录>');
  const dir = scope === 'user' ? userBlocksDir() : projectBlocksDir(path.resolve(opts.root));
  const dest = path.join(dir, `${lib.id}.mcblocks.json`);
  writeLibrary(lib, dest);
  const data = { ok: true, installed: dest, blockCount: lib.blocks.length, scope };
  if (opts.json) return result(0, [], data);
  return result(0, [
    `  ✓ 已装 ${lib.name}（${lib.blocks.length} 条积木）到 ${scope === 'user' ? '用户库' : '工程库'}`,
    `  ${dest}`,
    '  重启服务或刷新积木面板即可看到。',
  ], data);
}

/* ---------------------------------------------------------------------- new */
function cmdNew(opts) {
  const code = opts.code;
  const id = opts.id;
  const name = opts.name;
  if (!code || !id || !name) return fail('要给 --name、--id、--code 三个参数');
  const paramArgs = [];
  if (opts.param) paramArgs.push(...(Array.isArray(opts.param) ? opts.param : [opts.param]));
  const params = paramArgs.map((s) => {
    const [pname, kind = 'text'] = String(s).split(':');
    return { name: pname, kind, default: kind === 'number' ? 0 : '' };
  });
  const blockOpts = {
    id, name, code, params,
    description: opts.description || '',
    category: opts.category || 'custom',
  };
  if (opts.target || opts.targetId) blockOpts.targetId = opts.target || opts.targetId;
  else if (opts['all-targets']) blockOpts.allTargets = true;
  // 不传 target = 默认全目标（见 registry.mjs）
  const r = createUserBlock(blockOpts);
  if (!r.ok) return fail(r.error);
  const lib = exportUserBlocks([id]);
  if (opts.out) {
    const dest = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(lib, null, 2), 'utf8');
  }
  const targets = r.block.userDef?.targets || [r.block.userDef?.targetId];
  const data = { ok: true, block: r.block, library: lib, targets, out: opts.out ? path.resolve(opts.out) : null };
  if (opts.json) return result(0, [], data);
  return result(0, [
    `  ✓ 造好了「${name}」(${id})，${params.length} 个参数`,
    `  适用目标：${targets.join(', ')}`,
    ...(opts.out ? [`  已导出到 ${path.resolve(opts.out)}`] : ['  没给 --out，库只留在内存里（下次启动就没了）']),
  ], data);
}
