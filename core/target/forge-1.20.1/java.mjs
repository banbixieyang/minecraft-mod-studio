/**
 * Forge 1.20.1 的 Java 代码生成。
 *
 * 与 26.3 最大的区别：1.20.1 是「类继承式」物品（SwordItem / ArmorItem 都还在），
 * 注册走 DeferredRegister + RegistryObject，并且必须把 DeferredRegister 挂到
 * mod event bus 上，静态字段自己注册是无效的。
 *
 * 签名以官方 MDK 1.20.1-47.4.0 为基准，并且由 tests/forge.mjs 真编译兜底：
 * 写错类名/方法名，Gradle 会直接报错，不会混进交付里。
 */
import { toPascal, toConstant, javaStr } from '../../ids.mjs';

const RARITIES = new Set(['COMMON', 'UNCOMMON', 'RARE', 'EPIC']);

/** 1.20.1 的 Tiers 枚举没有 COPPER，映射到同级材质 */
export const TOOL_PRESETS = {
  wood: 'WOOD', stone: 'STONE', copper: 'IRON', iron: 'IRON',
  diamond: 'DIAMOND', gold: 'GOLD', netherite: 'NETHERITE',
};

const TOOL_CLASS = {
  sword: 'SwordItem', pickaxe: 'PickaxeItem', axe: 'AxeItem',
  shovel: 'ShovelItem', hoe: 'HoeItem',
};

const ARMOR_SLOTS = new Set(['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS']);

function rarity(v) {
  const s = String(v || 'common').toUpperCase();
  return RARITIES.has(s) ? s : 'COMMON';
}
function f(n, d = 0) {
  const v = Number(n);
  return `${(Number.isFinite(v) ? v : d).toFixed(1)}F`;
}
function flt(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : String(d);
}
function i(n, d = 0) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? String(v) : String(d);
}
export function constName(id) {
  return toConstant(id);
}

/** 1.20.1 的 Item.Properties 链：没有 setId，也不需要，DeferredRegister 负责命名 */
function propsChain(it) {
  const parts = ['new Item.Properties()'];
  const stack = Number(it.stacksTo);
  if (stack > 0 && stack !== 64) parts.push(`.stacksTo(${i(stack, 64)})`);
  parts.push(`.rarity(Rarity.${rarity(it.rarity)})`);
  if (it.fireResistant) parts.push('.fireResistant()');
  return parts.join('');
}

function defaultDamage(type) {
  return { sword: 3, pickaxe: 1, axe: 6, shovel: 1, hoe: -2 }[type] ?? 1;
}
function defaultSpeed(type) {
  return { sword: -2.4, pickaxe: -2.8, axe: -3.2, shovel: -3.0, hoe: 0.0 }[type] ?? -2.4;
}

// ============================================================
// 主类
// ============================================================
export function genMainClass(p) {
  const cls = toPascal(p.meta.id);
  const pkg = p.meta.pkg;
  const hasVisual = (p.visual?.programs || []).length > 0;
  return `package ${pkg};

import ${pkg}.custom.CustomContent;
${hasVisual ? `import ${pkg}.custom.ModLogic;\n` : ''}import ${pkg}.registry.ModBlocks;
import ${pkg}.registry.ModItems;
import ${pkg}.registry.ModTabs;
import com.mojang.logging.LogUtils;
import net.minecraft.resources.ResourceLocation;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;

/**
 * ${javaStr(p.meta.name)} 的 Forge 主类。
 *
 * <p>本文件由 MC Studio 生成。想加自己的初始化逻辑，请改 {@code custom/CustomContent.java}，
 * 那是手写区，重新生成不会覆盖。
 */
@Mod(${cls}.MOD_ID)
public class ${cls} {
    public static final String MOD_ID = "${p.meta.id}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ${cls}(FMLJavaModLoadingContext context) {
        IEventBus bus = context.getModEventBus();
        ModItems.register(bus);
        ModBlocks.register(bus);
        ModTabs.register(bus);
        MinecraftForge.EVENT_BUS.register(this);
${hasVisual ? '        ModLogic.init();\n' : ''}        CustomContent.init(bus);
        // @hook:init
        LOGGER.info("[${p.meta.id}] 已加载");
    }

    public static ResourceLocation id(String path) {
        return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
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
  const lines = [];
  for (const t of p.entries.tier || []) {
    lines.push(`    public static final TagKey<Item> ${constName(t.id)}_TOOL_MATERIALS = item("${t.id}_tool_materials");`);
  }
  for (const m of p.entries.armorMaterial || []) {
    lines.push(`    public static final TagKey<Item> ${constName(m.id)}_ARMOR_MATERIALS = item("${m.id}_armor_materials");`);
  }
  if ((p.entries.block || []).some((b) => b.kind === 'ore')) {
    lines.push(`    public static final TagKey<Block> ORES = block("ores");`);
  }

  return `package ${pkg}.registry;

import ${pkg}.${cls};
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;

/** 模组用到的 TagKey。对应 data/${p.meta.id}/tags/ 下的 json。本文件由 MC Studio 生成。 */
public final class ModTags {
${lines.length ? lines.join('\n') + '\n' : ''}
    private static TagKey<Item> item(String path) {
        return TagKey.create(Registries.ITEM, ResourceLocation.fromNamespaceAndPath(${cls}.MOD_ID, path));
    }

    private static TagKey<Block> block(String path) {
        return TagKey.create(Registries.BLOCK, ResourceLocation.fromNamespaceAndPath(${cls}.MOD_ID, path));
    }

    private ModTags() {
    }
}
`;
}

// ============================================================
// 工具材质
// ============================================================
export function genTiers(p) {
  const tiers = p.entries.tier || [];
  const body = tiers
    .map((t) => {
      // 1.20.1 的 Tier 只有 default getTag()，标签是「需要什么等级的工具」：
      // NEEDS_*_TOOL。26.x 的 getIncorrectBlocksForDrops() + INCORRECT_FOR_*_TOOL
      // 是 1.20.5 之后才改的名字，写进 1.20.1 会直接编不过（javap 核实过）。
      const toolTag = {
        stone: 'BlockTags.NEEDS_STONE_TOOL',
        iron: 'BlockTags.NEEDS_IRON_TOOL',
        diamond: 'BlockTags.NEEDS_DIAMOND_TOOL',
        netherite: 'BlockTags.NEEDS_DIAMOND_TOOL',
        copper: 'BlockTags.NEEDS_IRON_TOOL',
      }[String(t.incorrectFor || 'diamond').toLowerCase()] || 'null';
      return `    /** ${javaStr(t.nameZh || t.id)}：耐久 ${i(t.durability, 1561)} / 速度 ${f(t.speed, 8)} / 伤害加成 ${f(t.attackDamageBonus, 3)} */
    public static final Tier ${constName(t.id)} = new Tier() {
        @Override public int getUses() { return ${i(t.durability, 1561)}; }
        @Override public float getSpeed() { return ${f(t.speed, 8)}; }
        @Override public float getAttackDamageBonus() { return ${f(t.attackDamageBonus, 3)}; }
        @Override public int getLevel() { return ${i(t.level, 3)}; }
        @Override public int getEnchantmentValue() { return ${i(t.enchantmentValue, 10)}; }
        @Override public Ingredient getRepairIngredient() {
            return Ingredient.of(ModTags.${constName(t.id)}_TOOL_MATERIALS);
        }
        @Override public TagKey<Block> getTag() {
            return ${toolTag};
        }
    };`;
    })
    .join('\n\n');

  return `package ${pkgName(p)}.registry;

import net.minecraft.tags.BlockTags;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Tier;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.level.block.Block;

/**
 * 自定义工具材质。实现 Tier 接口而不是继承枚举，因为 1.20.1 的 Tiers 是 enum、不能扩展。
 * 维修材料走标签（data/<ns>/tags/items/<id>_tool_materials.json），与原版写法一致。
 * 本文件由 MC Studio 生成。
 */
public final class ModTiers {
${body}

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
  const body = mats
    .map((m) => {
      const sound = String(m.equipSound || 'diamond').toUpperCase();
      return `    /** ${javaStr(m.nameZh || m.id)} */
    public static final ArmorMaterial ${constName(m.id)} = new ArmorMaterial() {
        @Override public int getDurabilityForType(ArmorItem.Type type) {
            int base = ${i(m.durability, 33)};
            switch (type) {
                case HELMET: return base * 11;
                case CHESTPLATE: return base * 16;
                case LEGGINGS: return base * 15;
                case BOOTS: return base * 13;
                default: return base * 11;
            }
        }

        @Override public int getDefenseForType(ArmorItem.Type type) {
            switch (type) {
                case HELMET: return ${i(m.defHelmet, 3)};
                case CHESTPLATE: return ${i(m.defChest, 8)};
                case LEGGINGS: return ${i(m.defLegs, 6)};
                case BOOTS: return ${i(m.defBoots, 3)};
                default: return 0;
            }
        }

        @Override public int getEnchantmentValue() { return ${i(m.enchantmentValue, 10)}; }
        @Override public SoundEvent getEquipSound() { return SoundEvents.ARMOR_EQUIP_${sound}; }
        @Override public Ingredient getRepairIngredient() {
            return Ingredient.of(ModTags.${constName(m.id)}_ARMOR_MATERIALS);
        }
        @Override public String getName() { return "${m.id}"; }
        @Override public float getToughness() { return ${f(m.toughness, 2)}; }
        @Override public float getKnockbackResistance() { return ${f(m.knockbackResistance, 0)}; }
    };`;
    })
    .join('\n\n');

  return `package ${pkgName(p)}.registry;

import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.crafting.Ingredient;

/**
 * 自定义盔甲材质。1.20.1 的 ArmorMaterial 是接口，不是 enum 也不是 record。
 * getName() 决定贴图前缀：assets/minecraft/textures/models/armor/<name>_layer_1.png
 * 与 _layer_2.png 必须自己提供，否则穿上是紫黑缺贴图。
 * 本文件由 MC Studio 生成。
 */
public final class ModArmorMaterials {
${body}

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

  const simpleDecl = (it) => `    public static final RegistryObject<Item> ${constName(it.id)} =
            ITEMS.register("${it.id}", () -> new Item(${propsChain(it)}));`;

  const toolDecl = (it) => {
    const type = String(it.toolType || 'sword').toLowerCase();
    const klass = TOOL_CLASS[type] || 'SwordItem';
    const mode = it.materialMode === 'custom' ? 'custom' : 'preset';
    const matExpr =
      mode === 'custom' && tiers.has(it.tier)
        ? `ModTiers.${constName(it.tier)}`
        : `Tiers.${TOOL_PRESETS[it.materialPreset] || 'DIAMOND'}`;
    const dmg = it.attackDamage !== undefined && it.attackDamage !== '' ? it.attackDamage : defaultDamage(type);
    const spd = it.attackSpeed !== undefined && it.attackSpeed !== '' ? it.attackSpeed : defaultSpeed(type);
    // AxeItem 在 1.20.1 里攻击伤害参数是 float，其余工具是 int
    const dmgArg = type === 'axe' ? flt(dmg, 6) : i(dmg, 3);
    return `    public static final RegistryObject<Item> ${constName(it.id)} =
            ITEMS.register("${it.id}", () -> new ${klass}(${matExpr}, ${dmgArg}, ${flt(spd, -2.4)}F, ${propsChain(it)}));`;
  };

  const armorDecl = (it) => {
    const slot = String(it.armorSlot || 'helmet').toUpperCase();
    const type = ARMOR_SLOTS.has(slot) ? slot : 'HELMET';
    const mat = armors.has(it.armorMaterial) ? `ModArmorMaterials.${constName(it.armorMaterial)}` : null;
    if (!mat) return simpleDecl(it);
    return `    public static final RegistryObject<Item> ${constName(it.id)} =
            ITEMS.register("${it.id}", () -> new ArmorItem(${mat}, ArmorItem.Type.${type}, ${propsChain(it)}));`;
  };

  pushGroup('材料', groups.material, simpleDecl);
  pushGroup('工具', groups.tool, toolDecl);
  pushGroup('盔甲', groups.armor, armorDecl);
  pushGroup('其他物品', groups.simple, simpleDecl);

  const declText = decl.join('\n');
  // import 跟着生成结果走，不从字段再预测一遍（这条教训见 fabric-26.3/java.mjs）
  const uses = (token) => declText.includes(token);
  const imports = [
    `import ${pkg}.${cls};`,
    uses('ModTiers.') ? `import ${pkg}.registry.ModTiers;` : null,
    uses('ModArmorMaterials.') ? `import ${pkg}.registry.ModArmorMaterials;` : null,
    'import net.minecraft.world.item.ArmorItem;',
    'import net.minecraft.world.item.AxeItem;',
    'import net.minecraft.world.item.HoeItem;',
    'import net.minecraft.world.item.Item;',
    'import net.minecraft.world.item.PickaxeItem;',
    'import net.minecraft.world.item.Rarity;',
    'import net.minecraft.world.item.ShovelItem;',
    'import net.minecraft.world.item.SwordItem;',
    'import net.minecraft.world.item.Tiers;',
    'import net.minecraftforge.eventbus.api.IEventBus;',
    'import net.minecraftforge.registries.DeferredRegister;',
    'import net.minecraftforge.registries.ForgeRegistries;',
    'import net.minecraftforge.registries.RegistryObject;',
  ].filter(Boolean);

  return `package ${pkg}.registry;

${imports.join('\n')}

/**
 * 全部物品注册。本文件由 MC Studio 生成 —— 直接改会被下次生成覆盖。
 * 注意 1.20.1：静态字段只是「登记」，必须由主类把 ITEMS 挂到 mod event bus 上才真正注册。
 */
public final class ModItems {
    public static final DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, ${cls}.MOD_ID);

${declText}    // @hook:items
    public static void register(IEventBus bus) {
        ITEMS.register(bus);
    }

    private ModItems() {
    }
}
`;
}

// ============================================================
// 方块注册
// ============================================================
export function genBlocks(p) {
  const blocks = p.entries.block || [];
  const pkg = p.meta.pkg;
  const cls = toPascal(p.meta.id);
  const lines = blocks.map((b) => {
    const sound = String(b.sound || 'stone').toUpperCase();
    const light = Number(b.lightLevel) > 0 ? `.lightLevel(state -> ${i(b.lightLevel, 0)})` : '';
    const tool = b.requiresTool === false ? '' : '.requiresCorrectToolForDrops()';
    return `    /** ${javaStr(b.nameZh || b.id)} */
    public static final RegistryObject<Block> ${constName(b.id)} = block("${b.id}",
            () -> new Block(BlockBehaviour.Properties.of().mapColor(MapColor.STONE)
                    .strength(${f(b.hardness, 3)}, ${f(b.resistance, 3)})${light}${tool}
                    .sound(SoundType.${sound})));`;
  });

  return `package ${pkg}.registry;

import ${pkg}.${cls};
import java.util.function.Supplier;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/** 全部方块注册。每个方块会顺带登记一个同名的 BlockItem。本文件由 MC Studio 生成。 */
public final class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS = DeferredRegister.create(ForgeRegistries.BLOCKS, ${cls}.MOD_ID);
    public static final DeferredRegister<Item> BLOCK_ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, ${cls}.MOD_ID);

${lines.length ? lines.join('\n\n') + '\n\n' : ''}    // @hook:blocks
    public static void register(IEventBus bus) {
        BLOCKS.register(bus);
        BLOCK_ITEMS.register(bus);
    }

    /** 方块和它的 BlockItem 用同一个名字注册，模型 json 才能对上 */
    private static <T extends Block> RegistryObject<T> block(String name, Supplier<T> factory) {
        RegistryObject<T> holder = BLOCKS.register(name, factory);
        BLOCK_ITEMS.register(name, () -> new BlockItem(holder.get(), new Item.Properties()));
        return holder;
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
  const hasItems = (p.entries.item || []).length > 0;
  const hasBlocks = (p.entries.block || []).length > 0;
  const itemLoop = hasItems
    ? `        if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
            for (RegistryObject<Item> entry : ModItems.ITEMS.getEntries()) {
                event.accept(entry);
            }
        }
`
    : '';
  const blockLoop = hasBlocks
    ? `        if (event.getTabKey() == CreativeModeTabs.BUILDING_BLOCKS) {
            for (RegistryObject<Item> entry : ModBlocks.BLOCK_ITEMS.getEntries()) {
                event.accept(entry);
            }
        }
`
    : '';

  return `package ${pkg}.registry;

import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.RegistryObject;

/**
 * 创造栏。1.20.1 Forge 用 BuildCreativeModeTabContentsEvent 往原版栏里塞东西，
 * 比自己注册一个 CreativeModeTab 少一堆版本差异。本文件由 MC Studio 生成。
 */
public final class ModTabs {
    public static void register(IEventBus bus) {
        bus.addListener(ModTabs::addCreative);
    }

    private static void addCreative(BuildCreativeModeTabContentsEvent event) {
${itemLoop}${blockLoop}        // @hook:tabs
    }

    private ModTabs() {
    }
}
`;
}

// ============================================================
// 手写区
// ============================================================
export function genCustomContent(p) {
  return `package ${p.meta.pkg}.custom;

import net.minecraftforge.eventbus.api.IEventBus;

/**
 * 手写区 —— 这个文件只在第一次生成时创建，之后永远不会被覆盖。
 *
 * 在这里注册自己的事件、命令、能力都行。主类构造时会调用 init(modEventBus)。
 * 想监听游戏内事件（Forge 总线），用 MinecraftForge.EVENT_BUS.register(...)。
 */
public final class CustomContent {
    public static void init(IEventBus modEventBus) {
        // 例子：modEventBus.addListener(...)
        // 例子：MinecraftForge.EVENT_BUS.register(new MyHandler());
    }

    private CustomContent() {
    }
}
`;
}

function pkgName(p) {
  return p.meta.pkg;
}
