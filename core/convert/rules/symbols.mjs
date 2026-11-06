/**
 * 规则：低风险符号替换。
 *
 * 只动 SYMBOL_TABLE 里「两边一一对应、参数形状相同」的符号。
 * 加载器专属的事件/注册 API 不在这里动 —— 交给 events.mjs 标人工。
 */
import { applySymbolTable } from '../symbols.mjs';

export const rule = {
  id: 'builtin.symbols',
  label: 'API 符号替换',
  description: '类名 / 方法名的低风险等价替换（资源 id、注册表取值、发消息等）',
  priority: 90,
  convert(ctx) {
    const items = [];
    const changes = {};
    for (const part of ctx.parts.filter((p) => p.kind === 'java' || (p.kind === 'file' && /\.java$/.test(p.path)))) {
      const r = applySymbolTable(part.code, ctx.from.id, ctx.to.id);
      if (!r.changes.length) continue;
      changes[part.id] = { code: r.code };
      for (const c of r.changes) {
        items.push({
          id: `${part.id}/symbol/${c.concept}`, kind: part.kind, label: c.concept,
          status: 'adapted', confidence: 0.85, rule: rule.id,
          before: c.from, after: c.to,
          notes: [`替换 ${c.count} 处；依据 ${c.evidence}。建议生成后跑一次构建确认。`],
        });
      }
    }
    return { items, changes, notes: [] };
  },
};
