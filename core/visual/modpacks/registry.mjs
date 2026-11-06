/**
 * mod 专属积木包注册表 —— 可插拔。
 *
 * 背景：通用扫描（modlib.mjs）扫的是 public static 方法，产出「调用 XxxUtil.foo(a,b,c)」
 * 这种零件，对会写代码的人有用，对小朋友没用。所以还要有手写的「积木级」语义包，
 * 比如「给玩家一个聚晶」「把灵魂能量设成 500」。
 *
 * 以前 modlib.mjs 里写死 `if (isGoety(report)) goetyPack(...)` —— 每加一个 mod
 * 都要改引擎源码，跟「任意 mod 都能变成积木库」的承诺对不上。
 * 现在改成扫目录自动发现：
 *
 *   内置：core/visual/modpacks/*.mjs（随引擎发版）
 *   用户：~/.mcstudio/modpacks/*.mjs
 *   环境：MCSTUDIO_MODPACKS 指向的目录（CI / 多版本切换用）
 *   工程：<工程>/.studio/modpacks/*.mjs（只在当前工程生效）
 *
 * 一个包就是一个 .mjs 文件，导出 `pack`：
 *
 *   export const pack = {
 *     id: 'goety',                     // 唯一
 *     label: 'Goety 专属积木',          // 生成日志里显示
 *     modIds: ['goety'],               // 可选：按 mod id / namespace 匹配
 *     match(report) { ... },           // 可选：自定义匹配，返回 boolean
 *     build({ targetId, report, opts }) {
 *       return { blocks: [], categories: [], notes: [] };
 *     },
 *   };
 *
 * 设计约束：
 *   · **同步**。libraryFromReport() 是同步的，所以用 Node 22 的 require(esm)
 *     同步加载，不把整条生成链改成 async。
 *   · **隔离**。一个包写崩了（语法错 / build 抛异常）只跳过它，记进 notes，
 *     其它包和通用扫描照常出结果。
 *   · **可覆盖**。外部包 id 与内置相同时，外部优先 —— 用户能修内置包的 bug，
 *     不用等引擎发版。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertRuntime, isRequireEsmError } from '../../runtime.mjs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SELF_FILE = fileURLToPath(import.meta.url);
export const BUILTIN_PACKS_DIR = path.dirname(SELF_FILE);

const packs = new Map();
const issues = [];

/** 加载 / 匹配过程中出的问题，别静默吞掉 */
export function packDiagnostics() {
  return issues.slice();
}

/** 外部包目录，按优先级排好 */
export function externalPackDirs(extra = []) {
  const dirs = [];
  for (const d of String(process.env.MCSTUDIO_MODPACKS || '').split(path.delimiter)) {
    if (d.trim()) dirs.push(path.resolve(d.trim()));
  }
  dirs.push(path.join(os.homedir(), '.mcstudio', 'modpacks'));
  for (const d of extra) if (d) dirs.push(path.resolve(d));
  return [...new Set(dirs)];
}

/**
 * 直接登记一个包（代码里注册用，测试也走这条路）。
 * @returns {{ok:boolean, id?:string, error?:string}}
 */
export function registerPack(pack, opts = {}) {
  const p = pack?.pack || pack?.default || pack;
  if (!p || typeof p !== 'object') return { ok: false, error: '包不是对象' };
  if (!p.id) return { ok: false, error: '包缺少 id' };
  if (typeof p.build !== 'function') return { ok: false, error: `包 ${p.id} 缺少 build()` };
  if (packs.has(p.id) && opts.overwrite !== true && packs.get(p.id).__source !== 'api') {
    return { ok: false, error: `包 ${p.id} 已存在（来自 ${packs.get(p.id).__source}）` };
  }
  packs.set(String(p.id), {
    ...p,
    id: String(p.id),
    label: p.label || String(p.id),
    __source: opts.source || 'api',
  });
  return { ok: true, id: String(p.id) };
}

/** 扫目录，把里面的包登记进来。返回新加载的包 id */
export function loadPacks(extraDirs = []) {
  const loaded = [];
  for (const dir of [BUILTIN_PACKS_DIR, ...externalPackDirs(extraDirs)]) {
    if (!fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => /\.(mjs|js|cjs)$/.test(n)).sort();
    } catch (e) {
      issues.push(`${dir}：读目录失败 — ${e.message}`);
      continue;
    }
    const external = path.resolve(dir) !== path.resolve(BUILTIN_PACKS_DIR);
    for (const name of names) {
      const file = path.join(dir, name);
      // 扫内置目录会扫到本文件自己。require(esm) 不允许循环加载，
      // 会抛 "A cycle involving require(esm) is not allowed" —— 直接跳过。
      if (path.resolve(file) === path.resolve(SELF_FILE)) continue;
      let mod;
      try {
        mod = require(file);
      } catch (e) {
        if (isRequireEsmError(e)) assertRuntime();
        issues.push(`${file}：加载失败 — ${e.message}`);
        continue;
      }
      const p = mod?.pack || mod?.default?.pack || mod?.default;
      if (!p || !p.id) continue;   // 不是包（比如本文件），安静跳过
      const r = registerPack(p, { source: file, overwrite: external });
      if (r.ok) loaded.push(r.id);
      else issues.push(`${file}：${r.error}`);
    }
  }
  return loaded;
}

/** 已登记的包（给 CLI / 界面列清单） */
export function listPacks() {
  return [...packs.values()].map((p) => ({
    id: p.id,
    label: p.label,
    modIds: p.modIds || [],
    source: p.__source,
    builtin: p.__source === 'builtin' || p.__source.startsWith(BUILTIN_PACKS_DIR),
  }));
}

export function unregisterPack(id) {
  return packs.delete(String(id));
}

/** 一个包该不该对这个 mod 生效 */
function matches(pack, report) {
  if (typeof pack.match === 'function') {
    try {
      return !!pack.match(report);
    } catch (e) {
      issues.push(`${pack.id}：match() 抛异常 — ${e.message}`);
      return false;
    }
  }
  const ids = (pack.modIds || []).map((x) => String(x).toLowerCase());
  if (!ids.length) return false;
  const modId = String(report?.meta?.id || '').toLowerCase();
  const ns = String(report?.mainNs || '').toLowerCase();
  return ids.includes(modId) || ids.includes(ns);
}

/** 找出匹配这份分析报告的所有包 */
export function matchingPacks(report) {
  return [...packs.values()].filter((p) => matches(p, report));
}

/**
 * 跑所有匹配的包，把产出的积木 / 分类 / 说明合并。
 * 单个包失败不影响其它包。
 */
export function runPacks({ targetId, report, opts = {} } = {}) {
  const out = { blocks: [], categories: [], notes: [] };
  for (const p of matchingPacks(report)) {
    try {
      const r = p.build({ targetId, report, opts });
      if (!r || typeof r !== 'object') {
        out.notes.push(`${p.label}：build() 没返回对象，已跳过`);
        continue;
      }
      const blocks = Array.isArray(r.blocks) ? r.blocks : [];
      const categories = Array.isArray(r.categories) ? r.categories : [];
      out.blocks.push(...blocks);
      out.categories.push(...categories);
      out.notes.push(...(Array.isArray(r.notes) ? r.notes : []));
      out.notes.push(`${p.label} ${blocks.length} 条`);
    } catch (e) {
      out.notes.push(`${p.label}：生成失败 — ${e.message}`);
      issues.push(`${p.id}：build() 抛异常 — ${e.message}`);
    }
  }
  return out;
}

/** 测试用：清掉所有包（内置会重新扫） */
export function clearPacks() {
  packs.clear();
  issues.length = 0;
}

// 模块加载时自动扫一遍内置 + 用户目录
loadPacks();
