/**
 * 扩展系统 + Goety 扩展 的纯核心测试（不经 HTTP）。
 * - 非 Goety 的包：扩展不应激活，分析照常。
 * - Goety 包：应自动激活扩展，补回自定义配方 + 聚晶 + 套装词条。
 * - 改数值导出：focus 的 level 能经 overrides 合并进包。
 */
import { analyze, reportToPack } from '../core/analyze/report.mjs';
import { EXTENSIONS, activeExtensions } from '../core/analyze/ext/index.mjs';

const FALLEN = 'C:/Users/Lenovo/WorkBuddy/2026-11-04-14-25-04/fallen/build/libs/fallen-0.1.0.jar';
const GOETY = 'C:/Users/Lenovo/Desktop/GoetyRevelation-2.3.3fix.jar';

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
};

// --- 扩展系统本身 ---
ok(Array.isArray(EXTENSIONS) && EXTENSIONS.length >= 1, `扩展已加载：${EXTENSIONS.map((e) => e.id).join(', ')}`);
ok(activeExtensions({ id: 'goety_revelation' }).some((e) => e.id === 'goety-revelation'), 'match() 命中 Goety 时激活扩展');
ok(activeExtensions({ id: 'another_mod' }).every((e) => e.id !== 'goety-revelation'), 'match() 不命中时不激活 Goety 扩展');

// --- 非 Goety 包不受影响 ---
const f = analyze(FALLEN);
ok(!f.extensions.includes('goety-revelation'), 'fallen 不激活 Goety 扩展');
ok(!f.counts.goetyRecipe && !f.counts.focus && !f.counts.setBonus, 'fallen 报告里没有扩展内容类型');
ok((f.counts.item || 0) > 0, `fallen 基础内容正常（物品 ${f.counts.item}）`);

// --- Goety 包激活扩展 ---
const g = analyze(GOETY);
ok(g.extensions.includes('goety-revelation'), 'Goety 激活了扩展');
ok(g.extensionTypes.goetyRecipe && g.extensionTypes.focus && g.extensionTypes.setBonus, '报告声明了 goetyRecipe/focus/setBonus 三种内容类型');
ok((g.counts.goetyRecipe || 0) > 13, `配方总数 ${g.counts.goetyRecipe}（核心只解析到 13 条原版，其余被扩展补回）`);

const custom = (g.contents.goetyRecipe || []).filter((r) => !r.coreHandled);
ok(custom.length > 50, `其中自定义配方（ritual/brazier 等）${custom.length} 条，之前整批被跳过`);
const types = new Set(custom.map((r) => r.type));
console.log('   自定义配方类型：', [...types].join(', '));

ok((g.counts.focus || 0) > 0, `聚晶 ${g.counts.focus} 条（按 _focus 物品识别）`);
ok((g.counts.setBonus || 0) === (g.counts.armorMaterial || 0), `套装词条 ${g.counts.setBonus} 条（与盔甲材质一一对应）`);

// --- 改数值导出：focus.level 经 overrides 合并 ---
const foci = g.contents.focus || [];
const oneFocus = foci[0];
const pack = await reportToPack(g, { contents: { focus: [oneFocus.id] } }, { overrides: { focus: { [oneFocus.id]: { level: 7 } } } });
const out = pack.content.entries.focus?.[0];
ok(out && out.level === 7, `聚晶 ${oneFocus.id} 的 level 被改成 7（导出值 ${out?.level}）`);

// goetyRecipe 也能改 result/count
const rec = g.contents.goetyRecipe.find((r) => r.result);
const rpack = await reportToPack(g, { contents: { goetyRecipe: [rec.id] } }, { overrides: { goetyRecipe: { [rec.id]: { count: 9 } } } });
const rout = rpack.content.entries.goetyRecipe?.[0];
ok(rout && rout.count === 9, `配方 ${rec.id} 数量改为 9（导出值 ${rout?.count}）`);

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
