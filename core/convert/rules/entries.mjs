/**
 * 规则：内容条目 + 适用范围。
 *
 * 关键结论：工程里的 entries 是**平台无关**的。生成器拿同一份条目，
 * 按目标适配器的 features 重新出 Java 和资源，所以条目本身不用翻译。
 * 只有少数「版本特有约束」需要调数值（26.x 的 worldgen.size 最小 4）。
 */
export const rule = {
  id: 'builtin.entries',
  label: '内容条目与适用范围',
  description: '条目保持原样由目标适配器重出资源；重写 requires，并修版本特有约束',
  priority: 55,
  convert(ctx) {
    const items = [];
    const changes = {};
    for (const part of ctx.parts.filter((p) => p.kind === 'entry')) {
      const d = part.data || {};
      const notes = [`${part.type} 条目由目标适配器重新生成 Java / 资源，数据本身无需改写。`];
      let status = 'ported';
      let confidence = 1;
      let patch = null;
      // 26.x 的矿石特征尺寸下限是 4；1.20.1 没这个约束。
      if (part.type === 'worldgen' && ctx.to.mcVersion !== '1.20.1' && Number(d.size) > 0 && Number(d.size) < 4) {
        patch = { ...d, size: 4 };
        status = 'adapted';
        confidence = 0.9;
        notes.push(`size ${d.size} → 4：26.x 的 worldgen 特征尺寸不能小于 4（见 project.mjs 的 lintReferences）。`);
      }
      items.push({ id: part.id, kind: 'entry', label: part.label, status, confidence, rule: rule.id, notes });
      if (patch) changes[part.id] = { data: patch };
    }

    const req = ctx.parts.find((p) => p.kind === 'requires');
    if (req) {
      const next = {
        ...(req.data || {}),
        platform: [ctx.to.platform],
        mcVersion: [ctx.to.mcVersion],
      };
      changes[req.id] = { data: next };
      items.push({
        id: req.id, kind: 'requires', label: '适用平台 / 版本',
        status: 'ported', confidence: 1, rule: rule.id,
        before: JSON.stringify({ platform: req.data?.platform, mcVersion: req.data?.mcVersion }),
        after: JSON.stringify({ platform: next.platform, mcVersion: next.mcVersion }),
        notes: ['适用范围已改成目标平台；mods / modules / contentTypes 原样保留。'],
      });
    }
    return { items, changes, notes: [] };
  },
};
