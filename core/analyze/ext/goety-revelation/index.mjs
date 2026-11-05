/**
 * Goety: Revelation 分析扩展。
 *
 * 基础引擎只认原版配方类型，会把 Goety 的自定义配方
 * （goety:ritual / goety:brazier / goety:cursed_infuser_recipes /
 *  minecraft:smithing_transform）整批跳过；另外 Goety 的「聚晶」「套装词条」
 * 是基础引擎不建模的内容。本扩展把这些都补回来，并让它们能在拆解台里单独查看、改数值、导出。
 */
import { readJson } from '../../sources.mjs';

/** 原版已支持、核心解析器已处理的配方类型 */
const CORE_RECIPE_TYPES = new Set([
  'crafting_shaped', 'crafting_shapeless',
  'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting',
]);

function pickId(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) { const r = pickId(x); if (r) return r; }
    return '';
  }
  if (typeof v === 'object') {
    if (v.item) return pickId(v.item);
    if (v.id) return pickId(v.id);
    if (v.tag) return `#${v.tag}`;
  }
  return '';
}

/**
 * 收集配方文件，按 id 去重。
 *
 * 两个坑都要处理：
 *  1. src.list 是递归的，Goety 在 recipes/irons_spellbooks/ 下还放了一份
 *     给「铁与血」用的兼容副本，同名 id 会重复。
 *  2. Goety 同时带 recipe/（单数）和 recipes/（复数）两个目录，内容互为镜像，
 *     不去重就会每条算两遍。
 * 所以：同一个 id 只留一份，优先留路径浅的（顶层那份），其余记为副本。
 */
function listRecipeFiles(src, ns) {
  const byId = new Map();
  let copies = 0;
  for (const dir of [`data/${ns}/recipe`, `data/${ns}/recipes`]) {
    let names = [];
    try { names = src.list(dir); } catch { continue; }
    for (const p of names) {
      if (!/\.json$/i.test(p)) continue;
      const id = p.split('/').pop().replace(/\.json$/, '');
      const depth = (p.match(/\//g) || []).length;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, { id, path: p, depth });
        continue;
      }
      copies++;
      if (depth < prev.depth) byId.set(id, { id, path: p, depth });
    }
  }
  return { files: [...byId.values()], copies };
}

export default {
  id: 'goety-revelation',
  name: 'Goety: Revelation 扩展',
  order: 10,
  match: (meta) => !!(meta && meta.id === 'goety_revelation'),

  contentTypes: {
    goetyRecipe: { label: '仪式/熔炉配方', icon: '⚗' },
    focus: { label: '聚晶', icon: '🔮' },
    setBonus: { label: '套装词条', icon: '🛡' },
  },

  // 拆解台里这些类型可编辑的字段（kind 与内置类型一致：text|int|num|bool）
  fields: {
    goetyRecipe: [
      { key: 'type', label: '类型', kind: 'text' },
      { key: 'result', label: '产物', kind: 'text' },
      { key: 'count', label: '数量', kind: 'int', min: 1, max: 64 },
    ],
    focus: [
      { key: 'nameZh', label: '名称(中)', kind: 'text' },
      { key: 'level', label: '等级', kind: 'int', min: 1, max: 99 },
    ],
    setBonus: [
      { key: 'nameZh', label: '套装名', kind: 'text' },
      { key: 'bonusLevel', label: '加成档位', kind: 'int', min: 1, max: 99 },
    ],
  },

  analyze(ctx) {
    const { src, mainNs, contents } = ctx;
    const warnings = [];
    const out = { goetyRecipe: [], focus: [], setBonus: [] };

    // ---------- 1. 配方：把全部类型都收进来（含原引擎跳过的自定义类型） ----------
    let recovered = 0;
    const { files: recipeFiles, copies } = listRecipeFiles(src, mainNs);
    for (const f of recipeFiles) {
      const json = readJson(src, f.path);
      if (!json) continue;
      const id = f.id;
      const type = String(json.type || '');
      const short = type.replace(/^minecraft:/, '').replace(/^goety:/, '');
      const result = pickId(json.result);
      const entry = {
        id,
        type: short,
        rawType: type,
        result: result || '',
        count: Number(json?.result?.count ?? json?.count ?? 1) || 1,
        coreHandled: CORE_RECIPE_TYPES.has(short),
      };
      if (!entry.coreHandled) recovered++;
      if (short === 'ritual') {
        if (json.uses != null) entry.uses = json.uses;
        if (json.sacrifice != null) entry.sacrifice = pickId(json.sacrifice);
      } else if (short === 'brazier') {
        if (json.input != null) entry.input = pickId(json.input);
      }
      out.goetyRecipe.push(entry);
    }
    if (recovered) warnings.push(`本扩展补回 ${recovered} 条 Goety 自定义配方（ritual/brazier 等），原引擎此前整批跳过`);
    if (copies) warnings.push(`另有 ${copies} 份同名配方副本（recipe/ 与 recipes/ 目录镜像、以及给其它 mod 的兼容副本），已按 id 合并`);

    // ---------- 2. 聚晶（物品 id 以 _focus 结尾） ----------
    for (const it of contents?.item || []) {
      if (!/_focus$/.test(it.id)) continue;
      out.focus.push({
        id: it.id,
        nameZh: it.nameZh || '',
        nameEn: it.nameEn || '',
        element: it.id.replace(/_focus$/, ''),
        level: 1,
      });
    }

    // ---------- 3. 套装词条（从盔甲材质派生，每套一条） ----------
    for (const m of contents?.armorMaterial || []) {
      out.setBonus.push({
        id: m.id,
        nameZh: (m.nameZh || m.id) + '套装',
        bonusLevel: 1,
        durability: m.durability,
      });
    }

    return { contents: out, warnings };
  },
};
