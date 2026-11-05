/**
 * 生成《Goety Delight 效果与数值预览》HTML 文档。
 *
 * 数据来源：~/.mcstudio/packs/goety_delight.mcpkg.json（拆解包）
 * 输出：mcstudio/GoetyDelight-效果与数值预览.html
 *
 * 跑法：node tools/gen-delight-preview.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HOME = process.env.HOME || process.env.USERPROFILE;
const PACK = path.join(HOME, '.mcstudio', 'packs', 'goety_delight.mcpkg.json');
const OUT = path.join(ROOT, 'GoetyDelight-效果与数值预览.html');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const E = pack.content.entries;

// ---------- 分组统计 ----------
const cfg = E.delightConfig || [];
const eff = E.delightEffect || [];
const ench = E.delightEnchant || [];
const drec = E.delightRecipe || [];
const core = E.recipe || [];

const recByType = {};
for (const r of drec) recByType[r.type] = (recByType[r.type] || 0) + 1;

// 数值配置按 toml 文件分组
const cfgByFile = {};
for (const c of cfg) {
  const f = c.configFile || '(未知)';
  (cfgByFile[f] = cfgByFile[f] || []).push(c);
}

// ---------- 表格片段 ----------
const cfgRows = cfg
  .slice()
  .sort((a, b) => (a.configFile || '').localeCompare(b.configFile || '') || String(a.tomlPath).localeCompare(String(b.tomlPath)))
  .map((c) => {
    const range = (c.min != null || c.max != null)
      ? `${c.min ?? '−∞'} ~ ${c.max ?? '∞'}`
      : '';
    return `<tr>
<td><code>${esc(c.tomlPath || c.id)}</code></td>
<td>${esc(c.configFile || '')}</td>
<td class="num">${esc(c.value)}</td>
<td class="num muted">${esc(range)}</td>
<td class="desc">${esc((c.comment || '').split('\n')[0])}</td>
</tr>`;
  }).join('\n');

const effRows = eff.map((e) => {
  const name = e.nameZh || e.nameEn || '';
  const derived = e.nameDerived ? ' <span class="tag-derived">名由类名推导</span>' : '';
  return `<tr>
<td>${esc(name)}${derived}</td>
<td><code>${esc(e.registryId)}</code></td>
<td class="mono-sm">${esc(e.class || '—')}</td>
<td class="desc">${esc(e.descriptionZh || e.descriptionEn || '')}</td>
</tr>`;
}).join('\n');

const enchRows = ench.map((e) => {
  const name = e.nameZh || e.nameEn || '';
  const derived = e.nameDerived ? ' <span class="tag-derived">名由类名推导</span>' : '';
  return `<tr>
<td>${esc(name)}${derived}</td>
<td><code>${esc(e.registryId)}</code></td>
<td class="num">${esc(e.maxLevel ?? '?')}</td>
<td class="mono-sm">${esc(e.class || '—')}</td>
</tr>`;
}).join('\n');

const REC_LABEL = {
  brewing: '酿造（酿造台）',
  ritual: '仪式（召唤祭坛）',
  cooking: '烹饪（锅）',
  cutting: '切割（砧板）',
  doll_entity_crafting: '玩偶实体合成',
  potion_amplifier: '药水增幅',
  recraft_boat_plate: '船板重铸',
  ten_thousand_poison_feast: '万毒盛宴',
};

const recSections = Object.entries(recByType)
  .sort((a, b) => b[1] - a[1])
  .map(([type, n]) => {
    const list = drec.filter((r) => r.type === type);
    const rows = list.map((r) => {
      const bits = [];
      if (r.soulCost != null) bits.push(`灵魂 ${r.soulCost}`);
      if (r.duration != null) bits.push(`耗时 ${r.duration} tick`);
      if (r.effect) bits.push(`效果 <code>${esc(r.effect)}</code>`);
      if (r.ingredient) bits.push(`原料 <code>${esc(r.ingredient)}</code>`);
      if (r.activationItem) bits.push(`触发 <code>${esc(r.activationItem)}</code>`);
      if (r.sacrifice) bits.push(`献祭 <code>${esc(r.sacrifice)}</code>`);
      if (r.craftType) bits.push(`类别 ${r.craftType}`);
      if (r.ritualType) bits.push(`仪式 <code>${esc(r.ritualType)}</code>`);
      const mats = (r.ingredients || []).length;
      if (mats) bits.push(`材料 ${mats} 种`);
      return `<tr>
<td><code>${esc(r.id.replace(/^[a-z]+_/, ''))}</code></td>
<td>${r.result ? `<code>${esc(r.result)}</code>` : '<span class="muted">—</span>'}</td>
<td class="num">${esc(r.count ?? 1)}</td>
<td class="desc">${bits.join(' · ')}</td>
</tr>`;
    }).join('\n');
    return `<h3 class="rec-h">${esc(REC_LABEL[type] || type)}<span class="c">${n} 条</span></h3>
<table class="tbl"><thead><tr><th>配方 id</th><th>产物</th><th>数量</th><th>关键参数</th></tr></thead>
<tbody>${rows}</tbody></table>`;
  }).join('\n');

const MODE_LABEL = {
  shaped: '有序合成',
  shapeless: '无序合成',
  smelting: '熔炼',
  smithing: '锻造台改配方',
  stonecutting: '切石机',
};

const coreRows = core.map((r) => {
  const mode = r.mode || '?';
  const bits = [];
  // 不同配方类型的字段不一样：有序合成有 grid，无序合成有 ingredients，
  // 熔炼有主料 + 经验，切石机有主料，锻造台是三件套 —— 逐类展开才看得懂。
  if (r.grid) {
    const g = r.grid;
    for (let row = 0; row < 3; row++) {
      const line = g.slice(row * 3, row * 3 + 3);
      if (line.some((c) => c)) bits.push(line.map((c) => (c ? `<code>${esc(c)}</code>` : '·')).join(' '));
    }
  }
  if (r.ingredients) bits.push(r.ingredients.map((m) => `<code>${esc(m)}</code>`).join(' + '));
  if (r.ingredient) bits.push(`主料 <code>${esc(r.ingredient)}</code>`);
  if (r.template) bits.push(`模板 <code>${esc(r.template)}</code>`);
  if (r.base) bits.push(`基底 <code>${esc(r.base)}</code>`);
  if (r.addition) bits.push(`添加 <code>${esc(r.addition)}</code>`);
  if (r.experience != null) bits.push(`经验 ${r.experience}`);
  if (r.cookingTime != null) bits.push(`耗时 ${r.cookingTime} tick`);
  return `<tr>
<td><code>${esc(r.id)}</code></td>
<td>${r.result ? `<code>${esc(r.result)}</code>` : '<span class="muted">—</span>'}</td>
<td class="num">${esc(r.count ?? 1)}</td>
<td class="mono-sm">${esc(MODE_LABEL[mode] || mode)}</td>
<td class="desc">${bits.join('<br>') || '<span class="muted">—</span>'}</td>
</tr>`;
}).join('\n');

// ---------- 文档 ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Goety Delight · 效果与数值拆解</title>
<style>
:root{
  --bg:#f2f3f7;--panel:#fff;--panel-2:#fafbfd;--border:#e2e5ed;--border-strong:#d0d5e0;
  --text:#1e2330;--text-2:#4b5263;--muted:#7b8494;--accent:#c2410c;--accent-soft:#fff2e8;
  --ok:#15a34a;--warn:#c97a06;--danger:#d92d20;
  --mono:ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  font-size:13.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:28px 22px 60px}
header{margin-bottom:22px}
h1{margin:0 0 6px;font-size:22px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0 26px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px;
  box-shadow:0 1px 2px rgba(20,25,40,.05)}
.card .k{font-size:11.5px;color:var(--muted);letter-spacing:.3px}
.card .v{font-size:26px;font-weight:650;margin-top:2px;letter-spacing:-.4px}
.card .n{font-size:11.5px;color:var(--text-2);margin-top:2px}
.note{background:var(--accent-soft);border:1px solid #f5d5bd;border-left:3px solid var(--accent);
  border-radius:8px;padding:12px 14px;margin:0 0 22px;font-size:13px;color:var(--text-2)}
.note b{color:var(--text)}
.note code{background:#fff;padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px}
h2{font-size:16px;margin:30px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--border)}
h3.rec-h{font-size:13.5px;margin:20px 0 8px;color:var(--text-2);font-weight:650}
h3.rec-h .c{display:inline-block;background:#f4f5f9;border:1px solid var(--border);
  border-radius:20px;padding:0 8px;font-size:11.5px;color:var(--muted);margin-left:4px;font-weight:500}
.hint{margin:-4px 0 10px;color:var(--muted);font-size:12.5px}
.tbl{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);
  border-radius:9px;overflow:hidden;font-size:12.5px;margin-bottom:8px}
.tbl th{background:var(--panel-2);text-align:left;font-weight:600;color:var(--text-2);
  padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap;font-size:12px}
.tbl td{padding:7px 10px;border-bottom:1px solid #f0f2f6;vertical-align:top}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#fcfcfe}
code{font-family:var(--mono);font-size:11.5px;background:#f4f5f9;
  padding:1px 5px;border-radius:4px;color:#b45309}
.num{text-align:right;font-family:var(--mono);white-space:nowrap}
.mono-sm{font-family:var(--mono);font-size:11.5px;color:var(--text-2)}
.desc{color:var(--text-2);max-width:520px}
.muted{color:var(--muted)}
.tag-derived{display:inline-block;background:#fef3c7;color:#92400e;border-radius:4px;
  padding:0 5px;font-size:11px;white-space:nowrap}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.tabs a{font-size:12.5px;text-decoration:none;color:var(--text-2);background:var(--panel);
  border:1px solid var(--border);border-radius:20px;padding:3px 11px}
.tabs a:hover{border-color:var(--accent);color:var(--accent)}
.footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--border);
  color:var(--muted);font-size:12px}
</style>
</head><body><div class="wrap">

<header>
  <h1>Goety Delight · 效果与数值拆解</h1>
  <div class="sub">附属包 <b>${esc(pack.id)}</b> · Goety Delight 1.5.0fix4（MC 1.20.1 / Forge）·
    拆解于 MC Studio 分析引擎 · 包内 ${Object.values(E).reduce((n, l) => n + l.length, 0)} 条内容</div>
</header>

<div class="cards">
  <div class="card"><div class="k">状态效果</div><div class="v">${eff.length}</div><div class="n">全部可改中文名</div></div>
  <div class="card"><div class="k">附魔</div><div class="v">${ench.length}</div><div class="n">带真实最大等级</div></div>
  <div class="card"><div class="k">数值配置</div><div class="v">${cfg.length}</div><div class="n">改值 → toml 覆写</div></div>
  <div class="card"><div class="k">自定义配方</div><div class="v">${drec.length}</div><div class="n">仪式 / 烹饪 / 酿造</div></div>
  <div class="card"><div class="k">核心配方</div><div class="v">${core.length}</div><div class="n">含子目录</div></div>
  <div class="card"><div class="k">物品 / 方块</div><div class="v">${(E.item || []).length} / ${(E.block || []).length}</div><div class="n">${(E.item || []).length} 物品 · ${(E.block || []).length} 方块</div></div>
</div>

<div class="note">
  <b>怎么改数值并让它真的生效：</b>
  在 MC Studio 的「分析 → 管理已导入 → 拆解」里打开本包，切到<b>数值配置</b>分组，
  找到条目改「数值」一栏 → 点<b>「预览生效产物」</b>，会看到要生成的
  <code>config/goetydelight-common.toml</code>、<code>GoetyDelightConfigOverrides.java</code> 和说明文档 →
  再点<b>「导出为包（存库）」</b>，这三份覆写产物会一起进包。装到工程后，
  <code>GoetyDelightConfigOverrides</code> 会在运行时改写对应配置项，toml 则直接覆盖配置文件。
</div>

<div class="tabs">
  <a href="#eff">状态效果</a>
  <a href="#ench">附魔</a>
  <a href="#cfg">数值配置</a>
  <a href="#rec">仪式/料理配方</a>
  <a href="#core">核心配方</a>
</div>

<h2 id="eff">① 状态效果（${eff.length}）</h2>
<div class="hint">数值配置与效果分离：效果的行为逻辑在 jar 的 class 里，强度/时长/等级多数走配置项改。</div>
<table class="tbl"><thead><tr><th>名称</th><th>注册表 id</th><th>实现类</th><th>说明</th></tr></thead>
<tbody>${effRows}</tbody></table>

<h2 id="ench">② 附魔（${ench.length}）</h2>
<div class="hint">最大等级直接从 class 的 <code>getMaxLevel()</code> 读出（重映射包里方法名不可读，靠特征识别）。</div>
<table class="tbl"><thead><tr><th>名称</th><th>注册表 id</th><th>最大等级</th><th>实现类</th></tr></thead>
<tbody>${enchRows}</tbody></table>

<h2 id="cfg">③ 数值配置（${cfg.length}）</h2>
<div class="hint">每条都带 <b>toml 路径</b>（改哪一格）与<b>所属配置文件</b>（改哪个文件），范围列是 Forge 配置里声明的上下界。</div>
<table class="tbl"><thead><tr><th>TOML 路径</th><th>配置文件</th><th>默认值</th><th>范围</th><th>上游注释</th></tr></thead>
<tbody>${cfgRows}</tbody></table>

<h2 id="rec">④ 仪式 / 料理配方（${drec.length}）</h2>
<div class="hint">核心引擎原本不认这些配方类型，由 <code>goety-delight</code> 扩展接管补回 —— 不改核心代码就能支持新 mod。</div>
${recSections}

<h2 id="core">⑤ 核心配方（${core.length}）</h2>
<div class="hint">原版那套（工作台 / 熔炉 / 锻造台…），Forge 生态按类型分子目录，这里已全部收齐。</div>
<table class="tbl"><thead><tr><th>配方 id</th><th>产物</th><th>数量</th><th>方式</th><th>材料</th></tr></thead>
<tbody>${coreRows}</tbody></table>

<div class="footer">
  由 MC Studio 分析引擎生成 · 数据来自 <code>${esc(pack.id)}.mcpkg.json</code> ·
  引擎侧扩展：<code>goety-delight</code>（match: modId = goetydelight）· 新增扩展需重启服务生效
</div>

</div></body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`已生成 ${OUT}（${kb} KB）`);
console.log(`  状态效果 ${eff.length} · 附魔 ${ench.length} · 数值配置 ${cfg.length} · 自定义配方 ${drec.length} · 核心配方 ${core.length}`);
console.log('  配方分类：', JSON.stringify(recByType));
console.log('  配置文件分布：', JSON.stringify(Object.fromEntries(Object.entries(cfgByFile).map(([k, v]) => [k, v.length]))));
