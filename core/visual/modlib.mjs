/**
 * mod → 可视化积木库。
 *
 * 用户想「把某个 mod 的东西变成积木」，靠的就是这里。
 * 做法分两条腿：
 *
 *   A. **数据型积木** —— 从分析报告里的物品 / 方块 / 状态效果条目来。
 *      生成的 Java 只用**原版注册表 API**，完全不需要 mod 自己的 API：
 *        给玩家一个「魔核」→ BuiltInRegistries.ITEM.getValue(Identifier.parse("goety:magic_core"))
 *      好处是行为完全可预期，而且只要工程里装了那个 mod 就一定能编译。
 *
 *   B. **行为型积木** —— 扫 mod 的 class，把 public static 方法变成积木：
 *        「连锁闪电」→ com.Polarice3.Goety.utils.WandUtil.chainLightning(player, target, 0, 0)
 *      这类积木直接调 mod 的方法，需要工程里把 mod 加成依赖；
 *      参数只收「基本类型 + String + 我们约定的 player/level」，
 *      其它类型一律跳过 —— 宁可少给几条，也不给编译不过的积木。
 *
 * 三条规矩：
 *   1. 生成出来的积木，Java 必须是**真能编译**的（数据类型映射全走 javap 核过的 API）。
 *   2. 只在 mod 的加载器 / MC 版本对得上的目标下给模板，对不上的标 unverified。
 *   3. 不猜语义：方法名就是积木名，不擅自改写成「友好」的名字。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, closeReport } from '../analyze/report.mjs';
import { parseClass } from '../analyze/classfile.mjs';
import { openSource } from '../analyze/sources.mjs';
import { LIB_FORMAT, LIB_VERSION } from './library.mjs';
import { goetyPack, isGoety } from './modpacks/goety.mjs';

/** 我们认识的目标（loader + MC 版本 → 目标 id） */
export const KNOWN_TARGETS = [
  { id: 'fabric-26.3', loader: 'fabric', mc: '26.3', label: 'Fabric 26.3' },
  { id: 'forge-1.20.1', loader: 'forge', mc: '1.20.1', label: 'Forge 1.20.1' },
];

/**
 * Forge 的 loaderVersion 与 MC 版本是一一对应的，
 * 比 mods.toml 里没被替换的 ${minecraft_version_range} 靠谱得多。
 */
const FORGE_LOADER_TO_MC = [
  { loader: 47, mc: '1.20.1' },
  { loader: 46, mc: '1.20' },
  { loader: 45, mc: '1.19.4' },
  { loader: 43, mc: '1.19.2' },
  { loader: 41, mc: '1.19' },
  { loader: 40, mc: '1.16.5' },
];

/** 从 loaderVersion 里取第一个数字（"[47,)" → 47） */
function firstNumber(s) {
  const m = /(\d+)/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
}

/**
 * 这个 mod 能装进哪个目标。
 *
 * 三条线索，从可靠到不可靠依次用：
 *   1. 元数据里的 MC 版本（fabric.mod.json / mods.toml 通常都写清楚了）
 *   2. Forge 的 loaderVersion（47 → 1.20.1，权威）
 *   3. 都没写 → 退到「引用的 MC 类在目标 jar 里存不存在」的实测
 *
 * @param {object} meta 分析报告的 meta
 * @returns {{id:string,label:string, how:string}|null}
 */
export function targetOfMod(meta) {
  if (!meta) return null;
  const loader = String(meta.loader || '').toLowerCase();
  const mc = String(meta.mcVersion || '');
  for (const t of KNOWN_TARGETS) {
    if (t.loader !== loader) continue;
    if (mc && mc.includes(t.mc)) return { id: t.id, label: t.label, how: '元数据里的 MC 版本' };
  }
  if (loader === 'forge') {
    const lv = firstNumber(meta.loaderVersion);
    const hit = FORGE_LOADER_TO_MC.find((x) => x.loader === lv);
    if (hit) {
      const t = KNOWN_TARGETS.find((x) => x.id === 'forge-1.20.1' && hit.mc === x.mc);
      if (t) return { id: t.id, label: t.label, how: `Forge loaderVersion ${lv}` };
    }
  }
  return null;
}

/**
 * 实测法：这个 mod 引用的 Minecraft 类，在目标 jar 里能不能找到。
 *
 * 这是最硬的判据 —— mod 用到了 `net/minecraft/world/effect/MobEffect`，
 * 说明它要的那个版本的 MC 里真有这个类；找不到就是版本对不上。
 *
 * @param {object} src openSource() 出来的源（mod 本身）
 * @param {string} targetId
 * @returns {{ok:boolean, matched:number, total:number, rate:number}|null}
 */
export function checkApiAgainstTarget(src, targetId) {
  const jar = targetJarPath(targetId);
  if (!jar || !src) return null;

  // 目标 jar 的类清单
  let targetClasses;
  try {
    const t = openSource(jar);
    targetClasses = new Set((t.allNames || [])
      .filter((n) => n.endsWith('.class'))
      .map((n) => n.replace(/\.class$/, '')));
    t.close?.();
  } catch {
    return null;
  }
  if (!targetClasses.size) return null;

  // mod 引用的 MC 类
  const names = (src.allNames || []).filter((n) => n.endsWith('.class') && !n.includes('$'));
  const refs = new Set();
  let scanned = 0;
  for (const p of names) {
    if (scanned++ > 600) break;
    let cls;
    try { cls = parseClass(src.read(p)); } catch { continue; }
    for (const c of cls.classes || []) {
      if (c.startsWith('net/minecraft/')) refs.add(c);
    }
  }
  if (refs.size < 10) return null;

  let matched = 0;
  for (const c of refs) if (targetClasses.has(c)) matched++;
  return { ok: true, matched, total: refs.size, rate: matched / refs.size };
}

/** 目标版本的 MC jar 在哪（本地 Gradle 缓存） */
export function targetJarPath(targetId) {
  const home = os.homedir();
  const cands = targetId === 'forge-1.20.1'
    ? [
      path.join(home, '.gradle/caches/forge_gradle/minecraft_user_repo/net/minecraftforge/forge/1.20.1-47.4.0_mapped_official_1.20.1/forge-1.20.1-47.4.0_mapped_official_1.20.1.jar'),
    ]
    : [
      path.join(home, '.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/26.3/minecraft-merged-deobf-26.3.jar'),
    ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * 用实测法在候选目标里挑一个最匹配的。
 * @param {object} src
 * @param {object[]} candidates [{ id, label, loader }]
 */
export function detectTargetByApi(src, candidates = KNOWN_TARGETS) {
  let best = null;
  for (const c of candidates) {
    const r = checkApiAgainstTarget(src, c.id);
    if (!r) continue;
    if (r.rate >= 0.6 && r.matched >= 10) {
      if (!best || r.rate > best.rate) best = { id: c.id, label: c.label, rate: r.rate, matched: r.matched, total: r.total };
    }
  }
  return best;
}

/* ────────────────────────── 参数类型映射 ────────────────────────── */

/**
 * 基本类型：直接变成积木的输入槽。
 * kind 决定界面上是数字框还是文本框。
 */
const PRIMITIVES = {
  Z: { kind: 'boolean', java: 'boolean', def: 'false' },
  B: { kind: 'boolean', java: 'boolean', def: 'false' },
  I: { kind: 'number', java: 'int', def: '0' },
  J: { kind: 'number', java: 'long', def: '0' },
  S: { kind: 'number', java: 'short', def: '0' },
  F: { kind: 'number', java: 'float', def: '0' },
  D: { kind: 'number', java: 'double', def: '0' },
  'Ljava/lang/String;': { kind: 'text', java: 'String', def: '' },
  'Ljava/lang/CharSequence;': { kind: 'text', java: 'String', def: '' },
};

/**
 * 约定变量：直接把积木方法里的 player / level 传进去。
 * 这些是**编译期就确定**的类型，所以不用在积木上暴露输入槽。
 */
const CONTEXT_VARS = [
  { desc: 'Lnet/minecraft/server/level/ServerPlayer;', expr: 'player' },
  { desc: 'Lnet/minecraft/world/entity/player/Player;', expr: 'player' },
  { desc: 'Lnet/minecraft/world/entity/LivingEntity;', expr: 'player' },
  { desc: 'Lnet/minecraft/world/entity/Entity;', expr: 'player' },
  { desc: 'Lnet/minecraft/server/level/ServerLevel;', expr: '(net.minecraft.server.level.ServerLevel) level' },
  { desc: 'Lnet/minecraft/world/level/Level;', expr: 'level' },
  { desc: 'Lnet/minecraft/world/level/LevelAccessor;', expr: 'level' },
];

/** 描述符里的对象类型 → 短类名 */
function typeShortName(desc) {
  const m = /^L([^;]+);$/.exec(desc);
  if (!m) return desc;
  const cn = m[1].split('/').pop();
  return cn;
}

/**
 * 拆一个方法描述符的参数表。
 * @param {string} desc 方法描述符，如 "(Lnet/minecraft/world/entity/Entity;DF)V"
 * @returns {{params:string[], ret:string}}
 */
export function parseMethodDesc(desc) {
  const s = String(desc || '');
  const open = s.indexOf('(');
  const close = s.indexOf(')');
  if (open < 0 || close < 0) return { params: [], ret: 'V' };
  const inner = s.slice(open + 1, close);
  const params = [];
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === '[') {
      // 数组：类型是「数组」，映射不了
      let j = i;
      while (inner[j] === '[') j++;
      const t = inner[j];
      params.push(t === 'L' ? inner.slice(j, inner.indexOf(';', j) + 1) : t);
      const semi = inner.indexOf(';', j);
      i = semi >= 0 ? semi + 1 : j + 1;
      continue;
    }
    if (c === 'L') {
      const semi = inner.indexOf(';', i);
      params.push(inner.slice(i, semi + 1));
      i = semi + 1;
      continue;
    }
    params.push(c);
    i++;
  }
  return { params, ret: s.slice(close + 1) };
}

/* ────────────────────────── 数据型积木 ────────────────────────── */

/** 一个 menu 字段的选项：{ value, label } */
function menuOption(value, label) {
  return label && label !== value ? { value, label } : value;
}

/** 取条目的中文名（没有就退回 id） */
function nameOf(entry, fallback) {
  return entry?.nameZh || entry?.nameEn || fallback;
}

/**
 * 物品积木：给玩家 %count 个 <该 mod 的某个物品>
 */
function giveItemBlock(ns, items, targetId, modName) {
  const options = items.map((it) => menuOption(`${it.ns || ns}:${it.id}`, nameOf(it, it.id)));
  const tpl = targetId === 'fabric-26.3'
    ? `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(
        net.minecraft.resources.Identifier.parse(%item)),
    %count);
player.getInventory().add(give);`
    : `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.get(
        net.minecraft.resources.ResourceLocation.parse(%item)),
    %count);
player.getInventory().add(give);`;
  return {
    id: `${ns}.item.give`,
    category: `${ns}-item`,
    shape: 'stack',
    label: `给玩家 %count 个物品`,
    icon: '🎁',
    description: `从 ${modName} 里挑一个物品给玩家。物品清单共 ${items.length} 种。`,
    inputs: [
      { name: 'count', kind: 'number', default: 1 },
    ],
    fields: [
      { name: 'item', kind: 'menu', options, default: options[0], string: true },
    ],
    java: { [targetId]: tpl },
  };
}

/**
 * 方块积木：把 %x,%y,%z 处的方块设为 <该 mod 的某个方块>
 */
function setBlockBlock(ns, blocks, targetId, modName) {
  const options = blocks.map((b) => menuOption(`${b.ns || ns}:${b.id}`, nameOf(b, b.id)));
  const tpl = targetId === 'fabric-26.3'
    ? `level.setBlock(
    new net.minecraft.core.BlockPos(%x, %y, %z),
    net.minecraft.core.registries.BuiltInRegistries.BLOCK.getValue(
        net.minecraft.resources.Identifier.parse(%block)).defaultBlockState(),
    3);`
    : `level.setBlock(
    new net.minecraft.core.BlockPos(%x, %y, %z),
    net.minecraft.core.registries.BuiltInRegistries.BLOCK.get(
        net.minecraft.resources.ResourceLocation.parse(%block)).defaultBlockState(),
    3);`;
  return {
    id: `${ns}.block.set`,
    category: `${ns}-block`,
    shape: 'stack',
    label: '把方块设为 %block',
    icon: '🧱',
    description: `从 ${modName} 里挑一个方块放到指定坐标。共 ${blocks.length} 种。`,
    inputs: [
      { name: 'x', kind: 'number', default: 0 },
      { name: 'y', kind: 'number', default: 64 },
      { name: 'z', kind: 'number', default: 0 },
    ],
    fields: [
      { name: 'block', kind: 'menu', options, default: options[0], string: true },
    ],
    java: { [targetId]: tpl },
  };
}

/**
 * 状态效果积木：给玩家施加 <效果> %ticks tick
 *
 * ⚠️ 26.3 的 MobEffectInstance 收的是 Holder<MobEffect>（不是 MobEffect），
 *    1.20.1 还是收 MobEffect —— 两边写法不一样，这里分开写。
 */
function applyEffectBlock(ns, effects, targetId, modName) {
  const options = effects.map((e) => menuOption(e.registryId || `${ns}:${e.id}`, nameOf(e, e.id)));
  const tpl = targetId === 'fabric-26.3'
    ? `net.minecraft.core.Holder<net.minecraft.world.effect.MobEffect> __eff =
    net.minecraft.core.registries.BuiltInRegistries.MOB_EFFECT
        .get(net.minecraft.resources.Identifier.parse(%effect))
        .orElseThrow(() -> new IllegalArgumentException("no such effect: " + %effect));
player.addEffect(new net.minecraft.world.effect.MobEffectInstance(__eff, %ticks));`
    : `net.minecraft.world.effect.MobEffect __eff =
    net.minecraft.core.registries.BuiltInRegistries.MOB_EFFECT
        .get(net.minecraft.resources.ResourceLocation.parse(%effect));
player.addEffect(new net.minecraft.world.effect.MobEffectInstance(__eff, %ticks));`;
  return {
    id: `${ns}.effect.apply`,
    category: `${ns}-effect`,
    shape: 'stack',
    label: '给玩家施加 %effect',
    icon: '☠',
    description: `从 ${modName} 里挑一个状态效果给玩家。共 ${effects.length} 种。`,
    inputs: [
      { name: 'ticks', kind: 'number', default: 200 },
    ],
    fields: [
      { name: 'effect', kind: 'menu', options, default: options[0], string: true },
    ],
    java: { [targetId]: tpl },
  };
}

/* ────────────────────────── 行为型积木 ────────────────────────── */

/** class 文件里的访问标志 */
const ACC_PUBLIC = 0x0001;
const ACC_STATIC = 0x0008;
const ACC_SYNTHETIC = 0x1000;
const ACC_BRIDGE = 0x0040;

/**
 * 把一个 public static 方法变成积木。
 * @returns {object|null} 参数类型映射不了就返回 null
 */
function methodToBlock(clsName, clsSimple, m, ns, targetId, modName) {
  const { params, ret } = parseMethodDesc(m.desc);
  if (!params.length) return null; // 无参方法没什么可配的
  if (!['V', 'Z', 'I', 'J', 'F', 'D'].includes(ret)) return null;

  const inputs = [];
  const args = [];
  let idx = 0;
  let nNum = 0;
  let nFlag = 0;
  let nText = 0;
  let ctxCount = 0;
  for (const p of params) {
    idx++;
    const prim = PRIMITIVES[p];
    if (prim) {
      // 参数名按类型起一个能看懂的（界面上显示的是这个）
      let name;
      if (prim.kind === 'boolean') name = `flag${++nFlag}`;
      else if (prim.kind === 'text') name = `text${++nText}`;
      else name = `num${++nNum}`;
      inputs.push({ name, kind: prim.kind, default: prim.def });
      args.push(`%${name}`);
      continue;
    }
    const ctx = CONTEXT_VARS.find((c) => c.desc === p);
    if (ctx) {
      args.push(ctx.expr);
      ctxCount++;
      continue;
    }
    // 映射不了的类型 —— 整条方法都不要，宁缺毋滥
    return null;
  }

  const sig = `${clsName}.${m.name}(${args.join(', ')})`;
  const call = ret === 'V' ? `${sig};` : `(${sig});`;

  let desc = `调用 ${modName} 的 ${clsSimple}.${m.name}（${clsName}）。`;
  if (ctxCount >= 2) {
    desc += ' 实体 / 世界参数统一用「当前玩家」和「所在世界」代入。';
  }

  return {
    id: `${ns}.api.${clsSimple}.${m.name}`,
    category: `${ns}-api`,
    shape: ret === 'V' ? 'stack' : 'reporter',
    label: m.name,
    icon: '⚙',
    description: desc,
    inputs,
    fields: [],
    java: { [targetId]: call },
    // mod 的 API 会随版本变 —— 这类积木没法在通用工程里验证
    unverified: true,
  };
}

/** 包的「有用程度」排序：工具类最有用，接口常量最没用 */
const PKG_PRIORITY = [
  { re: /(^|\/)utils?(\/|$)/i, rank: 0 },
  { re: /(^|\/)api(\/|$)/i, rank: 2 },
  { re: /(^|\/)spells?(\/|$)/i, rank: 1 },
  { re: /(^|\/)commands?(\/|$)/i, rank: 1 },
  { re: /(^|\/)helpers?(\/|$)/i, rank: 1 },
  { re: /(^|\/)managers?(\/|$)/i, rank: 2 },
  { re: /(^|\/)effects?(\/|$)/i, rank: 3 },
];

/** 给类算一个排序分（小的先用） */
function classRank(path) {
  for (const p of PKG_PRIORITY) {
    if (p.re.test(path)) return p.rank;
  }
  return 5;
}

/**
 * 扫一个 jar，找出可以变成积木的 public static 方法。
 *
 * 只扫「像工具类」的包（util / helper / api / spell / command / manager / effect），
 * 别的包（实体、界面、网络）扫出来也没法用。
 *
 * @param {object} src openSource() 出来的源
 * @param {object} opts
 * @returns {{blocks:object[], scanned:number, skipped:number, notes:string[]}}
 */
export function scanApiBlocks(src, opts = {}) {
  const ns = opts.ns || 'mod';
  const targetId = opts.targetId || 'fabric-26.3';
  const modName = opts.modName || ns;
  const limit = opts.limit || 200;
  const maxPerClass = opts.maxPerClass || 14;
  const pkgRe = /(^|\/)(util|utils|helper|helpers|api|spell|spells|command|commands|manager|effect|effects)(\/|$)/i;

  const blocks = [];
  const notes = [];
  const seenIds = new Set();
  let scanned = 0;
  let skipped = 0;

  const names = (src?.allNames || []).filter((n) => n.endsWith('.class') && !n.includes('$'));
  const classes = names
    .filter((n) => pkgRe.test(n))
    // 工具类优先 —— 先把最有用的那批导出来，别被后面的挤掉
    .sort((a, b) => classRank(a) - classRank(b) || a.localeCompare(b));

  for (const path of classes) {
    if (blocks.length >= limit) break;
    let cls;
    try {
      cls = parseClass(src.read(path));
    } catch {
      continue;
    }
    const clsName = path.replace(/\//g, '.').replace(/\.class$/, '');
    const clsSimple = path.split('/').pop().replace(/\.class$/, '');
    let made = 0;
    for (const m of cls.methods || []) {
      if (made >= maxPerClass) break;
      if (!(m.access & ACC_PUBLIC) || !(m.access & ACC_STATIC)) continue;
      if (m.access & (ACC_SYNTHETIC | ACC_BRIDGE)) continue;
      if (m.name === '<init>' || m.name === '<clinit>') continue;
      if (m.name.startsWith('lambda$')) continue;
      scanned++;
      const b = methodToBlock(clsName, clsSimple, m, ns, targetId, modName);
      if (!b) { skipped++; continue; }
      if (seenIds.has(b.id)) continue;
      // 重载（同名不同参）用参数个数区分
      let id = b.id;
      let k = 2;
      while (seenIds.has(id)) id = `${b.id}_${k++}`;
      b.id = id;
      seenIds.add(id);
      blocks.push(b);
      made++;
    }
  }

  if (skipped) notes.push(`${skipped} 个方法的参数类型映射不了（需要 mod 特有类型），已跳过`);
  if (blocks.length >= limit) notes.push(`只导入了前 ${limit} 条 API 积木`);

  return { blocks, scanned, skipped, notes };
}

/* ────────────────────────── 库组装 ────────────────────────── */

/**
 * 把分析报告变成一个积木库。
 *
 * @param {object} report analyze() 的结果
 * @param {object} [opts]
 * @param {string} [opts.targetId] 强制用某个目标（默认按 mod 的加载器推）
 * @param {boolean} [opts.withApi] 是否扫行为型积木（默认 true）
 * @returns {{library:object, warnings:string[], target:string|null}}
 */
export function libraryFromReport(report, opts = {}) {
  const meta = report?.meta || {};
  const ns = report?.mainNs || meta.id || 'mod';
  const modName = meta.name || meta.id || ns;
  const warnings = [];

  const auto = targetOfMod(meta);
  let targetId = opts.targetId || auto?.id || null;
  let how = auto?.how || '';

  // 元数据没说清 → 用「引用的 MC 类在目标 jar 里存不存在」实测
  if (!targetId && report?.__src) {
    const guess = detectTargetByApi(report.__src);
    if (guess) {
      targetId = guess.id;
      how = `实测：mod 引用的 ${guess.matched}/${guess.total} 个 MC 类在 ${guess.label} 里能找到`;
    }
  }
  if (!targetId) {
    warnings.push(
      `没认出这个 mod 对应哪个目标（加载器 ${meta.loader || '未知'}，MC ${meta.mcVersion || '未知'}），` +
      '数据型积木没有生成模板（你可以在导出的库里手工补 java 字段）',
    );
  }

  const contents = report?.contents || {};
  const blocks = [];
  const categories = [];

  const items = (contents.item || []).filter((e) => e && e.id);
  const blocksList = (contents.block || []).filter((e) => e && e.id);
  // 状态效果：扩展分析器给的是带 registryId 的条目；
  // 核心分析器的 lang 效果只是一串 id（甚至只是字符串），这里统一成一种形状。
  const effectList = [
    ...(contents.statusEffect || []),
    ...(report?.effects || []),
  ]
    .map((e) => (typeof e === 'string' ? { id: e, registryId: `${ns}:${e}` } : e))
    .filter((e) => e && (e.registryId || e.id));

  if (targetId) {
    if (items.length) {
      blocks.push(giveItemBlock(ns, items, targetId, modName));
      categories.push({ id: `${ns}-item`, label: `${modName} · 物品`, icon: '🎁', color: '#3d8bd4' });
    }
    if (blocksList.length) {
      blocks.push(setBlockBlock(ns, blocksList, targetId, modName));
      categories.push({ id: `${ns}-block`, label: `${modName} · 方块`, icon: '🧱', color: '#8a63c4' });
    }
    if (effectList.length) {
      blocks.push(applyEffectBlock(ns, effectList, targetId, modName));
      categories.push({ id: `${ns}-effect`, label: `${modName} · 状态效果`, icon: '☠', color: '#c25f3d' });
    }
  }

  // 行为型积木
  if (opts.withApi !== false && targetId && report?.__src) {
    const r = scanApiBlocks(report.__src, { ns, targetId, modName, limit: opts.apiLimit });
    blocks.push(...r.blocks);
    if (r.blocks.length) {
      categories.push({ id: `${ns}-api`, label: `${modName} · 可调用的功能`, icon: '⚙', color: '#5a6472' });
    }
    warnings.push(...r.notes);
    warnings.push(`行为型积木 ${r.blocks.length} 条（扫了 ${r.scanned} 个方法，跳过 ${r.skipped} 个）`);
  }

  // mod 专属积木包：手工写的「积木级」语义，比通用扫描对小朋友友好得多
  if (opts.withPack !== false && targetId && isGoety(report)) {
    const pack = goetyPack({ targetId, report });
    blocks.push(...pack.blocks);
    categories.push(...pack.categories);
    warnings.push(...pack.notes);
    warnings.push(`Goety 专属积木 ${pack.blocks.length} 条`);
  }

  const library = {
    format: LIB_FORMAT,
    version: LIB_VERSION,
    id: opts.id || `${ns}-blocks`,
    name: opts.name || `${modName} 积木库`,
    description: opts.description || `从 ${modName}（${meta.version || '未知版本'}）自动生成的积木库`,
    source: {
      type: 'mod',
      modId: meta.id || ns,
      modName,
      modVersion: meta.version || '',
      loader: meta.loader || '',
      mcVersion: meta.mcVersion || '',
      target: targetId,
      targetHow: how,
    },
    categories,
    blocks,
  };

  return { library, warnings, target: targetId };
}

/**
 * 直接从 jar 生成积木库。
 * @param {string} jarPath
 * @param {object} [opts]
 */
export function libraryFromJar(jarPath, opts = {}) {
  const report = analyze(jarPath, opts);
  try {
    return libraryFromReport(report, opts);
  } finally {
    closeReport(report);
  }
}
