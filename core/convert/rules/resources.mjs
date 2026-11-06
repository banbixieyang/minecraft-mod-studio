/**
 * 规则：资源方言（1.20.1 复数目录 / 26.x 单数目录）。
 *
 * 路径与键名的对照是从 core/generator/resources.mjs 的 isLegacy 分支抄出来的，
 * 不是猜的。生成器本来就会按目标重新出资源，所以这里额外说清楚一件事：
 * 工程里的 entries 不用改，只有「包里手塞的 files」才需要动。
 */
const MODERN_TO_LEGACY = [
  { scope: '/data/', from: 'recipe/', to: 'recipes/' },
  { scope: '/data/', from: 'loot_table/', to: 'loot_tables/' },
  { scope: '/data/', from: 'tags/block/', to: 'tags/blocks/' },
  { scope: '/data/', from: 'tags/item/', to: 'tags/items/' },
  { scope: '/worldgen/', from: 'worldgen/feature/', to: 'worldgen/configured_feature/' },
  { scope: '/assets/', from: 'items/', to: 'models/item/' },
];

function pairsFor(toLegacy) {
  return toLegacy
    ? MODERN_TO_LEGACY
    : MODERN_TO_LEGACY.map((r) => ({ scope: r.scope, from: r.to, to: r.from }));
}

function mapPath(p, pairs) {
  let out = String(p);
  const applied = [];
  for (const r of pairs) {
    if (!out.includes(r.scope) || !out.includes(r.from)) continue;
    out = out.split(r.from).join(r.to);
    applied.push(`${r.from} → ${r.to}`);
  }
  return { path: out, applied };
}

/** 只在能确定文件类型的范围内换键名，避免把 JSON 里无关的 "type" 一起改坏。 */
function mapJson(text, p, toLegacy) {
  let out = String(text);
  const applied = [];
  const isLoot = /loot_table|loot_tables/.test(p);
  const isRecipe = /\/recipe\/|\/recipes\//.test(p);
  if (isLoot) {
    const a = toLegacy ? '"modifier":' : '"functions":';
    const b = toLegacy ? '"functions":' : '"modifier":';
    if (out.includes(a)) { out = out.split(a).join(b); applied.push(`${a} → ${b}`); }
    const c = toLegacy ? '"type": "minecraft:' : '"function": "minecraft:';
    const d = toLegacy ? '"function": "minecraft:' : '"type": "minecraft:';
    if (out.includes(c)) { out = out.split(c).join(d); applied.push(`${c} → ${d}`); }
  }
  if (isRecipe) {
    const a = toLegacy ? '"id":' : '"item":';
    const b = toLegacy ? '"item":' : '"id":';
    if (out.includes(a)) { out = out.split(a).join(b); applied.push(`配方结果 ${a} → ${b}`); }
  }
  return { content: out, applied };
}

export const rule = {
  id: 'builtin.resources',
  label: '资源方言',
  description: '复数/单数目录、战利品表键名、配方结果键名按目标版本改',
  priority: 60,
  convert(ctx) {
    const items = [];
    const changes = {};
    const toLegacy = ctx.to.features?.resourceFormat === '1.20.1';
    const fromLegacy = ctx.from.features?.resourceFormat === '1.20.1';
    if (toLegacy === fromLegacy) {
      return { items, changes, notes: ['两边资源方言一致，无需改路径'] };
    }
    const pairs = pairsFor(toLegacy);
    for (const part of ctx.parts.filter((p) => p.kind === 'file')) {
      const mapped = mapPath(part.path, pairs);
      const json = /\.json$/.test(part.path) ? mapJson(part.code, part.path, toLegacy) : { content: part.code, applied: [] };
      const applied = [...mapped.applied, ...json.applied];
      if (!applied.length) continue;
      changes[part.id] = { path: mapped.path, code: json.content };
      items.push({
        id: `${part.id}/dialect`, kind: 'file', label: part.path,
        status: 'adapted', confidence: 0.9, rule: rule.id,
        before: part.path, after: mapped.path,
        notes: applied,
        suggestion: '若这份文件来自分享包，应用后仍建议跑一次生成，让适配器按目标重出资源。',
      });
    }
    return { items, changes, notes: [] };
  },
};
