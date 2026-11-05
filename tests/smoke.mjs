/**
 * 冒烟测试：往工程里灌一批典型内容，走完整生成 + 构建。
 * 用法：node tests/smoke.mjs [工程目录]
 *
 * 这不是产品功能，是给开发者验证生成器没坏的回归用例。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..', process.argv[2] || 'projects/testmod');

// 工程不存在就现建一个 —— 否则 clone 下来第一次跑就得先手动建工程。
if (!P.isProject(root)) {
  console.log(`工程不存在，先建一个：${root}`);
  P.createProject(root, {
    name: '测试工程',
    id: 'testmod',
    pkg: 'com.testmod',
    version: '0.1.0',
    platform: 'fabric',
    mcVersion: '26.3',
  });
}

const d = P.loadProject(root);
d.entries = {};

const E = (type, entry) => P.addEntry(d, type, entry);

// 材质
E('armorMaterial', {
  id: 'ruby', nameZh: '红宝石', nameEn: 'Ruby',
  durability: 33, defHelmet: 3, defChest: 8, defLegs: 6, defBoots: 3,
  enchantmentValue: 10, toughness: 2, knockbackResistance: 0,
  equipSound: 'diamond', repairItems: ['testmod:ruby'],
});

E('tier', {
  id: 'ruby', nameZh: '红宝石', nameEn: 'Ruby',
  durability: 1561, speed: 8, attackDamageBonus: 3, enchantmentValue: 10,
  incorrectFor: 'diamond', repairItems: ['testmod:ruby'],
});

// 物品
E('item', {
  id: 'ruby', nameZh: '红宝石', nameEn: 'Ruby', kind: 'material',
  rarity: 'rare', stacksTo: 64, fireResistant: false,
  tooltip: ['用于制作红宝石装备'],
});

E('item', {
  id: 'ruby_sword', nameZh: '红宝石剑', nameEn: 'Ruby Sword', kind: 'tool',
  toolType: 'sword', materialMode: 'custom', tier: 'ruby',
  attackDamage: 3, attackSpeed: -2.4, rarity: 'common', stacksTo: 1,
  tooltip: ['自带掠夺 III', '与同名附魔可叠加'],
});

E('item', {
  id: 'ruby_pickaxe', nameZh: '红宝石镐', kind: 'tool',
  toolType: 'pickaxe', materialMode: 'preset', materialPreset: 'diamond',
  rarity: 'common', stacksTo: 1, tooltip: ['自带时运 III'],
});

E('item', {
  id: 'ruby_helmet', nameZh: '红宝石头盔', kind: 'armor',
  armorSlot: 'helmet', armorMaterial: 'ruby',
  rarity: 'common', stacksTo: 1, tooltip: ['潜行时标记周围矿物'],
});

E('item', {
  id: 'ruby_chestplate', nameZh: '红宝石胸甲', kind: 'armor',
  armorSlot: 'chestplate', armorMaterial: 'ruby', rarity: 'common', stacksTo: 1,
});

// 方块
E('block', {
  id: 'ruby_ore', nameZh: '红宝石矿石', kind: 'ore',
  hardness: 3, resistance: 3, sound: 'stone', xpMin: 3, xpMax: 7, requiresTool: true,
  drops: [{ item: 'ruby', min: 1, max: 1, fortune: true }],
});
E('block', {
  id: 'deepslate_ruby_ore', nameZh: '深层红宝石矿石', kind: 'ore',
  hardness: 4.5, resistance: 3, sound: 'deepslate', xpMin: 3, xpMax: 7, requiresTool: true,
  drops: [{ item: 'ruby', min: 1, max: 2, fortune: true }],
});
E('block', {
  id: 'ruby_block', nameZh: '红宝石块', kind: 'storage',
  hardness: 5, resistance: 6, sound: 'metal', requiresTool: true,
});

// 配方
E('recipe', {
  id: 'ruby_block', mode: 'shaped', category: 'building',
  grid: ['ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby'],
  result: 'ruby_block', count: 1,
});
E('recipe', {
  id: 'ruby_sword', mode: 'shaped', category: 'equipment',
  grid: ['', 'ruby', '', '', 'ruby', '', '', 'minecraft:stick', ''],
  result: 'ruby_sword', count: 1,
});
E('recipe', {
  id: 'ruby_from_block', mode: 'shapeless', category: 'misc',
  ingredients: ['ruby_block'], result: 'ruby', count: 9,
});
E('recipe', {
  id: 'ruby_from_ore', mode: 'smelting', ingredient: 'ruby_ore',
  result: 'ruby', count: 1, experience: 0.7, cookingTime: 200,
});

// 世界生成
E('worldgen', {
  id: 'ruby_ore', dimension: 'overworld',
  overworldBlock: 'ruby_ore', deepslateBlock: 'deepslate_ruby_ore', block: 'ruby_ore',
  size: 4, count: 1, rarity: 6, minY: -16, maxY: 64, discardChance: 0,
});

// 进度（模块自带生成器：纯数据驱动，但根进度必须带背景图，否则游戏拒绝启动）
E('advancement', {
  id: 'get_ruby', titleZh: '拿到红宝石', descriptionZh: '挖到第一颗红宝石',
  icon: 'ruby', triggerItem: 'ruby', frame: 'goal', announce: true, hidden: false,
});
E('advancement', {
  id: 'master', titleZh: '矿物大师', icon: 'ruby_block',
  frame: 'challenge', parent: 'get_ruby', hidden: true,
});

P.saveProject(root, d);

const counts = Object.entries(d.entries).map(([k, v]) => `${k}:${v.length}`).join(' ');
console.log(`已灌入内容 → ${counts}`);
console.log(`工程：${root}`);

// ---------------------------------------------------------------- 生成 + 断言
const { preview, generate } = await import('../core/generator/pipeline.mjs');

const files = await preview(root);
const byPath = new Map(files.map((f) => [f.path, f.content]));
const read = (p) => byPath.get(p) ?? null;

const problems = [];
const need = (p) => {
  const c = read(p);
  if (c === null) problems.push(`缺少文件：${p}`);
  return c;
};
const expect = (cond, msg) => {
  if (!cond) problems.push(msg);
};

// 26.3 把谓词的键名改了：any_of/all_of 用 rules，not 用 rule。
// 写成旧版的 predicates/predicate 不报错、不崩，只是矿一个都不生成 —— 必须守住。
const feature = need('src/main/resources/data/testmod/worldgen/feature/ruby_ore.json');
if (feature) {
  expect(feature.includes('"rules"'), 'ore feature 缺少 rules 键（26.3 要求）');
  expect(feature.includes('"rule"'), 'ore feature 的 not 少了 rule 键');
  expect(!/"predicates"|"predicate"\s*:/.test(feature), 'ore feature 里还有旧版 predicates/predicate 键');
  expect(feature.includes('height_specific_ore_replaceables'), 'ore feature 没处理 tuff 的高度带');
  const size = JSON.parse(feature).size;
  expect(size >= 4, `ore size=${size}，小于 4 在 26.3 里一个方块都不生成`);
}

const placed = need('src/main/resources/data/testmod/worldgen/placed_feature/ruby_ore.json');
if (placed) {
  expect(JSON.parse(placed).placement.some((x) => x.type === 'minecraft:biome'), 'placed_feature 缺少 biome 步骤');
}

const loot = need('src/main/resources/data/testmod/loot_table/blocks/ruby_ore.json');
if (loot) {
  const j = JSON.parse(loot);
  expect(JSON.stringify(j).includes('minecraft:tool/can_silk_touch'), '矿石战利品表没加精准采集分支');
  expect(JSON.stringify(j).includes('explosion_decay'), '矿石战利品表没加爆炸衰减');
}

const tagsJava = need('src/main/java/com/testmod/registry/ModTags.java');
if (tagsJava) {
  expect(tagsJava.includes('TagKey.create(Registries.'), 'ModTags 没用 TagKey.create(Registries.X, id)');
  expect(!tagsJava.includes('ItemTags.create'), 'ModTags 还在用 26.3 已移除的 ItemTags.create(Identifier)');
}

const itemsJava = need('src/main/java/com/testmod/registry/ModItems.java');
if (itemsJava) {
  expect(itemsJava.includes('.sword(ModTiers.RUBY'), '剑没走组件式 .sword()');
  expect(itemsJava.includes('.humanoidArmor(ModArmorMaterials.RUBY'), '盔甲没走组件式 .humanoidArmor()');
  expect(itemsJava.includes('// @hook:items'), 'ModItems 缺少 @hook:items 锚点');
  expect(!itemsJava.includes('undefined'), 'ModItems 里出现了 undefined');
}

const lang = need('src/main/resources/assets/testmod/lang/zh_cn.json');
if (lang) {
  expect(lang.includes('tag.item.testmod.ruby_tool_materials'), '语言文件缺少标签翻译（会触发 Fabric 开发警告）');
  expect(lang.includes('advancement.testmod.get_ruby.title'), '模块 addLang 没把进度标题合进语言文件');
}

// 模块产出的进度：根进度没有 background 会让服务端直接拒绝加载
// （Visible advancement roots must have background）
const adv = need('src/main/resources/data/testmod/advancement/get_ruby.json');
if (adv) {
  const j = JSON.parse(adv);
  expect(!!j.display?.background, '根进度缺少 display.background，游戏会拒绝加载');
  expect(j.criteria?.got_item?.trigger === 'minecraft:inventory_changed', '带触发物品的进度没生成 inventory_changed 触发器');
}
const advChild = need('src/main/resources/data/testmod/advancement/master.json');
if (advChild) {
  const j = JSON.parse(advChild);
  expect(j.parent === 'testmod:get_ruby', '子进度没正确挂到父进度下');
  expect(!j.display?.background, '子进度不该带背景图');
}

console.log(`\n生成预演：${files.length} 个文件`);

if (problems.length) {
  console.log(`发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('资源格式断言全部通过');

// 真正写盘，确认没有指纹冲突
const report = await generate(root);
console.log(
  `写盘：写入 ${report.written.length} / 未变 ${report.unchanged.length} / ` +
    `冲突 ${report.conflicts.length} / 保留 ${report.skipped.length} / 删除 ${report.removed.length}`,
);
if (report.conflicts.length) {
  console.log('冲突文件：', report.conflicts.map((c) => c.path).join(', '));
  process.exit(1);
}
if (report.errors.length) {
  console.log('错误：', report.errors.join(' | '));
  process.exit(1);
}
console.log('\n回归通过。要出 jar 再跑：node studio.mjs build ' + path.relative(path.resolve(HERE, '..'), root));
