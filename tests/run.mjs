/**
 * 全量回归统一入口。
 *
 * 以前跑全量得手敲一串 `node tests/xxx.mjs`，还容易漏掉要加 `--build` 的那几个。
 * 这里把清单收成一份，界面、CI、本地都用同一条命令。
 *
 *   node tests/run.mjs                 # 快测（不跑 Gradle / 浏览器）
 *   node tests/run.mjs --all           # 全部，含 Gradle 真编译与浏览器冒烟
 *   node tests/run.mjs --build         # 快测 + 所有 --build 用例（不起浏览器）
 *   node tests/run.mjs --ui --port 4175 # 只额外跑浏览器冒烟（服务要自己起）
 *   node tests/run.mjs --only convert   # 只跑文件名含 convert 的用例
 *   node tests/run.mjs --json           # 结构化结果给 CI
 *
 * 约定：每个用例自己 `process.exit(fail ? 1 : 0)`；本脚本只看退出码，
 * 不解析人话输出，避免测试改一句文案就误判。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const value = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

/**
 * slow = Gradle 真编译（几十秒到几分钟）；browser = 需要本地服务 + Edge/Chrome。
 * args 是该用例「完整版」的参数；快测时不带。
 */
const SUITES = [
  { file: 'smoke.mjs', args: ['projects/testmod'] },
  { file: 'ai.mjs' },
  { file: 'analyze.mjs' },
  { file: 'cookbook.mjs', slow: 'build', buildArgs: ['--build'] },
  { file: 'docs.mjs' },
  { file: 'effects.mjs', slow: 'build', buildArgs: ['--build'] },
  { file: 'ext.mjs' },
  { file: 'ext-base.mjs' },
  { file: 'extensible.mjs' },
  { file: 'forge.mjs', slow: 'build', buildArgs: ['--build'] },
  { file: 'generality.mjs' },
  { file: 'goety-delight.mjs' },
  { file: 'goety-override.mjs', slow: 'build', buildArgs: ['--build'] },
  { file: 'hooks.mjs' },
  { file: 'import.mjs' },
  { file: 'inspect.mjs' },
  { file: 'knowledge.mjs' },
  { file: 'modlib.mjs' },
  { file: 'pack.mjs' },
  { file: 'tutorial.mjs' },
  { file: 'visual.mjs' },
  { file: 'visual-routes.mjs' },
  { file: 'convert.mjs', slow: 'build', buildArgs: ['--build'] },
  { file: 'visual-build.mjs', slow: 'gradle' },
  { file: 'visual-e2e.mjs', slow: 'gradle' },
  { file: 'uitest.mjs', slow: 'browser', needsServer: true },
];

const only = value('only', '');
const withBuild = has('all') || has('build');
const withGradle = has('all');
const withUi = has('all') || has('ui');
const port = value('port', '4173');
const jsonOut = has('json');

function selected() {
  return SUITES.filter((s) => {
    if (only && !s.file.includes(only)) return false;
    if (s.slow === 'browser' && !withUi) return false;
    if (s.slow === 'gradle' && !withGradle) return false;
    return true;
  }).filter((s) => fs.existsSync(path.join(HERE, s.file)));
}

function argsFor(s) {
  const base = [...(s.args || [])];
  if (withBuild && s.buildArgs) base.push(...s.buildArgs);
  if (s.slow === 'browser') base.push('--port', port);
  return base;
}

const results = [];
for (const s of selected()) {
  const args = argsFor(s);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, s.file), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000,
  });
  const ms = Date.now() - started;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const pass = r.status === 0;
  const rec = { file: s.file, args, pass, exitCode: r.status, ms, tail: out.trim().split('\n').slice(-3).join(' | ') };
  results.push(rec);
  if (!jsonOut) {
    console.log(`${pass ? '  ✓' : '  ✗'} ${s.file.padEnd(26)} ${String(ms).padStart(6)} ms  ${args.join(' ') || ''}`);
    if (!pass) console.log(`      ${rec.tail}`);
  }
}

const failed = results.filter((r) => !r.pass);
const summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, port, results };
if (jsonOut) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`\n${failed.length ? `有 ${failed.length} 个用例失败：${failed.map((f) => f.file).join('、')}` : `全部通过（${results.length} 个用例）`}`);
  if (!withGradle || !withUi) console.log('  加 --all 可把 Gradle 真编译与浏览器冒烟一起跑（需要本地服务）。');
}
process.exit(failed.length ? 1 : 0);
