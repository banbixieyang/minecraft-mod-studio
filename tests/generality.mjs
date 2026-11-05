/**
 * 通用性回归测试 —— 换别的 mod 会不会又踩坑。
 *
 * 背景：引擎最早是照着 Goety 系列（1.20.1 Forge）调的，
 * 换成别的 mod 就暴露出一堆问题：
 *   - 只扫一个命名空间 → 漏掉 mod 自有的第二个命名空间
 *   - 依赖 mod 的资源混进来 → 拆解台出现一堆不属于它的物品
 *   - 语言键里的 *.info / *.brew 被当成物品 → 凭空多出上百个「物品」
 *   - 进度标题存的是 translate 键 → 界面上是一串键名不是中文
 *   - 26.x 的数据驱动附魔完全没解析 → 解析新版 mod 一个附魔都看不到
 *   - 内嵌 jar 只警告不分析 → 整合包里真正的功能看不到
 *   - 能力规则全是 Fabric 命名 → Forge mod 的事件回调大面积漏判
 *
 * 这个测试用「合成 mod」覆盖各种形态，不依赖外部 jar，
 * 所以以后改引擎时随时能跑，坏了立刻知道。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyze } from '../core/analyze/report.mjs';
import { writeZip } from '../core/analyze/zipwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`);
  }
}

/** 造一个临时 mod 目录 */
function makeMod(files, name) {
  const dir = path.join(os.tmpdir(), `mcstudio-gen-${name}-${Date.now()}`);
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof data === 'string' ? data : JSON.stringify(data));
  }
  return dir;
}

// ============================================================
// 1. 命名空间归属：依赖 mod 的资源不能混进来
// ============================================================
console.log('\n【命名空间归属】');
{
  const dir = makeMod({
    'fabric.mod.json': { schemaVersion: 1, id: 'mymod', version: '1.0.0', name: 'My Mod', environment: '*' },
    // 主命名空间的东西
    'assets/mymod/lang/zh_cn.json': { 'item.mymod.gem': '宝石', 'block.mymod.gem_block': '宝石块' },
    'assets/mymod/models/item/gem.json': { parent: 'minecraft:item/generated' },
    'assets/mymod/blockstates/gem_block.json': { variants: { '': {} } },
    // 依赖 mod 的命名空间：只有数据没有语言文件 → 不该被认领
    'assets/otherdep/lang/en_us.json': { 'item.otherdep.stuff': 'Stuff' },
    'assets/otherdep/models/item/stuff.json': { parent: 'minecraft:item/generated' },
    // minecraft 命名空间：永远不是自己的
    'assets/minecraft/models/item/vanilla_thing.json': { parent: 'minecraft:item/generated' },
  }, 'ns');

  const r = analyze(dir);
  const ids = r.contents.item.map((i) => i.id);
  check('主命名空间的物品在', ids.includes('gem'), ids.join(','));
  check('依赖 mod 的物品不在清单里', !ids.includes('stuff'), ids.join(','));
  check('minecraft 的物品不在清单里', !ids.includes('vanilla_thing'), ids.join(','));
  check('方块在清单里', r.contents.block.some((b) => b.id === 'gem_block'), r.contents.block.map((b) => b.id).join(','));
  check('条目带上了自己的命名空间', r.contents.item.find((i) => i.id === 'gem')?.ns === 'mymod');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 2. 语言键里的附属键不能变成物品
// ============================================================
console.log('\n【语言键噪声】');
{
  const dir = makeMod({
    'fabric.mod.json': { schemaVersion: 1, id: 'mymod', version: '1.0.0', name: 'My Mod', environment: '*' },
    'assets/mymod/lang/zh_cn.json': {
      'item.mymod.gem': '宝石',
      'item.mymod.spell_focus.info': '法术说明',      // 不是物品
      'item.mymod.brew_recipe.brew': '酿造说明',       // 不是物品
      'item.mymod.sword.desc': '剑的说明',            // 不是物品
    },
    'assets/mymod/models/item/gem.json': { parent: 'minecraft:item/generated' },
  }, 'lang');

  const r = analyze(dir);
  const ids = r.contents.item.map((i) => i.id);
  check('真物品被识别', ids.includes('gem'), ids.join(','));
  check('.info 附属键没变成物品', !ids.some((i) => i.endsWith('.info')), ids.join(','));
  check('.brew 附属键没变成物品', !ids.some((i) => i.endsWith('.brew')), ids.join(','));
  check('.desc 附属键没变成物品', !ids.some((i) => i.endsWith('.desc')), ids.join(','));
  check('物品数正好是 1', ids.length === 1, `实际 ${ids.length}：${ids.join(',')}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 3. 26.x 的数据驱动附魔与状态效果
// ============================================================
console.log('\n【26.x 数据驱动】');
{
  const dir = makeMod({
    'fabric.mod.json': { schemaVersion: 1, id: 'mymod', version: '1.0.0', name: 'My Mod', environment: '*' },
    'assets/mymod/lang/zh_cn.json': {
      'enchantment.mymod.blade': '雷光之刃',
      'enchantment.mymod.blade.desc': '挥剑附带雷击',
      'effect.mymod.bravery': '勇气',
      'effect.mymod.bravery.description': '无畏无惧',
    },
    'assets/mymod/lang/en_us.json': {
      'enchantment.mymod.blade': 'Lightning Blade',
      'effect.mymod.bravery': 'Bravery',
    },
    'data/mymod/enchantment/blade.json': {
      anvil_cost: 3,
      description: { translate: 'enchantment.mymod.blade' },
      effects: {
        'minecraft:damage': [{
          effect: { type: 'minecraft:add', value: { type: 'minecraft:linear', base: 2, per_level_above_first: 1.5 } },
        }],
      },
      max_level: 4,
      min_cost: { base: 2, per_level_above_first: 8 },
      supported_items: '#minecraft:enchantable/sword',
    },
    'data/mymod/mob_effect/bravery.json': {
      name: 'effect.mymod.bravery',
      category: 'BENEFICIAL',
      category_attributes: { combat: { 'minecraft:attack_damage': 2.0 } },
    },
  }, 'dd');

  const r = analyze(dir);
  const enc = r.contents.enchantment[0];
  check('附魔被识别', !!enc, JSON.stringify(r.contents.enchantment));
  check('附魔有中文名', enc?.nameZh === '雷光之刃', enc?.nameZh);
  check('附魔有说明', enc?.descriptionZh === '挥剑附带雷击', enc?.descriptionZh);
  check('附魔读出最大等级', enc?.maxLevel === 4, String(enc?.maxLevel));
  check('附魔读出每级增量', enc?.costPerLevel === 8, String(enc?.costPerLevel));
  check('附魔效果被压成一句人话', /damage add 2/.test(enc?.effects || ''), enc?.effects);
  check('附魔有注册表 id', enc?.registryId === 'mymod:blade', enc?.registryId);

  const eff = r.contents.statusEffect[0];
  check('状态效果被识别', !!eff, JSON.stringify(r.contents.statusEffect));
  check('状态效果有中文名', eff?.nameZh === '勇气', eff?.nameZh);
  check('状态效果读出类别', eff?.category === 'BENEFICIAL', eff?.category);
  check('状态效果读出属性修正', /attack_damage/.test(eff?.attributes || ''), eff?.attributes);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 4. 进度标题要翻译成中文，不是 translate 键
// ============================================================
console.log('\n【进度翻译】');
{
  const dir = makeMod({
    'fabric.mod.json': { schemaVersion: 1, id: 'mymod', version: '1.0.0', name: 'My Mod', environment: '*' },
    'assets/mymod/lang/zh_cn.json': {
      'advancements.mymod.get_gem.title': '获得宝石',
      'advancements.mymod.get_gem.description': '捡到了第一颗宝石',
    },
    'data/mymod/advancement/get_gem.json': {
      display: {
        icon: { item: 'mymod:gem' },
        title: { translate: 'advancements.mymod.get_gem.title' },
        description: { translate: 'advancements.mymod.get_gem.description' },
        frame: 'task',
      },
    },
  }, 'adv');

  const r = analyze(dir);
  const a = r.contents.advancement[0];
  check('进度被识别', !!a, JSON.stringify(r.contents.advancement));
  check('标题翻译成了中文', a?.titleZh === '获得宝石', a?.titleZh);
  check('说明翻译成了中文', a?.descriptionZh === '捡到了第一颗宝石', a?.descriptionZh);
  check('标题不是 translate 键', !String(a?.titleZh || '').startsWith('advancements.'), a?.titleZh);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 5. 内嵌 jar 要能识别出里头的 mod
// ============================================================
console.log('\n【内嵌 jar】');
{
  const inner = writeZip([
    { path: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id: 'innermod', version: '2.0.0', name: 'Inner Mod', environment: '*' }) },
    { path: 'assets/innermod/lang/en_us.json', data: '{}' },
  ]);
  const outer = writeZip([
    { path: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id: 'fatmod', version: '1.0.0', name: 'Fat Mod', environment: '*' }) },
    { path: 'META-INF/jars/innermod-2.0.0.jar', data: inner },
  ]);
  const jar = path.join(os.tmpdir(), `mcstudio-fat-${Date.now()}.jar`);
  fs.writeFileSync(jar, outer);

  const r = analyze(jar);
  const nm = r.packaging.nestedMods || [];
  check('识别出内嵌 jar', nm.length === 1, JSON.stringify(nm));
  check('内嵌 jar 的 modId 读出来了', nm[0]?.modId === 'innermod', nm[0]?.modId);
  check('内嵌 jar 的 mod 名字读出来了', nm[0]?.modName === 'Inner Mod', nm[0]?.modName);
  check('内嵌 jar 的加载器读出来了', nm[0]?.loader === 'fabric', nm[0]?.loader);
  check('警告里点名了内嵌的 mod', r.warnings.some((w) => w.includes('innermod')), r.warnings.join(' | '));

  fs.rmSync(jar, { force: true });
}

// ============================================================
// 6. 1.20.1 的老布局（复数 recipes/、loot_tables/）不能退化
// ============================================================
console.log('\n【1.20.1 老布局】');
{
  const dir = makeMod({
    'fabric.mod.json': { schemaVersion: 1, id: 'oldmod', version: '1.0.0', name: 'Old Mod', environment: '*' },
    'assets/oldmod/lang/zh_cn.json': { 'item.oldmod.gem': '宝石' },
    'assets/oldmod/models/item/gem.json': { parent: 'minecraft:item/generated' },
    'data/oldmod/recipes/gem_sword.json': {
      type: 'minecraft:crafting_shaped',
      pattern: ['G', 'S'],
      key: { G: { item: 'oldmod:gem' }, S: { item: 'minecraft:stick' } },
      result: { item: 'minecraft:iron_sword', count: 1 },
    },
    'data/oldmod/loot_tables/blocks/gem_ore.json': {
      pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'oldmod:gem' }] }],
    },
  }, 'old');

  const r = analyze(dir);
  check('老布局的配方被识别', r.contents.recipe.length === 1, JSON.stringify(r.contents.recipe));
  check('老布局的配方是 shaped', r.contents.recipe[0]?.mode === 'shaped', r.contents.recipe[0]?.mode);
  check('配方结果读出来了', r.contents.recipe[0]?.result === 'minecraft:iron_sword', r.contents.recipe[0]?.result);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 7. Forge 的事件要被认出来（能力识别不能只有 Fabric 命名）
// ============================================================
console.log('\n【Forge 能力识别】');
{
  // 造一个 class 文件太麻烦，这里直接测规则表本身能不能命中 Forge 事件名
  const { RULES } = await import('../core/analyze/abilities.mjs');
  const forgeEvents = ['AttackEntityEvent', 'LivingDeathEvent', 'LivingDropsEvent', 'TickEvent', 'PlayerEvent'];
  const allCls = RULES.flatMap((r) => r.cls || []);
  const missing = forgeEvents.filter((e) => !allCls.some((c) => c.includes(e)));
  check('规则表覆盖常见 Forge 事件', missing.length === 0, `缺：${missing.join(', ')}`);
  check('规则表有 Forge 配置识别', allCls.some((c) => c.includes('ForgeConfigSpec')));

  // 也要保证 Fabric 的那套没被删掉
  const fabricHooks = ['AttackEntityCallback', 'ServerTickEvents', 'PlayerBlockBreakEvents'];
  const missingFabric = fabricHooks.filter((e) => !allCls.some((c) => c.includes(e)));
  check('规则表仍覆盖 Fabric 回调', missingFabric.length === 0, `缺：${missingFabric.join(', ')}`);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
