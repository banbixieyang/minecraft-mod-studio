/**
 * 「所有能改数据的地方都有入口」的机器化检查。
 *
 * 跑法：node tests/fields.mjs
 *
 * 做法不是读源码猜，而是**在生成时记录真实读取**：
 * 把每个条目包一层 Proxy，生成过程中读了哪个键就记一个。然后和
 * `modules/<id>/module.json` 里声明的表单字段比对，两个方向都卡：
 *
 *   1. 生成器读了、表单没声明 → 这是个「藏起来的旋钮」：数据能改，但界面改不到
 *   2. 表单声明了、生成器从不读 → 这是个「假旋钮」：改了没有任何效果
 *
 * 两个方向都要跑一遍目标（Fabric 26.3 / Forge 1.20.1），因为确实存在
 * 只有某个目标才会读的字段（比如 Forge 的挖掘等级 t.level）。
 *
 * 会写 projects/fieldstest-xxx 两个临时工程（和别的用例一样，不删）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';
import { collect } from '../core/generator/pipeline.mjs';
import { listContentTypes } from '../core/modules/registry.mjs';
import { getTarget } from '../core/target/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

const TARGETS = ['fabric-26.3', 'forge-1.20.1'];

// 条目上不该被当成「数据字段」的键：JS 内建与序列化探针
const IGNORE = new Set([
  'toString', 'valueOf', 'constructor', 'hasOwnProperty', 'toJSON',
  'then', 'catch', 'finally', 'length', 'name', 'prototype', '__proto__',
]);

// 这些键确实参与生成，但**不属于表单字段** —— 它们有自己的界面入口：
// visualPrograms 是「条目级积木程序」，在编辑面板的积木入口里改。
const NON_FIELD_KEYS = new Set(['visualPrograms']);

/** 给一个字段造一个「不为空」的样例值，尽量让生成分支真的走到 */
function sampleValue(f, ct) {
  const opts = (f.options || []).map((o) => (typeof o === 'string' ? o : o.value));
  switch (f.type) {
    case 'number': return 3;
    case 'checkbox': return true;
    case 'select': return opts[0] ?? '';
    case 'ref': return '';
    case 'list': return ['minecraft:stone'];
    case 'grid9': return ['minecraft:stone', '', '', '', '', '', '', '', ''];
    case 'drops': return [{ item: 'minecraft:stone', min: 1, max: 1, chance: 1 }];
    case 'texture':
    case 'textarea':
    case 'text': return 'probe';
    case 'id': return `probe_${ct.id}`;
    case 'multiselect': {
      const o = (f.options || []).slice(0, 2).map((x) => (typeof x === 'string' ? x : x.value));
      return o.length ? o : ['probe'];
    }
    default: return 'probe';
  }
}

/** 把条目包成 Proxy，记录所有被读取的字符串键 */
function tracked(obj, into) {
  return new Proxy(obj, {
    get(t, k, r) {
      if (typeof k === 'string' && !IGNORE.has(k)) into.add(k);
      return Reflect.get(t, k, r);
    },
    has(t, k) {
      if (typeof k === 'string' && !IGNORE.has(k)) into.add(k);
      return Reflect.has(t, k);
    },
  });
}

function ensureProject(dir, targetId) {
  if (P.isProject(dir)) return;
  const t = getTarget(targetId);
  P.createProject(dir, {
    name: `字段探针 ${targetId}`,
    id: `fieldprobe${targetId.replace(/[^a-z0-9]/gi, '')}`.toLowerCase(),
    pkg: `com.fieldprobe.${targetId.replace(/[^a-z0-9]/gi, '')}`.toLowerCase(),
    version: '0.1.0',
    platform: t?.platform || 'fabric',
    mcVersion: t?.mcVersion || '26.3',
    loaderVersion: t?.loaderVersion || '0.19.5',
    apiVersion: t?.apiVersion || '',
    javaVersion: t?.javaVersion || 25,
  });
}

// 有些分支是**两个字段一起决定的**（比如「工具 + 自定义材质」才读 tier），
// 一维扫描扫不到。这里把生成器真实存在的分支显式列出来；
// 生成器加了新分支，这里就补一条 —— 否则「假旋钮」检查会误报。
const SCENARIOS = {
  item: [
    { kind: 'tool', materialMode: 'custom', tier: 'probe_tier', toolType: 'sword' },
    { kind: 'tool', materialMode: 'preset', materialPreset: 'iron', toolType: 'pickaxe' },
    { kind: 'armor', materialMode: 'custom', armorMaterial: 'probe_mat', armorSlot: 'chestplate' },
    { kind: 'armor', materialMode: 'preset', armorSlot: 'boots' },
  ],
  advancement: [
    { parent: '', background: '' }, // 根节点
  ],
};

/**
 * 某些 select 的取值是**生成器里写死的分支**，可能比表单选项还多。
 * 这里按生成器实际支持的值扫一遍：扫到了、表单却没这个选项，
 * 就说明那条分支在界面上根本走不到（[3] 会报出来）。
 */
const SELECT_SWEEP = {
  recipe: {
    mode: ['shaped', 'shapeless', 'smelting', 'blasting', 'smoking', 'campfire', 'stonecutting', 'smithing'],
  },
};

const types = listContentTypes(ROOT).filter((ct) => (ct.fields || []).length);
console.log(`\n发现 ${types.length} 个内容类型：${types.map((t) => t.id).join(' / ')}`);

// typeId -> Set(被读取的键)，两个目标的并集
const consumed = new Map(types.map((ct) => [ct.id, new Set()]));

for (const targetId of TARGETS) {
  const dir = path.join(ROOT, 'projects', `fieldstest-${targetId.replace(/\./g, '-')}`);
  ensureProject(dir, targetId);

  for (const ct of types) {
    const base = P.loadProject(dir);
    // 每个类型单独探针：只放这一个类型的样例条目，避免别的类型读串
    const sample = {};
    for (const f of ct.fields) sample[f.key] = sampleValue(f, ct);
    const entry = tracked({ ...sample }, consumed.get(ct.id));

    // 多造几种条目，把条件分支都走到：
    //   · 每个 select 字段单独取它的每个选项（一维扫描，不做组合爆炸）
    //   · 所有文本类字段清空（走「根进度」「用默认值」这类分支）
    const variants = [entry];
    for (const f of ct.fields || []) {
      if (f.type === 'select') {
        for (const o of f.options || []) {
          const v = typeof o === 'string' ? o : o.value;
          variants.push(tracked({ ...sample, [f.key]: v }, consumed.get(ct.id)));
          // 工具/盔甲这类分支只有配套字段也填了才会进
          variants.push(tracked({
            ...sample, [f.key]: v, armorSlot: 'helmet', toolType: 'sword', tier: '', armorMaterial: '',
          }, consumed.get(ct.id)));
        }
      }
    }
    const blank = { ...sample };
    for (const f of ct.fields || []) {
      if (['text', 'textarea', 'ref', 'id'].includes(f.type)) blank[f.key] = '';
    }
    variants.push(tracked(blank, consumed.get(ct.id)));
    for (const over of SCENARIOS[ct.id] || []) {
      variants.push(tracked({ ...sample, ...over }, consumed.get(ct.id)));
    }
    // 生成器写死的分支值（可能比表单选项多）
    for (const [key, values] of Object.entries(SELECT_SWEEP[ct.id] || {})) {
      for (const v of values) {
        variants.push(tracked({ ...sample, [key]: v }, consumed.get(ct.id)));
      }
    }

    base.entries = { [ct.id]: variants };
    try {
      await collect(base, {});
    } catch (e) {
      ok(false, `${targetId} · ${ct.id} 生成探针抛错`, e.message);
    }
  }
}

console.log('\n[1] 生成器读到的键，表单里都有入口吗（藏起来的旋钮）');
for (const ct of types) {
  const declared = new Set((ct.fields || []).map((f) => f.key));
  const used = [...consumed.get(ct.id)]
    .filter((k) => !['__error'].includes(k) && !NON_FIELD_KEYS.has(k))
    .sort();
  const hidden = used.filter((k) => !declared.has(k));
  ok(hidden.length === 0, `${ct.label || ct.id}（${ct.id}）没有藏起来的字段`,
    hidden.length ? `缺：${hidden.join(', ')}` : `${used.length} 个字段全在表单里`);
}

console.log('\n[2] 表单里的字段，生成器真的读了吗（假旋钮）');
for (const ct of types) {
  const used = consumed.get(ct.id);
  const dead = (ct.fields || []).map((f) => f.key).filter((k) => !used.has(k));
  ok(dead.length === 0, `${ct.label || ct.id}（${ct.id}）没有白填的字段`,
    dead.length ? `没人读：${dead.join(', ')}` : '全部参与生成');
}

console.log('\n[3] 生成器支持的取值，界面上选得到吗（够不着的分支）');
for (const ct of types) {
  for (const [key, values] of Object.entries(SELECT_SWEEP[ct.id] || {})) {
    const f = (ct.fields || []).find((x) => x.key === key);
    const opts = new Set((f?.options || []).map((o) => (typeof o === 'string' ? o : o.value)));
    const missing = values.filter((v) => !opts.has(v));
    ok(missing.length === 0, `${ct.label || ct.id} 的「${f?.label || key}」覆盖生成器的全部分支`,
      missing.length ? `选不到：${missing.join(', ')}` : `${values.length} 种取值都能选`);
  }
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
