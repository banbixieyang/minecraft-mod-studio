/**
 * 规则：积木程序 —— 天生跨平台。
 *
 * 编译器按目标挑模板，程序树本身不需要翻译。真正要检查的是：
 * 每条积木在目标下**有没有**实现（外部 mod 库往往只给了 Fabric 模板）。
 */
import { ensureBuiltin, loadLibraries } from '../../visual/registry.mjs';
import { getBlock, supportsTarget } from '../../visual/blocks.mjs';

function walkOps(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) { for (const n of node) walkOps(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.op) out.push(node.op);
  if (node.next) walkOps(node.next, out);
  for (const v of Object.values(node.inputs || {})) walkOps(v, out);
  for (const key of ['body', 'elseBody', 'body2']) if (node[key]) walkOps(node[key], out);
  return out;
}

export const rule = {
  id: 'builtin.programs',
  label: '积木程序',
  description: '程序树按目标自动挑模板；逐条检查目标下是否有实现',
  priority: 55,
  convert(ctx) {
    ensureBuiltin();
    // 用户级积木库在全新进程里还没装 —— 不装会把外部库的积木误判成「目标没实现」。
    try { loadLibraries(); } catch { /* 库坏了不影响转换主流程 */ }
    const items = [];
    const changes = {};
    for (const part of ctx.parts.filter((p) => p.kind === 'program')) {
      const ops = [...new Set(walkOps(part.data))];
      const problems = [];
      for (const op of ops) {
        // 帽形积木本身没有 java 模板（签名在 SIGNATURES 里），跳过。
        if (String(op).startsWith('event.')) continue;
        if (!getBlock(op)) {
          problems.push({ op, reason: '当前没装这条积木（可能来自未安装的外部库）' });
          continue;
        }
        const s = supportsTarget(op, ctx.to.id);
        if (!s.ok) problems.push({ op, reason: s.reason });
      }
      if (problems.length) {
        items.push({
          id: part.id, kind: 'program', label: part.label,
          status: 'blocked', confidence: 0, rule: rule.id,
          notes: problems.map((p) => `${p.op}：${p.reason}`),
          suggestion: '给这些积木补目标平台模板（写一条自定义积木或扩展规则），再重新转换。',
        });
      } else {
        items.push({
          id: part.id, kind: 'program', label: part.label,
          status: 'ported', confidence: 1, rule: rule.id,
          notes: [`${ops.length} 种积木在 ${ctx.to.id} 下都有模板；程序树原样保留，编译器会按目标挑写法。`],
        });
      }
    }
    return { items, changes, notes: [] };
  },
};
