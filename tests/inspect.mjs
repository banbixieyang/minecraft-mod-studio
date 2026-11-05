/**
 * 拆解台后端逻辑回归：不经 HTTP，直接 import 核心模块，避开沙箱代理。
 *
 * 覆盖：
 *   1. 分析报告带 sourceFiles（普通包为空，sources 包有 .java）
 *   2. reportToPack 的 overrides：按 id 合并数值、未知键忽略、未选条目不受影响
 *   3. 效果参数替换：to-pack 路由用 renderText + 模板默认值，{{key}} 必须被替换干净
 *
 * 跑法：node tests/inspect.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, reportToPack } from '../core/analyze/report.mjs';
import { getEffect, effectsForAbility } from '../core/library/effects.mjs';
import { renderText } from '../core/library/pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(HERE, 'fixtures', 'samplemod-0.1.0.jar');

/**
 * 样本 jar 从哪来：
 *   1. 命令行参数（普通包路径，sources 包路径）
 *   2. 环境变量 MCSTUDIO_SAMPLE_JAR / MCSTUDIO_SAMPLE_SOURCES
 *   3. 仓库自带的 tests/fixtures/
 *   4. 都没有 → 现场调 tools/make-sample-mod.mjs 造
 */
async function resolveSamples() {
  let main = process.argv[2] || process.env.MCSTUDIO_SAMPLE_JAR;
  let src = process.argv[3] || process.env.MCSTUDIO_SAMPLE_SOURCES;
  if (main && fs.existsSync(main)) {
    if (!src) {
      const guess = path.resolve(main).replace(/\.jar$/, '-sources.jar');
      if (fs.existsSync(guess)) src = guess;
    }
    return { main: path.resolve(main), src: src ? path.resolve(src) : null };
  }
  if (fs.existsSync(FIXTURE)) {
    const s = FIXTURE.replace(/\.jar$/, '-sources.jar');
    return { main: FIXTURE, src: fs.existsSync(s) ? s : null };
  }
  await import(pathToFileURL(path.join(ROOT, 'tools', 'make-sample-mod.mjs')).href);
  if (!fs.existsSync(FIXTURE)) {
    console.error('样本 jar 造不出来。可以手动跑 node tools/make-sample-mod.mjs，或把 jar 路径当参数传进来。');
    process.exit(1);
  }
  const s = FIXTURE.replace(/\.jar$/, '-sources.jar');
  return { main: FIXTURE, src: fs.existsSync(s) ? s : null };
}

const { main: FALLEN, src: SOURCES } = await resolveSamples();

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

if (!SOURCES) {
  console.error(`找不到 sources jar（${FALLEN.replace(/\.jar$/, '-sources.jar')}）。\n跑一次 node tools/make-sample-mod.mjs 就能生成。`);
  process.exit(1);
}

console.log(`\n[1] 分析 ${path.basename(FALLEN)} —— sourceFiles`);
const rep = analyze(FALLEN);
ok(Array.isArray(rep.sourceFiles), '报告带 sourceFiles 字段（数组）', `len=${rep.sourceFiles.length}`);
ok(rep.sourceFiles.length === 0, '普通发布包没有 .java，sourceFiles 为空（符合预期）');

console.log(`\n[2] 分析 ${path.basename(SOURCES)} —— sources 包有源码`);
const repSrc = analyze(SOURCES);
ok(repSrc.sourceFiles.length > 0, 'sources jar 的 sourceFiles 列出 .java', `${repSrc.sourceFiles.length} 个`);
ok(repSrc.sourceFiles.every((n) => n.endsWith('.java')), '列出的都是 .java 文件');

console.log(`\n[3] reportToPack + overrides（数值替换）`);
const items = rep.contents.item || [];
const tiers = rep.contents.tier || [];
ok(items.length > 0 || tiers.length > 0, '样本里有可编辑条目', `item=${items.length} tier=${tiers.length}`);

if (items.length) {
  const it = items[0];
  const pack = await reportToPack(rep, { contents: { item: [it.id] } }, {
    overrides: { item: { [it.id]: { stacksTo: 7, injected: 'X' } } },
  });
  const out = pack.content.entries.item[0];
  ok(out.stacksTo === 7, '勾选条目的 stacksTo 被改成 7', `原=${it.stacksTo}`);
  ok(out.injected === undefined, '注入的未知键被忽略（不动条目）');
  ok(pack.content.entries.item.length === 1, '未勾选的 item 不进包');

  // 未选的 item 不应被 override 影响（reportToPack 只处理选中集合）
  const noSel = await reportToPack(rep, { contents: {} }, {
    overrides: { item: { [it.id]: { stacksTo: 99 } } },
  });
  ok(!noSel.content.entries.item, '完全不选时，overrides 不会凭空造条目');
}

if (tiers.length) {
  const t = tiers[0];
  const pack = await reportToPack(rep, { contents: { tier: [t.id] } }, {
    overrides: { tier: { [t.id]: { durability: 2222 } } },
  });
  ok(pack.content.entries.tier[0].durability === 2222, 'tier 的 durability 被改', `原=${t.durability}`);
}

console.log(`\n[4] 效果参数替换（to-pack 路由用的同一套）`);
const eff = getEffect('attack_lifesteal');
ok(!!eff, '取到攻击吸血模板');
const defaults = {};
for (const p of eff.params) defaults[p.key] = p.default;
const code = renderText(eff.java[0].code, { ...defaults, ratio: 0.7, cap: 5 });
ok(!code.includes('{{'), '渲染后没有残留的 {{}} 占位符');
ok(code.includes('0.7F') && code.includes('5F'), '用户覆盖值（ratio=0.7 / cap=5）已写进代码');

const cands = effectsForAbility('heal');
ok(cands.length > 0, 'effectsForAbility 能按能力反查模板', cands.map((c) => c.id).join(','));

console.log(`\n${failed ? `✗ ${failed} 项失败` : '全部通过'}`);
process.exit(failed ? 1 : 0);
