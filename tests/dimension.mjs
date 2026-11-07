/**
 * 自定义维度：定义后生成 data/<ns>/dimension_type 与 dimension 两份 JSON，
 * 游戏建世界时会自动加载这个维度（数据驱动，无需 Java）。
 *
 * 覆盖三种生成器（noise / flat / debug）与布尔默认值（未显式关的开关应按默认开）。
 * 两个目标的 dimension_type schema 已完全不同：
 *   1.20.1 → effects + bed_works / natural / piglin_safe / ultrawarm / has_raids 平铺字段
 *   26.3   → 观感与玩法规则搬进 attributes（minecraft:visual/*、minecraft:gameplay/*），
 *            天空盒是 skybox 枚举、昼夜轴是 timelines 标签、固定时刻是 has_fixed_time 布尔
 */
import path from 'node:path';
import { openProject } from './_util.mjs';
import { collect } from '../core/generator/pipeline.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
};

const ROOT = path.resolve('.');

const DIMS = [
  { id: 'crystal', effects: 'end', hasSkylight: false, generator: 'noise', biome: 'minecraft:cold_ocean', seed: 7 },
  { id: 'flat', effects: 'overworld', generator: 'flat', flatBlock: 'minecraft:deepslate' },
  { id: 'dbg', effects: 'overworld', generator: 'debug' },
  // 不显式写 hasSkylight / bedWorks —— 应回到默认 true
  { id: 'defaults', effects: 'nether', generator: 'noise', biome: 'minecraft:basalt_deltas' },
];

for (const target of [
  { id: 'dimfab263', dir: 'dimfab263', target: 'fabric-26.3', pkg: 'com.test.dimfab' },
  { id: 'dimfor1201', dir: 'dimfor1201', target: 'forge-1.20.1', pkg: 'com.test.dimfor' },
]) {
  const root = path.join(ROOT, 'projects', target.dir);
  const p = openProject(root, {
    id: target.id, name: '维度测试', pkg: target.pkg, version: '0.1.0', target: target.target,
  });
  p.entries = { dimension: DIMS.map((d) => ({ ...d })) };

  let files;
  try {
    files = await collect(p, {});
  } catch (e) {
    console.log(`\n[${target.dir}] collect 抛错：${e.message}`);
    fail++; continue;
  }
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  const find = (sub) => Object.entries(byPath).find(([k]) => k.includes(sub) && k.endsWith('.json'));

  const isLegacy = target.target === 'forge-1.20.1';
  console.log(`\n[${target.dir}]`);

  const typeFiles = DIMS.map((d) => find(`dimension_type/${d.id}.json`));
  ok(typeFiles.every(Boolean), '每个维度都生成了 dimension_type JSON');
  const dimFiles = DIMS.map((d) => find(`dimension/${d.id}.json`));
  ok(dimFiles.every(Boolean), '每个维度都生成了 dimension JSON');

  if (typeFiles[0] && dimFiles[0]) {
    const t0 = JSON.parse(typeFiles[0][1]);
    if (isLegacy) {
      ok(t0.effects === 'minecraft:the_end', 'crystal 的 effects = the_end');
    } else {
      // 26.3 删掉了 effects，改用 skybox 枚举 + timelines 标签 + has_ender_dragon_fight
      ok(t0.effects === undefined, '26.3 的 dimension_type 不再有 effects');
      ok(t0.skybox === 'end', 'crystal 的 skybox = end');
      ok(t0.timelines === '#minecraft:in_end', 'crystal 的时间轴是 in_end');
      ok(t0.has_ender_dragon_fight === true, 'end 观感默认带末影龙战');
    }
    ok(t0.has_skylight === false, 'crystal 关了天空光照');
    ok(t0.infiniburn === '#minecraft:infiniburn_end', 'effects 决定 infiniburn 标签');

    const d0 = JSON.parse(dimFiles[0][1]);
    ok(d0.type === `${target.id}:crystal`, 'dimension.type 引用自己的维度类型');
    ok(d0.generator.type === 'minecraft:noise', 'crystal 用噪声生成器');
    ok(d0.generator.biome_source?.type === 'minecraft:fixed', 'noise 用固定单一群系');

    const d1 = JSON.parse(dimFiles[1][1]);
    ok(d1.generator.type === 'minecraft:flat', 'flat 用超平坦生成器');
    ok(d1.generator.settings?.layers?.[0]?.block === 'minecraft:deepslate', 'flat 的层方块是 deepslate');

    const d2 = JSON.parse(dimFiles[2][1]);
    ok(d2.generator.type === 'minecraft:debug', 'debug 用调试生成器');
  }

  // 默认值：defaults 维度没写 hasSkylight / bedWorks，应回到 true
  const dt = typeFiles[3] && JSON.parse(typeFiles[3][1]);
  if (isLegacy) {
    ok(dt && dt.has_skylight === true && dt.bed_works === true, '未显式关的开关按默认 true（hasSkylight / bedWorks）');
    ok(dt && dt.effects === 'minecraft:nether', 'defaults 的 effects = nether');
  } else {
    // 26.3：bed_works 等平铺开关搬进 attributes 的 minecraft:gameplay/*
    ok(dt && dt.has_skylight === true, '未显式关的 hasSkylight 按默认 true');
    ok(dt && dt.bed_works === undefined && dt.natural === undefined && dt.piglin_safe === undefined, '26.3 不再有 bed_works / natural / piglin_safe 平铺字段');
    ok(dt?.attributes?.['minecraft:gameplay/bed_rule']?.can_set_spawn === 'always', 'bed 可用 → bed_rule.can_set_spawn = always');
    ok(dt?.attributes?.['minecraft:gameplay/bed_rule']?.can_sleep === 'when_dark', 'bed_rule.can_sleep = when_dark');
    ok(dt && dt.skybox === 'none' && dt.cardinal_light === 'nether', 'defaults 是下界观感（skybox=none / cardinal_light=nether）');
    ok(dt && dt.timelines === '#minecraft:in_nether', 'defaults 的时间轴是 in_nether');
  }

  if (fail) console.log(`  （工程留在 ${root}，便于翻生成的 JSON）`);
}

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 通过，${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
