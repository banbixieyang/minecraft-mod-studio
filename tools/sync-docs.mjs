/**
 * 把应用内的指南同步一份到 docs/guides/。
 *
 * 跑法：node tools/sync-docs.mjs [--check]
 *
 * --check 只校验不写文件，用来当测试跑：内容不同步就退出码非 0。
 *
 * 为什么要有这一步：
 *   手册的正本在 knowledge/guides/ —— 应用里的「学习中心」直接读它，
 *   改了立刻生效，不会出现「网页上是旧的、文档上是新的」。
 *   但仓库里也要有一份能直接读的 Markdown（给不用这个工具的人看），
 *   所以同步一份过去。
 *
 *   两份同源不同步是迟早的事 —— 所以这里做了：
 *   · 带 front matter 头（说明这是同步出来的，别手改）
 *   · 同步后跑一遍校验：docs 里的和 knowledge 里的必须逐字一致
 *   · 不一致就退出码非 0，CI 或测试能拦住
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'knowledge', 'guides');
const OUT = path.join(ROOT, 'docs', 'guides');
const CHECK = process.argv.includes('--check');

const BANNER = `<!--
  本文件由 tools/sync-docs.mjs 从 knowledge/guides/ 同步生成。
  要改内容，请改 knowledge/guides/ 里的正本，然后重新跑一次同步。
-->
`;

function readBody(file) {
  const raw = fs.readFileSync(file, 'utf8');
  // front matter 保留 —— 它带着 order / category / evidence，
  // 复制出去的人一看就知道这是哪一篇、什么等级。
  return raw.replace(/\r\n/g, '\n');
}

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
if (!files.length) {
  console.error(`没找到指南：${SRC}`);
  process.exit(1);
}

let changed = 0;
for (const f of files) {
  const body = readBody(path.join(SRC, f));
  const content = BANNER + body;
  const outFile = path.join(OUT, f);
  const old = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (old === content) continue;
  if (CHECK) {
    console.log(`不同步 ${f}`);
    changed++;
    continue;
  }
  fs.writeFileSync(outFile, content, 'utf8');
  changed++;
  console.log(`同步 ${f}`);
}

// ---- 校验：docs 里的必须和正本逐字一致（去掉同步头）----
const problems = [];
for (const f of files) {
  const outFile = path.join(OUT, f);
  if (!fs.existsSync(outFile)) {
    problems.push(`${f} 没同步过来`);
    continue;
  }
  const got = fs.readFileSync(outFile, 'utf8');
  const want = BANNER + readBody(path.join(SRC, f));
  if (got !== want) problems.push(`${f} 与正本不一致`);
}

// 反向：docs 里多出来的（正本删了、docs 没删）也要报
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.md'))) {
  if (!files.includes(f)) problems.push(`${f} 在正本里已经没有了，docs 里是残留`);
}

if (problems.length) {
  console.error('\n同步没对齐：');
  for (const p of problems) console.error(`  ! ${p}`);
  console.error('\n跑一次 node tools/sync-docs.mjs 就能对齐。');
  process.exit(1);
}

if (CHECK) {
  console.log(`${files.length} 篇指南与正本一致 ✓`);
  process.exit(0);
}

console.log(`\n${files.length} 篇指南已同步（本次更新 ${changed} 篇），内容与正本一致。`);
console.log(`输出目录：${OUT}`);
