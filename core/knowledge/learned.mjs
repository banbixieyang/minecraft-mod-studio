/**
 * 把分析结果沉淀成知识文档。
 *
 * 为什么这件事值得单独做：分析器的输出是一次性的 —— 你看完关掉就没了。
 * 但「这个 mod 是怎么做吸血效果的」「它用了哪些 mixin」这类结论，
 * 下次做别的 mod 时还想再翻。所以落成 markdown，进知识库，
 * 搜索能搜到、AI 能引用。
 *
 * 落盘位置是用户级（~/.mcstudio/knowledge/learned/），不跟着工程走 ——
 * 分析的是别人的 mod，得到的是你自己的见识。
 *
 * 多目标之后的教训：不同加载器的元信息形状不一样。fabric.mod.json 的 authors
 * 是数组，Forge 的 mods.toml 里可能就是一个字符串。这里的输入是「别人写的 mod」，
 * 不能对形状有任何假设 —— 一律先过 asList()。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureWritableDir, learnedDir } from './sources.mjs';
import { invalidate, loadKnowledge } from './index.mjs';

const KNOWN_PLATFORMS = new Set(['fabric', 'forge', 'neoforge', 'paper', 'spigot']);

/** 元信息字段可能是数组、字符串、null；统一成数组再 .join / .map */
function asList(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function listBrief(list, pick = (x) => x.id, max = 24) {
  const ids = asList(list).map(pick).filter(Boolean);
  if (!ids.length) return '（无）';
  return ids.length > max ? `${ids.slice(0, max).join('、')} 等 ${ids.length} 项` : ids.join('、');
}

function table(rows) {
  const body = rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `| ${k} | ${v} |`);
  if (!body.length) return '';
  return ['| 项 | 值 |', '| --- | --- |', ...body].join('\n');
}

/**
 * 从分析报告生成一篇笔记。
 * 这里刻意把「事实」和「推断」分开写：资源反推出来的是事实，
 * 常量池推出来的是证据。混在一起写，下次读的人会当成同一回事。
 */
export function reportToMarkdown(report, opts = {}) {
  const m = report.meta || {};
  const c = report.contents || {};
  const counts = report.counts || {};
  const code = report.code || {};
  const abilities = asList(code.abilities);
  const mixins = asList(code.mixins);
  const now = new Date();

  const name = m.name || report.source?.name || '未知 mod';
  const modId = m.id || path.basename(report.source?.path || '', '.jar');
  // 分析的是 Forge mod，笔记就该标forge；问 Forge 的事时检索才会把它排前面。
  const loader = String(m.loader || '').toLowerCase();
  const platformLine = KNOWN_PLATFORMS.has(loader) ? `platform: ${loader}` : null;

  const facts = [
    ['mod id', modId],
    ['名称', m.name],
    ['加载器', m.loader],
    ['MC 版本', m.mcVersion],
    ['mod 版本', m.version],
    ['作者', asList(m.authors).join(', ')],
    ['分析对象', report.source?.path],
    ['分析时间', now.toISOString().slice(0, 19).replace('T', ' ')],
  ];

  const contentRows = Object.entries(counts)
    .filter(([, n]) => n)
    .map(([k, n]) => [`${k}`, n]);

  const byCat = new Map();
  for (const a of abilities) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }

  const abilityLines = [];
  for (const [cat, list] of byCat) {
    abilityLines.push(`### ${cat}`);
    for (const a of list) {
      const ev = asList(a.evidence).join('、');
      abilityLines.push(`- **${a.name}**${a.confidence === 'high' ? '（强证据）' : ''}：${a.desc || ''}${ev ? `  \\n  证据：\`${ev}\`` : ''}`);
    }
    abilityLines.push('');
  }

  const mixinLines = [];
  for (const m2 of mixins) {
    const targets = asList(m2.targets).map((t) => t.cls || t).join('、');
    mixinLines.push(`- \`${m2.config}\`：${asList(m2.classes).length} 个 mixin 类${targets ? `，最可能注入 ${targets}` : ''}`);
  }

  const parts = [
    '---',
    `title: ${name} 分析笔记`,
    'category: 学习记录',
    `tags: 分析, ${modId}, ${m.loader || 'unknown'}`,
    ...(platformLine ? [platformLine] : []),
    `evidence: 资源事实 + 代码证据`,
    `summary: 从 ${path.basename(report.source?.path || '')} 提取的内容与代码能力清单，可用于复用与借鉴。`,
    '---',
    '',
    `# ${name} 分析笔记`,
    '',
    '## 它是什么',
    '',
    table(facts),
    '',
    '## 内容规模（资源反推，事实）',
    '',
    contentRows.length ? ['| 类型 | 数量 |', '| --- | --- |', ...contentRows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n') : '（没读出内容，可能是纯逻辑 mod 或资源结构不常见）',
    '',
  ];

  if (c.item?.length) parts.push(`**物品**：${listBrief(c.item, (e) => `${e.id}${e.nameZh ? `(${e.nameZh})` : ''}`)}`, '');
  if (c.block?.length) parts.push(`**方块**：${listBrief(c.block)}`, '');
  if (c.recipe?.length) parts.push(`**配方**：${listBrief(c.recipe)}`, '');
  if (c.worldgen?.length) parts.push(`**世界生成**：${listBrief(c.worldgen, (e) => `${e.id}@${e.dimension || '?'}`)}`, '');
  if (c.armorMaterial?.length) parts.push(`**盔甲材质**：${listBrief(c.armorMaterial)}`, '');
  if (c.tier?.length) parts.push(`**工具材质**：${listBrief(c.tier)}`, '');

  parts.push('## 它做了哪些事（class 常量池推断，证据）', '');
  parts.push(abilityLines.length ? abilityLines.join('\n') : '（没识别出已知 API 调用）', '');

  if (mixinLines.length) {
    parts.push('## Mixin', '', ...mixinLines, '');
  }

  const usable = abilities.filter((a) => a.packable);
  if (usable.length) {
    parts.push(
      '## 可以直接复用的部分',
      '',
      '下面这些能力编辑器里有等价的可编译实现，勾选后就是一段能直接用的代码：',
      '',
      ...usable.map((a) => `- ${a.name}`),
      '',
    );
  }

  // 第三方发布包要写清「能读到什么」。否则以后检索到这篇笔记，
  // 很容易把「它引用了 ServerLivingEntityEvents」当成「拿到了它的吸血源码」。
  const p = report.packaging || {};
  const shape = [];
  if (p.signed) shape.push('带签名文件，是发布版 jar');
  if (p.obfuscation?.intermediary || p.obfuscation?.srg) shape.push('类名被重映射成 intermediary / SRG 名');
  if (p.javaSources) shape.push(`内含 ${p.javaSources} 个 .java 源码文件（sources jar，源码本来就能直接读）`);
  if (p.nestedJars?.length) shape.push(`内嵌 ${p.nestedJars.length} 个 jar（内容不在本报告的统计里，需要单独展开分析）`);
  if (shape.length) {
    parts.push('## 这个包是什么形态', '', ...shape.map((x) => `- ${x}`), '',
      '发布版 jar 只有 .class：下面的能力清单是常量池证据，**不等于**拿到了原作者的 Java 源码。', '');
  }

  parts.push(
    '## 读这份笔记要注意',
    '',
    '- 「内容规模」是读 jar 里的资源文件得到的，属于事实；',
    '- 「它做了哪些事」是读 class 常量池猜的，属于证据 —— 引用了某个 API 不等于逻辑就是这个意思，用之前翻一眼证据那一行；',
    '- 数值（耐久、防御、挖掘速度）写在 class 里读不出来，装备材质是按套装名推的默认值。',
    '',
  );

  return { text: parts.join('\n'), name, modId };
}

/**
 * 写进学习记录目录。
 * 同名会覆盖 —— 同一个 mod 反复分析，笔记该是最新那份，而不是攒一堆。
 */
export function learnReport(report, opts = {}) {
  const { text, name, modId } = reportToMarkdown(report, opts);
  const dir = ensureWritableDir('learned');
  const file = path.join(dir, `${slug(modId || name)}.md`);
  fs.writeFileSync(file, text, 'utf8');
  invalidate();
  return {
    path: file,
    id: `learned/${path.basename(file, '.md')}`,
    title: `${name} 分析笔记`,
  };
}

export function listLearned() {
  const dir = learnedDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { id: `learned/${f.replace(/\.md$/, '')}`, name: f, path: p, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** 删一篇文章。只允许删学习记录和自己写的笔记，内置和专家库动不了。 */
export function removeDoc(id) {
  const doc = loadKnowledge().byId.get(id);
  if (!doc) throw new Error('没找到这篇文档');
  if (doc.source !== 'learned' && doc.source !== 'user') throw new Error('内置和专家库的文档不能删');
  fs.rmSync(doc.path, { force: true });
  invalidate();
  return { removed: doc.path };
}
