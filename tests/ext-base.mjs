/**
 * Goety 基础库扩展测试（纯核心，不经 HTTP）。
 * 验证：扩展命中、状态效果/法术/配置/酿造/附魔都被拆出来、数值正确。
 */
import assert from 'node:assert';
import { analyze } from '../core/analyze/report.mjs';
import { reportToPack } from '../core/analyze/report.mjs';
import { validatePack } from '../core/library/pack.mjs';

const JAR = 'C:\\Users\\Lenovo\\.mcstudio\\imports\\goety-2.5.55.4-6cb70c62f48c.jar';

let pass = 0;
const fails = [];
// 断言函数可以是 async —— reportToPack 现在是异步的（要走导出钩子）
async function t(name, fn) {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '→', e.message); fails.push(name); }
}

console.log('\n=== 分析 Goety 基础库 ===');
const t0 = Date.now();
const report = analyze(JAR);
console.log(`  耗时 ${Date.now() - t0}ms，扩展：${(report.extensions || []).join(', ')}`);

await t('扩展已激活', async () => {
  assert.ok((report.extensions || []).includes('goety-base'), 'goety-base 未激活');
});

await t('状态效果 >= 80 条', async () => {
  const n = (report.contents.statusEffect || []).length;
  console.log('    状态效果:', n);
  assert.ok(n >= 80, `只有 ${n} 条`);
});

await t('状态效果带中文名与说明', async () => {
  const sapped = (report.contents.statusEffect || []).find((e) => e.registryId === 'goety:sapped');
  assert.ok(sapped, '找不到 goety:sapped');
  assert.ok(sapped.nameZh.length > 0, '缺中文名');
  assert.ok(sapped.descriptionZh.includes('20%'), `说明里没有 20%：${sapped.descriptionZh}`);
  console.log(`    ${sapped.nameZh}：${sapped.descriptionZh}`);
});

await t('条目 id 全部合法（包校验要求小写/数字/下划线）', async () => {
  const bad = [];
  for (const [type, list] of Object.entries(report.contents)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) if (!/^[a-z0-9_]+$/.test(e.id)) bad.push(`${type}:${e.id}`);
  }
  assert.strictEqual(bad.length, 0, `非法 id ${bad.length} 个：${bad.slice(0, 5).join(', ')}`);
});

await t('条目 id 无重复', async () => {
  for (const [type, list] of Object.entries(report.contents)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    for (const e of list) {
      assert.ok(!seen.has(e.id), `${type} 里 id 重复：${e.id}`);
      seen.add(e.id);
    }
  }
});

await t('法术 >= 110 条', async () => {
  const n = (report.contents.spell || []).length;
  console.log('    法术:', n);
  assert.ok(n >= 110, `只有 ${n} 条`);
});

await t('法术带学派', async () => {
  const withSchool = (report.contents.spell || []).filter((s) => s.school);
  console.log('    有学派的法术:', withSchool.length);
  assert.ok(withSchool.length >= 100, `只有 ${withSchool.length} 条有学派`);
  const schools = [...new Set(withSchool.map((s) => s.school))].sort();
  console.log('    学派:', schools.join(', '));
  assert.ok(schools.length >= 9, `学派只有 ${schools.length} 个`);
});

await t('法术数值来自 SpellConfig', async () => {
  const mb = (report.contents.spell || []).find((s) => s.id === 'magic_bolt');
  assert.ok(mb, '找不到 magic_bolt');
  console.log(`    ${mb.nameZh}：耗蓝 ${mb.soulCost}，吟唱 ${mb.castDuration}，冷却 ${mb.cooldown}`);
  assert.ok(mb.soulCost !== null, '灵魂消耗为 null');
  assert.ok(mb.castDuration !== null, '吟唱时长为 null');
});

await t('数值配置 >= 1200 条', async () => {
  const n = (report.contents.spellConfig || []).length;
  console.log('    数值配置:', n);
  assert.ok(n >= 1200, `只有 ${n} 条`);
});

await t('数值配置带默认值与范围', async () => {
  const vex = (report.contents.spellConfig || []).find((e) => e.path === 'vexCost' && e.group === 'SpellConfig');
  assert.ok(vex, '找不到 SpellConfig.vexCost');
  console.log(`    ${vex.id} = ${vex.value}（${vex.min}~${vex.max}）«${vex.comment}»`);
  assert.strictEqual(vex.value, 18);
  assert.strictEqual(vex.min, 0);
});

await t('数值配置覆盖多个分组', async () => {
  const groups = [...new Set((report.contents.spellConfig || []).map((e) => e.group))].sort();
  console.log('    分组:', groups.join(', '));
  assert.ok(groups.length >= 5, `只有 ${groups.length} 个分组`);
});

await t('酿造效果 >= 15 条', async () => {
  const n = (report.contents.brewEffect || []).length;
  console.log('    酿造效果:', n);
  assert.ok(n >= 15, `只有 ${n} 条`);
});

await t('附魔 >= 7 条', async () => {
  const n = (report.contents.enchantment || []).length;
  console.log('    附魔:', n);
  assert.ok(n >= 7, `只有 ${n} 条`);
  const potency = (report.contents.enchantment || []).find((e) => e.id === 'potency');
  assert.ok(potency && potency.nameZh, '附魔 potency 缺中文名');
  console.log(`    ${potency.nameZh}：${potency.descriptionZh}`);
});

await t('overrides 能改数值并随包导出', async () => {
  const vex = (report.contents.spellConfig || []).find((e) => e.path === 'vexCost' && e.group === 'SpellConfig');
  const sel = {
    contents: { spellConfig: [vex.id] },
  };
  const pack = await reportToPack(report, sel, {
    overrides: { spellConfig: { [vex.id]: { value: 3 } } },
  });
  const found = (pack.content.entries.spellConfig || []).find((e) => e.id === vex.id);
  assert.ok(found, '导出包里没有 vexCost');
  assert.strictEqual(found.value, 3, `值没改：${found.value}`);
  console.log(`    导出包里 ${vex.id} = ${found.value}`);
});

await t('没被选中的条目不进包', async () => {
  const vex = (report.contents.spellConfig || []).find((e) => e.path === 'vexCost' && e.group === 'SpellConfig');
  const pack = await reportToPack(report, { contents: { spellConfig: [vex.id] } }, {});
  const ids = (pack.content.entries.spellConfig || []).map((e) => e.id);
  assert.strictEqual(ids.length, 1, `包里有 ${ids.length} 条`);
});

await t('包整体校验通过', async () => {
  const pack = await reportToPack(report, {
    contents: {
      statusEffect: report.contents.statusEffect.map((e) => e.id),
      spell: report.contents.spell.map((e) => e.id),
      spellConfig: report.contents.spellConfig.map((e) => e.id),
      brewEffect: report.contents.brewEffect.map((e) => e.id),
      enchantment: report.contents.enchantment.map((e) => e.id),
    },
  }, {});
  pack.name = 'goety_base';
  const errs = validatePack(pack);
  assert.strictEqual(errs.length, 0, `校验失败：${errs.slice(0, 3).join('；')}`);
  console.log('    全量包校验通过');
});

console.log(`\n通过 ${pass}，失败 ${fails.length}${fails.length ? '：' + fails.join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
