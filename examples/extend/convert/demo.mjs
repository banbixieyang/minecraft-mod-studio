/**
 * 示例转换规则 —— 照着改就能加自己的映射。
 *
 * 放哪里（三选一，后面的覆盖前面同 id 的规则）：
 *   ~/.mcstudio/convert/<名字>.mjs
 *   <工程>/.studio/convert/<名字>.mjs
 *   MCSTUDIO_CONVERT=/path/to/dir
 *
 * 这个例子演示的是最常见的诉求：自己的工具类在 Fabric 和 Forge 下
 * 包名不一样，希望在转换时自动改掉，并给出一条「已改写」的报告项。
 *
 * ⚠️ 只有**两边确实等价**的符号才能自动改。拿不准就让它返回 manual，
 *    别假装转好了 —— 引擎的四档状态就是为了让用户看清哪里要自己动手。
 */
export const rule = {
  id: 'example.myapi',
  label: '示例：自己的 API 换包名',
  description: '演示规则契约：com.example.fabric.MyApi ↔ com.example.forge.MyApi',
  priority: 50,
  from: { platform: 'fabric' },
  to: { platform: 'forge' },

  convert(ctx) {
    const FROM = 'com.example.fabric.MyApi';
    const TO = 'com.example.forge.MyApi';
    const items = [];
    const changes = {};
    for (const part of ctx.parts.filter((p) => p.kind === 'java')) {
      if (ctx.from.platform === 'forge') {
        // 反向也能写：这里为了保持示例短，只演示 Fabric → Forge。
        continue;
      }
      if (!part.code.includes(FROM)) continue;
      changes[part.id] = { code: part.code.split(FROM).join(TO) };
      items.push({
        id: `${part.id}/myapi`, kind: 'java', label: '自己的 API 包名',
        status: 'adapted', confidence: 0.8, rule: rule.id,
        before: FROM, after: TO,
        notes: ['示例规则：请按你自己的类改名，并确认真编译过。'],
      });
    }
    return { items, changes, notes: [] };
  },
};
