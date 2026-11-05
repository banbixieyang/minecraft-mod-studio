# Goety: Revelation 拆解报告

> 源文件：**GoetyRevelation-2.3.3fix**　大小：14.9 MB　分析引擎：MC Studio 拆解台
> 生成时间：2026/11/5 18:18:15

## 一、概览

| 字段 | 值 |
| --- | --- |
| 名称 | Goety: Revelation |
| Mod ID | `goety_revelation` |
| 版本 | 2.3.3fix |
| 加载器 | forge（Forge [47,)） |
| 游戏版本 | Minecraft 1.20.1 |
| 作者 | Programmer:MegaDarkness
  Planner:Player__7、KunZhong
  Artists:XiaoWu、Illager_Wither |
| 简介 | Apostle's Mod. |
| 许可 | All Rights Reserved |
| 主命名空间 | `goety_revelation` |
| 涉及命名空间 | minecraft、curios、l2hostility、goety_revelation、goety、forge、ending_library、obscure_tooltips |

## 二、内容规模

| 类别 | 数量 |
| --- | ---: |
| 物品 | 90 |
| 方块 | 2 |
| 合成配方 | 13 |
| 护甲材质 | 5 |
| 工具等级 | 2 |
| 进度 | 18 |
| **合计** | **130** |
| 代码能力（abilities） | 9 |
| 自有类（own classes） | 112 |

## 三、物品清单（90）

| # | ID | 中文名 | 英文名 | 类型 | 最大堆叠 |
| ---: | --- | --- | --- | --- | ---: |
| 1 | `amulet_of_slime` | 凝胶护符 | Amulet of Slime | material | 64 |
| 2 | `apocalyptium_boots` | 神灵金靴子 | Apocalyptium Boots | armor | 1 |
| 3 | `apocalyptium_chestplate` | 神灵金胸甲 | Apocalyptium Chestplate | armor | 1 |
| 4 | `apocalyptium_helmet` | 神灵金头盔 | Apocalyptium Helmet | armor | 1 |
| 5 | `apocalyptium_ingot` | 神灵金属锭 | Apocalyptium Ingot | material | 64 |
| 6 | `apocalyptium_leggings` | 神灵金护腿 | Apocalyptium Leggings | armor | 1 |
| 7 | `apocalyptium_upgrade_smithing_template` |  |  | material | 64 |
| 8 | `apollyon_robe` | 教主长袍 | Apollyon Robe | material | 64 |
| 9 | `apostle_servant_spawn_egg` | 使徒仆从刷怪蛋 | Apostle Servant Spawn Egg | material | 64 |
| 10 | `ascension_halo` | 晋升之环 | Halo of Ascension | material | 64 |
| 11 | `ascension_hard_candy` | 晋升硬糖 | Ascension Hard Candy | material | 64 |
| 12 | `atonement_voucher` | 赎罪券 | Atonement Voucher | material | 64 |
| 13 | `base_bow` |  |  | material | 64 |
| 14 | `blessing_scroll` | 恩赐卷轴 | Scroll of Blessing | material | 64 |
| 15 | `bow_of_revelation` | 天启长弓 | Apocalyptic Longbow | material | 64 |
| 16 | `bow_of_revelation_pulling_0` |  |  | material | 64 |
| 17 | `bow_of_revelation_pulling_1` |  |  | material | 64 |
| 18 | `bow_of_revelation_pulling_2` |  |  | material | 64 |
| 19 | `bow_of_revelation_pulling_full` |  |  | material | 64 |
| 20 | `bow_of_revelation_pulling_full_icon` |  |  | material | 64 |
| 21 | `broken_ender_keeper` | 破损的末影守望者 | Broken Ender Keeper | material | 64 |
| 22 | `broken_halo` | 破碎之环 | Broken Halo | material | 64 |
| 23 | `curios_storage_crystal` | 饰品储存水晶 | Curios Storage Crystal | material | 64 |
| 24 | `dementor_focus` | 摄魂领域聚晶 | Dementor Focus | material | 64 |
| 25 | `dimensional_will` | 维度意志 | Dimensional Will | material | 64 |
| 26 | `disc_arch_illager` | 音乐唱片 | Music Disc | material | 64 |
| 27 | `disc_arch_illager_remix` | 音乐唱片 | Music Disc | material | 64 |
| 28 | `disc_decisive_moment_disc` | 音乐唱片 | Music Disc | material | 64 |
| 29 | `doom_icon` |  |  | material | 64 |
| 30 | `doom_medal` | 末日勋章 | Medal of Doom | material | 64 |
| 31 | `dragon_nirvana_focus` | 龙之涅槃聚晶 | Nirvana Focus | material | 64 |
| 32 | `dragon_skyrocket_focus` | 龙之腾跃聚晶 | Dragon Skyrocket Focus | material | 64 |
| 33 | `eden_scroll` | 伊甸之卷 | Eden Scroll | material | 64 |
| 34 | `eerie_axe` | 诡异之斧 | Eerie Axe | tool | 1 |
| 35 | `ender_keeper_sword` | 末影守望者(WIP) | Ender Keeper(WIP) | tool | 1 |
| 36 | `ender_keeper_sword_gui` |  |  | material | 64 |
| 37 | `ender_keeper_sword_normal` |  |  | material | 64 |
| 38 | `eternal_watch` | 永恒怀表 | Eternal Watch | material | 64 |
| 39 | `fake_needle` |  |  | material | 64 |
| 40 | `frostbloom_staff` | 寒寂之花 | Frostbloom | material | 64 |
| 41 | `god_forging_scroll` | 神锻卷轴 | God Forging Scroll | material | 64 |
| 42 | `gold_feather` | 黄金魔翎 | Gold Feather | material | 64 |
| 43 | `gungnir` | 冈格尼尔 | Gungnir | material | 64 |
| 44 | `gungnir_gui` |  |  | material | 64 |
| 45 | `gungnir_normal` |  |  | material | 64 |
| 46 | `haunted_whip_hilt` | 缠魂质长鞭手柄 | Haunted Whip Hilt | material | 64 |
| 47 | `heretic_focus` | 教团聚晶 | Heretic Focus | material | 64 |
| 48 | `heretic_servant_spawn_egg` | 异教徒仆从刷怪蛋 | Heretic Servant Spawn Egg | material | 64 |
| 49 | `ice_focus` | 绝对零度聚晶 | Absolute Zero Focus | material | 64 |
| 50 | `ice_hermit_spawn_egg` | 寒冰隐士刷怪蛋 | Mystic Recluse Spawn Egg | material | 64 |
| 51 | `maverick_servant_spawn_egg` | 独行者仆从刷怪蛋 | Maverick Servant Spawn Egg | material | 64 |
| 52 | `mystery_fragment` | 神秘碎片 | Mystery Fragment | material | 64 |
| 53 | `mystery_fragment_1` |  |  | material | 64 |
| 54 | `mystery_fragment_2` |  |  | material | 64 |
| 55 | `mystery_fragment_3` |  |  | material | 64 |
| 56 | `nether_meteor_focus` | 流星聚晶 | Nether Meteor Focus | material | 64 |
| 57 | `puzzle_display` |  |  | material | 64 |
| 58 | `puzzle_item` |  |  | material | 64 |
| 59 | `quietus_star` | 寂灭之星 | Star of Quietus | material | 64 |
| 60 | `random_display` |  |  | material | 64 |
| 61 | `revelation` | §l天启七印 | §lSeven Seals | material | 64 |
| 62 | `revelation_focus` | 炼狱聚晶 | Revelation Focus | material | 64 |
| 63 | `shadow_clone_focus` | 乱影聚晶 | Shadow Clone Focus | material | 64 |
| 64 | `soul_of_obsidian` | 黑曜石之魂 | Soul of Obsidian | material | 64 |
| 65 | `spectre_boots` | 幽魂靴子 | Spectre Boots | armor | 1 |
| 66 | `spectre_chestplate` | 幽魂胸甲 | Spectre Chestplate | armor | 1 |
| 67 | `spectre_darkmage_boots` | 渊魄黑魔法师靴子 | Spectre Darkmage Boots | armor | 1 |
| 68 | `spectre_darkmage_chestplate` | 渊魄黑魔法师胸甲 | Spectre Darkmage Chestplate | armor | 1 |
| 69 | `spectre_darkmage_helmet` | 渊魄黑魔法师法帽 | Spectre Darkmage Helmet | armor | 1 |
| 70 | `spectre_darkmage_leggings` | 渊魄黑魔法师绑腿 | Spectre Darkmage Leggings | armor | 1 |
| 71 | `spectre_helmet` | 幽魂覆面 | Spectre Helmet | armor | 1 |
| 72 | `spectre_leggings` | 幽魂绑腿 | Spectre Leggings | armor | 1 |
| 73 | `spectre_whip` | 幽魂长鞭 | Spectre Whip | material | 64 |
| 74 | `spider_boots` | 蜘蛛靴子 | Spider Boots | armor | 1 |
| 75 | `spider_chestplate` | 蜘蛛胸甲 | Spider Chestplate | armor | 1 |
| 76 | `spider_darkmage_boots` | 神经蚀刻者黑魔法师靴子 | Spider Darkmage Boots | armor | 1 |
| 77 | `spider_darkmage_chestplate` | 神经蚀刻者黑魔法师胸甲 | Spider Darkmage Chestplate | armor | 1 |
| 78 | `spider_darkmage_helmet` | 神经蚀刻者黑魔法师头盔 | Spider Darkmage Helmet | armor | 1 |
| 79 | `spider_darkmage_leggings` | 神经蚀刻者黑魔法师绑腿 | Spider Darkmage Leggings | armor | 1 |
| 80 | `spider_fang` | 蛛母之牙 | Spider Fang | material | 64 |
| 81 | `spider_helmet` | 蜘蛛头盔 | Spider Helmet | armor | 1 |
| 82 | `spider_leggings` | 蜘蛛绑腿 | Spider Leggings | armor | 1 |
| 83 | `the_needle` | 恶蝗蛰针 | The Needle | material | 64 |
| 84 | `the_tip_of_the_aeglos` | 恶意 | Tip of the Spear of Aeglos | material | 64 |
| 85 | `the_tip_of_the_longinus` | 命运之矛头 | Tip of the Spear of Longinus | material | 64 |
| 86 | `valettein` | 断曜流光 | Valettein | material | 64 |
| 87 | `valettein_gui` |  |  | material | 64 |
| 88 | `valettein_normal` |  |  | material | 64 |
| 89 | `venomous_spider_whip` | 毒蛛长鞭 | Venomous Spider Whip | material | 64 |
| 90 | `wither_quietus_focus` | 凋灵寂灭聚晶 | Wither Quietus Focus | material | 64 |

## 四、方块清单（2）

| # | ID | 中文名 | 英文名 | 需工具 | 掉落 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `rune_reactor` | 巫术反应台 | Rune Reactor | ✅ | goety_revelation:rune_reactor×1 |
| 2 | `runestone_engraved_table` | 符文镶嵌台 | Runestone Engraved Table | ✅ | goety_revelation:runestone_engraved_table×1 |

## 五、合成配方（13）

| # | 配方 ID | 产出 | 数量 | 类型 | 材料 |
| ---: | --- | --- | ---: | --- | --- |
| 1 | `treatise_apocalyptium_ingot` | tetra:scroll_rolled | 1 | shapeless | goety_revelation:apocalyptium_ingot |
| 2 | `schematics_longinus` | tetra:scroll_rolled | 1 | shaped | — |
| 3 | `schematics_aeglos` | tetra:scroll_rolled | 1 | shaped | — |
| 4 | `runestone_engraved_table` | goety_revelation:runestone_engraved_table | 1 | shaped | — |
| 5 | `rune_reactor` | goety_revelation:rune_reactor | 1 | shaped | — |
| 6 | `god_forging_scroll` | goety_revelation:god_forging_scroll | 1 | shaped | — |
| 7 | `dimensional_will` | goety_revelation:dimensional_will | 1 | shaped | — |
| 8 | `blessing_scroll` | goety_revelation:blessing_scroll | 1 | shaped | — |
| 9 | `apocalyptium_template2` | goety_revelation:apocalyptium_upgrade_smithing_template | 2 | shaped | — |
| 10 | `amulet_of_slime` | goety_revelation:amulet_of_slime | 1 | shaped | — |
| 11 | `aeglos_2` | goety_revelation:the_tip_of_the_aeglos | 1 | shaped | — |
| 12 | `aeglos_1` | goety_revelation:the_tip_of_the_aeglos | 1 | shaped | — |
| 13 | `aeglos_0` | goety_revelation:the_tip_of_the_aeglos | 1 | shaped | — |

## 六、护甲材质（5）

| # | ID | 耐久 | 头盔 | 胸甲 | 护腿 | 靴子 | 韧度 | 击退抗 | 附魔值 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `apocalyptium` | 33 | 3 | 8 | 6 | 3 | 2 | 0 | 10 |
| 2 | `spectre` | 33 | 3 | 8 | 6 | 3 | 2 | 0 | 10 |
| 3 | `spectre_darkmage` | 33 | 3 | 8 | 6 | 3 | 2 | 0 | 10 |
| 4 | `spider` | 33 | 3 | 8 | 6 | 3 | 2 | 0 | 10 |
| 5 | `spider_darkmage` | 33 | 3 | 8 | 6 | 3 | 2 | 0 | 10 |

> 注：护甲材质由代码注册，引擎未能从语言文件反推中英文名，故中文/英文名为空；数值取自注册常量。

## 七、工具等级 / 工具材质（2）

| # | ID | 耐久 | 挖掘速度 | 攻击加成 | 附魔值 | 不适配 |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `eerie` | 1561 | 8 | 3 | 10 | diamond |
| 2 | `ender_keeper` | 1561 | 8 | 3 | 10 | diamond |

> 注：工具等级同样由代码注册，引擎未反推中英文名。

## 八、进度（18）

| # | 进度 ID | 标题（key） | 图标 | 框架 | 隐藏 | 父进度 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `will` | advancements.goety_revelation.will.title | goety_revelation:dimensional_will | challenge | ✅ | goety_revelation:revelation |
| 2 | `time` | advancements.goety_revelation.time.title | goety_revelation:eternal_watch | challenge | ✅ | goety_revelation:puzzle |
| 3 | `the_tip_of_the_longinus` | advancements.goety_revelation.the_tip_of_the_longinus.title | goety_revelation:the_tip_of_the_longinus | challenge | — | goety_revelation:apocalyptium_ingot |
| 4 | `summon_apollyon` | advancements.goety_revelation.summon_apollyon.title | goety_revelation:ascension_halo | task | ✅ | goety_revelation:broken |
| 5 | `spider_set` | advancements.goety_revelation.spider_set.title | goety_revelation:spider_helmet | goal | — | goety:goety/craft_black_iron_armor |
| 6 | `spectre_set` | advancements.goety_revelation.spectre_set.title | goety_revelation:spectre_helmet | goal | — | goety:goety/craft_black_iron_armor |
| 7 | `servant_kill_apollyon` | advancements.goety_revelation.servant_kill_apollyon.title | minecraft:netherite_sword | challenge | ✅ | goety:goety/servant_kill_mob |
| 8 | `revelation` | advancements.goety_revelation.revelation.title | goety_revelation:revelation | challenge | ✅ | goety_revelation:kill_apollyon |
| 9 | `read_god_scroll` | advancements.goety_revelation.god_forging_scroll.title | goety_revelation:god_forging_scroll | task | ✅ | goety_revelation:kill_apollyon |
| 10 | `quietus` | advancements.goety_revelation.quietus_star.title | goety_revelation:quietus_star | challenge | — | minecraft:nether/summon_wither |
| 11 | `puzzle` | advancements.goety_revelation.puzzle.title | goety_revelation:puzzle_item | goal | ✅ | goety:goety/root |
| 12 | `kill_apollyon` | advancements.goety_revelation.defeat_apollyon.title | minecraft:cod | challenge | ✅ | goety_revelation:summon_apollyon |
| 13 | `end` | advancements.goety_revelation.end.title | minecraft:nether_star | challenge | ✅ | goety_revelation:time |
| 14 | `doom` | advancements.goety_revelation.doom.title | goety_revelation:doom_medal | goal | — | goety_revelation:kill_apollyon |
| 15 | `dark_ingot_hammer_improved` | advancements.goety_revelation.hammer.title | tetra:combustion_chamber | goal | — | tetra:spelunking/find_cell |
| 16 | `broken` | advancements.goety_revelation.broken.title | goety_revelation:broken_halo | task | — | goety:goety/kill_a_apostle |
| 17 | `apocalyptium_set` | advancements.goety_revelation.apocalyptium_set.title | goety_revelation:apocalyptium_upgrade_smithing_template | challenge | — | goety_revelation:apocalyptium_ingot |
| 18 | `apocalyptium_ingot` | advancements.goety_revelation.apocalyptium_ingot.title | goety_revelation:apocalyptium_ingot | goal | — | goety_revelation:read_god_scroll |

## 九、代码能力识别（9）

> 以下由常量池规则识别，**仅供参考**——带 `evidence` 供你自行判断置信度。

| # | 类别 | 能力 | 说明 | 可打包 | 置信度 | 证据 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 属性 | 状态效果（自定义 Buff） | 注册自己的状态效果，可以带周期性逻辑。 | ✅ | medium | net/minecraft/world/effect/MobEffectInstance |
| 2 | 移动 | 传送 | 把实体挪到别处。背后传送、向上传送、回出生点都靠它。 | ✅ | high | teleport、/teleport/ |
| 3 | 物品 | 自定义物品 | 注册了新物品。 | — | high | z1gned/goetyrevelation/item/ModItems、net/minecraft/world/item/Item$Properties |
| 4 | 物品 | 附魔 | 自定义或模拟附魔效果。 | ✅ | high | com/Polarice3/Goety/common/enchantments/ModEnchantments |
| 5 | 方块 | 自定义方块 | 注册了新方块。 | — | medium | net/minecraft/core/BlockPos |
| 6 | 方块 | 方块实体 | 带状态的方块（箱子、熔炉那种要存数据的）。 | ✅ | medium | BlockEntity |
| 7 | 界面 | 自定义界面 | 画了自己的 GUI 界面。 | ✅ | medium | net/minecraftforge/client/event/ScreenEvent$Render |
| 8 | 数据 | 存档数据 | 往世界存档里存自己的数据。 | ✅ | medium | net/minecraft/world/level/saveddata/SavedData |
| 9 | 技术 | Mixin 注入 | 用 Mixin 改了原版类的行为。威力大但要小心版本兼容。 | — | high | org/spongepowered/asm/mixin/injection/callback/CallbackInfoReturnable、z1gned/goetyrevelation/mixin/AbstractBeamMixin |

## 十、混合（Mixin）

- 引擎代码层检测到 mixin 注解类：**0**（扫描 @Mixin 注解）
- 但包内确实含 mixin 实现类，按类名/包路径检出 **43** 个（位于 `z1gned/goetyrevelation/mixin/` 等）：

  - `z1gned/goetyrevelation/mixin/ApostleMixin`（父类：com/Polarice3/Goety/common/entities/hostile/cultists/SpellCastingCultist，方法 58 个）
  - `z1gned/goetyrevelation/mixin/PlayerMixin`（父类：net/minecraft/world/entity/LivingEntity，方法 21 个）
  - `z1gned/goetyrevelation/mixin/LivingEntityMixin`（父类：net/minecraft/world/entity/Entity，方法 18 个）
  - `z1gned/goetyrevelation/mixin/StringRenderOutputMixin`（父类：java/lang/Object，方法 6 个）
  - `z1gned/goetyrevelation/mixin/BossBarEventMixin`（父类：java/lang/Object，方法 5 个）
  - `z1gned/goetyrevelation/mixin/BowItemMixin`（父类：java/lang/Object，方法 5 个）
  - `z1gned/goetyrevelation/mixin/FireballSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 5 个）
  - `z1gned/goetyrevelation/mixin/LavaballSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 5 个）
  - `z1gned/goetyrevelation/mixin/CycloneSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 4 个）
  - `z1gned/goetyrevelation/mixin/DeathArrowMixin`（父类：net/minecraft/world/entity/projectile/Arrow，方法 4 个）
  - `z1gned/goetyrevelation/mixin/WitherSkullSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 4 个）
  - `z1gned/goetyrevelation/mixin/ApostleRendererMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/ClientEventsMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/DarkWandMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/FireBlastTrapMixin`（父类：net/minecraft/world/entity/Entity，方法 3 个）
  - `z1gned/goetyrevelation/mixin/FontMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/GhastSpellMixin`（父类：com/Polarice3/Goety/common/magic/SummonSpell，方法 3 个）
  - `z1gned/goetyrevelation/mixin/HauntedSkullSpellMixin`（父类：com/Polarice3/Goety/common/magic/SummonSpell，方法 3 个）
  - `z1gned/goetyrevelation/mixin/HellCloudMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/HellfireMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/ItemEntityMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/SummonRitualMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/UpdraftSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 3 个）
  - `z1gned/goetyrevelation/mixin/UseSpellGoalMixin`（父类：java/lang/Object，方法 3 个）
  - `z1gned/goetyrevelation/mixin/AbstractBeamMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/AbstractSpellCloudMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/ApostleModelMixin`（父类：com/Polarice3/Goety/client/render/model/CultistModel，方法 2 个）
  - `z1gned/goetyrevelation/mixin/BarricadeSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 2 个）
  - `z1gned/goetyrevelation/mixin/BlazeSpellMixin`（父类：com/Polarice3/Goety/common/magic/SummonSpell，方法 2 个）
  - `z1gned/goetyrevelation/mixin/BossLoopMusicMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/ChatFormattingMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/EntityMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/HailSpellMixin`（父类：com/Polarice3/Goety/common/magic/Spell，方法 2 个）
  - `z1gned/goetyrevelation/mixin/LayerDefinitionsMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/LivingEntityRendererMixin`（父类：net/minecraft/client/renderer/entity/EntityRenderer，方法 2 个）
  - `z1gned/goetyrevelation/mixin/ObsidianMonolithMixin`（父类：com/Polarice3/Goety/common/entities/neutral/AbstractMonolith，方法 2 个）
  - `z1gned/goetyrevelation/mixin/SummonApostleMixin`（父类：net/minecraft/world/entity/Entity，方法 2 个）
  - `z1gned/goetyrevelation/mixin/TargetGoalMixin`（父类：java/lang/Object，方法 2 个）
  - `z1gned/goetyrevelation/mixin/ZPiglinServantMixin`（父类：com/Polarice3/Goety/common/entities/ally/undead/zombie/ZombieServant，方法 2 个）
  - `z1gned/goetyrevelation/mixin/ZombieSpellMixin`（父类：com/Polarice3/Goety/common/magic/SummonSpell，方法 2 个）
  - …（其余 3 个略）

## 十一、自有类清单（112）

按包路径分组（前两级）：

| 包路径 | 类数 |
| --- | ---: |
| `z1gned/goetyrevelation/mixin…` | 43 |
| `z1gned/goetyrevelation/client…` | 26 |
| `z1gned/goetyrevelation/entitiy…` | 16 |
| `z1gned/goetyrevelation/util…` | 7 |
| `z1gned/goetyrevelation/goal…` | 6 |
| `z1gned/goetyrevelation/item…` | 6 |
| `z1gned/goetyrevelation/event…` | 3 |
| `z1gned/goetyrevelation/ModMain…` | 1 |
| `z1gned/goetyrevelation/data…` | 1 |
| `z1gned/goetyrevelation/ModMain$ClientModEvents…` | 1 |
| `z1gned/goetyrevelation/tag…` | 1 |
| `z1gned/goetyrevelation/config…` | 1 |

### 实体相关类（35）

- `ApostleMixin` — `com/Polarice3/Goety/common/entities/hostile/cultists/SpellCastingCultist`
- `WitherServant` — `com/Polarice3/Goety/common/entities/ally/Summoned`
- `PhantomServant` — `com/Polarice3/Goety/common/entities/neutral/SummonedFlying`
- `LivingEntityMixin` — `net/minecraft/world/entity/Entity`
- `PhantomServantRenderer` — `net/minecraft/client/renderer/entity/MobRenderer`
- `WitherServantRenderer` — `net/minecraft/client/renderer/entity/MobRenderer`
- `WitherServantModel` — `net/minecraft/client/model/HierarchicalModel`
- `SummonServantGoal` — `z1gned/goetyrevelation/goal/CastingGoal`
- `PhantomServant$PhantomServantAttackStrategyGoal` — `net/minecraft/world/entity/ai/goal/Goal`
- `PhantomServant$PhantomServantSweepAttackGoal` — `z1gned/goetyrevelation/entitiy/PhantomServant$PhantomServantMoveTargetGoal`
- `WitherServantArmorLayer` — `net/minecraft/client/renderer/entity/layers/EnergySwirlLayer`
- `PhantomServantModel` — `net/minecraft/client/model/HierarchicalModel`
- `PhantomServant$AttackPhase` — `java/lang/Enum`
- `PhantomServant$PhantomServantCircleAroundAnchorGoal` — `z1gned/goetyrevelation/entitiy/PhantomServant$PhantomServantMoveTargetGoal`
- `ModEntityType` — `java/lang/Object`
- `PhantomServantEyesLayer` — `net/minecraft/client/renderer/entity/layers/EyesLayer`
- `PhantomServant$PhantomServantAttackPlayerTargetGoal` — `net/minecraft/world/entity/ai/goal/Goal`
- `ApostleRendererMixin` — `java/lang/Object`
- `ItemEntityMixin` — `java/lang/Object`
- `PhantomServant$PhantomServantBodyRotationControl` — `net/minecraft/world/entity/ai/control/BodyRotationControl`
- `PhantomServant$PhantomServantLookControl` — `net/minecraft/world/entity/ai/control/LookControl`
- `PhantomServant$PhantomServantMoveControl` — `net/minecraft/world/entity/ai/control/MoveControl`
- `PhantomServant$PhantomServantMoveTargetGoal` — `net/minecraft/world/entity/ai/goal/Goal`
- `WitherServant$WitherDoNothingGoal` — `net/minecraft/world/entity/ai/goal/Goal`
- `LivingEntityHurtEvent` — `java/lang/Object`
- `ApostleModelMixin` — `com/Polarice3/Goety/client/render/model/CultistModel`
- `EntityMixin` — `java/lang/Object`
- `LivingEntityRendererMixin` — `net/minecraft/client/renderer/entity/EntityRenderer`
- `SummonApostleMixin` — `net/minecraft/world/entity/Entity`
- `ZPiglinServantMixin` — `com/Polarice3/Goety/common/entities/ally/undead/zombie/ZombieServant`
- `DoomArrow` — `com/Polarice3/Goety/common/entities/projectiles/DeathArrow`
- `QuietusBolt` — `com/Polarice3/Goety/common/entities/projectiles/MagicBolt`
- `SummonApollyon` — `com/Polarice3/Goety/common/entities/util/SummonApostle`
- `SpellCastingCultistAccessor` — `java/lang/Object`
- `SpellCastingCultistInvoker` — `java/lang/Object`

## 十二、打包特征

- 签名文件：无
- 内嵌 jar：META-INF/jarjar/[Forge]RevelationFix-1.20.1-4.4.jar（5.3 MB）
- 自带 .java 源码：0 个（本包为发布版，无源码，无法直接读源）
- 重映射特征：intermediary=false，srg=false

## 十三、分析提示 / 警告（71）

1. 包里内嵌了 1 个 jar（META-INF/jars / jarjar），上面统计的是外层主 mod；想看内嵌的可以单独展开分析。
2. 装备的数值在 class 里读不出来，5 个盔甲材质、2 个工具材质按钻石档填了默认值，用之前建议按实际需求改一遍
3. 配方 wither_quietus_focus 的类型 goety:ritual 暂不支持，已跳过
4. 配方 wind_core 的类型 goety:ritual 暂不支持，已跳过
5. 配方 void_shard 的类型 goety:ritual 暂不支持，已跳过
6. 配方 venomous_spider_whip 的类型 goety:ritual 暂不支持，已跳过
7. 配方 valettein 的类型 minecraft:smithing_transform 暂不支持，已跳过
8. 配方 the_end_ritual 的类型 goety:ritual 暂不支持，已跳过
9. 配方 summon_wight 的类型 goety:ritual 暂不支持，已跳过
10. 配方 summon_apostle_servant 的类型 goety:ritual 暂不支持，已跳过
11. 配方 summon_apollyon2 的类型 goety:ritual 暂不支持，已跳过
12. 配方 summon_apollyon 的类型 goety:ritual 暂不支持，已跳过
13. 配方 spider_leggings 的类型 goety:ritual 暂不支持，已跳过
14. 配方 spider_helmet 的类型 goety:ritual 暂不支持，已跳过
15. 配方 spider_egg 的类型 goety:ritual 暂不支持，已跳过
16. 配方 spider_darkmage_leggings 的类型 goety:ritual 暂不支持，已跳过
17. 配方 spider_darkmage_helmet 的类型 goety:ritual 暂不支持，已跳过
18. 配方 spider_darkmage_chestplate 的类型 goety:ritual 暂不支持，已跳过
19. 配方 spider_darkmage_boots 的类型 goety:ritual 暂不支持，已跳过
20. 配方 spider_chestplate 的类型 goety:ritual 暂不支持，已跳过
21. 配方 spider_boots 的类型 goety:ritual 暂不支持，已跳过
22. 配方 spectre_whip 的类型 goety:ritual 暂不支持，已跳过
23. 配方 spectre_leggings 的类型 goety:ritual 暂不支持，已跳过
24. 配方 spectre_helmet 的类型 goety:ritual 暂不支持，已跳过
25. 配方 spectre_darkmage_leggings 的类型 goety:ritual 暂不支持，已跳过
26. 配方 spectre_darkmage_helmet 的类型 goety:ritual 暂不支持，已跳过
27. 配方 spectre_darkmage_chestplate 的类型 goety:ritual 暂不支持，已跳过
28. 配方 spectre_darkmage_boots 的类型 goety:ritual 暂不支持，已跳过
29. 配方 spectre_chestplate 的类型 goety:ritual 暂不支持，已跳过
30. 配方 spectre_boots 的类型 goety:ritual 暂不支持，已跳过
31. 配方 revelation_focus 的类型 goety:ritual 暂不支持，已跳过
32. 配方 puzzle4 的类型 goety:ritual 暂不支持，已跳过
33. 配方 puzzle3 的类型 goety:ritual 暂不支持，已跳过
34. 配方 puzzle2 的类型 goety:ritual 暂不支持，已跳过
35. 配方 puzzle1 的类型 goety:ritual 暂不支持，已跳过
36. 配方 needle 的类型 goety:ritual 暂不支持，已跳过
37. 配方 mystic_core 的类型 goety:ritual 暂不支持，已跳过
38. 配方 mystery_fragment_3 的类型 goety:ritual 暂不支持，已跳过
39. 配方 mystery_fragment_2 的类型 goety:ritual 暂不支持，已跳过
40. 配方 mystery_fragment_1 的类型 goety:ritual 暂不支持，已跳过
41. 配方 mystery_fragment_0 的类型 goety:ritual 暂不支持，已跳过
42. 配方 ice_focus_el 的类型 goety:ritual 暂不支持，已跳过
43. 配方 hunger_core 的类型 goety:ritual 暂不支持，已跳过
44. 配方 heretic_focus 的类型 goety:ritual 暂不支持，已跳过
45. 配方 haunted_whip_hilt 的类型 goety:ritual 暂不支持，已跳过
46. 配方 gungnir 的类型 goety:ritual 暂不支持，已跳过
47. 配方 gold_feather 的类型 goety:ritual 暂不支持，已跳过
48. 配方 gold_crown 的类型 goety:ritual 暂不支持，已跳过
49. 配方 frostbloom_staff_el 的类型 goety:ritual 暂不支持，已跳过
50. 配方 eternal_watch 的类型 goety:ritual 暂不支持，已跳过
51. 配方 ender_keeper_sword 的类型 goety:ritual 暂不支持，已跳过
52. 配方 eerie_axe 的类型 goety:ritual 暂不支持，已跳过
53. 配方 dark_metal_block 的类型 goety:brazier 暂不支持，已跳过
54. 配方 broken_halo3 的类型 goety:ritual 暂不支持，已跳过
55. 配方 broken_halo2 的类型 goety:ritual 暂不支持，已跳过
56. 配方 broken_halo 的类型 goety:ritual 暂不支持，已跳过
57. 配方 bow_of_revelation 的类型 goety:ritual 暂不支持，已跳过
58. 配方 atonement_voucher 的类型 goety:ritual 暂不支持，已跳过
59. 配方 arcane_debris 的类型 goety:cursed_infuser_recipes 暂不支持，已跳过
60. 配方 apollyon_robe_reverse 的类型 goety:cursed_infuser_recipes 暂不支持，已跳过
61. 配方 apollyon_robe 的类型 goety:cursed_infuser_recipes 暂不支持，已跳过
62. 配方 apollyon_disc_convert_1 的类型 goety:cursed_infuser_recipes 暂不支持，已跳过
63. 配方 apollyon_disc_convert_0 的类型 goety:cursed_infuser_recipes 暂不支持，已跳过
64. 配方 apocalyptium_template 的类型 goety:ritual 暂不支持，已跳过
65. 配方 apocalyptium_leggings 的类型 minecraft:smithing_transform 暂不支持，已跳过
66. 配方 apocalyptium_ingot 的类型 goety:ritual 暂不支持，已跳过
67. 配方 apocalyptium_helmet 的类型 minecraft:smithing_transform 暂不支持，已跳过
68. 配方 apocalyptium_chestplate 的类型 minecraft:smithing_transform 暂不支持，已跳过
69. 配方 apocalyptium_boots 的类型 minecraft:smithing_transform 暂不支持，已跳过
70. 配方 animation_core 的类型 goety:ritual 暂不支持，已跳过
71. 配方 anchor_ritual 的类型 goety:ritual 暂不支持，已跳过
