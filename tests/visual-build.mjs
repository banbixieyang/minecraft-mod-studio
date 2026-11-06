/**
 * 积木 → Java → **真跑 Gradle 编译**。
 *
 * 这是最硬的验证：光看生成的代码对不对不算数，
 * 得让 javac / Gradle 真的编译过。
 *
 * 跑法：
 *   node tests/visual-build.mjs                  # Fabric 26.3
 *   node tests/visual-build.mjs --target forge-1.20.1
 *   node tests/visual-build.mjs --keep           # 保留生成的工程，便于查看
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as P from '../core/project.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { block, value } from '../core/visual/model.mjs';
import { libraryFromReport, libraryFromJar } from '../core/visual/modlib.mjs';
import { installLibrary } from '../core/visual/library.mjs';
import { ensureBuiltin } from '../core/visual/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const targetArg = args.indexOf('--target');
const TARGET = targetArg >= 0 ? args[targetArg + 1] : 'fabric-26.3';
const KEEP = args.includes('--keep');

/**
 * Goety jar 在哪（用来做「Goety 专属积木」的真编译验证）。
 * 找不到就跳过那一段 —— 本地没这个 mod 时不该让整个测试挂掉。
 */
const GOETY_JAR_CANDIDATES = [
  'C:/Users/Lenovo/Downloads/goety-2.5.55.4.jar',
  path.join(os.homedir(), 'Downloads/goety-2.5.55.4.jar'),
  path.join(os.homedir(), 'Desktop/goety-2.5.55.4.jar'),
];
const GOETY_JAR = GOETY_JAR_CANDIDATES.find((p) => fs.existsSync(p)) || null;

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

console.log(`\n目标：${TARGET}`);

/** 造一个带积木程序的工程 */
function makeProject() {
  const programs = [
    {
      op: 'event.player_rightclick_block',
      methodName: 'on_rightclick_block',
      next: block('player.message', {
        inputs: { text: value('text', '你好，这是积木生成的消息') },
      }),
    },
    {
      op: 'event.player_tick',
      methodName: 'on_player_tick',
      next: block('flow.if', {
        inputs: {
          cond: block('math.compare', {
            inputs: { a: value('number', 10), b: value('number', 5) },
            fields: { op: '<' },
          }),
        },
        body: [
          block('player.heal', { inputs: { amount: value('number', 5) } }),
          block('player.message', { inputs: { text: value('text', '血量低') } }),
        ],
      }),
    },
    {
      op: 'event.block_break',
      methodName: 'on_block_break',
      next: block('block.set', {
        inputs: {
          x: value('number', 1),
          y: value('number', 64),
          z: value('number', 2),
          block: value('blockRef', 'minecraft:stone'),
        },
      }),
    },
    // 下面三条用来覆盖「另一个玩家变量名」和「没有玩家的事件」
    {
      op: 'event.entity_attack',
      methodName: 'on_attack',
      next: block('player.give', {
        inputs: {
          item: value('item', 'minecraft:apple'),
          count: value('number', 3),
        },
      }),
    },
    {
      op: 'event.item_use',
      methodName: 'on_item_use',
      next: block('player.set_gamemode', { fields: { mode: 'CREATIVE' } }),
    },
    {
      op: 'event.server_tick',
      methodName: 'on_server_tick',
      next: block('world.rain', { inputs: { level: value('number', 1) } }),
    },
    // 模组型积木：给物品 / 设方块 / 加效果（只用原版注册表 API）
    {
      op: 'event.entity_attack',
      methodName: 'on_mod_give',
      next: block('minecraft.item.give', {
        inputs: { count: value('number', 2) },
        fields: { item: 'minecraft:apple' },
      }),
    },
    {
      op: 'event.item_use',
      methodName: 'on_mod_block',
      next: block('minecraft.block.set', {
        inputs: {
          x: value('number', 0), y: value('number', 64), z: value('number', 0),
        },
        fields: { block: 'minecraft:stone' },
      }),
    },
    {
      op: 'event.player_tick',
      methodName: 'on_mod_effect',
      next: block('minecraft.effect.apply', {
        inputs: { ticks: value('number', 100) },
        fields: { effect: 'minecraft:strength' },
      }),
    },
  ];

  // Goety 专属积木：只有 Forge 1.20.1 + 本地有 Goety jar 时才加进来
  // （这些积木要调 com.Polarice3.Goety.* 的 API，工程必须挂上 Goety jar）
  const useGoety = TARGET === 'forge-1.20.1' && GOETY_JAR;
  if (useGoety) {
    programs.push(
      {
        op: 'event.item_use',
        methodName: 'on_goety_cast',
        next: block('goety.spell.cast'),
      },
      {
        op: 'event.player_tick',
        methodName: 'on_goety_soul',
        next: block('goety.soul.set', {
          inputs: { amount: value('number', 500) },
        }),
      },
      {
        op: 'event.entity_attack',
        methodName: 'on_goety_focus',
        next: block('goety.focus.give', {
          inputs: { count: value('number', 1) },
          fields: { focus: 'goety:arrow_rain_focus' },
        }),
      },
      {
        op: 'event.player_tick',
        methodName: 'on_goety_check',
        next: block('flow.if', {
          inputs: {
            cond: block('goety.spell.is_casting'),
          },
          body: [
            block('goety.soul.add', { inputs: { amount: value('number', 5) } }),
          ],
        }),
      },
    );
  }

  return {
    meta: {
      name: '积木编译验证',
      id: 'visualbuild',
      pkg: 'com.example.visualbuild',
      version: '0.1.0',
    },
    target: { id: TARGET },
    entries: {
      item: [{
        id: 'ruby', nameZh: '红宝石', nameEn: 'Ruby',
        kind: 'material', maxStack: 64, texture: 'ruby',
        description: '测试物品',
      }],
    },
    hooks: { java: [], js: [] },
    localDeps: useGoety ? [{ name: 'goety', path: GOETY_JAR }] : [],
    visual: { programs, libraries: [] },
  };
}

// ---------- 0. 装一个「mod 型积木库」 ----------
//
// mod 库里有三类积木：给物品、设方块、加状态效果。
// 它们的 Java 只用原版注册表 API —— 这里用原版 id 造一个假 mod 库，
// 好让这三个模板也被真编译验证一遍。
console.log('\n[0] mod 型积木库');
ensureBuiltin();
{
  const fakeMod = {
    meta: {
      loader: TARGET.startsWith('forge') ? 'forge' : 'fabric',
      id: 'testmod',
      name: '测试模组',
      version: '1.0.0',
      mcVersion: TARGET.startsWith('forge') ? '1.20.1' : '26.3',
      loaderVersion: TARGET.startsWith('forge') ? '[47,)' : '',
    },
    mainNs: 'minecraft',
    contents: {
      item: [{ id: 'apple', ns: 'minecraft', nameZh: '苹果' }],
      block: [{ id: 'stone', ns: 'minecraft', nameZh: '石头' }],
      statusEffect: [{ id: 'strength', registryId: 'minecraft:strength', nameZh: '力量' }],
    },
    effects: [],
  };
  const { library, target } = libraryFromReport(fakeMod, { targetId: TARGET });
  ok(target === TARGET, '认出目标', target);
  ok(library.blocks.length === 3, '出了三条数据型积木', `${library.blocks.length} 条`);
  const inst = installLibrary(library);
  ok(inst.ok, '装库成功', inst.errors.join('；'));
}

// ---------- 0.5 装 Goety 专属积木库 ----------
//
// Goety 专属积木要调 com.Polarice3.Goety.* 的 API，
// 所以这段只在「Forge 1.20.1 + 本地有 Goety jar」时做。
// 库是从 jar 现场生成的 —— 顺便验证「从 jar 生成库 → 装库 → 编译」整条链。
if (TARGET === 'forge-1.20.1' && GOETY_JAR) {
  console.log('\n[0.5] Goety 专属积木库');
  const { library, warnings, target } = libraryFromJar(GOETY_JAR, { apiLimit: 10 });
  ok(target === 'forge-1.20.1', '认出 Goety 对应的目标', target);
  const pack = library.blocks.filter((b) => /^goety\.(spell|soul|focus|wand)\./.test(b.id));
  ok(pack.length >= 8, 'Goety 专属积木已生成', `${pack.length} 条`);
  ok(pack.every((b) => b.requiresMod === 'goety'), '专属积木都标了 requiresMod');
  ok(pack.every((b) => b.java['forge-1.20.1']), '专属积木都有 Forge 1.20.1 的实现');
  const inst = installLibrary(library);
  ok(inst.ok, '装 Goety 库成功', inst.errors.join('；'));
  for (const w of warnings.slice(0, 3)) console.log(`    · ${w}`);
} else {
  console.log('\n[0.5] Goety 专属积木库 —— 跳过（需要 Forge 1.20.1 + 本地 Goety jar）');
}

// ---------- 1. 生成 ----------
console.log('\n[1] 生成工程');
// 构建工程放在系统临时目录里 —— 它是一次性的编译产物，不属于仓库，
// 也不该在跑测试时去删工作区里的目录。
const stamp = Date.now().toString(36);
const buildRoot = path.join(os.tmpdir(), 'mcstudio-visualbuild');
const projDir = path.join(buildRoot, `${TARGET.replace(/[^a-z0-9]/gi, '-')}-${stamp}`);
P.createProject(projDir, {
  name: '积木编译验证',
  id: 'visualbuild',
  pkg: 'com.example.visualbuild',
  version: '0.1.0',
  target: TARGET,
});
// target 直接给 id —— createProject 会自动从适配器取全套 defaults
// （javaVersion / loaderVersion 等，少一个都会让脚手架生成出坏 build.gradle）
const p = P.loadProject(projDir);
const spec = makeProject();
p.entries = spec.entries;
p.visual = spec.visual;
p.localDeps = spec.localDeps;
P.saveProject(projDir, p);
ok(P.isProject(projDir), '工程已创建', path.relative(ROOT, projDir));
ok(typeof p.target.javaVersion === 'number', 'target 字段完整', JSON.stringify(p.target));

const report = await generate(projDir);
ok(!report.errors?.length, '生成无错误', (report.errors || []).join('；'));
if (report.errors?.length) {
  console.log('\n生成错误明细：');
  for (const e of report.errors) console.log(`  ${e.path || ''}: ${e.reason || e}`);
}

// ---------- 2. 检查产物 ----------
console.log('\n[2] 积木产物');
const logicPath = path.join(projDir, 'src/main/java/com/example/visualbuild/custom/ModLogic.java');
ok(fs.existsSync(logicPath), 'ModLogic.java 已生成');
if (fs.existsSync(logicPath)) {
  const code = fs.readFileSync(logicPath, 'utf8');
  console.log('');
  console.log('--- ModLogic.java ---');
  console.log(code);
  console.log('--- 结束 ---');
  console.log('');
  ok(code.includes('on_rightclick_block'), '含右键事件方法');
  ok(code.includes('on_player_tick'), '含 tick 事件方法');
  ok(code.includes('on_block_break'), '含破坏方块事件方法');
  ok(code.includes('on_attack'), '含攻击事件方法');
  ok(code.includes('on_item_use'), '含使用物品事件方法');
  ok(code.includes('on_server_tick'), '含服务器 tick 事件方法');
  ok(code.includes('on_mod_give'), '含 mod 型「给物品」方法');
  ok(code.includes('on_mod_block'), '含 mod 型「设方块」方法');
  ok(code.includes('on_mod_effect'), '含 mod 型「加效果」方法');
  if (TARGET === 'forge-1.20.1' && GOETY_JAR) {
    ok(code.includes('on_goety_cast'), '含 Goety「施放法术」方法');
    ok(code.includes('on_goety_soul'), '含 Goety「设灵魂能量」方法');
    ok(code.includes('on_goety_focus'), '含 Goety「给聚晶」方法');
    ok(code.includes('on_goety_check'), '含 Goety「是否在施法」方法');
    ok(code.includes('com.Polarice3.Goety'), '生成的 Java 引用了 Goety 的类');
  }
  ok(code.includes('public static void init()'), '含事件接线 init');
  ok(!code.includes('%'), '没有未替换的占位符', (code.match(/%[a-zA-Z]+/g) || []).join(' '));
  // 接线必须调到真正的方法名（用户在界面上改过名字的情况）
  ok(!/on_player_rightclick_block\(/.test(code), '接线用的是实际方法名而不是默认名');
  // 同一事件写了两段程序 → 方法名不能撞车
  ok((code.match(/public static void on_player_tick/g) || []).length === 1, '同名事件的方法名被自动避开了');
}

// ---------- 3. 真编译 ----------
console.log('\n[3] Gradle 真编译');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const cmd = fs.existsSync(path.join(projDir, gradlew))
  ? gradlew
  : (fs.existsSync(path.join(projDir, 'gradlew')) ? './gradlew' : null);
if (!cmd) {
  ok(false, '找不到 gradlew —— 脚手架没生成？');
} else {
  const t0 = Date.now();
  const r = spawnSync(cmd, ['build', '--no-daemon', '--console=plain'], {
    cwd: projDir,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    shell: process.platform === 'win32',
    env: { ...process.env },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  耗时 ${secs}s`);

  if (r.status === 0) {
    ok(true, 'Gradle 编译通过');
  } else {
    ok(false, 'Gradle 编译失败');
    // 只打错误段
    const lines = out.split('\n');
    const errIdx = lines.findIndex((l) => /error:|错误|FAILURE|Execution failed/i.test(l));
    if (errIdx >= 0) {
      console.log('');
      console.log('--- 错误段 ---');
      console.log(lines.slice(Math.max(0, errIdx - 3), errIdx + 25).join('\n'));
      console.log('--- 结束 ---');
    }
    const jarDir = path.join(projDir, 'build', 'libs');
    if (fs.existsSync(jarDir)) {
      console.log('已产出的 jar：', fs.readdirSync(jarDir).join(', '));
    }
  }
}

// ---------- 4. 说明 ----------
// 构建工程留在系统临时目录里（不自动删 —— 删除目录属于破坏性操作，
// 而且这个目录在系统临时区，下次开机自然会被清掉）。
console.log(`\n构建工程在：${projDir}`);
if (KEEP) console.log('（--keep：保留以便查看）');

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
