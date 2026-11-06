/**
 * 规则：积木模板回填（证据等级最高）。
 *
 * 同一个 op 在 builtin.mjs 里有两份都真编译过的 Java 模板，
 * 那么把源写法整段换成目标写法是**有证据**的，可以标 ported。
 */
import { blockConcepts, matchBlockTemplates } from '../symbols.mjs';

export const rule = {
  id: 'builtin.blocks',
  label: '积木模板回填',
  description: '按积木库里两份真编译过的模板整段改写，参数原样带过去',
  priority: 100,
  convert(ctx) {
    const items = [];
    const changes = {};
    const concepts = blockConcepts(ctx.from.id, ctx.to.id);
    if (!concepts.length) {
      return { items: [{
        id: 'blocks/none', kind: 'java', label: '模板对照表',
        status: 'ported', confidence: 1,
        notes: [`${ctx.from.id} 与 ${ctx.to.id} 之间没有差异模板（或其中一个目标还没登记模板），跳过整段改写。`],
      }], notes: [] };
    }
    for (const part of ctx.parts.filter((p) => p.kind === 'java')) {
      const r = matchBlockTemplates(part.code, ctx.from.id, ctx.to.id, { concepts });
      if (!r.hits.length) continue;
      changes[part.id] = { code: r.code };
      for (const h of r.hits) {
        items.push({
          id: `${part.id}/${h.concept}`, kind: 'java', label: h.label,
          status: 'ported', confidence: 1, rule: rule.id,
          before: h.before, after: h.after,
          notes: [`命中 ${h.count} 处；依据 ${h.evidence}（两份模板都经 Gradle 真编译）`],
        });
      }
    }
    return { items, changes, notes: [`可用差异模板 ${concepts.length} 条`] };
  },
};
