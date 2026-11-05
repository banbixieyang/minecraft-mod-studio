/**
 * 复用体系的回归测试：捕获 → 存库 → 安装 → 再安装（制造冲突）。
 *
 * 跑法：node tests/pack.mjs
 * 前置：projects/testmod 里已经有内容（node tests/smoke.mjs 会灌）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';
import { capturePack } from '../core/library/capture.mjs';
import { listPacks, savePack, getPack, exportPack } from '../core/library/store.mjs';
import { applyPack, previewApply } from '../core/library/apply.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'projects/testmod');
const DST = path.join(ROOT, 'projects/packtest');

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failed++;
};

// packtest 每次都要从空工程装起，否则上一轮留下的内容会让「空工程不该有改名」直接不成立。
// 清条目而不是删目录 —— 跑测试不该有破坏力。
if (fs.existsSync(path.join(DST, '.studio', 'project.json'))) {
  const fresh = P.loadProject(DST);
  fresh.entries = {};
  fresh.hooks = { java: [], js: [] };
  P.saveProject(DST, fresh);
}

// ---------------- 1. 捕获 ----------------
console.log('\n[1] 从 testmod 捕获一套');
const srcProject = P.loadProject(SRC);
const pack = capturePack(srcProject, {
  root: SRC,
  types: { item: ['ruby_sword'], recipe: ['ruby_sword'] },
  name: '红宝石剑（测试包）',
  desc: '回归测试用',
  tags: ['test'],
  params: [{ key: 'dmg', label: '伤害', type: 'number', default: 3 }],
});
const closured = Object.entries(pack.content.entries)
  .map(([k, v]) => `${k}:${v.map((e) => e.id).join(',')}`)
  .join(' ');
console.log('    闭包 →', closured);
ok(pack.content.entries.tier?.[0]?.id === 'ruby', '自动带上了被引用的 tier');
ok((pack.content.entries.item || []).some((e) => e.id === 'ruby'), '自动带上了 tier 引用的材料物品');
ok(pack.origin?.ns === 'testmod', '记录了来源命名空间');

// ---------------- 2. 存库 ----------------
console.log('\n[2] 存进包里');
const saved = savePack(DST, pack, 'project');
const listed = listPacks(DST).packs;
ok(listed.some((p) => p.id === saved.id), `库列表里能看到 ${saved.id}`);
ok(getPack(DST, saved.id)?.name === '红宝石剑（测试包）', '按 id 能取回来');
const exp = exportPack(DST, saved.id);
ok(exp.text.includes('mcstudio.pack'), '导出文本带格式标记');

// ---------------- 3. 安装 ----------------
console.log('\n[3] 装进空工程 packtest');
let dst = P.loadProject(DST);
const preview = previewApply(dst, saved);
console.log('    预演 →', JSON.stringify(preview.counts), '改名', preview.renames.length, '个');
ok(Object.keys(preview.counts).length === 3, '预演列出 3 类内容');

const r1 = applyPack(DST, dst, saved);
console.log('    安装 →', JSON.stringify(r1.added), '警告', r1.warnings.length, '条');
ok(dst.entries.item?.some((e) => e.id === 'ruby_sword'), '红宝石剑进工程了');
ok(dst.entries.tier?.some((e) => e.id === 'ruby'), 'tier 进工程了');
ok(r1.renames.length === 0, '空工程不该有改名');
const sw1 = dst.entries.item.find((e) => e.id === 'ruby_sword');
ok(sw1.tier === 'ruby', 'tier 引用仍然指向 ruby');

// 命名空间搬家：包里 tier 的 repairItems 原来是 testmod:ruby
const tier1 = dst.entries.tier.find((e) => e.id === 'ruby');
console.log('    tier.repairItems =', JSON.stringify(tier1.repairItems));
ok(
  (tier1.repairItems || []).every((v) => !v.startsWith('testmod:')),
  '命名空间从 testmod 搬到了 packtest',
);
ok((tier1.repairItems || []).includes('packtest:ruby'), 'repairItems 指向新命名空间');

// ---------------- 4. 再装一次（冲突） ----------------
console.log('\n[4] 再装一次，制造 id 冲突');
const r2 = applyPack(DST, dst, saved);
console.log('    改名 →', r2.renames.map((x) => `${x.type}:${x.from}→${x.to}`).join(' '));
ok(r2.renames.length > 0, '撞名后自动改名');
ok(dst.entries.item.filter((e) => e.id.startsWith('ruby_sword')).length === 2, '现在有两把剑');
const sw2 = dst.entries.item.find((e) => e.id !== 'ruby_sword' && e.id.startsWith('ruby_sword'));
console.log('    第二把：', sw2?.id, '| tier =', sw2?.tier);
ok(sw2 && sw2.tier !== undefined, '第二把剑也有 tier 引用');
ok(dst.entries.tier.some((e) => e.id === sw2.tier), `tier 引用 ${sw2?.tier} 在工程里存在（引用被同步改名）`);

const rec2 = dst.entries.recipe.filter((e) => e.id.startsWith('ruby_sword'));
const gridOf = (r) => (r.grid || []).filter((c) => c && !c.includes('minecraft:'));
console.log('    两份配方的材料：', rec2.map((r) => gridOf(r).join(',')).join(' | '));
const grids = rec2.map((r) => gridOf(r).join(','));
ok(grids[0] !== grids[1], '第二份配方的材料指向改名后的新材料，没有和第一份撞');

// ---------------- 5. 参数 ----------------
console.log('\n[5] 参数化');
const paramPack = capturePack(srcProject, {
  root: SRC,
  types: { item: ['ruby_sword'] },
  closure: 'strong',
  name: '参数化剑',
  params: [{ key: 'dmg', label: '伤害', type: 'number', default: 3 }],
});
paramPack.content.java = [{ target: 'items', name: '参数演示', code: '// 伤害={{dmg}} 名字={{  name  }}' }];
const r3 = applyPack(DST, dst, paramPack, { params: { dmg: 7.5 } });
const hook = dst.hooks.java.find((h) => h.fromPack === paramPack.id);
console.log('    渲染后的钩子代码：', JSON.stringify(hook?.code));
ok(hook && hook.code.includes('伤害=7.5'), '数字参数替换成功');
// 没定义也没给的参数，正确行为是「原样留着 + 报警」，不能静默吃掉
ok((r3.missingParams || []).includes('name'), '未定义的参数被记进 missingParams，会在界面提示');
console.log('    未填参数：', JSON.stringify(r3.missingParams));
ok(r3.java === 1, 'Java 钩子被登记');

P.saveProject(DST, dst);

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
