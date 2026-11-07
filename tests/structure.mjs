/**
 * 自定义结构（完全自定义 Java 类型）。
 *
 * 验证四件事：
 *   1. 结构配置 JSON（群系 / 阶段 / 地形修饰）与结构集 JSON（间距 / 间隔 / 盐）
 *   2. 结构指定群系：写进结构 JSON 自己的 biomes 字段（群系侧没有 starts 这种反向联动）
 *   3. Java 产物：Structure 子类 + Piece 子类 + 注册表，两目标各自用对 API
 *   4. 版本差异：Identifier vs ResourceLocation、MapCodec vs Codec
 *
 * 用法：
 *   node tests/structure.mjs            只断言文件形状（不联网）
 *   node tests/structure.mjs --build    额外对 Forge 1.20.1 真跑 gradlew build
 */
import path from 'node:path';
import fs from 'node:fs';
import { saveProject } from '../core/project.mjs';
import { openProject } from './_util.mjs';
import { collect, generate } from '../core/generator/pipeline.mjs';

const DO_BUILD = process.argv.includes('--build');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
};

const BIOMES = [
  { id: 'crystal_forest', precipitation: 'rain', temperature: 0.8, downfall: 0.4 },
  { id: 'ash_plain', precipitation: 'none', temperature: 1.5, downfall: 0.0 },
];

const STRUCTURES = [
  {
    id: 'crystal_tower',
    biomes: ['crystal_forest'],
    step: 'surface_structures',
    terrain_adaptation: 'beard_thin',
    spacing: 24,
    separation: 6,
    salt: 12345,
    block: 'minecraft:stone_bricks',
    accentBlock: 'minecraft:glowstone',
    accentChance: 0.2,
    width: 9,
    height: 12,
    hollow: true,
    floorBlock: 'minecraft:polished_andesite',
    lootTable: 'crystal_tower_loot',
  },
  {
    id: 'ruin',
    biomes: ['all'],
    step: 'underground_structures',
    terrain_adaptation: 'none',
    spacing: 40,
    separation: 12,
    salt: 7,
    block: 'minecraft:mossy_stone_bricks',
    accentBlock: '',
    accentChance: 0.5,
    width: 4,
    height: 5,
    hollow: false,
    floorBlock: '',
    lootTable: '',
  },
];

for (const target of [
  { id: 'structfab263', dir: 'structfab263', target: 'fabric-26.3', pkg: 'com.test.structfab' },
  { id: 'structfor1201', dir: 'structfor1201', target: 'forge-1.20.1', pkg: 'com.test.structfor' },
]) {
  const root = path.join('.', 'projects', target.dir);
  const p = openProject(root, {
    id: target.id, name: '结构测试', pkg: target.pkg, version: '0.1.0', target: target.target,
  });
  p.entries = {
    biome: BIOMES.map((d) => ({ ...d })),
    structure: STRUCTURES.map((d) => ({ ...d, biomes: [...d.biomes] })),
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
  const java = (rel) => {
    const k = Object.keys(byPath).find((x) => x.endsWith(rel));
    return k ? byPath[k] : '';
  };

  const isFabric = target.target === 'fabric-26.3';
  const isLegacy = target.target === 'forge-1.20.1';

  console.log(`\n[${target.dir}]`);

  // ---- 结构配置 ----
  const st = get(`worldgen/structure/crystal_tower.json`);
  ok(st, '生成了 crystal_tower 结构配置');
  if (st) {
    ok(st.type === `${target.id}:crystal_tower`, 'type 指向本模组注册的结构类型');
    ok(Array.isArray(st.biomes) && st.biomes.includes(`${target.id}:crystal_forest`), 'biomes 包含指定群系');
    ok(st.step === 'surface_structures', '生成阶段 = 地表结构');
    ok(st.terrain_adaptation === 'beard_thin', '地形修饰 = beard_thin');
  }

  const set = get(`worldgen/structure_set/crystal_tower.json`);
  ok(set, '生成了结构集（structure_set）');
  if (set) {
    ok(set.structures?.[0]?.structure === `${target.id}:crystal_tower`, '结构集引用本结构');
    ok(set.placement?.type === 'minecraft:random_spread', '放置类型 = random_spread');
    ok(set.placement?.spacing === 24 && set.placement?.separation === 6, '间距 / 最小间隔正确');
    ok(set.placement?.salt === 12345, '随机盐正确');
  }

  // ---- 结构指定群系 ----
  // 1.19 起群系就没有 starts 了，方向反过来：由结构 JSON 的 biomes 说「我住在哪些群系」。
  const b0 = get(`worldgen/biome/crystal_forest.json`);
  const b1 = get(`worldgen/biome/ash_plain.json`);
  ok(b0 && b0.starts === undefined, 'crystal_forest 不写已废弃的 starts');
  ok(b1 && b1.starts === undefined, 'ash_plain 不写已废弃的 starts');

  const ruinJson = get(`worldgen/structure/ruin.json`);
  ok(ruinJson, '生成了 ruin 结构配置');
  // ruin 填的是 all → 展开成「本模组全部群系」
  ok(
    Array.isArray(ruinJson?.biomes)
      && ruinJson.biomes.includes(`${target.id}:crystal_forest`)
      && ruinJson.biomes.includes(`${target.id}:ash_plain`),
    'biomes=all 展开成本模组全部群系',
  );
  ok(
    Array.isArray(st?.biomes) && !st.biomes.includes(`${target.id}:ash_plain`),
    'crystal_tower 只住进指定群系，没有波及其他群系',
  );

  // ---- all 展开 ----
  const ruin = get(`worldgen/structure/ruin.json`);
  ok(ruin, '生成了 ruin 结构配置');
  if (ruin) {
    ok(Array.isArray(ruin.biomes) && ruin.biomes.length === 2, 'biomes=all 展开成全部自建群系');
    ok(ruin.biomes.includes(`${target.id}:crystal_forest`) && ruin.biomes.includes(`${target.id}:ash_plain`), '展开结果包含两个群系');
    ok(ruin.terrain_adaptation === undefined, 'terrain_adaptation=none 时不写该字段');
  }

  // ---- 注册表 Java ----
  const hub = java('world/ModStructures.java');
  ok(hub, '生成了 ModStructures 注册表');
  ok(/public static final StructureType<CrystalTowerStructure> CRYSTAL_TOWER/.test(hub), '注册表声明了结构类型常量');
  ok(/public static final StructurePieceType CRYSTAL_TOWER_PIECE/.test(hub), '注册表声明了拼块类型常量');
  if (isFabric) {
    ok(/BuiltInRegistries\.STRUCTURE_TYPE/.test(hub) && /Identifier\.fromNamespaceAndPath/.test(hub), 'Fabric 用 BuiltInRegistries + Identifier 注册');
    ok(/public static void init\(\)/.test(hub), 'Fabric 提供 init() 给主类调用');
    const main = java('/Structfab263.java');
    ok(/ModStructures\.init\(\)/.test(main), 'Fabric 主类调用了 ModStructures.init()');
  }
  if (isLegacy) {
    ok(/@Mod\.EventBusSubscriber/.test(hub), 'Forge 用 @Mod.EventBusSubscriber 自注册');
    ok(/RegisterEvent/.test(hub) && /Registries\.STRUCTURE_TYPE/.test(hub), 'Forge 用 RegisterEvent 注册结构类型');
    ok(/new ResourceLocation\(NS, "crystal_tower"\)/.test(hub), 'Forge 用 ResourceLocation');
  }

  // ---- Structure 子类 ----
  const sc = java('world/structure/CrystalTowerStructure.java');
  ok(sc, '生成了 CrystalTowerStructure');
  ok(/extends Structure/.test(sc) && /findGenerationPoint/.test(sc), '继承 Structure 并实现 findGenerationPoint');
  ok(/onTopOfChunkCenter/.test(sc) && /getFirstFreeHeight/.test(sc), '按地表高度确定落点');
  ok(/new CrystalTowerPiece\(cx, y, cz\)/.test(sc), '把落点交给拼块');
  ok(isFabric ? /public static final MapCodec<CrystalTowerStructure> CODEC/.test(sc) : /public static final Codec<CrystalTowerStructure> CODEC/.test(sc),
    isFabric ? 'Fabric 26.3 用 MapCodec' : 'Forge 1.20.1 用 Codec');

  // ---- Piece 子类 ----
  const pc = java('world/structure/CrystalTowerPiece.java');
  ok(pc, '生成了 CrystalTowerPiece');
  ok(/extends StructurePiece/.test(pc) && /postProcess/.test(pc), '继承 StructurePiece 并实现 postProcess');
  ok(/generateBox/.test(pc) && /placeBlock/.test(pc), '用 generateBox / placeBlock 摆方块');
  ok(/minecraft:glowstone/.test(pc), '点缀方块写进代码');
  ok(/minecraft:polished_andesite/.test(pc), '地板方块写进代码');
  ok(/y \+ 11/.test(pc), '高度 12 → 包围盒上沿 y+11');
  ok(/cx - 4/.test(pc), '宽度 9 → 半径 4');
  ok(/createChest/.test(pc) && /crystal_tower_loot/.test(pc), '配置了宝箱战利品表');
  ok(isFabric ? /BuiltInRegistries\.BLOCK\.getValue/.test(pc) : /BuiltInRegistries\.BLOCK\.get\(/.test(pc),
    isFabric ? 'Fabric 用 getValue 查方块' : 'Forge 用 get 查方块');
  ok(isFabric ? /ResourceKey\.create\(Registries\.LOOT_TABLE/.test(pc) : /new ResourceLocation\(".*:crystal_tower_loot"\)/.test(pc),
    isFabric ? 'Fabric 宝箱用 ResourceKey<LootTable>' : 'Forge 宝箱用 ResourceLocation');

  // ---- 第二个结构：实心 / 无点缀 / 无宝箱 ----
  const pc2 = java('world/structure/RuinPiece.java');
  ok(pc2, '生成了 RuinPiece');
  ok(/BlockState ACCENT = null/.test(pc2), '没填点缀方块 → ACCENT 为 null');
  ok(/LOOT = null/.test(pc2), '没填战利品表 → LOOT 为 null');
  ok(/BlockState FILL = state\("minecraft:mossy_stone_bricks"\)/.test(pc2), 'hollow=false → 内部也用主体方块（实心）');
  ok(/y \+ 4/.test(pc2), '高度 5 → 上沿 y+4');
  ok(/cx - 2/.test(pc2), '宽度 4 → 取奇数后半径 2');

  // collect 只收集不落盘。快跑时到此为止（工程目录留着，不删）；
  // 真编译才需要把工程和生成结果都写到磁盘上。
  if (DO_BUILD) {
    saveProject(root, p);
    const rep = await generate(root, { force: true });
    ok(rep.errors.length === 0, '生成落盘无错误', rep.errors.join('；'));
  } else if (fail) {
    console.log(`  （工程留在 ${root}，便于翻生成的产物）`);
  }
}

// ---- 真编译（两个目标都编）----
async function buildProject(DIR, label) {
  console.log(`\n[结构 ${label} 真编译]`);
  const { runGradle } = await import('../core/build/gradle.mjs');
  const jarDir = path.join(DIR, 'build/libs');
  // 编译失败时别让上一次成功的旧 jar 冒充通过
  if (fs.existsSync(jarDir)) for (const f of fs.readdirSync(jarDir)) if (f.endsWith('.jar')) fs.unlinkSync(path.join(jarDir, f));

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
    if (!errIdx.length) {
      for (let i = Math.max(0, job.lines.length - 40); i < job.lines.length; i++) show.add(i);
    }
    [...show].sort((a, b) => a - b).forEach((i) => console.log('    ' + job.lines[i]));
  }
  ok(job.exitCode === 0, `${label} gradlew build 成功`);
  const jars = fs.existsSync(jarDir) ? fs.readdirSync(jarDir).filter((f) => f.endsWith('.jar')) : [];
  ok(jars.length > 0, `${label} jar 产物存在`, jars.join(','));
}

if (DO_BUILD) {
  // Forge 1.20.1 需要 JDK 17 跑 Gradle（foojay 也会兜底）
  const jdks = [
    process.env.MCSTUDIO_JDK17,
    'C:/Users/Lenovo/AppData/Roaming/.minecraft/runtime/java-runtime-beta',
  ].filter(Boolean);
  const jdk17 = jdks.find((p) => fs.existsSync(path.join(p, 'bin', 'javac.exe')));
  if (jdk17) {
    process.env.JAVA_HOME = jdk17;
    console.log(`\n    使用 JDK 17：${jdk17}`);
  }
  await buildProject(path.resolve('projects/structfor1201'), 'Forge 1.20.1');
  // Fabric 26.3 的 toolchain 会自己 provision JDK 25；这里把 JAVA_HOME 交还给默认 JDK
  if (jdk17) delete process.env.JAVA_HOME;
  await buildProject(path.resolve('projects/structfab263'), 'Fabric 26.3');
}

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 通过，${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
