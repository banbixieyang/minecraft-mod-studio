/**
 * 文档一致性测试。
 *
 * 管三件事：
 *   1. docs/guides/ 里的手册副本和 knowledge/guides/ 的正本逐字一致（不脱节）；
 *   2. docs/README.md 和根 README.md 里的链接都指向真实存在的文件；
 *   3. 应用内的两份主教程（使用手册、拆解别人的 mod）章节齐全，
 *      不是写了一半的空壳。
 *
 *   node tests/docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`);
  }
}

console.log('【文档一致性】');

// ---- 1. docs 副本与正本一致 ----
const sync = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sync-docs.mjs'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
ok('docs/guides 与 knowledge/guides 同步', sync.status === 0, sync.status !== 0 ? (sync.stdout + sync.stderr).trim() : '');
if (sync.status === 0) {
  const m = (sync.stdout || '').match(/(\d+) 篇指南/);
  if (m) ok('指南篇数', Number(m[1]) >= 7, `${m[1]} 篇`);
}

// ---- 2. 文档里的链接都指向真实文件 ----
const mdFiles = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'docs', 'README.md'),
  path.join(ROOT, 'docs', 'module-guide.md'),
  path.join(ROOT, 'docs', 'reuse-and-analysis.md'),
  path.join(ROOT, 'docs', 'knowledge-and-ai.md'),
];

for (const f of mdFiles) {
  if (!fs.existsSync(f)) {
    ok(`${path.relative(ROOT, f)} 存在`, false);
    continue;
  }
  const raw = fs.readFileSync(f, 'utf8');
  // 只管本地相对链接：带协议的（http/mailto）和纯锚点的不算
  const links = [...raw.matchAll(/\]\(([^)]+?)\)/g)]
    .map((m) => m[1].split('#')[0].trim())
    .filter((rel) => rel && !/^[a-z]+:/i.test(rel) && !rel.startsWith('//'));
  const bad = links.filter((rel) => !fs.existsSync(path.resolve(path.dirname(f), rel)));
  ok(`${path.relative(ROOT, f)} 的链接都有效`, bad.length === 0, bad.length ? `失效：${bad.join('、')}` : `${links.length} 个链接`);
}

// ---- 3. 两份主教程章节齐全 ----
const manual = fs.readFileSync(path.join(ROOT, 'knowledge', 'guides', '00-使用手册.md'), 'utf8');
const manualSections = [
  '## 0. 一句话认识它',
  '## 1. 第一次用：新建一个工程',
  '## 2. 自己做内容：完整流程',
  '## 3. 拆别人的 mod：完整流程',
  '## 4. 包库：攒和用',
  '## 5. 学习中心与 AI',
  '## 6. 扩展系统：让引擎加载新工具',
  '## 7. 常见问题',
  '## 8. 一张速查表',
];
const missingManual = manualSections.filter((s) => !manual.includes(s));
ok('使用手册九章齐全', missingManual.length === 0, missingManual.join('、'));
ok('使用手册有扩展契约示例', /analyze\s*\(\s*ctx\s*\)|onExport/.test(manual));
ok('使用手册提醒扩展要重启', /重启/.test(manual));

const dissect = fs.readFileSync(path.join(ROOT, 'knowledge', 'guides', '06-拆解别人的mod.md'), 'utf8');
const dissectSections = [
  '## 1. 为什么这事值得做',
  '## 2. 四步走',
  '## 3. 关键：改数值怎么才真生效',
  '## 4. 拆解时能看到什么',
  '## 5. 边界：拆不出来的东西',
  '## 6. 实战：一个完整例子',
  '## 7. 排查清单',
];
const missingDissect = dissectSections.filter((s) => !dissect.includes(s));
ok('拆解教程七章齐全', missingDissect.length === 0, missingDissect.join('、'));
ok('拆解教程写了覆写路径', /toml/i.test(dissect) && /java/i.test(dissect));

// ---- 4. 网页入口的引导文案和文档对得上 ----
const appJs = fs.readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');
for (const rel of ['01-从零到出jar', '06-拆解别人的mod', '00-使用手册']) {
  ok(`首页卡片指向真实文档 ${rel}`, appJs.includes(rel));
}
ok('顶栏有手册按钮', /'手册'/.test(appJs));

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
