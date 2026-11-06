/**
 * 工具包索引。
 *
 * tools/ 里堆了十几个脚本，有长期维护的、也有一次性探针，
 * 没有入口、没有清单，过两周就没人记得哪个能干什么。
 * 这里直接扫目录 + 读文件头注释生成索引，新增脚本不用登记。
 *
 *   node studio.mjs tools            列全部
 *   node studio.mjs tools --formal   只列正式工具
 *   node studio.mjs tools --json     给脚本用
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOLS_DIR = path.resolve(HERE, '../../tools');

/** 从文件头注释里抽出说明、用法、是否一次性 */
function describe(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const head = src.split('\n').slice(0, 40);
  const comment = [];
  for (const line of head) {
    const t = line.trim();
    if (t.startsWith('/**') || t.startsWith('/*') || t.startsWith('*/')) continue;
    if (t.startsWith('*')) { comment.push(t.replace(/^\*+\s?/, '').trim()); continue; }
    if (comment.length) break;
  }
  const text = comment.filter(Boolean);
  const summary = text.find((t) => t && !/^(用法|跑法|为什么需要|背景|流程|示例)/.test(t)) || '';
  // 「用法：」常常单独占一行，真正的命令在下一行 —— 只取那一行会显示成空的
  const uidx = text.findIndex((t) => /^(用法|跑法|示例|命令)[:：]?/.test(t));
  let usage = '';
  if (uidx >= 0) {
    const first = text[uidx].replace(/^(用法|跑法|示例|命令)[:：]?\s*/, '').trim();
    usage = first || text[uidx + 1] || '';
  }
  const disposable = /一次性|跑完可删|临时用|探测用/.test(text.slice(0, 5).join(' '));
  return {
    name: path.basename(file),
    summary: summary.slice(0, 100),
    usage: usage.slice(0, 120),
    disposable,
    bytes: fs.statSync(file).size,
  };
}

/** 全部工具（按名字排序，正式工具在前） */
export function listTools() {
  if (!fs.existsSync(TOOLS_DIR)) return [];
  return fs.readdirSync(TOOLS_DIR)
    .filter((n) => /\.(mjs|js)$/.test(n) && !n.startsWith('probe-'))
    .map((n) => describe(path.join(TOOLS_DIR, n)))
    .filter(Boolean)
    .sort((a, b) => (a.disposable === b.disposable ? a.name.localeCompare(b.name) : (a.disposable ? 1 : -1)));
}

/** 探针脚本单列（它们不是工具，是浏览器验证用的注入脚本） */
export function listProbes() {
  if (!fs.existsSync(TOOLS_DIR)) return [];
  return fs.readdirSync(TOOLS_DIR)
    .filter((n) => n.startsWith('probe-'))
    .sort();
}

export function toolsCommand(argv = []) {
  const opts = {};
  for (const a of argv) if (a.startsWith('--')) opts[a.slice(2)] = true;
  let tools = listTools();
  if (opts.formal) tools = tools.filter((t) => !t.disposable);
  const probes = listProbes();
  const data = { tools, probes, dir: TOOLS_DIR };
  if (opts.json) return { exitCode: 0, lines: [], data };
  const lines = [`  tools/ 共 ${tools.length} 个脚本（${tools.filter((t) => !t.disposable).length} 个正式 / ${tools.filter((t) => t.disposable).length} 个一次性）：`, ''];
  for (const t of tools) {
    lines.push(`  ${t.disposable ? '·' : '★'} ${t.name.padEnd(32)} ${t.summary || '（文件头没写说明）'}`);
    if (t.usage) lines.push(`      ${t.usage}`);
  }
  if (probes.length) lines.push('', `  浏览器探针（配合 tests/visual-ui.mjs 用）：${probes.join(', ')}`);
  lines.push('', '  常用入口也可以走 CLI：node studio.mjs blocks help');
  return { exitCode: 0, lines, data };
}
