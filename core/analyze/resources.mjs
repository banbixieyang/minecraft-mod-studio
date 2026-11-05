/**
 * 从资源反推内容 —— 分析器的主力。
 *
 * 关键判断：**不需要反编译就能还原大部分内容**。
 * 26.3 的数据驱动程度很高，一个 mod 加了什么物品、什么配方、矿物怎么生成，
 * 全都躺在 jar 的资源目录里，而且是结构化的 JSON。
 *
 * 这条路比读 class 文件可靠得多：
 *  - 类名和方法体可能被混淆/内联，资源文件名不会；
 *  - 读出来直接就是我们自己的条目格式，能一键导入。
 *
 * 代码里注册的东西（状态效果、事件逻辑）不在这儿处理，交给 abilities.mjs。
 */
import { readJson } from './sources.mjs';
import { isReserved, uniqueId } from '../ids.mjs';

const LANG_PREFER = ['zh_cn', 'zh_tw', 'en_us', 'en_gb'];

/** 26.3 用单数目录名，老版本用复数。两套都试。 */
const DIRS = {
  recipe: ['data/{ns}/recipe', 'data/{ns}/recipes'],
  loot: ['data/{ns}/loot_table', 'data/{ns}/loot_tables'],
  feature: ['data/{ns}/worldgen/feature', 'data/{ns}/worldgen/configured_feature'],
  placed: ['data/{ns}/worldgen/placed_feature', 'data/{ns}/worldgen/placed_features'],
  advancement: ['data/{ns}/advancement', 'data/{ns}/advancements'],
  itemModel: ['assets/{ns}/models/item', 'assets/{ns}/items'],
  blockState: ['assets/{ns}/blockstates'],
  itemTexture: ['assets/{ns}/textures/item'],
  blockTexture: ['assets/{ns}/textures/block'],
  lang: ['assets/{ns}/lang'],
  // 26.x 起附魔改成数据驱动：data/<ns>/enchantment/*.json 里写最大等级、
  // 每级增量、作用效果。1.20.1 的附魔在 class 里，这里只管新版。
  enchantment: ['data/{ns}/enchantment'],
  // 状态效果的数据驱动目录（26.x）。老版本在 class 里。
  mobEffect: ['data/{ns}/mob_effect', 'data/{ns}/effect'],
  // 标签：items / blocks / entity_types 等，是「这个物品属于哪一组」的信息
  tag: ['data/{ns}/tags'],
};

/**
 * 在若干个候选目录里找文件，返回 [{ id, path }]
 *
 * allowSubdir 有两种用法：
 *   'basename' —— id 只取文件名（战利品表、进度用这个，跟方块/物品名对齐）
 *   'path'     —— id 保留子目录并把 / 换成 _（配方用这个：Forge 生态里
 *                 recipes/cooking/xxx.json 才是完整 id，只取文件名会跟
 *                 同名的别的目录撞车）
 *   false      —— 只看目录第一层
 */
function filesIn(src, dirs, ns, { stripExt = true, allowSubdir = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const tpl of dirs) {
    const dir = tpl.replace('{ns}', ns);
    for (const name of src.list(dir)) {
      // src.list 是前缀匹配，list('data/ns/recipe') 会连 'data/ns/recipes/…' 一起捞进来，
      // 那样切出来的相对路径会变成 's/xxx.json'，id 全歪。所以这里卡死目录边界：
      // 下一段必须是真正的目录分隔符或文件结束。
      const rest = name.slice(dir.length);
      if (rest && !rest.startsWith('/')) continue;
      const file = rest.slice(1);
      if (!file) continue;
      // 战利品表和进度常放在子目录里（loot_table/blocks/ruby_ore.json），
      // 这种情况下 id 取文件名，跟方块/物品名对齐
      if (!allowSubdir && file.includes('/')) continue;
      const bare = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file;
      // 有些 mod 会打出 xxx.json.json 这种双扩展名，剥一层会留下个带点的非法 id
      let id = stripExt ? bare.replace(/(\.(json|png|mcmeta))+$/i, '') : bare;
      if (id.endsWith('.png.mcmeta')) continue;
      // 'path' 模式：完整路径当 id，斜杠换下划线（包 id 不允许斜杠）
      if (allowSubdir === 'path' && file.includes('/')) {
        id = (stripExt ? file.replace(/(\.(json|png|mcmeta))+$/i, '') : file).replace(/\//g, '_');
      }
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, path: name });
    }
  }
  return out;
}

/**
 * 挑出「这个 mod 自己的」命名空间。
 *
 * 判据（两条都满足其一）：
 *   1. 就是 mod 描述文件声明的 modId；
 *   2. 命名空间里有语言文件 —— 作者认领过，说明内容是它的。
 *
 * 明确排除：
 *   - minecraft / forge：原版与加载器本体，永远不是 mod 自己的内容；
 *   - 其它依赖 mod 的命名空间：那是别人的东西，扫进来会污染清单。
 *
 * 为什么不能「全都扫」：goetydelight 依赖 goety，它的 jar 里带着
 * 431 个 goety 命名空间的文件（patchouli 书）。全扫的话，
 * 拆解台里会出现一堆不属于这个 mod 的物品。
 */
export function pickOwnNamespaces(src, namespaces, mainNs) {
  const own = [];
  for (const ns of namespaces) {
    if (ns === 'minecraft' || ns === 'forge' || ns === 'neoforge' || ns === 'fabric') continue;
    if (ns === mainNs) { own.push(ns); continue; }
    // 有语言文件 → 作者认领过这个命名空间
    const langFiles = filesIn(src, DIRS.lang, ns, { stripExt: false });
    if (langFiles.length) own.push(ns);
  }
  return own.length ? own : (mainNs ? [mainNs] : []);
}

/**
 * 从各种「可能是 id 也可能是对象」的写法里掏出 id */
function pickId(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = pickId(x);
      if (r) return r;
    }
    return '';
  }
  if (typeof v === 'object') {
    if (v.tag) return `#${v.tag}`;
    if (v.item) return pickId(v.item);
    if (v.id) return pickId(v.id);
    if (v.name) return pickId(v.name);
  }
  return '';
}

/** 名字里的后缀 → 我们的工具类型 */
const TOOL_SUFFIX = [
  ['_sword', 'sword'],
  ['_pickaxe', 'pickaxe'],
  ['_axe', 'axe'],
  ['_shovel', 'shovel'],
  ['_hoe', 'hoe'],
];
const ARMOR_SUFFIX = [
  ['_helmet', 'helmet'],
  ['_chestplate', 'chestplate'],
  ['_leggings', 'leggings'],
  ['_boots', 'boots'],
];

function classify(id) {
  for (const [suf, t] of TOOL_SUFFIX) if (id.endsWith(suf)) return { kind: 'tool', toolType: t };
  for (const [suf, slot] of ARMOR_SUFFIX) if (id.endsWith(suf)) return { kind: 'armor', armorSlot: slot };
  if (id.endsWith('_ore')) return { kind: 'ore' };
  return {};
}

/**
 * 把 26.x 附魔的 effects 结构压成一句人能读的描述。
 *
 * 原始结构是这样的：
 *   { "minecraft:damage": [ { effect: { type: "minecraft:add",
 *                                        value: { type: "minecraft:linear",
 *                                                  base: 1, per_level_above_first: 0.5 } } } ] }
 *
 * 界面上要的是「加多少伤害，每级 +0.5」这种一句话，
 * 而不是把整棵 JSON 甩给人看。
 */
function summarizeEnchantEffects(effects) {
  if (!effects || typeof effects !== 'object') return '';
  const out = [];
  for (const [kind, list] of Object.entries(effects)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const e = entry?.effect || entry;
      const type = String(e?.type || '').replace('minecraft:', '');
      const v = e?.value;
      if (v && typeof v === 'object') {
        const base = v.base ?? v.amount ?? '';
        const per = v.per_level_above_first ?? v.per_level_below_first ?? '';
        out.push(`${kind.replace('minecraft:', '')} ${type} ${base}${per !== '' && per !== undefined ? ` (每级 ${per > 0 ? '+' : ''}${per})` : ''}`);
      } else if (v !== undefined) {
        out.push(`${kind.replace('minecraft:', '')} ${type} ${v}`);
      } else {
        out.push(`${kind.replace('minecraft:', '')} ${type}`);
      }
    }
  }
  return out.join('; ');
}

/**
 * 把分析出来的名字收拾成一个合法标识符。
 *
 * 为什么需要：材质名是从物品 id 剥后缀推出来的，而原 mod 完全可能叫
 * void_helmet —— 剥出来就是 void，撞上 Java 保留字，条目会被 addEntry
 * 直接拒掉。这类名字在真实 mod 里不罕见（void / air / world / int 都有
 * 人用），分析器得自己收拾干净，不能甩给人手动改。
 *
 * 加 _mat 后缀而不是换个词：语义还在，读起来也还是那套装备。
 */
function safeId(raw) {
  let s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'default';
  if (!/^[a-z]/.test(s)) s = `m_${s}`;
  s = s.slice(0, 48).replace(/_+$/, '');
  if (s.length < 2 || isReserved(s)) s = `${s}_mat`;
  return s;
}

/** 把配方 JSON 转成 core-recipe 条目 */
function toRecipe(id, json, ns) {
  if (!json || typeof json !== 'object') return null;
  const type = String(json.type || '');
  const short = type.replace('minecraft:', '');

  const result = pickId(json.result);
  if (!result) return null;
  const count = Number(json.result?.count ?? json.count ?? 1) || 1;

  const base = { id, result, count };

  if (short === 'crafting_shaped' || short === 'crafting_shapeless') {
    if (short === 'crafting_shapeless') {
      const ings = (json.ingredients || []).map(pickId).filter(Boolean);
      if (!ings.length) return null;
      return { ...base, mode: 'shapeless', ingredients: ings };
    }
    const pattern = json.pattern || [];
    const key = json.key || {};
    const grid = new Array(9).fill('');
    for (let r = 0; r < Math.min(3, pattern.length); r++) {
      const row = String(pattern[r]);
      for (let c = 0; c < Math.min(3, row.length); c++) {
        const ch = row[c];
        if (!ch || ch === ' ') continue;
        const v = pickId(key[ch]);
        if (v) grid[r * 3 + c] = v;
      }
    }
    if (grid.every((v) => !v)) return null;
    return { ...base, mode: 'shaped', grid };
  }

  if (['smelting', 'blasting', 'smoking', 'campfire_cooking'].includes(short)) {
    const ing = pickId(json.ingredient);
    if (!ing) return null;
    return {
      ...base,
      mode: short === 'campfire_cooking' ? 'campfire' : short,
      ingredient: ing,
      experience: Number(json.experience) || 0,
      cookingTime: Math.max(1, Number(json.cookingtime ?? json.cooking_time ?? 200) || 200),
    };
  }

  if (short === 'stonecutting') {
    const ing = pickId(json.ingredient);
    if (!ing) return null;
    return { ...base, mode: 'stonecutting', ingredient: ing };
  }

  // 锻造台改配方（1.20 起原版自带，Forge 也用它）
  // 三件套：template 模板 / base 底材 / addition 追加材料。
  // 原版 1.20.1 的 JSON 里 result 是 { item, count }，跟其它配方一致。
  if (short === 'smithing_transform' || short === 'smithing_trim') {
    const template = pickId(json.template);
    const base1 = pickId(json.base);
    const addition = pickId(json.addition);
    if (!base1 || !addition) return null;
    return {
      ...base,
      mode: 'smithing',
      template: template || '',
      base: base1,
      addition,
    };
  }

  return null;
}

/** 从战利品表里抠出掉的东西 */
function lootDrops(json) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (node.type === 'minecraft:item' && node.name) {
      const fn = (node.functions || []).find((f) => f.function === 'minecraft:set_count');
      const c = fn?.count;
      const min = typeof c === 'object' ? Number(c.min) || 1 : Number(c) || 1;
      const max = typeof c === 'object' ? Number(c.max) || min : min;
      out.push({ item: node.name, min, max });
      return;
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(json.pools || json);
  return out;
}

/** 读 feature + placed_feature 配对成世界生成条目 */
function toWorldgen(id, feature, placed, ns) {
  if (!feature || feature.type !== 'minecraft:ore') return null;

  const targets = feature.targets || [];
  const statesOf = (t) => {
    if (t?.state) return [t.state];
    if (t?.target?.state) return [t.target.state];
    return [];
  };
  const allStates = targets.flatMap(statesOf).filter(Boolean);

  // 主世界矿通常两个目标：石头里一个、深板岩里一个
  const deep = allStates.find((s) => String(s).includes('deepslate')) || '';
  const over = allStates.find((s) => !String(s).includes('deepslate')) || allStates[0] || '';

  // 维度靠目标方块反推，比看 placed_feature 的 biome 可靠
  const joined = allStates.join(' ');
  const dimension = joined.includes('netherrack')
    ? 'nether'
    : joined.includes('end_stone')
      ? 'end'
      : 'overworld';

  const placement = placed?.placement || [];
  const countCfg = placement.find((x) => x.type === 'minecraft:count');
  const rarityCfg = placement.find((x) => x.type === 'minecraft:rarity_filter');
  const heightCfg = placement.find((x) => x.type === 'minecraft:height_range');

  const count = typeof countCfg?.count === 'object'
    ? Number(countCfg.count.min ?? countCfg.count.max) || 1
    : Number(countCfg?.count) || 1;

  const h = heightCfg?.height || {};
  const yOf = (v) => {
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') return Number(v.absolute ?? v.min_inclusive ?? 0) || 0;
    return 0;
  };
  const minY = yOf(h.min_inclusive);
  const maxY = yOf(h.max_inclusive);

  return {
    id,
    dimension,
    overworldBlock: over,
    deepslateBlock: deep,
    block: over,
    size: Math.max(4, Number(feature.size) || 4),
    count: Math.max(1, count),
    rarity: Math.max(1, Number(rarityCfg?.chance) || 1),
    minY,
    maxY,
    discardChance: Number(feature.discard_chance_on_air_exposure) || 0,
  };
}

/**
 * 扫描资源，还原内容清单。
 * 返回 { contents, lang, namespaces, warnings }
 *
 * 多命名空间：
 * 一个 jar 里往往不止一个命名空间 —— 主 mod 一个，附属/依赖的几个。
 * 只扫主命名空间会漏掉「mod 自己放在第二个命名空间下」的内容
 * （有些 mod 就会这么干，比如主 mod + 一个 lib 命名空间）。
 *
 * 判定「这个命名空间算谁的」用两条：
 *   1. mod 描述文件里声明的 modId（主命名空间）；
 *   2. 命名空间里有本 mod 的语言文件（说明作者认领过它）。
 * 其它命名空间（minecraft / forge / 别的依赖 mod）一律不碰 ——
 * 那是别人的东西，扫进来会污染内容清单。
 *
 * 跨命名空间的条目 id 一律带命名空间前缀（ns_item），
 * 否则两个命名空间里的同名物品会互相覆盖。
 */
export function analyzeResources(src, opts = {}) {
  const namespaces = opts.namespaces || [];
  const mainNs = opts.mainNs || namespaces[0] || '';
  const warnings = [];
  const contents = {
    item: [], block: [], recipe: [], worldgen: [], advancement: [], armorMaterial: [], tier: [],
    // 26.x 数据驱动的附魔与状态效果。跟扩展产出的同名字段并存 ——
    // 扩展管的是 class 里的老版本（Goety 那套），这里管的是 data/ 下的新版。
    enchantment: [], statusEffect: [],
  };

  if (!mainNs) return { contents, lang: {}, namespaces, warnings: ['没找到 assets/ 或 data/ 目录，可能不是内容类 mod'] };

  // ---- 判定要扫哪些命名空间 ----
  const ownNs = pickOwnNamespaces(src, namespaces, mainNs);

  // ---- 语言文件（拿来取名字，也拿来发现只在代码里注册的东西）----
  const lang = {};
  for (const ns of ownNs) {
    const files = filesIn(src, DIRS.lang, ns, { stripExt: false });
    const byLocale = new Map(files.map((f) => [f.id.replace(/\.json$/, ''), f.path]));
    for (const locale of LANG_PREFER) {
      const p = byLocale.get(locale);
      if (!p) continue;
      const j = readJson(src, p);
      if (j && typeof j === 'object') lang[locale] = j;
    }
  }
  const langZh = lang.zh_cn || lang.zh_tw || {};
  const langEn = lang.en_us || lang.en_gb || {};
  const nameOf = (key) => ({ zh: langZh[key] || '', en: langEn[key] || '' });

  // ---- 结构信号 ----
  // 键是「裸 id」（不含命名空间），值是它所属的命名空间。
  // 前缀由 nsPrefix() 在构造条目时统一加，这里绝不能再拼一次 ——
  // 拼两次就会得到 'goetydelight/goetydelight/xxx' 这种鬼名字。
  const texIndex = { item: new Map(), block: new Map() };
  const itemModels = new Set();
  const blockStates = new Set();
  for (const ns of ownNs) {
    for (const f of filesIn(src, DIRS.itemModel, ns)) {
      itemModels.add(f.id);
      texIndex.item.set(f.id, ns);
    }
    for (const f of filesIn(src, DIRS.blockState, ns)) {
      blockStates.add(f.id);
      texIndex.block.set(f.id, ns);
    }
  }

  // ---- 语言信号：有些东西没有模型（比如纯材料），只能靠语言键发现 ----
  // 语言键自带命名空间（item.<ns>.<id>），正好用来定位归属。
  const langItems = new Map();  // id → ns
  const langBlocks = new Map();
  const langEffects = new Set();
  const scanLang = (L) => {
    for (const key of Object.keys(L)) {
      let m;
      if ((m = key.match(/^item\.([a-z0-9_.-]+)\.([a-z0-9_/.-]+)$/))) {
        if (!ownNsSet.has(m[1])) continue;
        // item.<ns>.<id>.info / .brew / .desc 这类后缀不是物品，
        // 是法术描述、酿造配方说明挂在 item 命名空间下的附属键。
        // 不排除的话会把 143 个「物品」凭空造出来（拆解台里全是 xxx.info）。
        if (/\.(info|desc|description|brew|focus|effect|tip|tooltip)$/i.test(m[2])) continue;
        langItems.set(m[2], m[1]);
      } else if ((m = key.match(/^block\.([a-z0-9_.-]+)\.([a-z0-9_/.-]+)$/))) {
        if (ownNsSet.has(m[1])) langBlocks.set(m[2], m[1]);
      } else if ((m = key.match(/^effect\.([a-z0-9_.-]+)\.([a-z0-9_/.-]+)$/))) {
        if (ownNsSet.has(m[1])) langEffects.add(m[2]);
      }
    }
  };
  const ownNsSet = new Set(ownNs);
  scanLang(langZh);
  scanLang(langEn); // 英文语言文件里可能有中文文件没有的键

  // ---- 方块 ----
  //
  // id 规则：主命名空间下的用裸 id（保持向后兼容，包里就是 ruby_ore）；
  // 其它命名空间下的带前缀（otherns_block），避免两个命名空间的同名内容互相覆盖。
  const nsPrefix = (ns, id) => (ns === mainNs ? id : `${ns}_${id}`);
  const blockIds = new Map(); // id → ns
  for (const [id, ns] of texIndex.block) blockIds.set(id, ns);
  for (const [id, ns] of langBlocks) if (!blockIds.has(id)) blockIds.set(id, ns);

  for (const [rawId, ns] of blockIds) {
    const id = nsPrefix(ns, rawId);
    const cls = classify(rawId);
    const zh = nameOf(`block.${ns}.${rawId}`).zh || nameOf(`item.${ns}.${rawId}`).zh;
    const en = nameOf(`block.${ns}.${rawId}`).en || nameOf(`item.${ns}.${rawId}`).en;
    contents.block.push({
      id,
      ns,
      nameZh: zh || '',
      nameEn: en || '',
      kind: cls.kind === 'ore' ? 'ore' : /_block$/.test(rawId) ? 'storage' : 'plain',
      requiresTool: true,
      drops: [],
      texture: { mode: 'custom' },
    });
  }

  // ---- 物品（排除已经是方块的）----
  const itemIds = new Map(); // id → ns
  for (const [id, ns] of texIndex.item) itemIds.set(id, ns);
  for (const [id, ns] of langItems) if (!itemIds.has(id)) itemIds.set(id, ns);

  const blockIdSet = new Set(blockIds.keys());
  for (const [rawId, ns] of itemIds) {
    if (blockIdSet.has(rawId)) continue;
    const id = nsPrefix(ns, rawId);
    const cls = classify(rawId);
    const zh = nameOf(`item.${ns}.${rawId}`).zh;
    const en = nameOf(`item.${ns}.${rawId}`).en;
    const entry = {
      id,
      ns,
      nameZh: zh || '',
      nameEn: en || '',
      kind: cls.kind || 'material',
      stacksTo: cls.kind === 'tool' || cls.kind === 'armor' ? 1 : 64,
      texture: { mode: 'custom' },
    };
    if (cls.toolType) entry.toolType = cls.toolType;
    if (cls.armorSlot) entry.armorSlot = cls.armorSlot;
    contents.item.push(entry);
  }

  // ---- 装备材质 ----
  //
  // 为什么必须补这一块：物品的 kind 认成 armor/tool 了，但材质找不到匹配项时
  // 生成器会退化 —— armor 变成 stacksTo(1) 的普通物品，能编译、长得像盔甲、
  // 却穿不上；tool 一律当钻石工具，原 mod 的手感全丢。资源文件里读不出
  // 防御值和挖掘速度（那些在 class 常量里），所以这里按套装推一个、给钻石档
  // 默认值，然后在 warnings 里点名让人自己调 —— 不静默糊过去。
  //
  // 分组按名字剥后缀：ruby_helmet / ruby_boots 都归到 ruby，这跟绝大多数
  // mod 的命名习惯一致，也是我们编辑器里 tier 与 armorMaterial 同名的惯例。
  const groupOf = (id, suffixes) => {
    for (const [suf] of suffixes) if (id.endsWith(suf)) return id.slice(0, -suf.length);
    return '';
  };
  // knownIds / itemById 的键是「命名空间:裸id」——
  // 套装名本身是裸 id（剥掉 _helmet 之类），要靠命名空间区分来源。
  const knownIds = new Set(contents.item.map((e) => `${e.ns}:${e.id}`));
  const itemById = new Map(contents.item.map((e) => [`${e.ns}:${e.id}`, e]));

  // 一个套装名 → 一个材质 id。同一个 set 的盔甲材质和工具材质共用一个 id
  // （红宝石剑和红宝石头盔都叫 ruby），这跟我们编辑器里的惯例一致；
  // 不同 set 万一清洗后撞了，加后缀区分。
  //
  // 材质 id 要跨命名空间唯一，所以主命名空间用裸名（ruby），
  // 其它命名空间带前缀（otherns_ruby），不然两个命名空间的同名套装会互相覆盖。
  const matIds = new Map();
  const matIdOf = (key, set, ns) => {
    if (!matIds.has(key)) {
      const base = ns === mainNs ? safeId(set) : safeId(`${ns}_${set}`);
      matIds.set(key, uniqueId(base, new Set(matIds.values())));
    }
    return matIds.get(key);
  };

  const armorSets = new Map(); // set → ns
  for (const it of contents.item) {
    if (it.kind !== 'armor') continue;
    // 套装名用「裸 id」推（剥掉 _helmet 之类后缀），但材质 id 要跨命名空间唯一，
    // 所以键是 ns + 裸 id，材质 id 本身加上命名空间前缀避免撞。
    const raw = it.id.replace(/^(.*)_(helmet|chestplate|leggings|boots)$/, '$1');
    const set = raw.endsWith('_helmet') || raw.endsWith('_chestplate') || raw.endsWith('_leggings') || raw.endsWith('_boots')
      ? groupOf(raw, ARMOR_SUFFIX) || raw
      : raw;
    const key = `${it.ns}:${set}`;
    if (!armorSets.has(key)) armorSets.set(key, { set, ns: it.ns });
    it.armorMaterial = matIdOf(key, set, it.ns);
  }
  for (const { set, ns } of armorSets.values()) {
    contents.armorMaterial.push({
      id: matIdOf(`${ns}:${set}`, set, ns),
      nameZh: itemById.get(`${ns}:${set}`)?.nameZh || '',
      nameEn: itemById.get(`${ns}:${set}`)?.nameEn || '',
      durability: 33,
      defHelmet: 3,
      defChest: 8,
      defLegs: 6,
      defBoots: 3,
      enchantmentValue: 10,
      toughness: 2,
      knockbackResistance: 0,
      equipSound: 'diamond',
      // 维修材料用同名的那个材料物品（红宝石盔甲 → 红宝石）；没这个物品就留空，
      // 否则会往标签里塞一个不存在的 id
      repairItems: knownIds.has(`${ns}:${set}`) ? [`${ns}:${set}`] : [],
    });
  }

  const toolSets = new Map();
  for (const it of contents.item) {
    if (it.kind !== 'tool') continue;
    const raw = it.id.replace(/_(sword|pickaxe|axe|shovel|hoe)$/, '');
    const set = groupOf(raw, TOOL_SUFFIX) || raw;
    const key = `${it.ns}:${set}`;
    if (!toolSets.has(key)) toolSets.set(key, { set, ns: it.ns });
    it.materialMode = 'custom';
    it.tier = matIdOf(key, set, it.ns);
  }
  for (const { set, ns } of toolSets.values()) {
    contents.tier.push({
      id: matIdOf(`${ns}:${set}`, set, ns),
      nameZh: itemById.get(`${ns}:${set}`)?.nameZh || '',
      nameEn: itemById.get(`${ns}:${set}`)?.nameEn || '',
      durability: 1561,
      speed: 8,
      attackDamageBonus: 3,
      enchantmentValue: 10,
      incorrectFor: 'diamond',
      repairItems: knownIds.has(`${ns}:${set}`) ? [`${ns}:${set}`] : [],
    });
  }

  if (armorSets.size || toolSets.size) {
    const bits = [];
    if (armorSets.size) bits.push(`${armorSets.size} 个盔甲材质`);
    if (toolSets.size) bits.push(`${toolSets.size} 个工具材质`);
    warnings.push(`装备的数值在 class 里读不出来，${bits.join('、')}按钻石档填了默认值，用之前建议按实际需求改一遍`);
  }

  // ---- 配方 ----
  // allowSubdir: 'path' —— Forge 生态里配方按类型分子目录放
  // （recipes/cooking/、recipes/ritual/、recipes/brew/…），
  // 只看第一层会漏掉一大半；id 带目录前缀又不会跟同名的撞车。
  //
  // 不支持的类型按类型聚合成一条警告：有的 mod 会带上百条同类自定义配方，
  // 逐条报「已跳过」能把警告列表刷爆，真正重要的信息反而看不见了。
  const skippedByType = new Map();
  for (const ns of ownNs) {
    for (const f of filesIn(src, DIRS.recipe, ns, { allowSubdir: 'path' })) {
      const json = readJson(src, f.path);
      const r = toRecipe(f.id, json, ns);
      if (r) {
        r.ns = ns;
        contents.recipe.push(r);
        continue;
      }
      if (!json) continue;
      const t = String(json.type || '(无类型)');
      skippedByType.set(t, (skippedByType.get(t) || 0) + 1);
    }
  }
  for (const [t, n] of skippedByType) {
    warnings.push(`${n} 条 ${t} 类型的配方暂不支持，已跳过`);
  }

  // ---- 掉落（补回方块条目上）----
  const lootById = new Map();
  for (const ns of ownNs) {
    for (const f of filesIn(src, DIRS.loot, ns, { allowSubdir: true })) {
      const json = readJson(src, f.path);
      if (!json) continue;
      // 26.3 习惯放 loot_table/blocks/<id>.json，所以 id 可能是 "blocks/ruby_ore"
      const bare = f.id.split('/').pop();
      lootById.set(`${ns}:${bare}`, lootDrops(json));
    }
  }
  for (const b of contents.block) {
    const d = lootById.get(`${b.ns}:${b.id}`);
    if (d && d.length) b.drops = d.map((x) => ({ item: x.item, min: x.min, max: x.max, chance: 1 }));
  }

  // ---- 世界生成 ----
  for (const ns of ownNs) {
    const features = new Map(filesIn(src, DIRS.feature, ns).map((f) => [f.id, f.path]));
    const placed = new Map(filesIn(src, DIRS.placed, ns).map((f) => [f.id, f.path]));
    for (const [id, p] of features) {
      const feature = readJson(src, p);
      const placedJson = placed.has(id) ? readJson(src, placed.get(id)) : null;
      const w = toWorldgen(id, feature, placedJson, ns);
      if (w) {
        w.ns = ns;
        contents.worldgen.push(w);
      }
    }
  }

  // ---- 数据驱动的附魔与状态效果（26.x）----
  //
  // 为什么必须单独处理：26.x 起附魔从 class 搬到了 data/<ns>/enchantment/*.json，
  // 里面明明白白写着 max_level、每级增量、作用效果 —— 全是可调数值。
  // 不解析的话，解析 26.x 的 mod 会一个自定义附魔都看不到（老版本在 class 里，
  // 由 goety-base 那类扩展负责，不冲突）。
  for (const ns of ownNs) {
    for (const f of filesIn(src, DIRS.enchantment, ns)) {
      const json = readJson(src, f.path);
      if (!json) continue;
      const desc = json.description;
      const descKey = typeof desc === 'string' ? desc : desc?.translate || '';
      const id = ns === mainNs ? f.id : `${ns}_${f.id}`;
      contents.enchantment.push({
        id,
        ns,
        registryId: `${ns}:${f.id}`,
        nameZh: (descKey && langZh[descKey]) || '',
        nameEn: (descKey && langEn[descKey]) || '',
        descriptionZh: (descKey && langZh[`${descKey}.desc`]) || '',
        descriptionEn: (descKey && langEn[`${descKey}.desc`]) || '',
        maxLevel: Number(json.max_level) || 1,
        // 每级增量：min_cost / max_cost 的 per_level_above_first
        costPerLevel: Number(json.min_cost?.per_level_above_first) || 0,
        anvilCost: Number(json.anvil_cost) || 0,
        weight: Number(json.weight) || 0,
        supportedItems: String(json.supported_items || json.primary_items || ''),
        effects: summarizeEnchantEffects(json.effects),
        class: '',
        numbers: [],
      });
    }

    for (const f of filesIn(src, DIRS.mobEffect, ns)) {
      const json = readJson(src, f.path);
      if (!json) continue;
      const nameKey = json.name || '';
      const id = ns === mainNs ? f.id : `${ns}_${f.id}`;
      contents.statusEffect.push({
        id,
        ns,
        registryId: `${ns}:${f.id}`,
        nameZh: (nameKey && langZh[nameKey]) || '',
        nameEn: (nameKey && langEn[nameKey]) || '',
        descriptionZh: (nameKey && langZh[`${nameKey}.description`]) || '',
        descriptionEn: (nameKey && langEn[`${nameKey}.description`]) || '',
        category: String(json.category || ''),
        // 26.x 的属性修正在 category_attributes 里
        attributes: Object.entries(json.category_attributes || {})
          .map(([cat, attrs]) => `${cat}:${Object.keys(attrs || {}).join('/')}`)
          .join(' '),
        class: '',
        numbers: [],
      });
    }
  }

  // ---- 进度 ----
  //
  // 标题/说明在 JSON 里是 translate 键（"advancements.goety.xxx.title"），
  // 不是文本本身。以前直接把键当标题显示，界面上就是一串
  // advancements.goety.become_lich.title，看不出是干什么的 ——
  // 而这些键在语言文件里是有中文的（"超越自我"），必须查表翻译。
  const translate = (v, table) => {
    if (typeof v === 'string') return v;
    const key = v?.translate;
    if (!key) return '';
    return table[key] || '';
  };
  for (const ns of ownNs) {
    for (const f of filesIn(src, DIRS.advancement, ns, { allowSubdir: true })) {
      const json = readJson(src, f.path);
      if (!json || !json.display) continue;
      const d = json.display;
      const id = ns === mainNs ? f.id : `${ns}_${f.id}`;
      contents.advancement.push({
        id,
        ns,
        titleZh: translate(d.title, langZh),
        titleEn: translate(d.title, langEn),
        descriptionZh: translate(d.description, langZh),
        descriptionEn: translate(d.description, langEn),
        icon: pickId(d.icon) || 'minecraft:stone',
        frame: d.frame || 'task',
        hidden: !!d.hidden,
        announce: d.announce_to_chat !== false,
        parent: typeof json.parent === 'string' ? json.parent : '',
      });
    }
  }

  return {
    contents,
    lang: { zh_cn: langZh, en_us: langEn },
    namespaces,
    ownNamespaces: ownNs,
    effects: [...langEffects],
    warnings,
  };
}

/**
 * 只取「用户自己画的」贴图，转 dataUrl 塞进包里用。
 *
 * ids 的每一项可以是：
 *   - 裸 id（'ruby'）→ 在给定命名空间下找
 *   - { id, ns }     → 在条目自己的命名空间下找（多命名空间时必须这样）
 *   - 'ns:id'        → 显式指定命名空间
 */
export function collectTextures(src, ns, ids, opts = {}) {
  const maxEach = opts.maxEach || 256 * 1024;
  const maxTotal = opts.maxTotal || 8 * 1024 * 1024;
  const out = [];
  let total = 0;

  const tryAdd = (rel) => {
    if (!src.has(rel)) return false;
    const info = src.stat(rel);
    if (info && info.rawSize > maxEach) return false;
    if (total > maxTotal) return false;
    try {
      const buf = src.read(rel);
      if (buf.length > maxEach) return false;
      total += buf.length;
      out.push({ path: rel, dataUrl: `data:image/png;base64,${buf.toString('base64')}` });
      return true;
    } catch {
      return false;
    }
  };

  for (const [kind, dirs] of [
    ['item', DIRS.itemTexture],
    ['block', DIRS.blockTexture],
  ]) {
    for (const raw of ids[kind] || []) {
      let id = raw;
      let fileNs = ns;
      if (raw && typeof raw === 'object') {
        id = raw.id;
        fileNs = raw.ns || ns;
      } else if (typeof raw === 'string' && raw.includes(':')) {
        const i = raw.indexOf(':');
        fileNs = raw.slice(0, i);
        id = raw.slice(i + 1);
      }
      for (const tpl of dirs) {
        const dir = tpl.replace('{ns}', fileNs);
        if (tryAdd(`${dir}/${id}.png`)) break;
      }
    }
  }
  return out;
}
