/**
 * 目标适配器注册表。
 *
 * 「目标」= 加载器 + MC 版本 的组合，例如 fabric + 26.3。
 * 新增一个目标，只需要在 target/<id>/adapter.mjs 里导出同样的接口，
 * 然后在下面的 ADAPTERS 里登记一行。引擎、模块、界面都不用改。
 *
 * 适配器接口（约定，不是 TS 类型）：
 *   id            string    唯一标识，如 'fabric-26.3'
 *   label         string    界面显示名
 *   platform      string    'fabric' | 'neoforge' | 'forge' | 'paper' | ...
 *   mcVersion     string
 *   javaVersion   number    目标 JDK
 *   defaults      object    该目标的默认版本号，用于新建工程
 *   paths         object    目录约定函数
 *   features      object    能力开关，模块据此决定生成策略
 *   scaffold(ctx) Array<{path, content}>   生成工程骨架文件
 *   java          object    代码生成辅助（见各适配器实现）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fabric263 from './fabric-26.3/adapter.mjs';
import forge1201 from './forge-1.20.1/adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 内置目标目录，文档 / 工具里给出「照着谁抄」时用 */
export const BUILTIN_TARGETS_DIR = HERE;
// Node 22 起 require() 能同步加载 ESM。用它是为了让 listTargets() / getTarget()
// 继续保持**同步** API —— 改成动态 import 会把半条调用链都逼成 async。
const require = createRequire(import.meta.url);

// 内置目标：随引擎发版。外部目标（用户自己放的）在下面自动补进来。
const ADAPTERS = new Map([
  [fabric263.id, { ...fabric263, __source: 'builtin' }],
  [forge1201.id, { ...forge1201, __source: 'builtin' }],
]);

/** 加载外部目标时出的问题，给 CLI / 界面的诊断面板看，不静默吞掉 */
const loadIssues = [];
export function targetDiagnostics() {
  return loadIssues.slice();
}

/**
 * 外部目标目录，按优先级：
 *   1. 环境变量 MCSTUDIO_TARGETS（多个用路径分隔符隔开，CI 里最好用）
 *   2. 用户目录 ~/.mcstudio/targets/（装一次，所有工程都能用）
 *   3. 调用方显式传入（工程自己的 .studio/targets/）
 */
export function externalTargetDirs(extra = []) {
  const dirs = [];
  for (const d of String(process.env.MCSTUDIO_TARGETS || '').split(path.delimiter)) {
    if (d.trim()) dirs.push(path.resolve(d.trim()));
  }
  dirs.push(path.join(os.homedir(), '.mcstudio', 'targets'));
  for (const d of extra) if (d) dirs.push(path.resolve(d));
  return [...new Set(dirs)];
}

/**
 * 登记一个目标适配器。第三方也可以在代码里直接调，不必非得放文件。
 * 适配器至少要给 id / label / platform / mcVersion，其余接口见文件头注释。
 */
export function registerTarget(adapter, opts = {}) {
  const a = adapter?.default || adapter?.adapter || adapter;
  if (!a || typeof a !== 'object') return { ok: false, error: '适配器不是对象' };
  const missing = ['id', 'label', 'platform', 'mcVersion'].filter((k) => !a[k]);
  if (missing.length) return { ok: false, error: `缺少字段：${missing.join(', ')}` };
  const id = String(a.id);
  if (ADAPTERS.has(id) && opts.overwrite !== true) {
    return { ok: false, error: `目标 "${id}" 已存在（来自 ${ADAPTERS.get(id).__source}）` };
  }
  ADAPTERS.set(id, { ...a, id, __source: opts.source || 'api' });
  if (typeof a.scaffold !== 'function') {
    loadIssues.push(`${id}：没有 scaffold()，选它建工程会失败`);
  }
  return { ok: true, id };
}

/** 扫外部目录，把里面的适配器都登记进来。返回新加载的目标 id */
export function loadExternalTargets(extraDirs = []) {
  const loaded = [];
  for (const dir of externalTargetDirs(extraDirs)) {
    if (!fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => /\.(mjs|js|cjs)$/.test(n)).sort();
    } catch (e) {
      loadIssues.push(`${dir}：读目录失败 — ${e.message}`);
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      let mod;
      try {
        mod = require(file);
      } catch (e) {
        loadIssues.push(`${file}：加载失败 — ${e.message}`);
        continue;
      }
      const r = registerTarget(mod, { source: file, overwrite: optsOverwrite() });
      if (r.ok) loaded.push(r.id);
      else if (!r.error.includes('已存在')) loadIssues.push(`${file}：${r.error}`);
    }
  }
  return loaded;
}

/** 外部目标允许覆盖内置目标（改默认版本号之类），用环境变量开启 */
function optsOverwrite() {
  return process.env.MCSTUDIO_TARGETS_OVERWRITE === '1';
}

export function unregisterTarget(id) {
  const a = ADAPTERS.get(id);
  if (!a || a.__source === 'builtin') return false;
  return ADAPTERS.delete(id);
}

/** 这个目标是不是引擎内置的 */
export function isBuiltinTarget(id) {
  return ADAPTERS.get(id)?.__source === 'builtin';
}

// 模块一加载就扫一遍 —— CLI / 服务 / 测试都不用改一行代码就能认出新目标。
loadExternalTargets();

export function listTargets() {
  return [...ADAPTERS.values()].map((a) => ({
    id: a.id,
    label: a.label,
    platform: a.platform,
    mcVersion: a.mcVersion,
    javaVersion: a.javaVersion,
    defaults: a.defaults,
    experimental: !!a.experimental,
    source: a.__source,
    builtin: a.__source === 'builtin',
  }));
}

export function getTarget(id) {
  const a = ADAPTERS.get(id);
  if (!a) throw new Error(`未知目标 "${id}"，可选：${[...ADAPTERS.keys()].join(', ')}`);
  return a;
}

export function hasTarget(id) {
  return ADAPTERS.has(id);
}

/**
 * 从工程数据里解析出目标 id。
 *
 * 老工程只有 platform + mcVersion，新工程带 target.id。两条路都要认：
 * 用户手改过 project.json、或者从旧版本编辑器迁移过来的工程不能突然打不开。
 * 解析不出来时返回一个拼出来的 id，让 getTarget() 去抛那句带候选列表的清晰错误。
 */
export function resolveTargetId(target) {
  if (!target) return 'fabric-26.3';
  if (target.id && ADAPTERS.has(target.id)) return target.id;
  const composed = `${target.platform || 'fabric'}-${target.mcVersion || ''}`.replace(/-$/, '');
  if (ADAPTERS.has(composed)) return composed;
  // 兼容早期只写 platform 的工程
  if (ADAPTERS.has(target.platform)) return target.platform;
  return composed;
}

/** 工程 → 适配器。管线里统一用这个，别再自己拼字符串 */
export function getTargetFor(project) {
  return getTarget(resolveTargetId(project?.target));
}

/** 按平台的显示色，界面用来做标签 */
export const PLATFORM_COLORS = {
  fabric: '#dbc17a',
  neoforge: '#e08a3c',
  forge: '#7a8fa6',
  paper: '#6aa84f',
  spigot: '#c9a227',
};
