/**
 * Goety 专属积木包。
 *
 * 为什么单独写一份，而不用 modlib 的通用扫描？
 *
 * 通用扫描（modlib.mjs）扫的是 **public static 方法**，产出的是
 * 「调用 WandUtil.chainLightning(a,b,c,d)」这种零件 —— 对会写代码的人有用，
 * 对小朋友没用：他们不知道「连锁闪电」要传 4 个参数，也不知道灵魂能量从哪读。
 *
 * 这里手写的是 **「积木级」语义**：
 *   「给玩家一个聚晶」「施放玩家手上的法术」「把灵魂能量设成 500」
 *   「玩家正在施法吗」「玩家身上有聚晶吗」
 *
 * 每一块都用 javap 核过 API，而且整包在 Forge 1.20.1 工程里真跑过 Gradle 编译。
 *
 * ⚠️ 这些积木要求工程里装了 Goety（还要把 Goety jar 加成编译依赖）。
 *    所以每条都标 requiresMod: 'goety'，界面上会提示。
 *    没装 Goety 的工程用了它们 → 编译不过（这是应该的：依赖就是依赖）。
 */

/** Goety 的包前缀（2.5.x 一直是这个） */
const P = 'com.Polarice3.Goety';

/** 这个包支持的版本（只验过这一个） */
export const GOETY_VERIFIED_VERSION = '2.5.55.4';

/**
 * Goety 专属积木。
 *
 * @param {object} opts
 * @param {string} opts.targetId 目标 id（只有 forge-1.20.1 有模板）
 * @param {object} opts.report 分析报告（用来取聚晶清单）
 * @returns {{blocks:object[], categories:object[], notes:string[]}}
 */
export function goetyPack(opts = {}) {
  const targetId = opts.targetId || 'forge-1.20.1';
  const report = opts.report || {};
  const notes = [];

  // 聚晶清单：从分析报告的物品条目里挑 _focus 结尾的
  const items = (report.contents?.item || []).filter((e) => e && e.id);
  const focuses = items.filter((e) => String(e.id).endsWith('_focus'));

  // 法杖清单：id 里带 wand / staff 的
  const wands = items.filter((e) => /wand|staff/i.test(String(e.id)));

  // 法术清单（分析器解出来的）—— 用来给聚晶配中文名与说明
  const spells = report.contents?.spell || [];
  const spellByName = new Map();
  for (const s of spells) {
    if (s && s.nameZh) spellByName.set(s.nameZh, s);
  }

  const blocks = [];
  const categories = [];

  /* ────────── 聚晶 ────────── */

  if (focuses.length) {
    const options = focuses.map((f) => ({
      value: `${f.ns || report.mainNs || 'goety'}:${f.id}`,
      label: f.nameZh || f.id,
    }));
    blocks.push({
      id: 'goety.focus.give',
      category: 'goety-magic',
      shape: 'stack',
      label: '给玩家 %count 个 %focus',
      icon: '🔮',
      description:
        `从 Goety 的聚晶里挑一个给玩家。共 ${focuses.length} 种聚晶` +
        '（聚晶 = 一个法术的载体，像「魔法卷轴」）。',
      inputs: [{ name: 'count', kind: 'number', default: 1 }],
      fields: [
        { name: 'focus', kind: 'menu', options, default: options[0], string: true },
      ],
      java: {
        'forge-1.20.1': `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.get(
        net.minecraft.resources.ResourceLocation.parse(%focus)),
    %count);
player.getInventory().add(give);`,
      },
      requiresMod: 'goety',
    });
    categories.push({ id: 'goety-magic', label: 'Goety · 聚晶', icon: '🔮', color: '#a55fc0' });
  }

  /* ────────── 施法 ────────── */

  blocks.push({
    id: 'goety.spell.cast',
    category: 'goety-magic',
    shape: 'stack',
    label: '施放玩家手上的法术',
    icon: '✨',
    description:
      '让玩家施放自己当前法杖/聚晶上的法术。' +
      '如果玩家手里没有法术，什么都不会发生（不会报错）。',
    inputs: [],
    fields: [],
    java: {
      'forge-1.20.1': `com.Polarice3.Goety.api.magic.ISpell __spell =
    com.Polarice3.Goety.utils.WandUtil.getSpell(player);
if (__spell != null) {
    com.Polarice3.Goety.common.magic.SpellStat __stat =
        com.Polarice3.Goety.utils.WandUtil.getStats(player, __spell);
    __spell.useSpell(player.serverLevel(), player, player.getMainHandItem(),
        com.Polarice3.Goety.utils.WandUtil.getShots(player), __stat);
}`,
    },
    requiresMod: 'goety',
  });

  blocks.push({
    id: 'goety.spell.is_casting',
    category: 'goety-magic',
    shape: 'boolean',
    label: '玩家正在施法吗',
    icon: '❓',
    description: '判断玩家此刻是不是在放法术。',
    inputs: [],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.MobUtil.isSpellCasting(player)',
    },
    requiresMod: 'goety',
  });

  blocks.push({
    id: 'goety.focus.has',
    category: 'goety-magic',
    shape: 'boolean',
    label: '玩家身上有聚晶吗',
    icon: '🎒',
    description: '判断玩家背包里有没有聚晶（法术载体）。',
    inputs: [],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.WandUtil.hasFocusInInv(player)',
    },
    requiresMod: 'goety',
  });

  /* ────────── 灵魂能量 ────────── */

  blocks.push({
    id: 'goety.soul.get',
    category: 'goety-soul',
    shape: 'reporter',
    label: '玩家的灵魂能量',
    icon: '👻',
    description: '读出玩家当前的灵魂能量值（放法术要消耗它）。',
    inputs: [],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.SEHelper.getSESouls(player)',
    },
    requiresMod: 'goety',
  });

  blocks.push({
    id: 'goety.soul.set',
    category: 'goety-soul',
    shape: 'stack',
    label: '把玩家灵魂能量设为 %amount',
    icon: '🔋',
    description: '直接设定玩家的灵魂能量。',
    inputs: [{ name: 'amount', kind: 'number', default: 100 }],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.SEHelper.setSESouls(player, %amount);',
    },
    requiresMod: 'goety',
  });

  blocks.push({
    id: 'goety.soul.add',
    category: 'goety-soul',
    shape: 'stack',
    label: '给玩家 %amount 点灵魂能量',
    icon: '➕',
    description: '增加玩家的灵魂能量（不会减少）。',
    inputs: [{ name: 'amount', kind: 'number', default: 50 }],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.SEHelper.increaseSESouls(player, %amount);',
    },
    requiresMod: 'goety',
  });

  blocks.push({
    id: 'goety.soul.take',
    category: 'goety-soul',
    shape: 'stack',
    label: '消耗玩家 %amount 点灵魂能量',
    icon: '➖',
    description: '扣掉玩家的灵魂能量（能量不够时什么都不会发生）。',
    inputs: [{ name: 'amount', kind: 'number', default: 50 }],
    fields: [],
    java: {
      'forge-1.20.1': 'com.Polarice3.Goety.utils.SEHelper.decreaseSESouls(player, %amount);',
    },
    requiresMod: 'goety',
  });

  categories.push({ id: 'goety-soul', label: 'Goety · 灵魂能量', icon: '👻', color: '#3aa8a0' });

  /* ────────── 法杖 ────────── */

  if (wands.length) {
    const options = wands.map((w) => ({
      value: `${w.ns || report.mainNs || 'goety'}:${w.id}`,
      label: w.nameZh || w.id,
    }));
    blocks.push({
      id: 'goety.wand.give',
      category: 'goety-magic',
      shape: 'stack',
      label: '给玩家一根 %wand',
      icon: '🪄',
      description:
        `给玩家一根 Goety 法杖。共 ${wands.length} 种` +
        '（法杖决定能放哪一系法术：火、冰、地卜、风……）。',
      inputs: [],
      fields: [
        { name: 'wand', kind: 'menu', options, default: options[0], string: true },
      ],
      java: {
        'forge-1.20.1': `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.get(
        net.minecraft.resources.ResourceLocation.parse(%wand)));
player.getInventory().add(give);`,
      },
      requiresMod: 'goety',
    });
  }

  /* ────────── 法术说明（给界面看的元信息） ────────── */

  if (spells.length) {
    notes.push(`法术清单 ${spells.length} 条，聚晶 ${focuses.length} 种，法杖 ${wands.length} 种`);
  } else {
    notes.push('没从报告里读到法术/聚晶清单 —— 聚晶与法杖积木可能缺菜单项');
  }

  return { blocks, categories, notes, focusCount: focuses.length, wandCount: wands.length };
}

/**
 * 判断一个 mod 是不是 Goety（用来决定要不要合并这个专属包）。
 */
export function isGoety(report) {
  const id = String(report?.meta?.id || '').toLowerCase();
  const ns = String(report?.mainNs || '').toLowerCase();
  return id === 'goety' || ns === 'goety';
}
