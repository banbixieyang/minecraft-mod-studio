/**
 * 规则：外部 jar 依赖。
 *
 * jar 本身是二进制，转换器搬不动，也不该假装搬得动：
 * 一个 Forge mod 的 jar 放到 Fabric 工程里编译不过。明确列出来让人换版本。
 */
export const rule = {
  id: 'builtin.deps',
  label: '外部 jar 依赖',
  description: 'compileOnly 的本地 jar 列出目标加载器对应的版本要求',
  priority: 40,
  convert(ctx) {
    const items = [];
    const changes = {};
    for (const part of ctx.parts.filter((p) => p.kind === 'dep')) {
      items.push({
        id: part.id, kind: 'dep', label: part.label,
        status: 'manual', confidence: 0.4, rule: rule.id,
        notes: [`${part.data?.path || part.label}：jar 是二进制，不能自动换加载器。`],
        suggestion: `请找 ${ctx.to.label}（${ctx.to.platform} ${ctx.to.mcVersion}）版本的同一个 mod jar，替换 localDeps 后再构建。`,
      });
    }
    return { items, changes, notes: [] };
  },
};
