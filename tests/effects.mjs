/**
 * 效果模板的可编译性验证。
 *
 * 这一条测试的意义：模板库里的代码是「别人会直接装进自己工程」的东西。
 * 如果它编译不过，那「分析完给你一段能用的代码」就是句谎话。
 * 所以每次改模板都必须跑这个 —— 它真的会调 gradlew。
 *
 * 跑法：node tests/effects.mjs [--build]
 *   --build 才会真的编译（约 40 秒）；不带参数只做生成和静态检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';
import { EFFECTS, effectToPack } from '../core/library/effects.mjs';
import { applyPack } from '../core/library/apply.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { runGradle } from '../core/build/gradle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'projects/effectstest');
const DO_BUILD = process.argv.includes('--build');

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failed++;
};

// 干净重建，保证每次测的都是从零装起的效果。
// 不删目录 —— 跑测试不该有破坏力，删错东西的代价远大于省下的几行。
if (!fs.existsSync(path.join(DIR, '.studio', 'project.json'))) {
  P.createProject(DIR, {
    name: '效果模板测试',
    id: 'effectstest',
    pkg: 'com.effectstest',
    version: '0.1.0',
    ...{ platform: 'fabric', mcVersion: '26.3', loaderVersion: '0.19.5', apiVersion: '0.164.0+26.3', javaVersion: 25 },
  });
}
{
  const fresh = P.loadProject(DIR);
  fresh.entries = {};
  fresh.hooks = { java: [], js: [] };
  P.saveProject(DIR, fresh);
}

console.log(`\n[1] 装 ${EFFECTS.length} 个效果模板`);
const p = P.loadProject(DIR);
for (const eff of EFFECTS) {
  const pack = effectToPack(eff);
  const r = applyPack(DIR, p, pack);
  console.log(`    ${eff.id} → java ${r.java} 段，警告 ${r.warnings.length}`);
  if (r.warnings.length) console.log('       ', r.warnings.join(' | '));
  ok(r.java >= 1, `${eff.id} 产出了 Java 代码`);
}
P.saveProject(DIR, p);
ok(p.hooks.java.length === EFFECTS.length, `钩子里有 ${EFFECTS.length} 段代码`);

// 检查每段代码都渲染干净了（不该有残留的 {{}}）
console.log('\n[2] 参数渲染检查');
let leftover = 0;
for (const h of p.hooks.java) {
  const m = h.code.match(/\{\{[^}]*\}\}/g);
  if (m) {
    leftover++;
    console.log(`    ${h.name} 残留：${m.join(', ')}`);
  }
}
ok(leftover === 0, '所有参数都渲染掉了');

console.log('\n[3] 生成');
const report = await generate(DIR);
console.log(`    写入 ${report.written.length} / 未变 ${report.unchanged.length} / 冲突 ${report.conflicts.length}`);
ok(report.conflicts.length === 0, '没有指纹冲突');
ok(report.errors.length === 0, '生成没有报错');

// 确认代码真的进了主类
const mainFile = fs.readdirSync(path.join(DIR, 'src/main/java/com/effectstest')).find((f) => f.endsWith('.java'));
const mainSrc = fs.readFileSync(path.join(DIR, 'src/main/java/com/effectstest', mainFile), 'utf8');
ok(mainSrc.includes('@hook:init'), '主类里有锚点');
ok((mainSrc.match(/自定义代码（钩子/g) || []).length === EFFECTS.length, '每段效果都插进主类了');

if (DO_BUILD) {
  console.log('\n[4] 真实编译（这一步最能说明问题）');
  const job = runGradle(DIR, 'build');
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (!job.running) {
        clearInterval(t);
        resolve();
      }
    }, 500);
  });
  const j = job;
  console.log(`    exit=${j.exitCode}，日志 ${j.lines.length} 行`);
  if (j.exitCode !== 0) {
    const errs = j.lines.filter((l) => /error:|错误:/.test(l)).slice(0, 12);
    console.log(errs.join('\n'));
  }
  ok(j.exitCode === 0, 'gradlew build 成功');
  const jar = path.join(DIR, 'build/libs/effectstest-0.1.0.jar');
  ok(fs.existsSync(jar), 'jar 产物存在');
} else {
  console.log('\n（跳过编译，加 --build 才会真编）');
}

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
