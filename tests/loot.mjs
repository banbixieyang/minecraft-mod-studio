/**
 * 宝箱 / 战利品表：定义后生成 data/<ns>/loot_table/<id>.json，
 * 物品、数量区间、权重、附魔都正确落到表里。两个目标共享同一份数据驱动逻辑。
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

const LOOT = [
  { id: 'diamond_chest', type: 'minecraft:chest', items: ['minecraft:diamond', 'minecraft:emerald'], countMin: 1, countMax: 3, weight: 5, enchant: false },
  { id: 'tool_box', type: 'minecraft:chest', items: ['minecraft:iron_pickaxe'], countMin: 1, countMax: 1, weight: 1, enchant: true },
  { id: 'empty_one', type: 'minecraft:empty', items: [] },
];

for (const target of [
  { id: 'lootfab263', dir: 'lootfab263', target: 'fabric-26.3', pkg: 'com.test.lootfab' },
  { id: 'lootfor1201', dir: 'lootfor1201', target: 'forge-1.20.1', pkg: 'com.test.lootfor' },
]) {
  const root = path.join('.', 'projects', target.dir);
  const p = openProject(root, {
    id: target.id, name: '战利品测试', pkg: target.pkg, version: '0.1.0', target: target.target,
  });
  p.entries = { loot_table: LOOT.map((d) => ({ ...d })) };

  let files;
  try {
    files = await collect(p, {});
  } catch (e) {
    console.log(`\n[${target.dir}] collect 抛错：${e.message}`);
    fail++; continue;
  }
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  // 1.20.1 的数据包目录是复数 loot_tables，1.21 起才是单数 loot_table。
  const lootDir = target.target === 'forge-1.20.1' ? 'loot_tables' : 'loot_table';
  const get = (sub) => {
    const k = Object.keys(byPath).find((x) => x.includes(sub) && x.endsWith('.json'));
    return k ? JSON.parse(byPath[k]) : null;
  };

  console.log(`\n[${target.dir}]`);
  ok(
    Object.keys(byPath).some((p) => p.endsWith(`data/${target.id}/${lootDir}/diamond_chest.json`)),
    `战利品表落在 data/${target.id}/${lootDir}/`,
  );
  const d = get(`${lootDir}/diamond_chest.json`);
  ok(d, '生成了 diamond_chest 战利品表');
  if (d) {
    ok(d.type === 'minecraft:chest', '类型是 minecraft:chest');
    ok(d.pools?.length === 1, '只有一个掉落池');
    const ents = d.pools[0].entries;
    ok(ents.length === 2, '池里有 2 个物品');
    ok(ents.some((e) => e.name === 'minecraft:diamond'), '包含 diamond');
    ok(ents.some((e) => e.name === 'minecraft:emerald'), '包含 emerald');
    ok(ents[0].weight === 5, '权重 = 5');
    const fn = ents[0].functions || [];
    ok(fn.some((f) => f.function === 'minecraft:set_count'), '带 set_count 函数');
    const sc = fn.find((f) => f.function === 'minecraft:set_count');
    ok(sc && sc.count && sc.count.max === 3, '数量上限 = 3');
  }

  const t = get(`${lootDir}/tool_box.json`);
  ok(t, '生成了 tool_box 战利品表');
  if (t) {
    ok(t.pools[0].entries[0].name === 'minecraft:iron_pickaxe', '物品是 iron_pickaxe');
    ok((t.pools[0].entries[0].functions || []).some((f) => f.function === 'minecraft:enchant_randomly'), '带随机附魔');
  }

  const e = get(`${lootDir}/empty_one.json`);
  ok(e && e.type === 'minecraft:empty', '空表类型是 minecraft:empty');

  if (fail) console.log(`  （工程留在 ${root}，便于翻生成的 JSON）`);
}

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 通过，${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
