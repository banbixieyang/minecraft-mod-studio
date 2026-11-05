/**
 * Forge 1.20.1 目标回归。
 *
 * 用法：
 *   node tests/forge.mjs           建工程 → 灌内容 → 生成 → 断言文件形状（不联网）
 *   node tests/forge.mjs --build   额外真跑一次 gradlew build
 *
 * 为什么必须真编译：1.20.1 与 26.3 的 API 差了一整个时代，
 * 靠「看起来对」是骗不了 javac 的。知识库里的 Forge 签名也靠这一步背书。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { getTarget, listTargets } from '../core/target/registry.mjs';
import { parseDoc } from '../core/knowledge/parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'projects/forgetest');
const DO_BUILD = process.argv.includes('--build');

let failed = 0;
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};
const read = (rel) => (fs.existsSync(path.join(DIR, rel)) ? fs.readFileSync(path.join(DIR, rel), 'utf8') : '');

console.log('\n[1] 目标注册');
{
  const ids = listTargets().map((t) => t.id);
  ok(ids.includes('forge-1.20.1'), 'Forge 1.20.1 已注册进目标表', ids.join(','));
  const t = getTarget('forge-1.20.1');
  ok(t.platform === 'forge' && t.mcVersion === '1.20.1' && t.javaVersion === 17, '平台 / MC 版本 / JDK 都对');
  ok(t.features.resourceFormat === '1.20.1', '资源方言标成 1.20.1');
}

console.log('\n[2] 建工程并灌内容');
fs.mkdirSync(DIR, { recursive: true });
let d;
if (P.isProject(DIR)) {
  d = P.loadProject(DIR);
  d.entries = {};
  d.hooks = { java: [], js: [] };
  d.target = { ...getTarget('forge-1.20.1').defaults, id: 'forge-1.20.1' };
} else {
  P.createProject(DIR, {
    name: 'Forge 测试模组', id: 'forgetest', pkg: 'com.example.forgetest',
    target: { ...getTarget('forge-1.20.1').defaults, id: 'forge-1.20.1' },
  });
  d = P.loadProject(DIR);
}
ok(d.target.id === 'forge-1.20.1' && d.target.forgeVersion === '47.4.0', '工程存了完整目标字段（含 Forge 专属）');

const E = (type, entry) => P.addEntry(d, type, entry);
E('armorMaterial', {
  id: 'ruby', nameZh: '红宝石', durability: 33, defHelmet: 3, defChest: 8, defLegs: 6, defBoots: 3,
  enchantmentValue: 10, toughness: 2, knockbackResistance: 0, equipSound: 'diamond', repairItems: ['forgetest:ruby'],
});
E('tier', {
  id: 'ruby', nameZh: '红宝石', durability: 1561, speed: 8, attackDamageBonus: 3,
  enchantmentValue: 10, incorrectFor: 'diamond', repairItems: ['forgetest:ruby'],
});
E('item', { id: 'ruby', nameZh: '红宝石', kind: 'material', rarity: 'rare', tooltip: ['红宝石'] });
E('item', { id: 'ruby_sword', nameZh: '红宝石剑', kind: 'tool', toolType: 'sword', materialMode: 'custom', tier: 'ruby', attackDamage: 3, attackSpeed: -2.4 });
E('item', { id: 'ruby_axe', nameZh: '红宝石斧', kind: 'tool', toolType: 'axe', materialMode: 'preset', materialPreset: 'diamond' });
E('item', { id: 'ruby_helmet', nameZh: '红宝石头盔', kind: 'armor', armorSlot: 'helmet', armorMaterial: 'ruby' });
E('block', { id: 'ruby_ore', nameZh: '红宝石矿石', kind: 'ore', hardness: 3, resistance: 3, sound: 'stone', requiresTool: true, drops: [{ item: 'ruby', min: 1, max: 2 }] });
E('recipe', { id: 'ruby_block', mode: 'shaped', grid: ['ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby', 'ruby'], result: 'ruby', count: 1 });
E('worldgen', { id: 'ruby_ore', block: 'ruby_ore', dimension: 'overworld', size: 9, count: 8, minY: -64, maxY: 64 });
// generate() 会重新从磁盘读工程，内存里的改动必须先落盘
P.saveProject(DIR, d);
const report = await generate(DIR, { force: true });
ok(report.errors.length === 0, '生成没有报错', report.errors.join('；'));
ok(report.written.length > 10, `写出 ${report.written.length} 个文件`);

console.log('\n[3] 骨架与元数据');
{
  const bg = read('build.gradle');
  const props = read('gradle.properties');
  const toml = read('src/main/resources/META-INF/mods.toml');
  const mcmeta = read('src/main/resources/pack.mcmeta');
  ok(/net\.minecraftforge\.gradle/.test(bg), 'build.gradle 用 ForgeGradle');
  ok(/JavaLanguageVersion\.of\(17\)/.test(bg), '编译目标 JDK 17');
  ok(/forge_version=47\.4\.0/.test(props) && /mapping_channel=official/.test(props), 'gradle.properties 版本与映射正确');
  ok(/modId=/.test(toml) && /\[\[dependencies\./.test(toml), 'mods.toml 有 mod 与依赖段');
  ok(/"pack_format": 15/.test(mcmeta), 'pack.mcmeta 是 1.20.1 的 pack_format 15');
  ok(!fs.existsSync(path.join(DIR, 'src/main/resources/fabric.mod.json')), '没有混进 fabric.mod.json');
  ok(fs.existsSync(path.join(DIR, 'gradle/wrapper/gradle-wrapper.jar')), 'wrapper 二进制已搬运');
  ok(/gradle-8\.8-bin\.zip/.test(read('gradle/wrapper/gradle-wrapper.properties')), 'wrapper 指向 Gradle 8.8');
}

console.log('\n[4] 生成的 Java 用对 1.20.1 API');
{
  const main = read('src/main/java/com/example/forgetest/Forgetest.java');
  const items = read('src/main/java/com/example/forgetest/registry/ModItems.java');
  const blocks = read('src/main/java/com/example/forgetest/registry/ModBlocks.java');
  const tiers = read('src/main/java/com/example/forgetest/registry/ModTiers.java');
  const armors = read('src/main/java/com/example/forgetest/registry/ModArmorMaterials.java');
  const tabs = read('src/main/java/com/example/forgetest/registry/ModTabs.java');
  ok(/@Mod\(/.test(main) && /FMLJavaModLoadingContext/.test(main), '主类是 @Mod + mod event bus');
  ok(/\/\/ @hook:init/.test(main), '主类保留了 init 锚点');
  ok(/DeferredRegister<Item>/.test(items) && /ForgeRegistries\.ITEMS/.test(items), '物品用 DeferredRegister');
  ok(/new SwordItem\(/.test(items) && /new AxeItem\(/.test(items), '工具走 SwordItem / AxeItem 类');
  ok(/new ArmorItem\(/.test(items) && /ArmorItem\.Type\.HELMET/.test(items), '盔甲走 ArmorItem + Type 枚举');
  ok(/\/\/ @hook:items/.test(items) && /\/\/ @hook:blocks/.test(blocks), '钩子锚点都在');
  ok(/BLOCK_ITEMS/.test(blocks), '方块顺带注册 BlockItem');
  ok(/new Tier\(\)/.test(tiers) && /getTag\(\)/.test(tiers) && /NEEDS_DIAMOND_TOOL/.test(tiers),
    '自定义工具材质用 1.20.1 的 getTag() + NEEDS_*_TOOL（不是 1.20.5 的 getIncorrectBlocksForDrops）');
  ok(!/getIncorrectBlocksForDrops|INCORRECT_FOR_/.test(tiers), '没有混入 26.x 的工具标签 API');
  ok(/new ArmorMaterial\(\)/.test(armors) && /getDurabilityForType/.test(armors), '自定义盔甲材质实现接口');
  ok(/BuildCreativeModeTabContentsEvent/.test(tabs), '创造栏用 Forge 的 Build 事件');
  const allJava = [main, items, blocks, tiers, armors, tabs].join('\n');
  ok(!/setId\(/.test(allJava) && !/net\.fabricmc/.test(allJava), '没有混入 26.3 / Fabric 的 API');
}

console.log('\n[5] 资源是 1.20.1 方言');
{
  const ns = 'src/main/resources/assets/forgetest/';
  const data = 'src/main/resources/data/forgetest/';
  ok(fs.existsSync(path.join(DIR, ns + 'models/item/ruby.json')), '物品模型在 models/item/ 下');
  ok(!fs.existsSync(path.join(DIR, ns + 'items/ruby.json')), '没有 26.3 的 items/*.json 定义文件');
  const model = read(ns + 'models/item/ruby.json');
  ok(/"parent"/.test(model) && !/"model"/.test(model), '模型用 parent 写法');
  const recipe = read(data + 'recipes/ruby_block.json');
  ok(/"item"\s*:\s*"forgetest:ruby"/.test(recipe), '配方 result 用 {item,count} 而非 {id,count}');
  ok(!fs.existsSync(path.join(DIR, data + 'recipe/ruby_block.json')), '配方目录用复数 recipes/');
  ok(fs.existsSync(path.join(DIR, data + 'worldgen/configured_feature/ruby_ore.json')), '世界生成在 configured_feature/ 下');
  ok(fs.existsSync(path.join(DIR, data + 'forge/biome_modifier/ruby_ore.json')), '矿物通过 biome_modifier 挂到生物群系');
  let feat = {};
  try { feat = JSON.parse(read(data + 'worldgen/configured_feature/ruby_ore.json') || '{}'); } catch { /* 文件还没生成 */ }
  ok(typeof feat.targets?.[0]?.state === 'object', 'ore target 的 state 是 {"Name":...} 对象');
  ok(fs.existsSync(path.join(DIR, data + 'tags/blocks/ores.json')), '方块标签目录用复数 tags/blocks');
  const loot = read(data + 'loot_tables/blocks/ruby_ore.json');
  ok(/"functions"/.test(loot) && !/"modifier"/.test(loot), '战利品表用 functions 而非 modifier');
  ok(/"function"\s*:\s*"minecraft:apply_bonus"/.test(loot), '战利品函数用 function 键声明类型');
  ok(fs.existsSync(path.join(DIR, 'src/main/resources/assets/minecraft/textures/models/armor/ruby_layer_1.png')), '盔甲层贴图落在 1.20.1 的 armor 路径');
}

if (DO_BUILD) {
  console.log('\n[6] 真编译（gradlew build）');

  // Forge 任务卡也要过 javac。这些代码是给新手直接粘贴的，
  // 「看起来对」不算数；挂成 init 钩子一起编，签名错了这里就会红。
  const KB = path.join(ROOT, 'knowledge/cookbook');
  const proj = P.loadProject(DIR);
  proj.hooks.java = [];
  for (const file of fs.readdirSync(KB).filter((f) => f.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(KB, file), 'utf8');
    const doc = parseDoc(raw, { id: file, name: file });
    if (doc.platform !== 'forge') continue;
    const sec = doc.sections.find((s) => /^代码/.test(s.heading) && s.level === 2);
    const java = (sec?.code || []).find((c) => c.lang === 'java');
    if (!java) {
      ok(false, `${file}：Forge 任务卡缺 ## 代码 下的 java 块`);
      continue;
    }
    proj.hooks.java.push({ target: 'init', name: `Forge 任务卡：${doc.title}`, code: java.content });
  }
  ok(proj.hooks.java.length >= 2, `挂了 ${proj.hooks.java.length} 张 Forge 任务卡钩子`);
  P.saveProject(DIR, proj);
  const rep2 = await generate(DIR, { force: true });
  ok(rep2.errors.length === 0, '带钩子的工程生成无错误', rep2.errors.join('；'));
  const mainWithHooks = read('src/main/java/com/example/forgetest/Forgetest.java');
  ok(mainWithHooks.includes('Forge 任务卡：'), '任务卡代码真的插进了主类');

  const jarDir = path.join(DIR, 'build/libs');
  // 编译失败时别让上一次成功的旧 jar 冒充通过
  if (fs.existsSync(jarDir)) for (const f of fs.readdirSync(jarDir)) if (f.endsWith('.jar')) fs.unlinkSync(path.join(jarDir, f));

  const { runGradle } = await import('../core/build/gradle.mjs');
  const jdks = [
    process.env.MCSTUDIO_JDK17,
    'C:/Users/Lenovo/AppData/Roaming/.minecraft/runtime/java-runtime-beta',
  ].filter(Boolean);
  const jdk17 = jdks.find((p) => fs.existsSync(path.join(p, 'bin', 'javac.exe')));
  if (jdk17) {
    process.env.JAVA_HOME = jdk17;
    console.log(`    使用 JDK 17：${jdk17}`);
  } else {
    console.log('    没找到本机 JDK 17，交给 Gradle toolchain / foojay 自行准备');
  }

  const job = runGradle(DIR, 'build');
  await new Promise((resolve) => {
    const t = setInterval(() => { if (!job.running) { clearInterval(t); resolve(); } }, 500);
  });
  if (job.exitCode !== 0) {
    console.log('    ---- 编译错误（含符号 / 位置行）----');
    const show = new Set();
    const errIdx = [];
    job.lines.forEach((l, i) => { if (/error:|错误:/.test(l)) errIdx.push(i); });
    for (const i of errIdx.slice(0, 15)) {
      for (let j = i; j <= i + 2 && j < job.lines.length; j++) show.add(j);
    }
    // 中文 Windows 的 javac 输出是 GBK，按 utf8 解出来是乱码，error: 过滤会全漏。
    // 一条都没匹配到时把末尾日志倒出来兜底：类名与符号是 ASCII，照样能定位。
    if (!errIdx.length) {
      for (let i = Math.max(0, job.lines.length - 40); i < job.lines.length; i++) show.add(i);
    }
    [...show].sort((a, b) => a - b).forEach((i) => console.log('    ' + job.lines[i]));
  }
  ok(job.exitCode === 0, 'BUILD SUCCESSFUL');
  const jars = fs.existsSync(jarDir) ? fs.readdirSync(jarDir).filter((f) => f.endsWith('.jar')) : [];
  ok(jars.length > 0, 'jar 产物存在', jars.join(','));
}

console.log(`\n${failed ? `✗ ${failed} 条失败` : '✓ 全部通过'}`);
process.exit(failed ? 1 : 0);
