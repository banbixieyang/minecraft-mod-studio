/**
 * 用修复后的引擎重跑全量分析，并重新导出包。
 *
 * 跑法：node tools/reexport-packs.mjs
 *
 * 做三件事：
 *   1. 重新分析三个 Goety 系列的包，确认 class 解析 100% 成功
 *   2. 全选条目重导出包（保留原 id / name / desc），
 *      让新字段（sections / configFile / tomlPath）进包
 *   3. 打印条目数对比与新字段覆盖率
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, closeReport, reportToPack } from '../core/analyze/report.mjs';
import { serializePack } from '../core/library/pack.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE;
const IMPORTS = path.join(HOME, '.mcstudio', 'imports');
const PACKS = path.join(HOME, '.mcstudio', 'packs');

const targets = [
  {
    jar: 'GoetyRevelation-2.3.3fix.jar',
    packId: 'goety_revelation',
    name: 'Goety: Revelation 拆解包',
    desc: '完整拆解 87 条配方（含 160 条 Goety 自定义仪式/熔炉配方）、9 个聚晶、5 条套装词条',
  },
  {
    jar: 'goetydelight-1.5.0fix4-ea25f0e30c8f.jar',
    packId: 'goety_delight',
    name: 'Goety Delight 拆解包',
    desc: 'Goety Delight 拆解：163 物品 / 38 方块 / 157 配方 / 18 状态效果 / 5 附魔 / 33 条数值配置',
  },
  {
    jar: 'goety-2.5.55.4-6cb70c62f48c.jar',
    packId: 'goety_base',
    name: 'goety_base',
    desc: 'Goety 基础库拆解：112 个状态效果 / 125 个法术 / 1579 条数值配置',
    // 基础库包只装「效果/数值」这几组 —— 物品、方块、配方这些是主体内容，
    // 由 Revelation 包负责，不重复灌进来。
    only: ['statusEffect', 'spell', 'spellConfig', 'brewEffect', 'enchantment'],
  },
];

// 附属包文件名容易变，这里按前缀兜底匹配
function findJar(prefix) {
  if (!fs.existsSync(IMPORTS)) return null;
  const hit = fs.readdirSync(IMPORTS).find((f) => f.startsWith(prefix) && f.endsWith('.jar'));
  return hit ? path.join(IMPORTS, hit) : null;
}

function readOldPack(id) {
  const p = path.join(PACKS, `${id}.mcpkg.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

for (const t of targets) {
  const jarPath = t.jar.includes('Revelation')
    ? findJar('GoetyRevelation')
    : t.jar.includes('delight')
      ? findJar('goetydelight')
      : findJar('goety-2.5');
  if (!jarPath || !fs.existsSync(jarPath)) {
    console.log(`跳过 ${t.packId}：导入缓存里找不到 jar`);
    continue;
  }
  console.log(`\n========== ${t.packId} ==========`);
  console.log('源文件', path.basename(jarPath));
  const t0 = Date.now();
  const rep = analyze(jarPath);
  console.log('分析耗时', Date.now() - t0, 'ms');
  console.log('class 统计', JSON.stringify(rep.code.stats));

  // 全选要装的分组
  const sel = {};
  for (const [type, list] of Object.entries(rep.contents)) {
    if (!Array.isArray(list) || !list.length) continue;
    if (t.only && !t.only.includes(type)) continue;
    sel[type] = list.map((e) => e.id);
  }
  console.log('全选分组', Object.entries(sel).map(([k, v]) => `${k}:${v.length}`).join(' '));

  const old = readOldPack(t.packId);
  const pack = await reportToPack(rep, { contents: sel, withTextures: true }, {
    id: t.packId,
    name: t.name,
    desc: t.desc,
  });

  // 保留原包里的 author / tags / requires 等人工填的元信息
  if (old) {
    pack.author = old.author || pack.author;
    pack.tags = old.tags || pack.tags;
    pack.kind = old.kind || pack.kind;
  }

  // 校验：条目数必须和旧包一致
  const oldCounts = {};
  for (const [k, v] of Object.entries(old?.content?.entries || {})) oldCounts[k] = (v || []).length;
  const newCounts = {};
  for (const [k, v] of Object.entries(pack.content.entries || {})) newCounts[k] = (v || []).length;
  const diffs = [];
  for (const k of new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)])) {
    if ((oldCounts[k] || 0) !== (newCounts[k] || 0)) diffs.push(`${k}: ${oldCounts[k] || 0} → ${newCounts[k] || 0}`);
  }
  console.log(diffs.length ? '条目数差异: ' + diffs.join('; ') : '条目数与旧包一致 ✓');

  // 抽查新字段是否进来了
  const cfg = pack.content.entries.spellConfig || [];
  const sample = cfg.find((e) => e.tomlPath && e.configFile) || cfg[0];
  if (sample) {
    console.log('spellConfig 样例:', JSON.stringify({
      id: sample.id, value: sample.value, min: sample.min, max: sample.max,
      sections: sample.sections, configFile: sample.configFile, tomlPath: sample.tomlPath,
    }));
    const withToml = cfg.filter((e) => e.tomlPath).length;
    const withFile = cfg.filter((e) => e.configFile).length;
    console.log(`spellConfig 带 tomlPath 的 ${withToml}/${cfg.length}，带 configFile 的 ${withFile}/${cfg.length}`);
    const byFile = {};
    for (const e of cfg) {
      const k = e.configFile || '(无)';
      byFile[k] = (byFile[k] || 0) + 1;
    }
    console.log('按配置文件分布', JSON.stringify(byFile));
  }

  fs.writeFileSync(path.join(PACKS, `${t.packId}.mcpkg.json`), serializePack(pack), 'utf8');
  console.log(`已写入 ${path.join(PACKS, `${t.packId}.mcpkg.json`)}（${(fs.statSync(path.join(PACKS, `${t.packId}.mcpkg.json`)).size / 1024).toFixed(0)} KB）`);

  closeReport(rep);
}
