/**
 * 造一个「内容够全」的样本 mod jar。
 *
 * 为什么需要它：
 *   tests/analyze.mjs、tests/inspect.mjs、tests/pack.mjs 这几个用例
 *   需要一个真实的第三方 jar 才跑得起来（要能读出物品、方块、矿物生成、
 *   进度、事件回调，还要能真的装进空工程再生成一遍）。
 *   那个样本原先放在仓库外（../fallen），别人 clone 下来一跑就报错。
 *
 *   这个脚本用引擎自己的 zip 写入器现场造一个，造完就能跑，
 *   不需要额外下载、也不需要先构建任何工程。
 *
 * 跑法：
 *   node tools/make-sample-mod.mjs [输出路径]
 *
 * 默认输出：tests/fixtures/samplemod-0.1.0.jar
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../core/analyze/zipwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'fixtures', 'samplemod-0.1.0.jar');

const NS = 'samplemod';
const PKG = 'com.example.samplemod';

const json = (o) => JSON.stringify(o, null, 2);

// ── 描述文件 ───────────────────────────────────────
const fabricMod = json({
  schemaVersion: 1,
  id: NS,
  version: '0.1.0',
  name: 'Sample Mod',
  description: '分析器测试用样本：物品、方块、矿物生成、进度、事件回调都有。',
  authors: ['MC Studio'],
  contact: {},
  license: 'MIT',
  icon: `assets/${NS}/icon.png`,
  environment: '*',
  entrypoints: { main: [`${PKG}.SampleMod`], client: [`${PKG}.SampleModClient`] },
  depends: { fabricloader: '>=0.15.0', minecraft: '~26.3', java: '>=21' },
});

const mixins = json({
  required: { client: [], server: [`${PKG}.mixin.ServerMixin`] },
  package: `${PKG}.mixin`,
  compatibilityLevel: 'JAVA_21',
});

// ── 语言 ───────────────────────────────────────────
const lang = json({
  'item.samplemod.ruby': '红宝石',
  'item.samplemod.ruby_sword': '红宝石剑',
  'item.samplemod.ruby_helmet': '红宝石头盔',
  'item.samplemod.ruby_chestplate': '红宝石胸甲',
  'item.samplemod.ruby_leggings': '红宝石护腿',
  'item.samplemod.ruby_boots': '红宝石靴子',
  'item.samplemod.void_helmet': '虚空头盔',
  'item.samplemod.void_chestplate': '虚空胸甲',
  'item.samplemod.void_leggings': '虚空护腿',
  'item.samplemod.void_boots': '虚空靴子',
  'block.samplemod.ruby_block': '红宝石块',
  'block.samplemod.ruby_ore': '红宝石矿',
  'block.samplemod.deepslate_ruby_ore': '深板岩红宝石矿',
  'block.samplemod.ruby_stairs': '红宝石楼梯',
  'block.samplemod.ruby_slab': '红宝石台阶',
  'item.samplemod.ruby_pickaxe': '红宝石镐',
  'item.samplemod.ruby_axe': '红宝石斧',
  'item.samplemod.ruby_shovel': '红宝石锹',
  'item.samplemod.ruby_hoe': '红宝石锄',
  'advancements.samplemod.root.title': 'Sample Mod',
  'advancements.samplemod.root.description': '一个能跑通分析器的样本',
  'advancements.samplemod.obtain_ruby.title': '获得红宝石',
  'advancements.samplemod.obtain_ruby.description': '在世界里挖到红宝石矿',
});

// ── 数据（26.x 单数目录）───────────────────────────
const items = [
  'ruby', 'ruby_sword', 'ruby_helmet', 'ruby_chestplate',
  'ruby_leggings', 'ruby_boots', 'ruby_pickaxe', 'ruby_axe',
  'ruby_shovel', 'ruby_hoe',
  // 套装名撞 Java 保留字（void）：分析器必须自动清洗成 void_mat
  'void_helmet', 'void_chestplate', 'void_leggings', 'void_boots',
];

const itemDefs = items.map((id) => [id, json({
  model: { type: 'minecraft:model', model: `${NS}:item/${id}` },
})]);

const blockDefs = ['ruby_block', 'ruby_ore', 'deepslate_ruby_ore', 'ruby_stairs', 'ruby_slab'].map((id) => [id, json({
  model: { type: 'minecraft:model', model: `${NS}:block/${id}` },
})]);

const recipes = [
  ['ruby_sword', { type: 'minecraft:crafting_shaped', pattern: [' R ', ' R ', ' S '], key: { R: { item: `${NS}:ruby` }, S: { item: 'minecraft:stick' } }, result: { id: `${NS}:ruby_sword`, count: 1 } }],
  ['ruby_block', { type: 'minecraft:crafting_shaped', pattern: ['RRR', 'RRR', 'RRR'], key: { R: { item: `${NS}:ruby` } }, result: { id: `${NS}:ruby_block`, count: 1 } }],
  ['ruby_pickaxe', { type: 'minecraft:crafting_shaped', pattern: ['RRR', ' S ', ' S '], key: { R: { item: `${NS}:ruby` }, S: { item: 'minecraft:stick' } }, result: { id: `${NS}:ruby_pickaxe`, count: 1 } }],
  ['ruby_axe', { type: 'minecraft:crafting_shaped', pattern: ['RR', 'RS', ' S'], key: { R: { item: `${NS}:ruby` }, S: { item: 'minecraft:stick' } }, result: { id: `${NS}:ruby_axe`, count: 1 } }],
  ['ruby_shovel', { type: 'minecraft:crafting_shaped', pattern: ['R', 'S', 'S'], key: { R: { item: `${NS}:ruby` }, S: { item: 'minecraft:stick' } }, result: { id: `${NS}:ruby_shovel`, count: 1 } }],
  ['ruby_hoe', { type: 'minecraft:crafting_shaped', pattern: ['RR', ' S'], key: { R: { item: `${NS}:ruby` }, S: { item: 'minecraft:stick' } }, result: { id: `${NS}:ruby_hoe`, count: 1 } }],
  ['ruby_stairs', { type: 'minecraft:crafting_shaped', pattern: ['R  ', 'RR ', 'RRR'], key: { R: { item: `${NS}:ruby_block` } }, result: { id: `${NS}:ruby_stairs`, count: 4 } }],
  ['ruby_slab', { type: 'minecraft:crafting_shaped', pattern: ['RRR'], key: { R: { item: `${NS}:ruby_block` } }, result: { id: `${NS}:ruby_slab`, count: 6 } }],
];

const lootTables = [
  ['blocks/ruby_block', { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `${NS}:ruby_block` }] }] }],
  ['blocks/ruby_ore', { type: 'minecraft:block', pools: [{ rolls: 1, bonus_rolls: 0, entries: [{ type: 'minecraft:item', name: `${NS}:ruby` }] }] }],
  ['blocks/deepslate_ruby_ore', { type: 'minecraft:block', pools: [{ rolls: 1, bonus_rolls: 0, entries: [{ type: 'minecraft:item', name: `${NS}:ruby` }] }] }],
  ['blocks/ruby_stairs', { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `${NS}:ruby_stairs` }] }] }],
  ['blocks/ruby_slab', { type: 'minecraft:block', pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `${NS}:ruby_slab` }] }] }],
];

// 26.x 单词复数：recipe / loot_table / worldgen
const recipeFiles = recipes.map(([id, def]) => [`data/${NS}/recipe/${id}.json`, json(def)]);
const lootFiles = lootTables.map(([id, def]) => [`data/${NS}/loot_table/${id}.json`, json(def)]);

// 世界生成：矿脉。
// 分析器把 feature（minecraft:ore）+ placed_feature 配成一条，
// 数值从 feature.size / feature.targets 和 placement 里的
// count / rarity_filter / height_range 读，维度靠目标方块反推。
// 注意：feature 的 id 必须和 placed_feature 的 id 一致，否则配不上对。
const worldgen = [
  [`data/${NS}/worldgen/placed_feature/ruby_ore.json`, json({
    feature: `${NS}:ruby_ore`,
    placement: [
      { type: 'minecraft:count', count: 8 },
      { type: 'minecraft:rarity_filter', chance: 0.3 },
      {
        type: 'minecraft:height_range',
        height: { min_inclusive: { absolute: -16 }, max_inclusive: { absolute: 96 } },
      },
      { type: 'minecraft:biome' },
    ],
  })],
  [`data/${NS}/worldgen/configured_feature/ruby_ore.json`, json({
    type: 'minecraft:ore',
    size: 9,
    discard_chance_on_air_exposure: 0.1,
    targets: [
      {
        target: { predicate_type: 'minecraft:tag_match', tag: 'minecraft:stone_ore_replaceables' },
        state: { Name: `${NS}:ruby_ore` },
      },
      {
        target: { predicate_type: 'minecraft:tag_match', tag: 'minecraft:deepslate_ore_replaceables' },
        state: { Name: `deepslate_${NS}_ruby_ore` },
      },
    ],
  })],
];

// 进度
const advancements = [
  ['root', { display: { icon: { item: `${NS}:ruby` }, title: { translate: 'advancements.samplemod.root.title' }, description: { translate: 'advancements.samplemod.root.description' }, frame: 'task', background: 'minecraft:textures/gui/advancements/backgrounds/stone.png' }, criteria: { tick: { trigger: 'minecraft:tick' } } }],
  ['obtain_ruby', { parent: 'samplemod:root', display: { icon: { item: `${NS}:ruby` }, title: { translate: 'advancements.samplemod.obtain_ruby.title' }, description: { translate: 'advancements.samplemod.obtain_ruby.description' }, frame: 'goal' }, criteria: { got_ruby: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: `${NS}:ruby` }] } } } }],
];

// 26.x 附魔与状态效果（数据驱动）
const enchantments = [
  ['ruby_edge', { description: { translate: 'enchantment.samplemod.ruby_edge' }, supported_items: `#minecraft:can_place_on`, max_level: 3, min_cost: { base: 8, per_level_above_first: 9 }, anvil_cost: 3, effects: { 'minecraft:damage': [{ effect: { type: 'linear', base: 1.5, per_level_above_first: 1.5 } }] } }],
  ['ruby_luck', { description: { translate: 'enchantment.samplemod.ruby_luck' }, supported_items: '#minecraft:enchantable/weapon', max_level: 3, min_cost: { base: 6, per_level_above_first: 8 }, anvil_cost: 2, effects: {} }],
];

const mobEffects = [
  ['ruby_fortune', { description: { translate: 'effect.samplemod.ruby_fortune' }, category: 'beneficial', category_attributes: { 'minecraft:attack_damage': { amount: 0.15, operation: 'add_multiple' } } }],
  ['ruby_dull', { description: { translate: 'effect.samplemod.ruby_dull' }, category: 'harmful', category_attributes: { 'minecraft:movement_speed': { amount: -0.2, operation: 'add_multiple' } } }],
];

// ── 贴图（1x1 PNG，最小合法）───────────────────────
// 用 deflate 存一张 1x1 透明 PNG。
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ── class 文件（只为让常量池里出现事件回调名字）──
// 真实的 .class 是编译产物，这里造的是「能被分析器读到常量池」的最小 class。
// 分析器是从 class 的常量池里找回调名，所以只要常量池里有名字就行。
// 严格按 JVM class 文件格式拼：magic / version / 常量池 / 访问标志 /
// this_class / super_class / 接口表 / 字段表 / 方法表 / 属性表。
function fakeClass(className, strings) {
  // 常量池条目（从 1 开始编号）
  const cp = [];
  const pushUtf8 = (s) => {
    cp.push({ tag: 1, s });
    return cp.length; // 1-based 索引
  };
  const pushClass = (utf8Idx) => {
    cp.push({ tag: 7, name: utf8Idx });
    return cp.length;
  };

  // 1. 类名本身必须是 Utf8，且在 this_class 之前
  const nameIdx = pushUtf8(className);
  // 2. 父类 java/lang/Object
  const objectIdx = pushUtf8('java/lang/Object');
  // 3. 事件回调全限定名 —— 做成 Class 条目。
  //    真实 class 里对 API 的引用就是 CONSTANT_Class，
  //    分析器也正是从 Class 条目里读出「引用了哪些类」来匹配能力规则。
  const strIdxs = strings.map((s) => pushClass(pushUtf8(s)));

  // 4. this_class / super_class 指向 Class 条目
  const thisClassIdx = pushClass(nameIdx);
  const superClassIdx = pushClass(objectIdx);

  // 常量池字节
  const cpParts = [];
  for (const e of cp) {
    if (e.tag === 1) {
      const b = Buffer.from(e.s, 'utf8');
      const len = Buffer.alloc(2);
      len.writeUInt16BE(b.length);
      cpParts.push(Buffer.concat([Buffer.from([0x01]), len, b]));
    } else {
      const idx = Buffer.alloc(2);
      idx.writeUInt16BE(e.name);
      cpParts.push(Buffer.concat([Buffer.from([0x07]), idx]));
    }
  }
  // cp_count = 条目数 + 1（0 号位保留）
  const cpCount = Buffer.alloc(2);
  cpCount.writeUInt16BE(cp.length + 1);
  const cpBody = Buffer.concat([cpCount, ...cpParts]);

  const u2 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

  const header = Buffer.concat([
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // magic
    u2(0), u2(65),                        // version 65 = Java 21
  ]);

  const thisClass = u2(thisClassIdx);
  const superClass = u2(superClassIdx);
  const interfaces = u2(0);               // 接口表：空
  const fields = u2(0);                   // 字段表：空
  const methods = u2(0);                  // 方法表：空
  const attributes = u2(0);               // 属性表：空

  // 供调用方确认写入成功
  void strIdxs;
  return Buffer.concat([
    header, cpBody,
    u2(0x0021),                           // access_flags: ACC_PUBLIC | ACC_SUPER
    thisClass, superClass,
    interfaces, fields, methods, attributes,
  ]);
}

// 事件回调类：常量池里放 Fabric 与 Forge 两套事件名
const modClass = fakeClass(`${PKG}/SampleMod`, [
  'SampleMod',
  'onInitialize',
  'net/fabricmc/fabric/api/event/player/UseBlockCallback',
  'net/fabricmc/fabric/api/event/player/AttackEntityCallback',
  'net/fabricmc/fabric/api/event/lifecycle/v1/ServerTickEvents',
  'net/minecraftforge/event/entity/player/PlayerInteractEvent',
  'net/minecraftforge/event/entity/living/LivingDeathEvent',
  'net/minecraftforge/event/TickEvent',
  // 属性加成：装备和药水效果的常见底层
  'net/minecraft/world/entity/ai/attributes/AttributeModifier',
]);

const clientClass = fakeClass(`${PKG}/SampleModClient`, [
  'SampleModClient',
  'onInitializeClient',
  'net/fabricmc/fabric/api/client/rendering/v1/HudRenderCallback',
]);

const mixinClass = fakeClass(`${PKG}/mixin/ServerMixin`, [
  'ServerMixin',
  'net/minecraft/server/MinecraftServer',
]);

// ── 组装 ───────────────────────────────────────────
const entries = [];

entries.push({ path: 'fabric.mod.json', data: fabricMod });
entries.push({ path: 'samplemod.mixins.json', data: mixins });
entries.push({ path: `assets/${NS}/lang/en_us.json`, data: json({ 'item.samplemod.ruby': 'Ruby' }) });
entries.push({ path: `assets/${NS}/lang/zh_cn.json`, data: lang });

// 物品模型 + 贴图
for (const id of items) {
  entries.push({ path: `assets/${NS}/models/item/${id}.json`, data: json({ parent: 'minecraft:item/generated', textures: { layer0: `${NS}:item/${id}` } }) });
  entries.push({ path: `assets/${NS}/textures/item/${id}.png`, data: PNG_1x1, compress: false });
}
// 方块模型 + 方块状态 + 贴图
for (const id of ['ruby_block', 'ruby_ore', 'deepslate_ruby_ore', 'ruby_stairs', 'ruby_slab']) {
  entries.push({ path: `assets/${NS}/models/block/${id}.json`, data: json({ parent: 'minecraft:block/cube_all', textures: { all: `${NS}:block/${id}` } }) });
  entries.push({ path: `assets/${NS}/blockstates/${id}.json`, data: json({ variants: { '': { model: `${NS}:block/${id}` } } }) });
  entries.push({ path: `assets/${NS}/textures/block/${id}.png`, data: PNG_1x1, compress: false });
}
// 材质（工具/盔甲）
for (const id of ['ruby_pickaxe', 'ruby_axe', 'ruby_shovel', 'ruby_hoe']) {
  entries.push({ path: `assets/${NS}/models/item/${id}.json`, data: json({ parent: 'minecraft:item/handheld', textures: { layer0: `${NS}:item/${id}` } }) });
}
for (const id of ['ruby_helmet', 'ruby_chestplate', 'ruby_leggings', 'ruby_boots']) {
  entries.push({ path: `assets/${NS}/models/item/${id}.json`, data: json({ parent: 'minecraft:item/generated', textures: { layer0: `${NS}:item/${id}` } }) });
}

// 物品定义（26.x）
for (const [id, def] of itemDefs) entries.push({ path: `data/${NS}/item/${id}.json`, data: def });
for (const [id, def] of blockDefs) entries.push({ path: `data/${NS}/block/${id}.json`, data: def });

// 配方 / 掉落 / 世界生成 / 进度
for (const [p, d] of recipeFiles) entries.push({ path: p, data: d });
for (const [p, d] of lootFiles) entries.push({ path: p, data: d });
for (const [p, d] of worldgen) entries.push({ path: p, data: d });
for (const [id, def] of advancements) {
  entries.push({ path: `data/${NS}/advancement/${id}.json`, data: json(def) });
}

// 附魔 / 状态效果
for (const [id, def] of enchantments) entries.push({ path: `data/${NS}/enchantment/${id}.json`, data: json(def) });
for (const [id, def] of mobEffects) entries.push({ path: `data/${NS}/mob_effect/${id}.json`, data: json(def) });

// class
entries.push({ path: `${PKG.replace(/\./g, '/')}/SampleMod.class`, data: modClass, compress: false });
entries.push({ path: `${PKG.replace(/\./g, '/')}/SampleModClient.class`, data: clientClass, compress: false });
entries.push({ path: `${PKG.replace(/\./g, '/')}/mixin/ServerMixin.class`, data: mixinClass, compress: false });

// ── 写出 ───────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, writeZip(entries));

// 顺带造一个 sources 版：同样的内容，但额外带 .java 源码。
// 分析器要靠「有没有 .java」区分发布包和源码包 ——
// 源码包能列出 sourceFiles 并支持覆盖源码级数值。
const SRC_OUT = OUT.replace(/\.jar$/, '-sources.jar');
const srcEntries = [
  ...entries,
  { path: `${PKG.replace(/\./g, '/')}/SampleMod.java`, data: `package com.example.samplemod;\n\npublic class SampleMod {\n    public static final String MOD_ID = "${NS}";\n\n    public void onInitialize() {\n        // 样本 mod 的入口\n    }\n}\n` },
  { path: `${PKG.replace(/\./g, '/')}/SampleModClient.java`, data: `package com.example.samplemod;\n\npublic class SampleModClient {\n    public void onInitializeClient() {\n        // 样本 mod 的客户端入口\n    }\n}\n` },
];
fs.writeFileSync(SRC_OUT, writeZip(srcEntries));

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`样本 jar 已生成：${path.relative(ROOT, OUT)}  （${kb} KB，${entries.length} 个条目）`);
console.log(`源码 jar 也生成了：${path.relative(ROOT, SRC_OUT)}`);
console.log('');
console.log('现在可以跑：');
console.log('  node tests/analyze.mjs   ' + path.relative(ROOT, OUT));
console.log('  node tests/inspect.mjs   ' + path.relative(ROOT, OUT));
console.log('  node tests/pack.mjs      ' + path.relative(ROOT, OUT));
