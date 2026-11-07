/**
 * 通用资源生成 —— assets/ 与 data/ 下的 JSON。
 *
 * 加载器之间大体共用一套资源包格式，但 **MC 版本之间不共用**：
 * 1.20.1 与 26.x 在物品模型定义、配方 result、战利品表函数名、
 * 标签目录单复数、世界生成目录与 ore target 形状上都不同。
 * 这里由 adapter.features.resourceFormat 选「方言」，不把差异散到适配器里。
 *
 * 加新版本时：先看 features 里声明了哪些差异，再在这里补分支；
 * 26.3 的默认路径逐字保持不变，老工程生成结果不会漂。
 */
import { toPascal } from '../ids.mjs';

const HANDHELD_TOOLS = new Set(['sword', 'pickaxe', 'axe', 'shovel', 'hoe']);

/** 1.20.1 及更早的资源格式；不传 adapter 时按 26.x 处理（老调用兼容） */
const isLegacy = (adapter) => adapter?.features?.resourceFormat === '1.20.1';

function j(obj) {
  return JSON.stringify(obj, null, 2);
}

/** 方块 id 集合，用来判断某个物品是不是方块物品 */
function blockIds(p) {
  return new Set((p.entries.block || []).map((b) => b.id));
}

// ============================================================
// assets
// ============================================================
export function genAssets(p, adapter) {
  const legacy = isLegacy(adapter);
  const ns = p.meta.id;
  const files = [];
  const add = (rel, content) => files.push({ path: `src/main/resources/assets/${ns}/${rel}`, content });

  const blocks = p.entries.block || [];
  const items = p.entries.item || [];
  const blockSet = blockIds(p);

  // ---- 物品模型 ----
  for (const it of items) {
    const isBlock = blockSet.has(it.id);
    const tt = String(it.toolType || '').toLowerCase();
    const parent = it.kind === 'tool' && HANDHELD_TOOLS.has(tt) ? 'minecraft:item/handheld' : 'minecraft:item/generated';
    if (legacy) {
      // 1.20.1 没有 assets/<ns>/items/ 这一层「物品模型定义」，模型直接写在 models/item/ 下
      if (!isBlock) add(`models/item/${it.id}.json`, j({ parent, textures: { layer0: `${ns}:item/${it.id}` } }));
    } else {
      add(
        `items/${it.id}.json`,
        j({ model: { type: 'minecraft:model', model: isBlock ? `${ns}:block/${it.id}` : `${ns}:item/${it.id}` } }),
      );
      if (!isBlock) add(`models/item/${it.id}.json`, j({ parent, textures: { layer0: `${ns}:item/${it.id}` } }));
    }
  }

  // ---- 方块模型与方块状态 ----
  for (const b of blocks) {
    add(`blockstates/${b.id}.json`, j({ variants: { '': { model: `${ns}:block/${b.id}` } } }));
    add(`models/block/${b.id}.json`, j({ parent: 'minecraft:block/cube_all', textures: { all: `${ns}:block/${b.id}` } }));
    if (legacy) {
      // 1.20.1 的方块物品模型：直接继承方块模型
      add(`models/item/${b.id}.json`, j({ parent: `${ns}:block/${b.id}` }));
    } else {
      add(`items/${b.id}.json`, j({ model: { type: 'minecraft:model', model: `${ns}:block/${b.id}` } }));
    }
  }

  // ---- 盔甲渲染层 ----
  // 26.x 用 assets/<ns>/equipment/<材质>.json 描述贴图；
  // 1.20.1 没有这套文件，ArmorMaterial.getName() 直接决定
  // assets/minecraft/textures/models/armor/<name>_layer_1/2.png（由 textures.mjs 产出）。
  if (!legacy) {
    for (const m of p.entries.armorMaterial || []) {
      add(
        `equipment/${m.id}.json`,
        j({
          layers: {
            humanoid: [{ texture: `${ns}:${m.id}` }],
            humanoid_leggings: [{ texture: `${ns}:${m.id}` }],
          },
        }),
      );
    }
  }

  // ---- 语言文件 ----
  files.push({ path: `src/main/resources/assets/${ns}/lang/zh_cn.json`, content: j(buildLang(p, 'zh')) });
  files.push({ path: `src/main/resources/assets/${ns}/lang/en_us.json`, content: j(buildLang(p, 'en')) });

  return files;
}

function buildLang(p, locale) {
  const ns = p.meta.id;
  const out = {};
  const zh = locale === 'zh';

  out[`itemGroup.${ns}.main`] = zh ? p.meta.name : p.meta.name;

  for (const it of p.entries.item || []) {
    out[`item.${ns}.${it.id}`] = (zh ? it.nameZh : it.nameEn) || it.nameZh || toPascal(it.id);
    (it.tooltip || []).forEach((line, n) => {
      if (String(line).trim()) out[`tooltip.${ns}.${it.id}.${n}`] = line;
    });
  }
  for (const b of p.entries.block || []) {
    out[`block.${ns}.${b.id}`] = (zh ? b.nameZh : b.nameEn) || b.nameZh || toPascal(b.id);
    (b.tooltip || []).forEach((line, n) => {
      if (String(line).trim()) out[`tooltip.${ns}.${b.id}.${n}`] = line;
    });
  }
  for (const t of p.entries.tier || []) {
    const nm = (zh ? t.nameZh : t.nameEn) || t.id;
    out[`tooltip.${ns}.tier_${t.id}`] = nm;
    // 标签也要翻译，否则 Fabric 会在启动时刷「Untranslated Item Tags」开发警告
    out[`tag.item.${ns}.${t.id}_tool_materials`] = zh ? `${nm}工具材料` : `${nm} Tool Materials`;
  }
  for (const m of p.entries.armorMaterial || []) {
    const nm = (zh ? m.nameZh : m.nameEn) || m.id;
    out[`tooltip.${ns}.armor_${m.id}`] = nm;
    out[`tag.item.${ns}.${m.id}_armor_materials`] = zh ? `${nm}盔甲材料` : `${nm} Armor Materials`;
  }
  const oreCount = (p.entries.block || []).filter((b) => b.kind === 'ore').length;
  if (oreCount) {
    out[`tag.block.${ns}.ores`] = zh ? '矿石' : 'Ores';
  }
  // 「按下按键」事件：绑定名会出现在游戏的「按键设置」里。
  // 编号必须和 compile.mjs 里分配的 bindId（kb0 / kb1 …）一致 ——
  // 否则按键设置里会显示原始翻译键。
  let kbCount = 0;
  for (const g of p.visual?.programs || []) {
    if (g && g.op === 'event.key_pressed') {
      out[`${ns}.kb${kbCount}`] = zh ? `快捷键 ${kbCount + 1}` : `Hotkey ${kbCount + 1}`;
      kbCount++;
    }
  }
  if (kbCount > 0) {
    out[`${ns}.key.category`] = zh ? 'MC Studio 快捷键' : 'MC Studio Hotkeys';
  }
  return out;
}

// ============================================================
// data
// ============================================================
export function genData(p, adapter) {
  const legacy = isLegacy(adapter);
  const ns = p.meta.id;
  const files = [];
  const add = (rel, content) => files.push({ path: `src/main/resources/data/${ns}/${rel}`, content });
  const addMc = (rel, content) => files.push({ path: `src/main/resources/data/minecraft/${rel}`, content });

  const featureDir = adapter?.features?.worldgenFeatureDir || 'feature';
  // 1.21 起这些目录从复数改成了单数；1.20.1 还在用复数
  const lootDir = legacy ? 'loot_tables/blocks' : 'loot_table/blocks';
  const recipeDir = legacy ? 'recipes' : 'recipe';
  const tagBlockDir = legacy ? 'tags/blocks' : 'tags/block';
  const tagItemDir = legacy ? 'tags/items' : 'tags/item';

  // ---- 战利品表 ----
  for (const b of p.entries.block || []) {
    add(`${lootDir}/${b.id}.json`, j(buildLoot(p, b, ns, legacy)));
  }

  // ---- 配方 ----
  for (const r of p.entries.recipe || []) {
    const built = buildRecipe(p, r, ns, legacy);
    if (built) add(`${recipeDir}/${r.id}.json`, j(built));
  }

  // ---- 标签 ----
  const oreBlocks = (p.entries.block || []).filter((b) => b.kind === 'ore').map((b) => `${ns}:${b.id}`);
  if (oreBlocks.length) {
    add(`${tagBlockDir}/ores.json`, j({ replace: false, values: oreBlocks }));
    // 追加进原版 ores 标签，矿物标记 / 连锁挖矿类模组才能识别
    addMc(`${tagBlockDir}/ores.json`, j({ replace: false, values: [`#${ns}:ores`] }));
  }

  for (const t of p.entries.tier || []) {
    const repair = (t.repairItems || []).filter(Boolean).map((x) => String(x));
    add(`${tagItemDir}/${t.id}_tool_materials.json`, j({ replace: false, values: repair }));
  }
  for (const m of p.entries.armorMaterial || []) {
    const repair = (m.repairItems || []).filter(Boolean).map((x) => String(x));
    add(`${tagItemDir}/${m.id}_armor_materials.json`, j({ replace: false, values: repair }));
  }

  // ---- 世界生成 ----
  for (const w of p.entries.worldgen || []) {
    // 26.x 的 OreFeature 在 size < 4 时一个方块都不生成；1.20.1 没这个限制
    const size = legacy ? Math.max(1, Number(w.size) || 9) : Math.max(4, Number(w.size) || 4);
    add(`worldgen/${featureDir}/${w.id}.json`, j(buildOreFeature(p, w, ns, size, legacy)));
    add(`worldgen/placed_feature/${w.id}.json`, j(buildPlacedFeature(p, w, ns)));
    if (legacy) {
      // 1.20.1 Forge：configured_feature 不会自动挂到生物群系，
      // 必须再写一份 forge:add_features 的 biome_modifier，否则矿物永远不生成。
      const dim = String(w.dimension || 'overworld');
      const biomeTag = dim === 'nether' ? '#minecraft:is_nether' : dim === 'end' ? '#minecraft:is_end' : '#minecraft:is_overworld';
      add(`forge/biome_modifier/${w.id}.json`, j({
        type: 'forge:add_features',
        biomes: biomeTag,
        features: `${ns}:${w.id}`,
        step: 'underground_ores',
      }));
    }
  }

  return files;
}

// ---------- 战利品表 ----------
function buildLoot(p, b, ns, legacy) {
  const self = `${ns}:${b.id}`;
  const drops = (b.drops || []).filter((d) => d && d.item);
  // 1.20.1 的精准采集条件写法与 26.x 完全不同，先不生成这段条件，
  // 免得产出一份游戏直接报错的战利品表；主掉落和概率池照常有效。
  const hasSilk = !legacy && (b.kind === 'ore' || b.silkTouch !== false);

  // 没配掉落物 → 掉自己
  if (!drops.length) {
    return blockLoot(ns, b.id, [{ rolls: 1, entries: [{ type: 'minecraft:item', name: self }] }]);
  }

  const mainEntries = []; // 每次必掉的候选（多个时只用其中一个）
  const chancePools = []; // 独立概率池，和主掉落互不影响

  for (const d of drops) {
    const name = d.item.includes(':') ? d.item : `${ns}:${d.item}`;
    const min = Math.max(1, Math.round(num(d.min, 1)));
    const max = Math.max(min, Math.round(num(d.max, min)));
    const modifier = [];
    const countVal = min === max ? min : { type: 'minecraft:uniform', min, max };
    // 1.20.1：字段叫 functions，且每项用 "function" 声明类型；
    // 26.x：字段叫 modifier，每项用 "type"。两者混用会被游戏直接丢弃整张表。
    if (min !== 1 || max !== 1) {
      modifier.push(
        legacy
          ? { function: 'minecraft:set_count', count: countVal, add: false }
          : { type: 'minecraft:set_count', count: countVal, add: false },
      );
    }
    if (d.fortune !== false) {
      const formula = b.kind === 'ore' ? 'minecraft:ore_drops' : 'minecraft:uniform_bonus_count';
      modifier.push(
        legacy
          ? { function: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula }
          : { type: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula },
      );
    }
    // 原版矿物的爆炸抗损行为：炸掉的方块有概率损失掉落
    if (b.kind === 'ore') {
      modifier.push(legacy ? { function: 'minecraft:explosion_decay' } : { type: 'minecraft:explosion_decay' });
    }
    const entry = { type: 'minecraft:item', name };
    if (modifier.length) entry[legacy ? 'functions' : 'modifier'] = modifier;

    const chance = num(d.chance, 1);
    if (chance > 0 && chance < 1) {
      chancePools.push({ rolls: 1, conditions: [{ condition: 'minecraft:random_chance', chance }], entries: [entry] });
    } else if (chance > 0) {
      mainEntries.push(entry);
    }
    // chance <= 0 视为永不掉落，直接跳过
  }

  const pools = [];
  if (mainEntries.length) {
    const main = mainEntries.length === 1 ? mainEntries[0] : { type: 'minecraft:alternatives', children: mainEntries };
    // 精准采集：优先掉方块本体，否则走正常掉落
    const entries = hasSilk
      ? { type: 'minecraft:alternatives', children: [{ type: 'minecraft:item', condition: 'minecraft:tool/can_silk_touch', name: self }, main] }
      : main;
    pools.push({ rolls: 1, entries: [entries] });
  }
  pools.push(...chancePools);

  return blockLoot(ns, b.id, pools);
}

function blockLoot(ns, id, pools) {
  return {
    type: 'minecraft:block',
    pools,
    random_sequence: `${ns}:blocks/${id}`,
  };
}

// ---------- 配方 ----------
const KEY_CHARS = 'ABCDEFGHI';

function buildRecipe(p, r, ns, legacy) {
  const resolve = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.includes(':') ? s : `${ns}:${s}`;
  };
  const result = resolve(r.result);
  if (!result) return null;
  const count = Math.max(1, Number(r.count) || 1);
  // 26.x 的 result 用 id（物品组件化后的写法）；1.20.1 用 item
  const resultObj = () => (legacy ? { item: result, count } : { id: result, count });

  const mode = r.mode || 'shaped';

  if (mode === 'smelting' || mode === 'blasting' || mode === 'smoking' || mode === 'campfire') {
    const ing = resolve(r.ingredient || r.input);
    if (!ing) return null;
    return {
      type: `minecraft:${mode}`,
      category: 'misc',
      ingredient: ing,
      // 1.20.1 的熔炼配方 result 是字符串，且不支持 count 字段
      ...(legacy ? { result } : { result: { id: result, count } }),
      experience: Number(r.experience) || 0,
      cookingtime: Math.max(1, Number(r.cookingTime) || 200),
    };
  }

  if (mode === 'stonecutting') {
    const ing = resolve(r.ingredient || r.input);
    if (!ing) return null;
    return legacy
      ? { type: 'minecraft:stonecutting', ingredient: ing, result, count }
      : { type: 'minecraft:stonecutting', ingredient: ing, result: { id: result, count } };
  }

  if (mode === 'shapeless') {
    const ings = (r.ingredients || []).map(resolve).filter(Boolean);
    if (!ings.length) return null;
    return {
      type: 'minecraft:crafting_shapeless',
      category: 'misc',
      ingredients: ings,
      result: resultObj(),
    };
  }

  // 锻造台改配方：template / base / addition 三件套
  if (mode === 'smithing') {
    const base = resolve(r.base);
    const addition = resolve(r.addition);
    if (!base || !addition) return null;
    const template = resolve(r.template);
    const out = {
      type: 'minecraft:smithing_transform',
      base,
      addition,
    };
    if (template) out.template = template;
    // 1.20.1 的 result 是 { item, count }，26.x 是 { id, count }
    out.result = legacy ? { item: result, count } : { id: result, count };
    return out;
  }

  // 有序：把 9 格网格裁成最小包围盒，并自动分配字符
  const grid = (r.grid || []).slice(0, 9);
  while (grid.length < 9) grid.push('');
  const filled = grid.map((v) => resolve(v));
  if (filled.every((v) => !v)) return null;

  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let i = 0; i < 9; i++) {
    if (!filled[i]) continue;
    const rr = Math.floor(i / 3), cc = i % 3;
    minR = Math.min(minR, rr); maxR = Math.max(maxR, rr);
    minC = Math.min(minC, cc); maxC = Math.max(maxC, cc);
  }

  const charOf = new Map();
  let next = 0;
  const pattern = [];
  for (let rr = minR; rr <= maxR; rr++) {
    let row = '';
    for (let cc = minC; cc <= maxC; cc++) {
      const v = filled[rr * 3 + cc];
      if (!v) { row += ' '; continue; }
      if (!charOf.has(v)) charOf.set(v, KEY_CHARS[next++]);
      row += charOf.get(v);
    }
    pattern.push(row);
  }

  const key = {};
  for (const [item, ch] of charOf) key[ch] = item;

  return {
    type: 'minecraft:crafting_shaped',
    category: r.category || 'misc',
    pattern,
    key,
    result: resultObj(),
  };
}

// ---------- 世界生成 ----------

/** 取一个有限数值，0 是合法值，不能被 `||` 吃掉 */
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 26.3 的可替换方块判定。
 * 原版把「按高度区分」的方块（目前只有 tuff）单独放进
 * minecraft:height_specific_ore_replaceables，需要额外用 height_match 卡高度带；
 * 其余岩石走普通 tag_match。两段用 any_of 合并，和原版 ore_coal 写法一致。
 *
 * 注意 26.3 的键名：any_of/all_of 用 rules，not 用 rule（旧版是 predicates/predicate）。
 */
function replaceableRule(tag, bandMin, bandMax) {
  const notHeightSpecific = {
    predicate_type: 'minecraft:not',
    rule: { predicate_type: 'minecraft:tag_match', tag: 'minecraft:height_specific_ore_replaceables' },
  };
  const plain = {
    predicate_type: 'minecraft:all_of',
    rules: [notHeightSpecific, { predicate_type: 'minecraft:tag_match', tag }],
  };
  // 高度带完全落空时没必要生成 any_of，直接用最简形式
  if (bandMin > bandMax) return plain;

  return {
    predicate_type: 'minecraft:any_of',
    rules: [
      {
        predicate_type: 'minecraft:all_of',
        rules: [
          { predicate_type: 'minecraft:tag_match', tag: 'minecraft:height_specific_ore_replaceables' },
          { predicate_type: 'minecraft:height_match', min_inclusive: bandMin, max_inclusive: bandMax },
        ],
      },
      plain,
    ],
  };
}

function buildOreFeature(p, w, ns, size, legacy) {
  const targets = [];
  const blockOf = (ref) => {
    if (!ref) return null;
    const s = String(ref).trim();
    if (!s) return null;
    return s.includes(':') ? s : `${ns}:${s}`;
  };

  if (legacy) {
    // 1.20.1 的 BlockState codec 是 {"Name": "..."}，26.x 才改成纯字符串；
    // 也没有 minecraft:height_specific_ore_replaceables 这套高度带规则。
    const stateOf = (ref) => ({ Name: ref });
    const tagRule = (tag) => ({ predicate_type: 'minecraft:tag_match', tag });
    const over = blockOf(w.overworldBlock);
    const deep = blockOf(w.deepslateBlock);
    if (over) targets.push({ state: stateOf(over), target: tagRule('minecraft:stone_ore_replaceables') });
    if (deep) targets.push({ state: stateOf(deep), target: tagRule('minecraft:deepslate_ore_replaceables') });
    if (!targets.length) {
      const single = blockOf(w.block);
      if (!single) return { type: 'minecraft:ore', size, targets: [] };
      const dim = w.dimension || 'overworld';
      const tag = dim === 'nether' ? 'minecraft:base_stone_nether' : 'minecraft:stone_ore_replaceables';
      targets.push({ state: stateOf(single), target: tagRule(tag) });
    }
    return {
      type: 'minecraft:ore',
      discard_chance_on_air_exposure: num(w.discardChance, 0),
      size,
      targets,
    };
  }

  const mineMin = Math.round(num(w.minY, -64));
  const mineMax = Math.round(num(w.maxY, 64));

  const over = blockOf(w.overworldBlock);
  const deep = blockOf(w.deepslateBlock);
  if (over) {
    // 石头层：tuff 只在 y>=0 且落在矿脉高度带内时才换成石头版矿石（原版同款 0..2031）
    targets.push({
      state: over,
      target: replaceableRule('minecraft:stone_ore_replaceables', Math.max(0, mineMin), Math.min(2031, mineMax)),
    });
  }
  if (deep) {
    // 深板岩层：tuff 只在 y<=8 且落在矿脉高度带内时才换成深板岩版矿石（原版同款 -2032..8）
    targets.push({
      state: deep,
      target: replaceableRule('minecraft:deepslate_ore_replaceables', Math.max(-2032, mineMin), Math.min(8, mineMax)),
    });
  }
  if (!targets.length) {
    const single = blockOf(w.block);
    if (!single) return { type: 'minecraft:ore', size, targets: [] };
    const dim = w.dimension || 'overworld';
    const target =
      dim === 'nether'
        ? { predicate_type: 'minecraft:tag_match', tag: 'minecraft:base_stone_nether' }
        : dim === 'end'
          ? { predicate_type: 'minecraft:block_match', block: 'minecraft:end_stone' }
          : // 主世界单方块：覆盖石头层 + 深板岩层，跟双矿石写法保持同一套高度带规则
            {
              predicate_type: 'minecraft:any_of',
              rules: [
                replaceableRule('minecraft:stone_ore_replaceables', Math.max(0, mineMin), Math.min(2031, mineMax)),
                replaceableRule('minecraft:deepslate_ore_replaceables', Math.max(-2032, mineMin), Math.min(8, mineMax)),
              ],
            };
    targets.push({ state: single, target });
  }

  return {
    type: 'minecraft:ore',
    discard_chance_on_air_exposure: num(w.discardChance, 0),
    size,
    targets,
  };
}

function buildPlacedFeature(p, w, ns) {
  const placement = [];
  const rarity = Math.round(num(w.rarity, 1));
  if (rarity > 1) {
    placement.push({ type: 'minecraft:rarity_filter', chance: rarity });
  }
  placement.push({ type: 'minecraft:count', count: Math.max(1, Math.round(num(w.count, 1))) });
  placement.push({ type: 'minecraft:in_square' });
  placement.push({
    type: 'minecraft:height_range',
    height: {
      type: 'minecraft:uniform',
      min_inclusive: { absolute: Math.round(num(w.minY, -64)) },
      max_inclusive: { absolute: Math.round(num(w.maxY, 64)) },
    },
  });
  placement.push({ type: 'minecraft:biome' });
  return { feature: `${ns}:${w.id}`, placement };
}

/** 世界生成要挂到哪些生物群系 —— 交给 ModWorldGen 那种启动期代码，这里只输出描述供界面显示 */
export function worldgenSummary(p) {
  return (p.entries.worldgen || []).map((w) => ({
    id: w.id,
    dimension: w.dimension || 'overworld',
    size: Math.max(4, Math.round(num(w.size, 4))),
    count: Math.max(1, Math.round(num(w.count, 1))),
    rarity: Math.max(1, Math.round(num(w.rarity, 1))),
    minY: Math.round(num(w.minY, -64)),
    maxY: Math.round(num(w.maxY, 64)),
  }));
}
