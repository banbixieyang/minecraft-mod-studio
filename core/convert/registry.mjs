/**
 * 转换器规则注册表 —— 可插拔。
 *
 * 「转换器」把一份功能（内容条目 / 效果代码 / 积木程序 / 生成资源）
 * 从源目标（加载器 + MC 版本）搬到目标目标。它不猜 API：能证实的自动改，
 * 不能证实的明确标成「需人工」，绝不假装转好了。
 *
 * 规则就是一个 .mjs 文件，导出 `rule`：
 *
 *   export const rule = {
 *     id: 'demo.hello',
 *     label: '示例规则',
 *     priority: 50,                    // 大数字先跑
 *     from: { platform: 'fabric', mcVersion: '*' },   // 省略 / '*' = 任意
 *     to:   { platform: 'forge',  mcVersion: '*' },
 *     match(ctx) { return true; },    // 可选，更细的命中条件
 *     convert(ctx, draft) {
 *       // ctx = { from, to, feature, parts, targets }
 *       // draft 是输入的深拷贝，规则可以改它，也可以用 changes 精确回填
 *       return {
 *         changes: { 'java/0': { code: '...' } },   // 按 part id 回填
 *         items: [{ id, kind, label, status, confidence, notes, suggestion }],
 *         notes: [],
 *       };
 *     },
 *   };
 *
 * status 四档（界面/CLI/报告共用）：
 *   ported   全自动且有证据（积木模板、适配器能力表）
 *   adapted  已自动改写，但建议编译确认
 *   manual   没敢自动改，原样保留 + TODO 与做法提示
 *   blocked  目标表达不了这个能力，需要换实现思路
 *
 * 发现顺序（后面的覆盖前面同 id 的规则）：
 *   内置 core/convert/rules/*.mjs
 *   MCSTUDIO_CONVERT（多个目录用路径分隔符隔开，CI 用）
 *   ~/.mcstudio/convert/（装一次，所有工程可用）
 *   <工程>/.studio/convert/（只对当前工程生效）
 *
 * 设计约束与 modpacks/registry.mjs 一致：同步加载（Node 22 的 require(esm)）、
 * 单个规则写崩只跳过它并记诊断、外部可覆盖内置。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const BUILTIN_RULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rules');

const rules = new Map();
const issues = [];

export function convertDiagnostics() {
  return issues.slice();
}

export function externalRuleDirs(extra = []) {
  const dirs = [];
  for (const d of String(process.env.MCSTUDIO_CONVERT || '').split(path.delimiter)) {
    if (d.trim()) dirs.push(path.resolve(d.trim()));
  }
  dirs.push(path.join(os.homedir(), '.mcstudio', 'convert'));
  for (const d of extra) if (d) dirs.push(path.resolve(d));
  return [...new Set(dirs)];
}

/** 代码里直接登记一条规则（测试也走这里）。 */
export function registerRule(rule, opts = {}) {
  const r = rule?.rule || rule?.default || rule;
  if (!r || typeof r !== 'object') return { ok: false, error: '规则不是对象' };
  if (!r.id) return { ok: false, error: '规则缺少 id' };
  if (typeof r.convert !== 'function') return { ok: false, error: `规则 ${r.id} 缺少 convert()` };
  const id = String(r.id);
  const old = rules.get(id);
  // 只有外部目录扫描明确带 overwrite:true 才能覆盖内置；
  // 代码里直接登记的规则一视同仁，避免误把别人注册的同 id 规则顶掉。
  if (old && opts.overwrite !== true) {
    return { ok: false, error: `规则 ${id} 已存在（来自 ${old.__source}）` };
  }
  rules.set(id, {
    ...r,
    id,
    label: r.label || id,
    priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 50,
    __source: opts.source || 'api',
  });
  return { ok: true, id };
}

/** 扫目录登记规则，返回新加载的 id。 */
export function loadRules(extraDirs = []) {
  const loaded = [];
  for (const dir of [BUILTIN_RULES_DIR, ...externalRuleDirs(extraDirs)]) {
    if (!fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => /\.(mjs|js|cjs)$/.test(n)).sort();
    } catch (e) {
      issues.push(`${dir}：读目录失败 — ${e.message}`);
      continue;
    }
    const external = path.resolve(dir) !== path.resolve(BUILTIN_RULES_DIR);
    for (const name of names) {
      const file = path.join(dir, name);
      let mod;
      try {
        mod = require(file);
      } catch (e) {
        issues.push(`${file}：加载失败 — ${e.message}`);
        continue;
      }
      const r = mod?.rule || mod?.default?.rule || mod?.default;
      if (!r || !r.id) continue;   // 不是规则文件，安静跳过
      const res = registerRule(r, { source: file, overwrite: external });
      if (res.ok) loaded.push(res.id);
      else issues.push(`${file}：${res.error}`);
    }
  }
  return loaded;
}

export function listRules() {
  return [...rules.values()].map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description || '',
    priority: r.priority,
    from: r.from || null,
    to: r.to || null,
    source: r.__source,
    builtin: r.__source === 'builtin' || r.__source.startsWith(BUILTIN_RULES_DIR),
  }));
}

export function unregisterRule(id) {
  return rules.delete(String(id));
}

export function clearRules() {
  rules.clear();
  issues.length = 0;
}

const anyMatch = (spec, side) => {
  if (!spec) return true;
  for (const key of ['platform', 'mcVersion', 'id']) {
    const want = spec[key];
    if (!want || want === '*') continue;
    const got = String(side?.[key] ?? '');
    const list = Array.isArray(want) ? want.map(String) : [String(want)];
    if (!list.includes(got)) return false;
  }
  return true;
};

/** 找出这次转换该跑的规则，按 priority 从大到小。 */
export function matchingRules(ctx) {
  return [...rules.values()]
    .filter((r) => anyMatch(r.from, ctx.from) && anyMatch(r.to, ctx.to))
    .filter((r) => {
      if (typeof r.match !== 'function') return true;
      try {
        return !!r.match(ctx);
      } catch (e) {
        issues.push(`${r.id}：match() 抛异常 — ${e.message}`);
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

// 模块加载时自动扫一遍内置 + 用户目录
loadRules();
