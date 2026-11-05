/**
 * 任务卡代码的可编译性验证。
 *
 * 为什么要有这个测试：这些代码是给「不会写 Java 的人」直接粘贴的。
 * 粘过去报错，整套教程就废了，而且他大概率没法自己排查。
 *
 * 做法：从 knowledge/cookbook/*.md 里抽出 `## 代码` 这一节下的第一个
 * java 代码块（那是完整可运行的那段，变体里的碎片不抽），全部塞进一个
 * 工程的 Java 钩子，然后真跑一次 gradlew。
 *
 * 跑法：node tests/cookbook.mjs [--build]
 *   --build 才真编译（约 30 秒）；不带参数只做抽取与静态检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as P from '../core/project.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { runGradle } from '../core/build/gradle.mjs';
import { parseDoc } from '../core/knowledge/parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'projects/cookbooktest');
const KB = path.join(ROOT, 'knowledge/cookbook');
const DO_BUILD = process.argv.includes('--build');

let failed = 0;
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};

// ---------------- [0] 变体代码里的符号（编译测试覆盖不到的部分） ----------------
// 「## 代码」那一节会被真编译，但「## 变体」里的碎片不会 —— 可初学者照样会抄。
// 曾经就因为变体里写了 MobEffects.MOVEMENT_SLOWDOWN 而没被发现。
// 从 loom 映射后的真实 jar 里 javap 出字段名，把知识库所有 java 块都核一遍。
// jar 或 javap 不在（比如刚 clone、还没构建过）就跳过，不硬失败。
console.log('\n[0] 校验代码片段里的 API 符号');

function findMinecraftJar() {
  const projects = path.join(ROOT, 'projects');
  if (!fs.existsSync(projects)) return null;
  for (const p of fs.readdirSync(projects)) {
    const base = path.join(projects, p, '.gradle/loom-cache/minecraftMaven/net/minecraft');
    if (!fs.existsSync(base)) continue;
    for (const g of fs.readdirSync(base)) {
      const ver = path.join(base, g, '26.3');
      if (!fs.existsSync(ver)) continue;
      const jar = fs.readdirSync(ver).find((f) => f.endsWith('.jar') && /merged/.test(f));
      if (jar) return path.join(ver, jar);
    }
  }
  return null;
}

// 类名 → 正则（抓代码块里对该类静态字段的引用）
const SYMBOL_CHECKS = [
  { cls: 'net.minecraft.world.effect.MobEffects', ref: /MobEffects\.([A-Z][A-Z0-9_]*)/g },
];

function collectMarkdown(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectMarkdown(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const jar = findMinecraftJar();
if (!jar) {
  console.log('    （跳过：本机还没有 loom 映射后的 minecraft jar，构建过一次后本项自动生效）');
} else {
  for (const chk of SYMBOL_CHECKS) {
    let fields;
    try {
      const out = execFileSync('javap', ['-classpath', jar, chk.cls], { encoding: 'utf8' });
      fields = new Set([...out.matchAll(/\b([A-Z][A-Z0-9_]*);\s*$/gm)].map((m) => m[1]));
    } catch {
      console.log(`    （跳过：javap 读不出 ${chk.cls}）`);
      continue;
    }
    const bad = [];
    for (const file of collectMarkdown(path.join(ROOT, 'knowledge'))) {
      const raw = fs.readFileSync(file, 'utf8');
      for (const m of raw.matchAll(/```java\s*\n([\s\S]*?)```/g)) {
        for (const r of m[1].matchAll(chk.ref)) {
          if (!fields.has(r[1])) bad.push(`${path.basename(file)}: MobEffects.${r[1]}`);
        }
      }
    }
    ok(bad.length === 0, `${chk.cls} 字段名（${fields.size} 个候选中核对）`, bad.join('、'));
  }
}

// ---------------- 抽取 ----------------
console.log('\n[1] 从任务卡抽代码块');
// 多目标之后，任务卡不再全是 Fabric 的。把 Forge 卡塞进 Fabric 工程编译等于
// 故意制造失败，所以按 front matter 的 platform 分组：这里只编 Fabric 卡，
// Forge 卡由 tests/forge.mjs --build 挂进 Forge 工程真编译。
const blocks = [];
const forgeBlocks = [];
if (fs.existsSync(KB)) {
  for (const file of fs.readdirSync(KB).filter((f) => f.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(KB, file), 'utf8');
    const doc = parseDoc(raw, { id: file, name: file });
    // 「## 代码」那一节才是完整可跑的那段
    const sec = doc.sections.find((s) => /^代码/.test(s.heading) && s.level === 2);
    const java = (sec?.code || []).find((c) => c.lang === 'java');
    if (!java) {
      ok(false, `${file}：没找到「## 代码」下的 java 代码块`);
      continue;
    }
    const item = { doc: doc.title, file, code: java.content, platform: doc.platform || 'fabric' };
    (item.platform === 'forge' ? forgeBlocks : blocks).push(item);
    console.log(`    [${item.platform}] ${doc.title} → ${java.content.split('\n').length} 行`);
  }
}
ok(blocks.length >= 5, `抽出 ${blocks.length} 段 Fabric 任务卡代码`);
ok(forgeBlocks.length >= 2, `另有 ${forgeBlocks.length} 张 Forge 任务卡（由 tests/forge.mjs --build 真编译）`);
for (const b of forgeBlocks) {
  ok(/net\.minecraftforge\b/.test(b.code) && !/net\.fabricmc\b/.test(b.code),
    `${b.file}：Forge 卡没混入 Fabric API`);
  ok(!/^\s*(package|import)\s/m.test(b.code),
    `${b.file}：钩子代码没有 import / package（插进方法体会编不过）`);
}

// ---------------- 灌进工程 ----------------
console.log('\n[2] 建工程并挂成钩子');
if (!fs.existsSync(path.join(DIR, '.studio', 'project.json'))) {
  P.createProject(DIR, {
    name: '任务卡编译测试',
    id: 'cookbooktest',
    pkg: 'com.cookbooktest',
    version: '0.1.0',
    ...{ platform: 'fabric', mcVersion: '26.3', loaderVersion: '0.19.5', apiVersion: '0.164.0+26.3', javaVersion: 25 },
  });
}

const proj = P.loadProject(DIR);
proj.entries = {};
proj.hooks = { java: [], js: [] };

const E = (type, entry) => P.addEntry(proj, type, entry);
// 任务卡里引用到的所有条目都得存在，否则 id(...) 虽然编译通过但运行会空
E('item', { id: 'ruby', nameZh: '红宝石', kind: 'material', rarity: 'common', stacksTo: 64, texture: { mode: 'auto' } });
E('item', { id: 'ruby_charm', nameZh: '红宝石护符', kind: 'simple', rarity: 'common', stacksTo: 1, texture: { mode: 'auto' } });
E('item', {
  id: 'ruby_sword', nameZh: '红宝石剑', kind: 'tool', toolType: 'sword',
  materialMode: 'preset', materialPreset: 'diamond', rarity: 'common', stacksTo: 1, texture: { mode: 'auto' },
});
E('item', {
  id: 'ruby_pickaxe', nameZh: '红宝石镐', kind: 'tool', toolType: 'pickaxe',
  materialMode: 'preset', materialPreset: 'diamond', rarity: 'common', stacksTo: 1, texture: { mode: 'auto' },
});
E('block', {
  id: 'ruby_ore', nameZh: '红宝石矿石', kind: 'ore',
  hardness: 3, resistance: 3, sound: 'stone', xpMin: 1, xpMax: 3,
  requiresTool: true, texture: { mode: 'auto' },
  drops: [{ item: 'ruby', min: 1, max: 1, chance: 1, fortune: true }],
});

for (const b of blocks) {
  proj.hooks.java.push({ target: 'init', name: `任务卡：${b.doc}`, code: b.code });
}
P.saveProject(DIR, proj);
ok(proj.hooks.java.length === blocks.length, `挂了 ${proj.hooks.java.length} 段钩子`);

// ---------------- 生成 ----------------
console.log('\n[3] 生成');
const rep = await generate(DIR);
console.log(`    写入 ${rep.written.length} / 冲突 ${rep.conflicts.length} / 错误 ${rep.errors.length}`);
for (const e of rep.errors) console.log(`      ! ${e}`);
ok(rep.conflicts.length === 0, '生成无冲突');
ok(rep.errors.length === 0, '生成无错误');

// 钩子真的进主类了吗（插不进去的话编译会「过」但代码根本没生效）
const mainPath = path.join(DIR, 'src/main/java/com/cookbooktest/Cookbooktest.java');
if (fs.existsSync(mainPath)) {
  const main = fs.readFileSync(mainPath, 'utf8');
  const applied = blocks.filter((b) => main.includes(`任务卡：${b.doc}`)).length;
  ok(applied === blocks.length, `${applied}/${blocks.length} 段钩子插进了主类`);
} else {
  ok(false, '主类没生成');
}

// ---------------- 编译 ----------------
if (!DO_BUILD) {
  console.log('\n（跳过编译，加 --build 才会真编）');
} else {
  console.log('\n[4] 编译（这一步才证明代码真的能用）');
  // 先删旧 jar：否则本次编译失败时，上一次成功的产物还在，会误报「jar 产物存在」
  const jarPath = path.join(DIR, 'build/libs/cookbooktest-0.1.0.jar');
  if (fs.existsSync(jarPath)) fs.rmSync(jarPath);
  const job = runGradle(DIR, 'build');
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (!job.running) {
        clearInterval(t);
        resolve();
      }
    }, 500);
  });
  if (job.exitCode !== 0) {
    // javac 的「找不到符号」把真正的名字写在紧跟着的「符号:/位置:」行里，
    // 只过滤 error 行等于把关键线索丢掉。连带打印后续两行。
    console.log('    ---- 编译错误 ----');
    const errIdx = [];
    job.lines.forEach((l, i) => { if (/error:|错误:/.test(l)) errIdx.push(i); });
    const show = new Set();
    for (const i of errIdx.slice(0, 15)) for (let j = i; j <= i + 2 && j < job.lines.length; j++) show.add(j);
    [...show].sort((a, b) => a - b).forEach((i) => console.log('    ' + job.lines[i]));
  }
  ok(job.exitCode === 0, '任务卡代码全部编译通过');
  ok(fs.existsSync(jarPath), 'jar 产物存在');
}

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
