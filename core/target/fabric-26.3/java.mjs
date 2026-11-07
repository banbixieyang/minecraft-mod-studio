/**
 * Fabric 26.3 的 Java 代码生成。
 *
 * 26.3 的物品是「组件式」的：没有 SwordItem / ArmorItem 这些类，
 * 所有行为都由 Item.Properties 的工厂方法表达（.sword() / .humanoidArmor() 等）。
 * 这对手写代码不算友好，但对可视化编辑器反而是好事 —— 表单字段能一比一映射成属性链。
 */
import { toPascal, toConstant, javaStr } from '../../ids.mjs';

const RARITIES = new Set(['COMMON', 'UNCOMMON', 'RARE', 'EPIC']);

export const TOOL_PRESETS = {
  wood: 'WOOD', stone: 'STONE', copper: 'COPPER', iron: 'IRON',
  diamond: 'DIAMOND', gold: 'GOLD', netherite: 'NETHERITE',
};

/** 把稀有度字段规范化成枚举名 */
function rarity(v) {
  const s = String(v || 'common').toUpperCase();
  return RARITIES.has(s) ? s : 'COMMON';
}

/** 数值格式化：1 → "1.0"，保持 Java float 字面量合法 */
function f(n, dflt = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}F` : `${dflt.toFixed(1)}F`;
}

function i(n, dflt = 0) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? String(v) : String(dflt);
}

/** 每个物品/方块对应的常量名 */
export function constName(id) {
  return toConstant(id);
}

// ============================================================
// 主类
// ============================================================
export function genMainClass(p) {
  const cls = toPascal(p.meta.id);
  const pkg = p.meta.pkg;
  const hasBlocks = (p.entries.block || []).length > 0;
  const hasWorldgen = (p.entries.worldgen || []).length > 0;
  // 只有「服务端事件」（非按键事件）才会在 ModLogic 里生成 init()。
  // 按键事件是客户端事件，接线在 ModClient 里 —— 纯按键工程不能调 ModLogic.init()，
  // 否则会引用一个不存在的方法，javac 直接报错。
  const isServerProg = (x) => x && x.op && x.op !== 'event.key_pressed';
  const hasVisual = (p.visual?.programs || []).some(isServerProg)
    || ['item', 'block'].some((t) => (p.entries?.[t] || [])
      .some((e) => (e.visualPrograms || []).some(isServerProg)));
  const worldgenImport = hasWorldgen ? `import ${pkg}.world.ModWorldGen;\n` : '';
  const worldgenCall = hasWorldgen ? '        ModWorldGen.init();\n' : '';
  // 结构类型 / 拼块类型必须在数据包加载前注册，所以在主入口调一次。
  // （Forge 那边不用改主类：ModStructures 自己挂了 @Mod.EventBusSubscriber。）
  const hasStructures = (p.entries?.structure || []).length > 0;
  const structureImport = hasStructures ? `import ${pkg}.world.ModStructures;\n` : '';
  const structureCall = hasStructures ? '        ModStructures.init();\n' : '';
  // 有服务端积木程序时，把接线挂进 onInitialize
  const visualImport = hasVisual ? `import ${pkg}.custom.ModLogic;\n` : '';
  const visualCall = hasVisual ? '        ModLogic.init();\n' : '';
  return `package ${pkg};

import ${pkg}.registry.ModArmorMaterials;
${hasBlocks ? `import ${pkg}.registry.ModBlocks;\n` : ''}import ${pkg}.registry.ModItems;
import ${pkg}.registry.ModTabs;
import ${pkg}.registry.ModTiers;
import ${pkg}.custom.CustomContent;
${visualImport}${worldgenImport}${structureImport}import net.fabricmc.api.ModInitializer;
import net.minecraft.resources.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ${javaStr(p.meta.name)} 的主入口。
 *
 * <p>本文件由 MC Studio 生成。想加自己的初始化逻辑，请改 {@code custom/CustomContent.java}，
 * 那是手写区，重新生成不会覆盖。
 */
public class ${cls} implements ModInitializer {
    public static final String MOD_ID = "${p.meta.id}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public static Identifier id(String path) {
        return Identifier.fromNamespaceAndPath(MOD_ID, path);
    }

    @Override
    public void onInitialize() {
        ModTiers.init();
        ModArmorMaterials.init();
${hasBlocks ? '        ModBlocks.init();\n' : ''}        ModItems.init();
        ModTabs.init();
${worldgenCall}${structureCall}${visualCall}        CustomContent.init();
        // @hook:init
        LOGGER.info("[${p.meta.id}] 已加载 {} 个物品${hasBlocks ? ' / {} 个方块' : ''}",
                ModItems.all().size()${hasBlocks ? ', ModBlocks.all().size()' : ''});
    }
}
`;
}

// ============================================================
// 工具材质
// ============================================================
export function genTiers(p) {
  const tiers = p.entries.tier || [];
  const pkg = p.meta.pkg;
  const body = tiers
    .map((t) => {
      const incorrect = String(t.incorrectFor || 'diamond').toUpperCase();
      return `    /** ${javaStr(t.nameZh || t.id)}：耐久 ${i(t.durability, 1561)} / 速度 ${f(t.speed, 8)} / 伤害加成 ${f(t.attackDamageBonus, 3)} */
    public static final ToolMaterial ${constName(t.id)} = new ToolMaterial(
            BlockTags.INCORRECT_FOR_${incorrect}_TOOL,
            ${i(t.durability, 1561)}, ${f(t.speed, 8)}, ${f(t.attackDamageBonus, 3)}, ${i(t.enchantmentValue, 10)},
            ModTags.${constName(t.id)}_TOOL_MATERIALS);`;
    })
    .join('\n\n');

  return `package ${pkg}.registry;

import net.minecraft.tags.BlockTags;
import net.minecraft.world.item.ToolMaterial;

/**
 * 工具材质。数值语义：耐久 / 挖掘速度 / 攻击伤害加成 / 附魔能力 / 维修材料标签。
 * 本文件由 MC Studio 生成。
 */
public final class ModTiers {
${body}

    public static void init() {
        // 空方法：被主类调用以触发类加载（静态字段在类初始化时构造材质）
    }

    private ModTiers() {
    }
}
`;
}

// ============================================================
// 盔甲材质
// ============================================================
export function genArmorMaterials(p) {
  const mats = p.entries.armorMaterial || [];
  const pkg = p.meta.pkg;
  const body = mats
    .map((m) => {
      const sound = String(m.equipSound || 'diamond').toUpperCase();
      return `    public static final ArmorMaterial ${constName(m.id)} = create("${m.id}", ${i(m.durability, 33)},
            Map.of(ArmorType.HELMET, ${i(m.defHelmet, 3)}, ArmorType.CHESTPLATE, ${i(m.defChest, 8)},
                    ArmorType.LEGGINGS, ${i(m.defLegs, 6)}, ArmorType.BOOTS, ${i(m.defBoots, 3)}),
            ${i(m.enchantmentValue, 10)}, ${f(m.toughness, 2)}, ${f(m.knockbackResistance, 0)},
            ModTags.${constName(m.id)}_ARMOR_MATERIALS, SoundEvents.ARMOR_EQUIP_${sound});`;
    })
    .join('\n\n');

  return `package ${pkg}.registry;

import ${pkg}.${toPascal(p.meta.id)};
import java.util.Map;
import net.minecraft.core.Holder;
import net.minecraft.resources.ResourceKey;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.equipment.ArmorMaterial;
import net.minecraft.world.item.equipment.ArmorType;
import net.minecraft.world.item.equipment.EquipmentAsset;
import net.minecraft.world.item.equipment.EquipmentAssets;

/**
 * 盔甲材质。渲染资源由 assets/${p.meta.id}/equipment/&lt;name&gt;.json 描述，
 * 贴图在 assets/${p.meta.id}/textures/entity/equipment/humanoid/&lt;name&gt;.png。
 * 本文件由 MC Studio 生成。
 */
public final class ModArmorMaterials {
${body}

    private static ArmorMaterial create(String name, int durability, Map<ArmorType, Integer> defense,
                                        int enchantmentValue, float toughness, float knockbackResistance,
                                        TagKey<Item> repairIngredient, Holder<SoundEvent> equipSound) {
        ResourceKey<EquipmentAsset> asset = ResourceKey.create(EquipmentAssets.ROOT_ID, ${toPascal(p.meta.id)}.id(name));
        return new ArmorMaterial(durability, defense, enchantmentValue, equipSound,
                toughness, knockbackResistance, repairIngredient, asset);
    }

    public static void init() {
    }

    private ModArmorMaterials() {
    }
}
`;
}

// ============================================================
// 物品注册
// ============================================================
export function genItems(p) {
  const items = p.entries.item || [];
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);
  const tiers = new Set((p.entries.tier || []).map((t) => t.id));
  const armors = new Set((p.entries.armorMaterial || []).map((m) => m.id));

  // 按 kind 分组，生成的源码读起来有层次
  const groups = { material: [], tool: [], armor: [], simple: [] };
  for (const it of items) {
    const g = it.kind === 'tool' ? 'tool' : it.kind === 'armor' ? 'armor' : it.kind === 'material' ? 'material' : 'simple';
    groups[g].push(it);
  }

  const decl = [];
  const pushGroup = (label, list, fn) => {
    if (!list.length) return;
    decl.push(`    // ===================== ${label} =====================`);
    for (const it of list) decl.push(fn(it));
    decl.push('');
  };

  /** 公共属性前缀 */
  const propsChain = (it) => {
    const parts = [`new Item.Properties()`];
    if (Number(it.stacksTo) > 0 && Number(it.stacksTo) !== 64) parts.push(`.stacksTo(${i(it.stacksTo, 64)})`);
    parts.push(`.rarity(Rarity.${rarity(it.rarity)})`);
    if (it.fireResistant) parts.push('.fireResistant()');
    return parts.join('\n                    ');
  };

  const tooltipArgs = (it) => {
    const lines = (it.tooltip || []).filter((s) => String(s).trim());
    if (!lines.length) return null;
    return lines.map((_, n) => `"tooltip.${p.meta.id}.${it.id}.${n}"`).join(', ');
  };

  const simpleDecl = (it) => {
    const tt = tooltipArgs(it);
    if (!tt) return `    public static final Item ${constName(it.id)} = reg("${it.id}", ${propsChain(it)});`;
    return `    public static final Item ${constName(it.id)} = reg("${it.id}",
            props -> new DescribedItem(props, ${tt}),
            ${propsChain(it)});`;
  };

  const toolDecl = (it) => {
    const type = String(it.toolType || 'sword').toLowerCase();
    const mode = it.materialMode === 'custom' ? 'custom' : 'preset';
    const matExpr =
      mode === 'custom' && tiers.has(it.tier)
        ? `ModTiers.${constName(it.tier)}`
        : `ToolMaterial.${TOOL_PRESETS[it.materialPreset] || 'DIAMOND'}`;
    const dmg = it.attackDamage !== undefined && it.attackDamage !== '' ? it.attackDamage : defaultDamage(type);
    const spd = it.attackSpeed !== undefined && it.attackSpeed !== '' ? it.attackSpeed : defaultSpeed(type);
    const tt = tooltipArgs(it);
    const factory = tt ? `props -> new DescribedItem(props, ${tt})` : 'Item::new';
    return `    public static final Item ${constName(it.id)} = reg("${it.id}",
            ${factory},
            new Item.Properties().rarity(Rarity.${rarity(it.rarity)}).${type}(${matExpr}, ${f(dmg)}, ${f(spd)}));`;
  };

  const armorDecl = (it) => {
    const slot = String(it.armorSlot || 'helmet').toLowerCase();
    const type = slot.toUpperCase();
    const mat = armors.has(it.armorMaterial) ? `ModArmorMaterials.${constName(it.armorMaterial)}` : null;
    const tt = tooltipArgs(it);
    const factory = tt ? `props -> new DescribedItem(props, ${tt})` : 'Item::new';
    const body = mat
      ? `new Item.Properties().rarity(Rarity.${rarity(it.rarity)}).humanoidArmor(${mat}, ArmorType.${type})`
      : `new Item.Properties().rarity(Rarity.${rarity(it.rarity)}).stacksTo(1)`;
    return `    public static final Item ${constName(it.id)} = reg("${it.id}",
            ${factory},
            ${body});`;
  };

  pushGroup('材料', groups.material, simpleDecl);
  pushGroup('工具', groups.tool, toolDecl);
  pushGroup('盔甲', groups.armor, armorDecl);
  pushGroup('其他物品', groups.simple, simpleDecl);

  const declText = decl.join('\n');

  /**
   * import 判定从「已经生成的代码」里读，而不是再预测一遍。
   *
   * 为什么：toolDecl 有两条分支 —— 自定义材质走 ModTiers.X，否则退回
   * ToolMaterial.X。之前这里靠 `materialMode === 'custom'` 预测要不要
   * import ToolMaterial，而分析导入的物品从资源文件反推、根本没有
   * materialMode 字段，于是走了 ToolMaterial 分支却没拿到 import，
   * 编译直接报「找不到符号: ToolMaterial」。
   *
   * 预测和生成是两处独立的逻辑，迟早会漂。让 import 跟着生成结果走，
   * 这类 bug 就不可能再出现 —— 以后改分支也不用回来同步这里。
   */
  const uses = (token) => declText.includes(token);

  const imports = [
    `import ${pkg}.${cls};`,
    uses('new DescribedItem(') ? `import ${pkg}.item.DescribedItem;` : null,
    uses('ModArmorMaterials.') ? `import ${pkg}.registry.ModArmorMaterials;` : null,
    uses('ModTiers.') ? `import ${pkg}.registry.ModTiers;` : null,
    'import java.util.ArrayList;',
    'import java.util.List;',
    'import java.util.function.Function;',
    'import net.minecraft.core.Registry;',
    'import net.minecraft.core.registries.BuiltInRegistries;',
    'import net.minecraft.core.registries.Registries;',
    'import net.minecraft.resources.ResourceKey;',
    'import net.minecraft.world.item.Item;',
    'import net.minecraft.world.item.Rarity;',
    uses('ToolMaterial.') ? 'import net.minecraft.world.item.ToolMaterial;' : null,
    uses('ArmorType.') ? 'import net.minecraft.world.item.equipment.ArmorType;' : null,
  ].filter(Boolean);

  return `package ${pkg}.registry;

${imports.join('\n')}

/**
 * 全部物品注册。本文件由 MC Studio 生成 —— 直接改会被下次生成覆盖。
 * 需要手写逻辑，请在 ${pkg}.custom.CustomContent 里追加。
 */
public final class ModItems {
    private static final List<Item> ALL = new ArrayList<>();

${declText}    // @hook:items
    public static void init() {
        // 触发类加载
    }

    public static List<Item> all() {
        return ALL;
    }

    private static Item reg(String name, Item.Properties props) {
        return reg(name, Item::new, props);
    }

    private static <T extends Item> T reg(String name, Function<Item.Properties, T> factory, Item.Properties props) {
        ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, ${cls}.id(name));
        T item = factory.apply(props.setId(key));
        Registry.register(BuiltInRegistries.ITEM, key, item);
        ALL.add(item);
        return item;
    }

    private ModItems() {
    }
}
`;
}

function defaultDamage(type) {
  return { sword: 3.0, pickaxe: 1.0, axe: 6.0, shovel: 1.5, hoe: -2.0 }[type] ?? 1.0;
}
function defaultSpeed(type) {
  return { sword: -2.4, pickaxe: -2.8, axe: -3.2, shovel: -3.0, hoe: 0.0 }[type] ?? -2.4;
}

// ============================================================
// 方块注册
// ============================================================
export function genBlocks(p) {
  const blocks = p.entries.block || [];
  if (!blocks.length) return null;
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);

  const ore = blocks.filter((b) => b.kind === 'ore');
  const storage = blocks.filter((b) => b.kind === 'storage');
  const plain = blocks.filter((b) => b.kind !== 'ore' && b.kind !== 'storage');

  const lines = [];
  const add = (label, list, fn) => {
    if (!list.length) return;
    lines.push(`    // ===================== ${label} =====================`);
    for (const b of list) lines.push(fn(b));
    lines.push('');
  };

  const soundOf = (b) => {
    const s = String(b.sound || 'stone').toUpperCase();
    return `SoundType.${s}`;
  };

  add('矿石', ore, (b) => `    public static final Block ${constName(b.id)} = ore("${b.id}",
            ${f(b.hardness, 3)}, ${f(b.resistance, 3)}, ${i(b.xpMin, 0)}, ${i(b.xpMax, 0)}, ${soundOf(b)});`);

  add('矿物块 / 建筑方块', storage, (b) => `    public static final Block ${constName(b.id)} = storage("${b.id}",
            ${f(b.hardness, 5)}, ${f(b.resistance, 6)}, ${soundOf(b)});`);

  add('普通方块', plain, (b) => {
    const light = Number(b.lightLevel) > 0 ? `.lightLevel(state -> ${i(b.lightLevel, 0)})` : '';
    const tool = b.requiresTool === false ? '' : '.requiresCorrectToolForDrops()';
    return `    public static final Block ${constName(b.id)} = plain("${b.id}",
            ${f(b.hardness, 2)}, ${f(b.resistance, 3)}, ${soundOf(b)}${light}${tool});`;
  });

  return `package ${pkg}.registry;

import ${pkg}.${cls};
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.util.valueproviders.UniformInt;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.DropExperienceBlock;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;

/**
 * 全部方块注册。本文件由 MC Studio 生成。
 */
public final class ModBlocks {
    private static final List<Block> BLOCKS = new ArrayList<>();
    private static final List<Item> ITEMS = new ArrayList<>();

${lines.join('\n')}    // @hook:blocks
    public static void init() {
    }

    public static List<Block> all() {
        return BLOCKS;
    }

    private static Block ore(String name, float hardness, float resistance, int xpMin, int xpMax, SoundType sound) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK, ${cls}.id(name));
        Block block = new DropExperienceBlock(UniformInt.of(xpMin, xpMax), BlockBehaviour.Properties.of()
                .setId(key).strength(hardness, resistance).requiresCorrectToolForDrops().sound(sound));
        Registry.register(BuiltInRegistries.BLOCK, key, block);
        BLOCKS.add(block);
        registerBlockItem(name, block);
        return block;
    }

    private static Block storage(String name, float hardness, float resistance, SoundType sound) {
        return plain(name, hardness, resistance, sound);
    }

    private static Block plain(String name, float hardness, float resistance, SoundType sound) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK, ${cls}.id(name));
        Block block = new Block(BlockBehaviour.Properties.of()
                .setId(key).strength(hardness, resistance).requiresCorrectToolForDrops().sound(sound));
        Registry.register(BuiltInRegistries.BLOCK, key, block);
        BLOCKS.add(block);
        registerBlockItem(name, block);
        return block;
    }

    private static void registerBlockItem(String name, Block block) {
        ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, ${cls}.id(name));
        Item item = new BlockItem(block, new Item.Properties().setId(key).useBlockDescriptionPrefix());
        Registry.register(BuiltInRegistries.ITEM, key, item);
        ITEMS.add(item);
    }

    private ModBlocks() {
    }
}
`;
}

// ============================================================
// 创造栏
// ============================================================
export function genTabs(p) {
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);
  const items = p.entries.item || [];
  const blocks = p.entries.block || [];
  const iconItem = items.find((it) => it.kind === 'material') || items[0];
  const iconExpr = iconItem
    ? `new ItemStack(ModItems.${constName(iconItem.id)})`
    : blocks.length
      ? `new ItemStack(ModBlocks.${constName(blocks[0].id)}.asItem())`
      : 'ItemStack.EMPTY';

  const blockLoop = blocks.length
    ? `                    for (Block block : ModBlocks.all()) {
                        output.accept(block.asItem());
                    }
`
    : '';
  const blockImport = blocks.length ? 'import net.minecraft.world.level.block.Block;\n' : '';

  return `package ${pkg}.registry;

import ${pkg}.${cls};
import net.fabricmc.fabric.api.creativetab.v1.FabricCreativeModeTab;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
${blockImport}
/** 自定义创造栏。本文件由 MC Studio 生成。 */
public final class ModTabs {
    public static final ResourceKey<CreativeModeTab> MAIN =
            ResourceKey.create(Registries.CREATIVE_MODE_TAB, ${cls}.id("main"));

    public static void init() {
        CreativeModeTab tab = FabricCreativeModeTab.builder()
                .title(Component.translatable("itemGroup.${p.meta.id}.main"))
                .icon(() -> ${iconExpr})
                .displayItems((params, output) -> {
                    for (Item item : ModItems.all()) {
                        output.accept(item);
                    }
${blockLoop}                    // @hook:tabs
                })
                .build();
        Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, MAIN, tab);
    }

    private ModTabs() {
    }
}
`;
}

// ============================================================
// 标签
// ============================================================
export function genTags(p) {
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);
  const tiers = p.entries.tier || [];
  const armors = p.entries.armorMaterial || [];
  const blocks = p.entries.block || [];

  // 26.3 起 ItemTags/BlockTags 不再接受 Identifier，统一走 TagKey.create(Registries.X, id)
  const sections = [];
  if (blocks.length) {
    sections.push(`    /** 全部矿石，供矿物标记、连锁挖矿类机制识别 */
    public static final TagKey<Block> ORES = TagKey.create(Registries.BLOCK, ${cls}.id("ores"));`);
  }
  if (tiers.length) {
    sections.push(
      tiers
        .map((t) => `    /** ${javaStr(t.nameZh || t.id)} 的维修材料 */
    public static final TagKey<Item> ${constName(t.id)}_TOOL_MATERIALS = TagKey.create(Registries.ITEM, ${cls}.id("${t.id}_tool_materials"));`)
        .join('\n\n'),
    );
  }
  if (armors.length) {
    sections.push(
      armors
        .map((m) => `    public static final TagKey<Item> ${constName(m.id)}_ARMOR_MATERIALS = TagKey.create(Registries.ITEM, ${cls}.id("${m.id}_armor_materials"));`)
        .join('\n\n'),
    );
  }

  return `package ${pkg}.registry;

import ${pkg}.${cls};
import net.minecraft.core.registries.Registries;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;

/**
 * 本模组的标签。维修材料标签决定了铁砧里能用什么东西修工具/盔甲。
 * 本文件由 MC Studio 生成。
 */
public final class ModTags {
${sections.join('\n\n')}

    public static void init() {
    }

    private ModTags() {
    }
}
`;
}

// ============================================================
// 世界生成
// ============================================================
export function genWorldGen(p) {
  const list = p.entries.worldgen || [];
  if (!list.length) return null;
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);

  const byDim = { overworld: [], nether: [], end: [] };
  for (const w of list) {
    const d = ['nether', 'end'].includes(w.dimension) ? w.dimension : 'overworld';
    byDim[d].push(w);
  }

  const section = (label, sel, arr) =>
    arr.length
      ? `        // ${label}
${arr.map((w) => `        add("${w.id}", ${sel});`).join('\n')}
`
      : '';

  return `package ${pkg}.world;

import ${pkg}.${cls};
import java.util.function.Predicate;
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectionContext;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.levelgen.GenerationStep;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;

/**
 * 矿物生成：把 datapack 里的 placed_feature 挂到对应维度的生物群系。
 * 本文件由 MC Studio 生成。
 */
public final class ModWorldGen {
    public static void init() {
        Predicate<BiomeSelectionContext> overworld = BiomeSelectors.foundInOverworld();
        Predicate<BiomeSelectionContext> nether = BiomeSelectors.foundInTheNether();
        Predicate<BiomeSelectionContext> end = BiomeSelectors.foundInTheEnd();

${section('主世界', 'overworld', byDim.overworld)}${section('下界', 'nether', byDim.nether)}${section('末地', 'end', byDim.end)}    }

    private static void add(String name, Predicate<BiomeSelectionContext> selector) {
        ResourceKey<PlacedFeature> key = ResourceKey.create(Registries.PLACED_FEATURE, ${cls}.id(name));
        BiomeModifications.addFeature(selector, GenerationStep.Decoration.UNDERGROUND_ORES, key);
    }

    private ModWorldGen() {
    }
}
`;
}

/** 手写区骨架：只在文件不存在时创建，永不覆盖 */
export function genCustomContent(p) {
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);
  return `package ${pkg}.custom;

import ${pkg}.${cls};

/**
 * 手写区 —— MC Studio 永远不会覆盖这个文件。
 *
 * 想加完全自由的代码（自定义事件、命令、机制），就写在这里，
 * 或者在这个目录下新建类，然后在这里调用。
 */
public final class CustomContent {

    public static void init() {
        ${cls}.LOGGER.info("[${p.meta.id}] 手写区已加载");
        // 示例：
        //   ServerTickEvents.END_SERVER_TICK.register(server -> { ... });
    }

    private CustomContent() {
    }
}
`;
}

/** 带 tooltip 的物品基类，是静态模板 */
export function genDescribedItem(p) {
  const pkg = p.meta.pkg;
  return `package ${pkg}.item;

import java.util.function.Consumer;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.component.TooltipDisplay;

/** 带说明文本的通用物品：把机制写进 tooltip，玩家不用查资料。 */
public class DescribedItem extends Item {
    private final String[] descKeys;

    public DescribedItem(Properties properties, String... descKeys) {
        super(properties);
        this.descKeys = descKeys;
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, TooltipDisplay display,
                                Consumer<Component> tooltip, TooltipFlag flag) {
        super.appendHoverText(stack, context, display, tooltip, flag);
        for (String key : descKeys) {
            tooltip.accept(Component.translatable(key).withStyle(ChatFormatting.GRAY));
        }
    }
}
`;
}
