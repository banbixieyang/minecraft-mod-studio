/**
 * 分析器回归测试：拿真实的 jar 走一遍完整的分析链路。
 *
 * 样本 jar 从哪来：
 *   1. 命令行传路径 —— node tests/analyze.mjs /path/to/mod.jar
 *   2. 环境变量 MCSTUDIO_SAMPLE_JAR
 *   3. 仓库自带的 tests/fixtures/samplemod-0.1.0.jar
 *   4. 都没有 → 现场调 tools/make-sample-mod.mjs 造一个
 *
 * 期望值全部从样本自身推导（读它的 fabric.mod.json），
 * 不写死某个 mod 的 id —— 这样换任何一个 jar 来跑都成立。
 *
 * 跑法：node tests/analyze.mjs [jar路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyze, reportSummary, reportToPack } from '../core/analyze/report.mjs';
import { effectsForAbility } from '../core/library/effects.mjs';
import { summarizePack } from '../core/library/pack.mjs';
import { applyPack } from '../core/library/apply.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import * as P from '../core/project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(HERE, 'fixtures', 'samplemod-0.1.0.jar');

/** 找到样本 jar；找不到就现场造一个 */
async function resolveJar() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.MCSTUDIO_SAMPLE_JAR;
  if (fromArg && fs.existsSync(fromArg)) return { jar: path.resolve(fromArg), made: false };
  if (fromEnv && fs.existsSync(fromEnv)) return { jar: path.resolve(fromEnv), made: false };
  if (fs.existsSync(FIXTURE)) return { jar: FIXTURE, made: false };

  // 现场造
  const gen = await import(pathToFileURL(path.join(ROOT, 'tools', 'make-sample-mod.mjs')).href);
  void gen; // 导入即执行，脚本会自己写文件
  if (!fs.existsSync(FIXTURE)) {
    console.error(`样本 jar 造不出来：${FIXTURE}\n可以手动跑 node tools/make-sample-mod.mjs，或把 jar 路径当参数传进来。`);
    process.exit(1);
  }
  return { jar: FIXTURE, made: true };
}

const { jar: JAR, made } = await resolveJar();

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

if (made) console.log('（没找到样本 jar，已现场生成一个）');

console.log(`\n分析 ${path.basename(JAR)}`);
const t0 = Date.now();
const report = analyze(JAR);
const ms = Date.now() - t0;

console.log(`\n[元数据]`);
const m = report.meta;
console.log(`  ${m.loader} | ${m.id} | ${m.name} | v${m.version} | MC ${m.mcVersion || '?'} | ${m.authors.join(',')}`);

// 期望值不写死某个 mod —— 只断言「元数据被正确读出来了」
ok(m.loader === 'fabric', '识别出加载器是 fabric');
ok(!!m.id && /^[a-z0-9_-]+$/.test(m.id), '识别出 mod id', m.id);
ok(m.mcVersion === '26.3', '从依赖里读出 MC 版本', m.mcVersion);
ok((m.authors || []).length > 0, '读出作者');
ok(m.version === '0.1.0', '读出版本号', m.version);

console.log(`\n[内容]  耗时 ${ms}ms`);
for (const [k, v] of Object.entries(report.counts)) {
  if (v) console.log(`  ${k}: ${v}`);
}
console.log(`  贴图: ${report.assets.textures} 张，语言键: ${report.assets.langKeys}`);
ok(report.counts.item > 10, '认出了物品', `${report.counts.item} 个`);
ok(report.counts.block > 3, '认出了方块', `${report.counts.block} 个`);
ok(report.counts.recipe > 3, '认出了配方', `${report.counts.recipe} 个`);
ok(report.counts.worldgen > 0, '认出了矿物生成', `${report.counts.worldgen} 条`);

// 抽验一条：红宝石剑应该被识别成 tool/sword，名字是中文
const sword = report.contents.item.find((e) => e.id === 'ruby_sword');
console.log('  抽验 ruby_sword →', JSON.stringify({ nameZh: sword?.nameZh, kind: sword?.kind, toolType: sword?.toolType }));
ok(sword && sword.nameZh === '红宝石剑', '物品中文名从语言文件里取到了');
ok(sword && sword.toolType === 'sword', '按命名规则认出是剑');

const ore = report.contents.block.find((b) => b.id === 'ruby_ore');
console.log('  抽验 ruby_ore →', JSON.stringify({ kind: ore?.kind, drops: ore?.drops?.map((d) => d.item) }));
ok(ore && ore.kind === 'ore', '认出是矿石方块');
ok(ore && ore.drops && ore.drops.length > 0, '从战利品表里读出了掉落物');

const w = report.contents.worldgen.find((x) => x.id === 'ruby_ore');
console.log('  抽验 worldgen →', JSON.stringify({ dim: w?.dimension, size: w?.size, count: w?.count, rarity: w?.rarity, y: [w?.minY, w?.maxY] }));
ok(w && w.dimension === 'overworld', '世界生成推对了维度');
ok(w && w.size >= 4, 'size 合法（≥4）');
ok(w && w.count >= 1 && w.rarity >= 1, 'count / rarity 解析出数值');

console.log(`\n[代码]`);
console.log(`  class ${report.code.stats.classFiles} 个（解析成功 ${report.code.stats.parsed}，自有 ${report.code.stats.ownClasses}）`);
console.log(`  mixin 配置 ${report.code.mixins.length} 个`);
for (const mx of report.code.mixins) {
  console.log(`    ${mx.file}（${mx.count} 个 mixin 类）`);
  for (const d of mx.details || []) {
    console.log(`      ${d.name} → ${d.targets.map((t) => t.split('/').pop()).join(', ') || '（未识别）'}`);
  }
}
ok(report.code.stats.parsed > 0, 'class 文件解析成功');

const ab = report.code.abilities;
console.log(`  能力 ${ab.length} 项：`);
for (const a of ab) {
  const mark = a.packable ? '可打包' : '仅识别';
  console.log(`    [${a.category}] ${a.name}${a.confidence === 'high' ? ' *' : ''}  ${mark}  ← ${a.evidence[0]}`);
}
ok(ab.length > 5, '识别出多种能力', `${ab.length} 项`);
ok(ab.some((a) => a.id === 'scheduler' || a.id === 'forge_tick'), '认出了 tick 事件');
// 伤害事件：Fabric 叫 damage_allow/damage_after，Forge 叫 forge_damage —— 两套都算对
ok(
  ab.some((a) => ['damage_after', 'damage_allow', 'forge_damage'].includes(a.id)),
  '认出了伤害事件',
);
ok(ab.some((a) => a.id === 'attribute_modifier'), '认出了属性加成');

// 可打包的能力里，有多少有现成效果模板
console.log('\n[能力 → 效果模板]');
const packable = ab.filter((a) => a.packable);
let withTemplate = 0;
for (const a of packable) {
  const tpl = effectsForAbility(a.id);
  if (tpl.length) {
    withTemplate++;
    console.log(`  ${a.name} → ${tpl.map((t) => t.name).join('、')}`);
  }
}
ok(withTemplate > 0, '有能力的现成实现', `${withTemplate}/${packable.length} 项`);

console.log('\n[转成包]');
const pack = await reportToPack(report, {
  contents: {
    item: report.contents.item.filter((e) => e.id.startsWith('ruby')).map((e) => e.id),
    block: report.contents.block.filter((e) => e.id.startsWith('ruby') || e.id.startsWith('deepslate_ruby')).map((e) => e.id),
    recipe: report.contents.recipe.filter((e) => e.id.startsWith('ruby')).map((e) => e.id),
    worldgen: report.contents.worldgen.filter((e) => e.id === 'ruby_ore').map((e) => e.id),
    // 材质也要带 —— 不带的话盔甲生成出来是 stacksTo(1) 的普通物品，穿不上
    armorMaterial: report.contents.armorMaterial.map((e) => e.id),
    tier: report.contents.tier.map((e) => e.id),
  },
  withTextures: true,
});
const s = summarizePack(pack);
console.log(`  ${pack.name}`);
console.log(`  ${JSON.stringify(s)}`);
ok(s.entries > 3, '包里装进了内容', `${s.entries} 项`);
ok(s.textures > 0, '贴图一起带走了', `${s.textures} 张`);
ok(pack.origin.ns === report.mainNs, '记录了来源命名空间（安装时用来搬命名空间）', pack.origin.ns);

// 套装推导 + 保留字清洗：虚空套叫 void_helmet，剥出套装名就是 void，
// 撞 Java 保留字。分析器必须自己收拾成合法 id，不能让人回头手改。
ok(
  report.contents.armorMaterial.some((e) => e.id === 'void_mat'),
  '材质名撞到保留字时自动清洗（void → void_mat）',
);
ok(
  report.contents.item.find((e) => e.id === 'void_helmet')?.armorMaterial === 'void_mat',
  '盔甲条目指向清洗后的材质',
);

console.log(`\n[警告] ${report.warnings.length} 条`);
for (const w of report.warnings) console.log(`  - ${w}`);

// 报告要能被 JSON 序列化（界面要传给前端）
try {
  JSON.stringify(reportSummary(report));
  ok(true, '报告可序列化（能安全发给界面）');
} catch (e) {
  ok(false, `报告不能序列化：${e.message}`);
}

// ---------------- 装进空工程，验证真的能用 ----------------
console.log('\n[装进空工程]');
const DEST = path.resolve(ROOT, 'projects/analyzetest');
if (!fs.existsSync(path.join(DEST, '.studio', 'project.json'))) {
  P.createProject(DEST, {
    name: '分析导入测试',
    id: 'analyzetest',
    pkg: 'com.analyzetest',
    version: '0.1.0',
    platform: 'fabric',
    mcVersion: '26.3',
  });
}

const dst = P.loadProject(DEST);
// 想回到「空工程」的状态，但不去删目录 —— 清掉条目就够了，效果一样。
// 之前这里是 rmSync 整个工程，太容易误伤，跑测试不该有这种破坏力。
dst.entries = {};
const applyReport = applyPack(DEST, dst, pack);
const addedTotal = Object.values(applyReport.added).reduce((n, l) => n + l.length, 0);
console.log(`    加入 ${addedTotal} 项，改名 ${applyReport.renames.length} 个，警告 ${applyReport.warnings.length} 条`);
for (const w of applyReport.warnings) console.log(`      ! ${w}`);
ok(addedTotal > 0, '内容装进了空工程');
ok(applyReport.renames.length === 0, '空工程不该有改名');

// 命名空间搬家检查：源命名空间不该有残留
const srcNs = report.mainNs;
const anyEntry = Object.values(dst.entries).flat().find((e) => JSON.stringify(e).includes(`${srcNs}:`));
console.log('    抽验命名空间：', anyEntry ? `还有 ${srcNs}: 残留` : `全部搬到 analyzetest`);
ok(!anyEntry, `引用里的 ${srcNs}: 都换成了新命名空间`);

P.saveProject(DEST, dst);
const genReport = await generate(DEST);
console.log(`    生成：写入 ${genReport.written.length} / 冲突 ${genReport.conflicts.length} / 错误 ${genReport.errors.length}`);
ok(genReport.conflicts.length === 0, '生成无冲突');
ok(genReport.errors.length === 0, '生成无错误');

// 装备材质：分析器补出来的材质必须真的落到生成代码里。
// 只断言「条数对」不够 —— 之前 tool 明明有 tier 却因为 import 判定错而编不过，
// 所以这里直接读生成出来的 java 看它到底用了什么。
const genArmorMat = fs.readFileSync(path.join(DEST, 'src/main/java/com/analyzetest/registry/ModArmorMaterials.java'), 'utf8');
ok(/ArmorMaterial\s+RUBY\s*=/.test(genArmorMat), '盔甲材质生成到了 ModArmorMaterials');
const genItems = fs.readFileSync(path.join(DEST, 'src/main/java/com/analyzetest/registry/ModItems.java'), 'utf8');
ok(/humanoidArmor\(ModArmorMaterials\.RUBY/.test(genItems), '盔甲物品用上了材质（不是 stacksTo(1) 的假盔甲）');
ok(/import net\.minecraft\.world\.item\.equipment\.ArmorType;/.test(genItems), 'ArmorType 的 import 跟着生成结果走');
ok(/import net\.minecraft\.world\.item\.ToolMaterial;/.test(genItems) === /ToolMaterial\./.test(genItems), 'ToolMaterial 的 import 与用法一致');

const genMain = path.join(DEST, 'src/main/resources/assets/analyzetest/lang/zh_cn.json');
ok(fs.existsSync(genMain), '资源文件生成到了新命名空间下');
const zh = JSON.parse(fs.readFileSync(genMain, 'utf8'));
const hasSword = Object.keys(zh).some((k) => k.includes('ruby_sword'));
ok(hasSword, '丢掉了原中文名（红宝石剑 能查到）');

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
