/**
 * 知识库回归测试：索引 → 检索 → 上下文预算 → 分析沉淀。
 *
 * 跑法：node tests/knowledge.mjs
 *
 * 用一个临时 MCSTUDIO_HOME，不往你真实的 ~/.mcstudio 里写东西。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// 必须在 import 业务模块之前设好 —— mcstudioHome() 每次调用都读 env
const TMP_HOME = path.join(os.tmpdir(), `mcstudio-kb-test-${Date.now()}`);
process.env.MCSTUDIO_HOME = TMP_HOME;
fs.mkdirSync(TMP_HOME, { recursive: true });

const K = await import('../core/knowledge/index.mjs');
const { reportToMarkdown, learnReport, removeDoc } = await import('../core/knowledge/learned.mjs');

let failed = 0;
const ok = (cond, msg, detail) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${detail ? `  → ${detail}` : ''}`);
  if (!cond) failed++;
};

// ---------------- 1. 索引 ----------------
console.log('\n[1] 扫知识源');
const list = K.listDocs();
console.log('    来源：', list.sources.map((s) => `${s.label}(${s.kind})`).join(' · '));
console.log('    统计：', JSON.stringify(list.stats.byCategory));
ok(list.docs.length > 0, '扫到了文档', `${list.docs.length} 篇`);
ok(list.docs.some((d) => d.category === '指南'), '有内置指南');
ok(list.docs.some((d) => d.category === '速查'), '有内置速查');
ok(list.docs.some((d) => d.category === '任务卡'), '有内置任务卡');
const hasExpert = list.sources.some((s) => s.kind === 'expert');
console.log(`    专家库：${hasExpert ? '已接入' : '未检测到（不影响功能）'}`);
ok(list.stats.sections > 30, '切出了足够多的章节', `${list.stats.sections} 节`);

// 代码块必须活着到检索层和渲染层。曾经围栏被摘掉、只留裸代码，
// 结果界面画不出代码块，AI 拿到的片段也看不出哪段是代码。
const codeDoc = K.getDoc('builtin/guides/01-从零到出jar') || K.listDocs().docs[0];
const codeSec = (codeDoc?.sections || []).find((s) => s.code?.length);
ok(Boolean(codeSec), '解析出了代码块', codeSec ? `${codeSec.heading}·${codeSec.code.length} 段` : '');
if (codeSec) {
  ok(codeSec.text.includes('```'), '章节正文保留了围栏（界面据此画代码块）');
  ok(codeSec.text.includes(codeSec.code[0].content.split('\n')[0]), '代码内容也在正文里（检索要找类名）');
}
// 语言标记：裸围栏是合法 markdown，但整个库里得有带语言的块，否则高亮和「问 AI」都少了信息
const anyLang = list.docs
  .map((d) => K.getDoc(d.id))
  .flatMap((d) => d?.sections || [])
  .some((s) => (s.code || []).some((c) => c.lang));
ok(anyLang, '代码块带了语言标记');

// id 唯一性：中文文件名被剥掉时，多篇会共用一个 id，byId 里前一篇被后一篇盖掉，
// 表现是「点目录里的 A，打开的是 B」。这条必须守住。
const idList = list.docs.map((d) => d.id);
const idDup = [...new Set(idList.filter((x, i) => idList.indexOf(x) !== i))];
ok(idDup.length === 0, '文档 id 不撞车', idDup.length ? idDup.join(' / ') : '');

// 打开任意一篇，内容得是它自己 —— 抽查速查和任务卡两类（同名前缀最容易撞）
for (const [pick, label] of [
  [(d) => d.category === '速查', '速查'],
  [(d) => d.category === '任务卡', '任务卡'],
]) {
  const group = list.docs.filter(pick);
  if (group.length < 2) continue;
  const a = K.getDoc(group[0].id);
  const b = K.getDoc(group[group.length - 1].id);
  ok(a && b && a.path !== b.path, `${label}两篇能分别打开`, a && b ? `${a.title} ≠ ${b.title}` : '取不到');
}

// ---------------- 2. 检索 ----------------
console.log('\n[2] 检索');
const cases = [
  { q: '注册物品', want: /注册|物品/ },
  { q: 'mixin 注入', want: /mixin/i },
  { q: '时运 掉落', want: /掉落|时运/ },
];
for (const c of cases) {
  const r = K.search(c.q, { limit: 5, preferPlatform: 'fabric' });
  const hit = r.hits[0];
  ok(Boolean(hit) && c.want.test(`${hit.title}${hit.heading}`), `「${c.q}」命中相关章节`, hit ? `${hit.title}·${hit.heading || '(整篇)'}` : '无结果');
}

// 平台权重：问 fabric 的事，不该把 spigot 排在前面
const pf = K.search('注册物品', { limit: 8, preferPlatform: 'fabric' });
const firstOther = pf.hits.findIndex((h) => h.platform && h.platform !== 'fabric');
const firstFabric = pf.hits.findIndex((h) => h.platform === 'fabric');
ok(firstFabric === 0, '平台权重生效：fabric 资料排第一');
if (firstOther > 0) ok(firstFabric < firstOther, '其它平台资料被压到后面');

// 空查询不炸
ok(K.search('').hits.length === 0, '空查询返回空');

// 标题命中：搜整篇的名字，那篇笔记的正文段也该被抬起来。
// 这里用「内部 关键词」跨段查询来验 —— 光靠章节标题，第二段起是拿不到加权的。
const t1 = K.search('踩坑清单', { limit: 6, preferPlatform: 'fabric' });
ok(t1.hits[0]?.title.includes('踩坑'), '标题命中排第一', t1.hits[0]?.title);

// 多样性：同一篇最多占 3 条，且第 2 条开始要打折，不能前三条全是同一篇
const div = K.search('踩坑清单', { limit: 6, preferPlatform: 'fabric' });
const sameDoc = div.hits.filter((h) => h.docId === div.hits[0].docId);
ok(sameDoc.length <= 3, '同一篇最多 3 段');
ok(
  sameDoc.length < 2 || sameDoc[1].score < sameDoc[0].score,
  '同篇第 2 段被打折',
  sameDoc.map((h) => h.score).join(' / '),
);

// ---------------- 2b. 多目标：Forge 资料要能被正确标平台并优先命中 ----------------
console.log('\n[2b] Forge 1.20.1 内置资料');
const forgeDocs = list.docs.filter((d) => d.platform === 'forge');
const fabricDocs = list.docs.filter((d) => d.platform === 'fabric');
ok(forgeDocs.length >= 4, `内置库有 ${forgeDocs.length} 篇标了 platform: forge`, forgeDocs.map((d) => d.title).join('、'));
ok(fabricDocs.length >= 10, `老的 26.3 文档仍标 fabric（${fabricDocs.length} 篇）`);
ok(forgeDocs.some((d) => d.category === '指南') && forgeDocs.some((d) => d.category === '速查')
  && forgeDocs.some((d) => d.category === '任务卡'), 'Forge 指南 / 速查 / 任务卡齐全');
const fh = K.search('DeferredRegister 注册物品', { limit: 6, preferPlatform: 'forge' });
ok(fh.hits[0]?.platform === 'forge', 'Forge 工程优先命中 Forge 资料', fh.hits[0]?.title);
const forgeCtx = K.buildContext('Forge 注册物品怎么写', { limit: 3, budget: 3000, preferPlatform: 'forge' });
ok(forgeCtx.text.includes('平台 forge'), '上下文里标了资料平台，模型能分辨版本');

// ---------------- 3. 上下文预算 ----------------
console.log('\n[3] 拼上下文');
const ctx = K.buildContext('怎么给工具加时运', { budget: 1500, limit: 4, preferPlatform: 'fabric' });
ok(ctx.chars > 0, '拼出了内容', `${ctx.chars} 字符`);
ok(ctx.chars <= 1500 + 200, '没超出预算（允许少量头部开销）');
ok(ctx.sources.length > 0, '带了来源标注', `${ctx.sources.length} 条`);
ok(ctx.text.includes('【资料 1】'), '资料带编号，便于模型引用');

// ---------------- 4. 分析沉淀 ----------------
console.log('\n[4] 分析沉淀');
const fakeReport = {
  source: { path: 'C:/fake/example-mod-1.0.jar', name: 'example-mod' },
  meta: { id: 'examplemod', name: '示例模组', loader: 'fabric', mcVersion: '26.3', version: '1.0.0', authors: ['someone'] },
  mainNs: 'examplemod',
  counts: { item: 2, block: 1, recipe: 1, armorMaterial: 1, tier: 0 },
  contents: {
    item: [
      { id: 'ruby_sword', nameZh: '红宝石剑', kind: 'tool', toolType: 'sword' },
      { id: 'ruby', nameZh: '红宝石', kind: 'material' },
    ],
    block: [{ id: 'ruby_ore', nameZh: '红宝石矿石', kind: 'ore' }],
    recipe: [{ id: 'ruby_sword', mode: 'shaped', result: 'examplemod:ruby_sword' }],
    armorMaterial: [{ id: 'ruby' }],
    tier: [],
  },
  code: {
    stats: { classFiles: 12 },
    abilities: [
      { id: 'damage_hook', name: '伤害拦截', category: '战斗', confidence: 'high', packable: true, desc: '取消了部分伤害', evidence: ['ServerLivingEntityEvents.ALLOW_DAMAGE'] },
      { id: 'lifecycle', name: '定时任务', category: '技术', confidence: 'high', packable: true, desc: '每 tick 执行', evidence: ['ServerTickEvents'] },
    ],
    mixins: [{ config: 'examplemod.mixins.json', classes: ['A'], targets: [{ cls: 'net/minecraft/world/entity/projectile/AbstractArrow' }] }],
  },
  warnings: [],
};

const md = reportToMarkdown(fakeReport);
ok(md.text.includes('示例模组'), '笔记里带了 mod 名');
ok(md.text.includes('红宝石剑'), '笔记里列了内容');
ok(md.text.includes('伤害拦截'), '笔记里列了代码能力');
ok(/evidence: /.test(md.text), 'front matter 带证据等级');
ok(md.text.includes('属于事实') && md.text.includes('属于证据'), '把事实和证据分开写清楚了');
ok(/platform: fabric/.test(md.text), 'Fabric mod 的笔记标上了 platform');

// Forge 的 mods.toml 里 authors 常常是字符串，不是 fabric.mod.json 那种数组。
// 曾经因为直接 .join() 抛错，界面「存成笔记」返回 400 —— 分析别人的 mod
// 不能对元信息形状有任何假设。
const forgeMd = reportToMarkdown({
  ...fakeReport,
  meta: { ...fakeReport.meta, loader: 'forge', mcVersion: '1.20.1', authors: 'ForgeAuthor' },
});
ok(forgeMd.text.includes('ForgeAuthor'), 'authors 是字符串也能沉淀（Forge mods.toml）');
ok(/platform: forge/.test(forgeMd.text), 'Forge mod 的笔记标上 platform: forge');

const saved = learnReport(fakeReport);
console.log('    写入：', saved.path);
ok(fs.existsSync(saved.path), '笔记落盘了');
ok(saved.path.startsWith(TMP_HOME), '写进了临时 home，没污染真实目录');

// ---------------- 5. 沉淀能立刻被搜到 ----------------
console.log('\n[5] 沉淀可检索');
const after = K.listDocs();
ok(after.docs.some((d) => d.category === '学习记录'), '学习记录出现在目录里');
const sr = K.search('示例模组 伤害拦截', { limit: 5 });
ok(sr.hits.length > 0, '刚存的笔记能搜到');
ok(sr.hits[0].title.includes('示例模组'), '排在第一条');

// 删除
removeDoc(saved.id);
ok(!fs.existsSync(saved.path), '删除生效');
const afterDel = K.listDocs();
ok(!afterDel.docs.some((d) => d.id === saved.id), '删除后目录里也没了');

console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
