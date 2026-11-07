/**
 * 自定义群系：生成 worldgen/biome/<id>.json（含颜色/降水/温度），
 * 并生成配套测试维度（或住进用户指定的维度）。
 * 结构挂群系靠结构 JSON 自己的 biomes 字段（群系的 starts 1.19 起已废弃，两个目标都不写）。
 * 两个目标共享同一套数据驱动逻辑，但 26.3 的字段格式已经和 1.20.1 分道扬镳：
 *   1.20.1 → precipitation 字符串 + effects 里的整数颜色
 *   26.3   → has_precipitation 布尔 + effects.water_color 字符串，
 *            天空/雾/水雾色搬到 attributes 的 minecraft:visual/*
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

const BIOMES = [
  { id: 'crystal_forest', precipitation: 'rain', temperature: 0.8, downfall: 0.4, sky_color: '#88CCFF', fog_color: '#BBDDFF', water_color: '#3366CC', water_fog_color: '#0A1133' },
  { id: 'ash_plain', precipitation: 'none', temperature: 1.5, downfall: 0.0, sky_color: '#443322', fog_color: '#553322', water_color: '#222222', water_fog_color: '#111111', grass_color_modifier: 'swamp', dimension: 'ash_world' },
];
const STRUCTURES = [
  { id: 'crystal_tower', biomes: ['crystal_forest'] },
];

for (const target of [
  { id: 'bimfab263', dir: 'bimfab263', target: 'fabric-26.3', pkg: 'com.test.bimfab' },
  { id: 'bimfor1201', dir: 'bimfor1201', target: 'forge-1.20.1', pkg: 'com.test.bimfor' },
]) {
  const root = path.join('.', 'projects', target.dir);
  const p = openProject(root, {
    id: target.id, name: '群系测试', pkg: target.pkg, version: '0.1.0', target: target.target,
  });
  p.entries = {
    biome: BIOMES.map((d) => ({ ...d })),
    structure: STRUCTURES.map((d) => ({ ...d })),
  };

  let files;
  try {
    files = await collect(p, {});
  } catch (e) {
    console.log(`\n[${target.dir}] collect 抛错：${e.message}`);
    fail++; continue;
  }
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  const get = (sub) => {
    const k = Object.keys(byPath).find((x) => x.includes(sub) && x.endsWith('.json'));
    return k ? JSON.parse(byPath[k]) : null;
  };

  const isLegacy = target.target === 'forge-1.20.1';
  console.log(`\n[${target.dir}]`);
  const b0 = get(`worldgen/biome/crystal_forest.json`);
  ok(b0, '生成了 crystal_forest 群系');
  if (b0) {
    ok(isLegacy ? b0.precipitation === 'rain' : b0.has_precipitation === true, isLegacy ? '1.20.1 用 precipitation=rain' : '26.x 用 has_precipitation=true');
    ok(Math.abs(b0.temperature - 0.8) < 1e-6, '温度 = 0.8');
    if (isLegacy) {
      ok(b0.effects.sky_color === 0x88ccff, '天空色解析为 0x88CCFF（1.20.1 整数）');
      ok(b0.effects.water_fog_color === 0x0a1133, '水雾色解析为 0x0A1133（1.20.1 整数）');
    } else {
      // 26.3 起 sky/fog/water_fog 从 effects 搬到 attributes，且必须是 "#rrggbb" 字符串
      ok(b0.attributes?.['minecraft:visual/sky_color'] === '#88ccff', '天空色落在 attributes 的 minecraft:visual/sky_color');
      ok(b0.attributes?.['minecraft:visual/water_fog_color'] === '#0a1133', '水雾色落在 attributes 的 minecraft:visual/water_fog_color');
      ok(b0.effects && b0.effects.sky_color === undefined, '26.3 的 effects 不再有 sky_color');
    }
    // 结构挂群系靠结构 JSON 自己的 biomes 字段，1.19 起群系就没有 starts 了
    ok(b0.starts === undefined, '群系不写已废弃的 starts');
  }

  const b1 = get(`worldgen/biome/ash_plain.json`);
  ok(b1, '生成了 ash_plain 群系');
  if (b1) {
    ok(isLegacy ? b1.precipitation === 'none' : b1.has_precipitation === false, 'ash_plain 无降水');
    ok(b1.effects.grass_color_modifier === 'swamp', '草色修正 = swamp');
  }

  // 配套维度
  const d0 = get(`dimension/crystal_forest_world.json`);
  ok(d0, 'crystal_forest 生成了配套测试维度（默认 <id>_world）');
  if (d0) ok(d0.generator.biome_source?.biome === `${target.id}:crystal_forest`, '维度用 fixed 单一群系');

  const d1 = get(`dimension/ash_world.json`);
  ok(d1, 'ash_plain 用了自定义维度 id（ash_world）');
  if (d1) ok(d1.generator.biome_source?.biome === `${target.id}:ash_plain`, 'ash_world 维度包含 ash_plain 群系');

  // 结构挂群系：靠结构 JSON 的 biomes 字段，群系侧没有任何反向联动
  const s0 = get(`worldgen/structure/crystal_tower.json`);
  ok(s0, '生成了 crystal_tower 结构');
  if (s0) ok(Array.isArray(s0.biomes) && s0.biomes.includes(`${target.id}:crystal_forest`), '结构的 biomes 指向 crystal_forest 群系');

  if (fail) console.log(`  （工程留在 ${root}，便于翻生成的 JSON）`);
}

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 通过，${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
