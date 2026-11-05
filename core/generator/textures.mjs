/**
 * 贴图管线：把工程数据变成 PNG 文件。
 *
 * 设计目标是「什么都不填也有像样的贴图」：
 * 用户没配 texture 字段时，按物品/方块类型自动挑底图与配色，
 * 保证新建一个物品立刻能在游戏里看见，而不是紫黑方块。
 */
import { stripNs } from '../project.mjs';
import { buildTexture, recolor, composeOre, readVanilla, pngBuffer, PRESETS } from '../texture/recolor.mjs';

/** 原版矿石模板 → 它自己的宿主岩石，差分取遮罩时必须配对 */
function hostOf(source) {
  if (source.startsWith('deepslate_')) return 'deepslate';
  if (source.startsWith('nether_')) return 'netherrack';
  return 'stone';
}

/** 从世界生成配置反推每个方块属于哪个维度，用于挑底岩 */
function dimensionMap(p) {
  const map = new Map();
  for (const w of p.entries.worldgen || []) {
    const dim = w.dimension || 'overworld';
    for (const ref of [w.block, w.overworldBlock, w.deepslateBlock]) {
      if (!ref) continue;
      const id = stripNs(ref);
      if (!map.has(id)) map.set(id, dim);
    }
  }
  return map;
}

function baseRockOf(dim, blockId) {
  if (String(blockId).startsWith('deepslate_')) return 'deepslate';
  if (dim === 'nether') return 'netherrack';
  if (dim === 'end') return 'end_stone';
  return 'stone';
}

/** 物品默认底图 */
function defaultItemSource(it) {
  const kind = it.kind || 'material';
  if (kind === 'tool') {
    const t = String(it.toolType || 'sword');
    const map = { sword: 'diamond_sword', pickaxe: 'diamond_pickaxe', axe: 'diamond_axe', shovel: 'diamond_shovel', hoe: 'diamond_hoe' };
    return { kind: 'item', source: map[t] || 'diamond_sword' };
  }
  if (kind === 'armor') {
    const s = String(it.armorSlot || 'helmet');
    return { kind: 'item', source: `diamond_${s}` };
  }
  return { kind: 'item', source: 'diamond' };
}

/**
 * 推导一张贴图的配置。
 * 优先用用户配的 texture，其次按类型猜。
 */
export function resolveTexture(entry, type, ctx) {
  const cfg = entry.texture;
  if (cfg && cfg.mode === 'custom') return null; // 用户自己画，不覆盖
  if (cfg && cfg.mode && cfg.mode !== 'none' && cfg.source) {
    return { ...cfg, kind: cfg.kind || (type === 'block' ? 'block' : 'item') };
  }
  if (cfg && cfg.mode === 'none') return null;

  if (type === 'block') {
    const dim = ctx.dimensions.get(entry.id) || 'overworld';
    const base = baseRockOf(dim, entry.id);
    if (entry.kind === 'ore') {
      // 用与原版宿主配对的矿石模板做差分，避免把下界岩底色也染成矿点色
      const isDeep = base === 'deepslate';
      const source = isDeep ? 'deepslate_diamond_ore' : base === 'netherrack' ? 'nether_gold_ore' : 'diamond_ore';
      return {
        mode: 'ore',
        kind: 'block',
        source,
        host: hostOf(source),
        base,
        palette: ctx.palette || 'ruby',
      };
    }
    const srcMap = { storage: 'diamond_block' };
    return { mode: 'recolor', kind: 'block', source: srcMap[entry.kind] || 'stone', palette: ctx.palette || 'stone' };
  }

  const d = defaultItemSource(entry);
  return { ...d, mode: 'recolor', palette: ctx.palette || 'ruby' };
}

/** 素材库里有没有这个方块底图 */
function hasVanilla(kind, name) {
  try {
    readVanilla(kind, name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成全部贴图。
 * @returns [{path, content(Buffer), binary:true}]
 */
export function genTextures(p, adapter) {
  const legacy = adapter?.features?.resourceFormat === '1.20.1';
  const ns = p.meta.id;
  const files = [];
  const dimensions = dimensionMap(p);
  const notes = [];

  // 每个内容类型可以用自己的默认配色。约定：id 里出现色系名就用那个色系
  const guessPalette = (id, fallback) => {
    for (const key of Object.keys(PRESETS)) {
      if (String(id).includes(key)) return key;
    }
    return fallback;
  };

  const emit = (cfg, relPath, label) => {
    if (!cfg) return;
    const img = buildTexture(cfg);
    if (!img) {
      notes.push(`${label} 的贴图未能生成（素材 "${cfg.source}" 可能不存在）`);
      return;
    }
    files.push({ path: relPath, content: pngBuffer(img), binary: true });
  };

  // ---- 物品贴图 ----
  for (const it of p.entries.item || []) {
    const ctx = { dimensions, palette: guessPalette(it.id, 'ruby') };
    const cfg = resolveTexture(it, 'item', ctx);
    // 兜底：底图不存在就退回钻石
    if (cfg && !hasVanilla(cfg.kind || 'item', cfg.source)) {
      notes.push(`物品「${it.id}」的贴图素材 ${cfg.source} 不存在，已退回 diamond`);
      cfg.source = 'diamond';
      cfg.kind = 'item';
    }
    emit(cfg, `src/main/resources/assets/${ns}/textures/item/${it.id}.png`, `物品「${it.id}」`);
  }

  // ---- 方块贴图 ----
  for (const b of p.entries.block || []) {
    const ctx = { dimensions, palette: guessPalette(b.id, b.kind === 'ore' ? 'ruby' : 'stone') };
    const cfg = resolveTexture(b, 'block', ctx);
    if (cfg && cfg.mode === 'ore') {
      if (!hasVanilla('block', cfg.source)) cfg.source = 'diamond_ore';
      if (!hasVanilla('block', cfg.host)) cfg.host = 'stone';
      if (!hasVanilla('block', cfg.base)) cfg.base = 'stone';
    } else if (cfg && !hasVanilla('block', cfg.source)) {
      cfg.source = b.kind === 'storage' ? 'diamond_block' : 'stone';
    }
    emit(cfg, `src/main/resources/assets/${ns}/textures/block/${b.id}.png`, `方块「${b.id}」`);
  }

  // ---- 盔甲层贴图 ----
  for (const m of p.entries.armorMaterial || []) {
    const pal = typeof m.texturePalette === 'string' ? m.texturePalette : guessPalette(m.id, 'ruby');
    const p2 = PRESETS[pal] || PRESETS.ruby;
    const layers = legacy
      ? [['equip_h', 'layer_1'], ['equip_l', 'layer_2']]
      : [['equip_h', 'humanoid'], ['equip_l', 'humanoid_leggings']];
    for (const [layer, dir] of layers) {
      try {
        const img = readVanilla(layer, 'diamond');
        const out = recolor(img, p2);
        // 1.20.1 的盔甲贴图路径由 ArmorMaterial.getName() 硬编码到 minecraft 命名空间下；
        // 26.x 走 assets/<ns>/equipment/<name>.json 描述的自定义层。
        const rel = legacy
          ? `src/main/resources/assets/minecraft/textures/models/armor/${m.id}_${dir}.png`
          : `src/main/resources/assets/${ns}/textures/entity/equipment/${dir}/${m.id}.png`;
        files.push({ path: rel, content: pngBuffer(out), binary: true });
      } catch (e) {
        notes.push(`盔甲材质「${m.id}」的 ${dir} 层贴图生成失败：${e.message}`);
      }
    }
  }

  // ---- mod 图标 ----
  // 有内容就拿第一个物品当图标；空工程也要给一个，否则 fabric.mod.json 引用会落空
  const firstItem = (p.entries.item || [])[0];
  const firstBlock = (p.entries.block || [])[0];
  const iconSrc = firstItem
    ? `src/main/resources/assets/${ns}/textures/item/${firstItem.id}.png`
    : firstBlock
      ? `src/main/resources/assets/${ns}/textures/block/${firstBlock.id}.png`
      : null;
  const iconFile = iconSrc ? files.find((f) => f.path === iconSrc) : null;
  if (iconFile) {
    files.push({ path: `src/main/resources/assets/${ns}/icon.png`, content: iconFile.content, binary: true });
  } else {
    try {
      const base = readVanilla('item', 'diamond');
      files.push({
        path: `src/main/resources/assets/${ns}/icon.png`,
        content: pngBuffer(recolor(base, PRESETS.ruby)),
        binary: true,
      });
    } catch {
      notes.push('默认 mod 图标生成失败');
    }
  }

  files.notes = notes;
  return files;
}

/** 单独生成一张贴图给界面预览用（不写盘） */
export function previewTexture(entry, type, p) {
  const dimensions = dimensionMap(p);
  const cfg = resolveTexture(entry, type, { dimensions, palette: 'ruby' });
  if (!cfg) return null;
  if (cfg.mode === 'ore') {
    if (!hasVanilla('block', cfg.source)) cfg.source = 'diamond_ore';
    if (!hasVanilla('block', cfg.host)) cfg.host = 'stone';
    if (!hasVanilla('block', cfg.base)) cfg.base = 'stone';
  }
  return buildTexture(cfg);
}

export { composeOre, recolor, PRESETS };
