/**
 * 代码能力识别 —— 分析器最有用的一层。
 *
 * 用户真正想知道的不是「这个 mod 有 37 个 class」，
 * 而是「它做了什么，我能拿走哪一段」。
 *
 * 做法：把每个 class 的常量池摊开，按规则表匹配 API 引用。
 * 命中「事件回调」「属性加成」「状态效果」这类，就说明这个 mod 有这个能力。
 *
 * 为什么这样够用：Fabric 的扩展方式就是「注册回调」，你要用某个能力，
 * 必然在常量池里留下那个回调类的引用。反过来，常量池里出现了，
 * 基本就说明它确实挂了这段逻辑。
 */
import { parseClass, isLibraryClass } from './classfile.mjs';
import { readJson } from './sources.mjs';

/**
 * 规则表。cls 里写类名片段，命中就算。
 * packable: 这条能力能不能单独打包成「效果」（纯 API 用法通常能）。
 */
export const RULES = [
  // ---------- 战斗 ----------
  {
    id: 'attack_hit', category: '战斗', name: '攻击命中回调', packable: true,
    desc: '玩家打中生物时执行自定义逻辑。吸血、附加状态、真实伤害都挂在这里。',
    cls: ['AttackEntityCallback'],
  },
  {
    id: 'damage_allow', category: '战斗', name: '伤害拦截 / 免伤', packable: true,
    desc: '在生物受伤前决定「这一下算不算」，可以做到概率免伤、免疫某类伤害。',
    cls: ['LivingEntityEvents', 'ServerLivingEntityEvents$AllowDamage'],
  },
  {
    id: 'damage_after', category: '战斗', name: '受伤后处理', packable: true,
    desc: '受伤结算完之后做事。反伤、吸血、触发连锁效果。',
    cls: ['ServerLivingEntityEvents$AfterDamage'],
  },
  {
    id: 'death_hook', category: '战斗', name: '死亡回调', packable: true,
    desc: '生物死亡时触发。掉落额外物品、给击杀者奖励。',
    cls: ['ServerLivingEntityEvents$AfterDeath'],
  },
  {
    id: 'projectile_hit', category: '战斗', name: '弹射物命中', packable: true,
    desc: '箭矢等飞行物命中时的处理。附加凋零、减速、爆炸。',
    cls: ['ProjectileEntity', 'PersistentProjectileEntity'],
  },
  {
    id: 'crit_boost', category: '战斗', name: '暴击处理', packable: false,
    desc: '涉及暴击判定的逻辑。',
    cls: ['isCritical', 'CriticalHit'],
  },

  // ---------- 属性 / 状态 ----------
  {
    id: 'attribute_modifier', category: '属性', name: '属性加成', packable: true,
    desc: '改移速、攻击力、生命上限、击退抗性等。装备和药水效果的常见底层。',
    cls: ['AttributeModifier', 'EntityAttributeModifier', 'AttributeModifiers'],
  },
  {
    id: 'status_effect', category: '属性', name: '状态效果（自定义 Buff）', packable: true,
    desc: '注册自己的状态效果，可以带周期性逻辑。',
    cls: ['MobEffect', 'StatusEffect'],
  },
  {
    id: 'effect_apply', category: '属性', name: '施加状态效果', packable: true,
    desc: '给别人上 Buff / Debuff。',
    cls: ['addEffect', 'applyStatusEffect', 'StackingStatusEffect'],
  },
  {
    id: 'heal', category: '属性', name: '回血 / 治疗', packable: true,
    desc: '恢复生命值。',
    cls: ['PlayerEntity#heal'],
    str: ['\\bheal\\b'],
  },

  // ---------- 移动 ----------
  {
    id: 'flight', category: '移动', name: '允许飞行', packable: true,
    desc: '给玩家开飞行能力（创造模式那种，或缓降）。',
    cls: ['Abilities', 'mayfly', 'allowFlying'],
  },
  {
    id: 'gravity', category: '移动', name: '重力控制', packable: true,
    desc: '改重力、失重、悬浮。',
    cls: ['setNoGravity', 'hasNoGravity'],
  },
  {
    id: 'teleport', category: '移动', name: '传送', packable: true,
    desc: '把实体挪到别处。背后传送、向上传送、回出生点都靠它。',
    cls: ['teleport', 'TeleportTarget', 'requestTeleport'],
    str: ['teleport'],
  },
  {
    id: 'speed_boost', category: '移动', name: '移速调整', packable: true,
    desc: '直接改移动速度（区别于属性加成，这个更即时）。',
    cls: ['MOVEMENT_SPEED', 'setVelocity'],
  },
  {
    id: 'fall_protect', category: '移动', name: '摔落保护 / 缓降', packable: true,
    desc: '免疫或减轻落地伤害，或者像羽毛一样慢慢飘下来。',
    cls: ['FallDamage', 'fallDistance', 'SlowFalling'],
  },

  // ---------- 物品 ----------
  {
    id: 'custom_item', category: '物品', name: '自定义物品', packable: false,
    desc: '注册了新物品。',
    cls: ['Item', 'Item$Settings', 'Item$Properties'],
  },
  {
    id: 'tool_material', category: '物品', name: '工具材质', packable: false,
    desc: '自定义了工具等级（挖掘等级、耐久、附魔能力）。',
    cls: ['ToolMaterial', 'Tier'],
  },
  {
    id: 'armor_material', category: '物品', name: '盔甲材质', packable: false,
    desc: '自定义了盔甲材质（护甲值、韧性、耐久）。',
    cls: ['ArmorMaterial', 'ArmorItem'],
  },
  {
    id: 'food', category: '物品', name: '食物', packable: true,
    desc: '可食用物品，带饱食度与效果。',
    cls: ['FoodProperties', 'FoodComponent'],
  },
  {
    id: 'item_tooltip', category: '物品', name: '物品说明文字', packable: true,
    desc: '给物品加悬浮说明（不是附魔，纯文字）。',
    cls: ['ItemTooltipCallback', 'appendTooltip', 'TooltipAppender'],
  },
  {
    id: 'data_component', category: '物品', name: '数据组件', packable: true,
    desc: '26.x 的组件式数据（替代老的 NBT），给物品挂自定义数据。',
    cls: ['DataComponentType', 'ComponentType', 'DataComponent'],
  },
  {
    id: 'enchantment', category: '物品', name: '附魔', packable: true,
    desc: '自定义或模拟附魔效果。',
    cls: ['Enchantment', 'Enchantments'],
  },
  {
    id: 'durability', category: '物品', name: '耐久处理', packable: true,
    desc: '自定义耐久消耗规则。',
    cls: ['damageItem', 'isDamageable', 'DurabilityComponent'],
  },

  // ---------- 方块 ----------
  {
    id: 'custom_block', category: '方块', name: '自定义方块', packable: false,
    desc: '注册了新方块。',
    cls: ['Block', 'BlockBehaviour'],
  },
  {
    id: 'block_entity', category: '方块', name: '方块实体', packable: true,
    desc: '带状态的方块（箱子、熔炉那种要存数据的）。',
    cls: ['BlockEntity', 'BlockEntityType'],
  },
  {
    id: 'block_tick', category: '方块', name: '方块定时逻辑', packable: true,
    desc: '方块每隔一段时间自己做事 —— 加速熔炉、自动农场都这么写。',
    cls: ['BlockEntityTicker', 'tickBlockEntities', 'scheduledTick'],
  },
  {
    id: 'block_break', category: '方块', name: '方块破坏回调', packable: true,
    desc: '方块被挖掉时触发。',
    cls: ['PlayerBlockBreakEvents'],
  },
  {
    id: 'block_interact', category: '方块', name: '方块交互回调', packable: true,
    desc: '右键方块时触发。',
    cls: ['UseBlockCallback'],
  },

  // ---------- 交互 ----------
  {
    id: 'use_item', category: '交互', name: '使用物品回调', packable: true,
    desc: '右键使用某个物品时触发。时之钟、末影之杖这类都靠它。',
    cls: ['UseItemCallback'],
  },
  {
    id: 'keybind', category: '交互', name: '自定义按键', packable: true,
    desc: '注册了按键，按下触发功能。',
    cls: ['KeyBindingHelper', 'KeyBinding', 'KeyMapping'],
  },
  {
    id: 'command', category: '交互', name: '命令', packable: true,
    desc: '注册了 / 命令。',
    cls: ['CommandRegistrationCallback', 'CommandManager', 'Brigadier'],
  },

  // ---------- 世界 ----------
  {
    id: 'biome_inject', category: '世界', name: '生物群系注入', packable: true,
    desc: '把矿物/植被加进现有生物群系。矿物生成必须走这条路才会真的出现。',
    cls: ['BiomeModifications', 'BiomeModificationContext'],
  },
  {
    id: 'worldgen', category: '世界', name: '世界生成特性', packable: true,
    desc: '自定义的 feature / placed_feature。',
    cls: ['ConfiguredFeature', 'PlacedFeature', 'OreConfiguration'],
  },
  {
    id: 'loot_modify', category: '世界', name: '战利品表修改', packable: true,
    desc: '改原版方块的掉落，或给自己的方块加掉落。',
    cls: ['LootTableEvents', 'LootTable', 'LootPool'],
  },
  {
    id: 'structure', category: '世界', name: '结构生成', packable: true,
    desc: '生成建筑 / 地牢。',
    cls: ['StructureType', 'StructurePiece', 'Jigsaw'],
  },

  // ---------- 界面 ----------
  {
    id: 'screen', category: '界面', name: '自定义界面', packable: true,
    desc: '画了自己的 GUI 界面。',
    cls: ['Screen', 'HandledScreen', 'ScreenHandler', 'MenuType'],
  },
  {
    id: 'hud', category: '界面', name: 'HUD 叠加层', packable: true,
    desc: '在游戏画面上叠信息（血条、计时器、准星提示）。',
    cls: ['HudRenderCallback', 'HudLayerRegistrationCallback', 'DrawContext'],
  },
  {
    id: 'creative_tab', category: '界面', name: '创造栏分组', packable: false,
    desc: '建了自己的创造模式物品栏分组。',
    cls: ['CreativeModeTab', 'ItemGroupEvents', 'FabricItemGroup'],
  },
  {
    id: 'render', category: '界面', name: '自定义渲染', packable: false,
    desc: '实体/方块的自定义模型渲染（需要客户端）。',
    cls: ['EntityRendererRegistry', 'BlockEntityRenderer', 'ModelLoader'],
  },

  // ---------- 数据 / 技术 ----------
  {
    id: 'attachment', category: '数据', name: '数据附件', packable: true,
    desc: '给实体/区块挂自定义数据，跨维度保存。玩家自定义属性常用它。',
    cls: ['AttachmentRegistry', 'AttachmentType'],
  },
  {
    id: 'saved_data', category: '数据', name: '存档数据', packable: true,
    desc: '往世界存档里存自己的数据。',
    cls: ['PersistentState', 'SavedData'],
  },
  {
    id: 'nbt', category: '数据', name: 'NBT 读写', packable: true,
    desc: '直接操作 NBT。',
    cls: ['NbtCompound', 'NbtList', 'NbtElement'],
  },
  {
    id: 'codec', category: '数据', name: '序列化（Codec）', packable: false,
    desc: '用 Codec 做数据序列化，现代版本的自定义内容基本都需要。',
    cls: ['Codec', 'MapCodec'],
  },
  {
    id: 'networking', category: '数据', name: '网络通信', packable: true,
    desc: '客户端与服务端互发消息。',
    cls: ['ServerPlayNetworking', 'ClientPlayNetworking', 'PayloadTypeRegistry'],
  },
  {
    id: 'scheduler', category: '技术', name: '定时任务', packable: true,
    desc: '延迟执行、循环执行。',
    cls: ['ServerTickEvents', 'ClientTickEvents', 'PlayerTickEvents'],
  },
  {
    id: 'lifecycle', category: '技术', name: '生命周期钩子', packable: true,
    desc: '服务器/游戏启动关闭时做事。',
    cls: ['ServerLifecycleEvents', 'ServerLifecycle'],
  },
  {
    id: 'player_join', category: '技术', name: '玩家进出', packable: true,
    desc: '玩家上线/下线/重生时触发。',
    cls: ['ServerPlayerEvents', 'ServerPlayConnectionEvents'],
  },
  {
    id: 'mixin', category: '技术', name: 'Mixin 注入', packable: false,
    desc: '用 Mixin 改了原版类的行为。威力大但要小心版本兼容。',
    cls: ['spongepowered/asm/mixin', 'Mixin'],
  },
  {
    id: 'access_widener', category: '技术', name: '访问拓宽器', packable: false,
    desc: '用 access widener 打开了原版私有成员。',
    cls: ['accesswidener'],
  },

  // ---------- Forge 生态 ----------
  //
  // 为什么单列一块：上面那些规则用的是 Fabric API 的类名
  // （AttackEntityCallback、ServerTickEvents…），
  // 而 Forge mod 挂事件用的是完全另一套类名
  // （AttackEntityEvent、TickEvent.ServerTickEvent…）。
  // 常量池里只会出现实际引用的那套，所以规则表必须两套都写，
  // 否则解析 Forge mod 时「代码能力」会大面积漏判 —— 明明有战斗回调，
  // 却报「这个 mod 没有攻击命中回调」。
  {
    id: 'forge_attack_hit', category: '战斗', name: '攻击命中回调（Forge）', packable: true,
    desc: 'Forge 版攻击命中事件。可附加状态、造成额外伤害。',
    cls: ['AttackEntityEvent'],
  },
  {
    id: 'forge_damage', category: '战斗', name: '受伤事件（Forge）', packable: true,
    desc: 'Forge 受伤生命周期：受伤前拦截、受伤后结算、死亡时触发。',
    cls: ['LivingHurtEvent', 'LivingDamageEvent', 'LivingDeathEvent', 'LivingAttackEvent'],
  },
  {
    id: 'forge_drops', category: '战斗', name: '掉落事件（Forge）', packable: true,
    desc: 'Forge 死亡掉落事件，可追加或修改掉落物。',
    cls: ['LivingDropsEvent'],
  },
  {
    id: 'forge_use_item', category: '交互', name: '使用物品事件（Forge）', packable: true,
    desc: 'Forge 版右键使用物品事件（开始 / 结束 / 每 tick）。',
    cls: ['LivingEntityUseItemEvent', 'PlayerInteractEvent'],
  },
  {
    id: 'forge_tick', category: '技术', name: '定时事件（Forge）', packable: true,
    desc: 'Forge 的 tick 事件，延迟与循环逻辑都挂在这里。',
    cls: ['TickEvent', 'LivingTickEvent', 'PlayerTickEvent'],
  },
  {
    id: 'forge_player', category: '技术', name: '玩家事件（Forge）', packable: true,
    desc: '玩家登录、登出、重生、切换维度等事件。',
    cls: ['PlayerEvent', 'PlayerLoggedInEvent', 'PlayerLoggedOutEvent', 'PlayerRespawnEvent', 'PlayerChangedDimensionEvent'],
  },
  {
    id: 'forge_config', category: '技术', name: 'Forge 配置（可调数值）', packable: true,
    desc: '用 ForgeConfigSpec 定义的可调数值。默认值、取值范围、说明都在里面 —— 这是改数值最直接的抓手。',
    cls: ['ForgeConfigSpec', 'ModConfigSpec'],
  },
  {
    id: 'forge_registry', category: '技术', name: 'Forge 注册表事件', packable: false,
    desc: '在注册表开放时注册内容（生物、效果、附魔等）。',
    cls: ['NewRegistryEvent', 'DataPackRegistryEvent', 'RegisterEvent'],
  },
  {
    id: 'forge_capability', category: '数据', name: 'Forge Capability', packable: true,
    desc: 'Forge 的能力（Capability）系统，给实体或物品挂自定义数据。',
    cls: ['Capability', 'CapabilityItemStack', 'AttachCapabilitiesEvent', 'ICapabilitySerializable'],
  },
  {
    id: 'forge_tool_action', category: '物品', name: 'Forge 工具动作', packable: true,
    desc: '用 ToolAction 声明工具能做什么（挖掘、砍树、挖方块）。',
    cls: ['ToolAction', 'ToolActions'],
  },
  {
    id: 'forge_data_gen', category: '技术', name: '数据生成（GatherData）', packable: false,
    desc: '用 GatherDataEvent 在构建期生成配方、战利品表等数据文件。',
    cls: ['GatherDataEvent', 'DataGenerator', 'RecipeProvider'],
  },
  {
    id: 'forge_creative_tab', category: '界面', name: '创造栏填充（Forge）', packable: true,
    desc: '往创造模式物品栏里加自己的物品。',
    cls: ['BuildCreativeModeTabContentsEvent'],
  },
];

/** 从 utf8 里挑出「看起来是注册 id」的字符串 */
function extractIds(strings, nsList) {
  const out = new Set();
  for (const s of strings) {
    if (s.length < 2 || s.length > 64) continue;
    if (!/^[a-z0-9_./:-]+$/.test(s)) continue;
    if (s.includes('/')) continue;
    const m = s.match(/^([a-z0-9_.-]+):([a-z0-9_./-]+)$/);
    if (m) {
      if (m[1] === 'minecraft') continue;
      if (nsList.length && !nsList.includes(m[1])) continue;
      out.add(s);
    }
  }
  return [...out].slice(0, 200);
}

/**
 * 分析代码部分。
 * 返回 { classes, mixins, abilities, strings, entrypoints, warnings }
 */
export function analyzeCode(src, opts = {}) {
  const warnings = [];
  const limit = opts.maxClasses || 4000;

  // ---- 先读 mixin 配置 ----
  // 顺序很重要：要先把「哪些类是这个 mod 的 mixin」搞清楚，
  // 才能在解析 class 时顺手把它注入的目标捞出来。
  const mixins = [];
  const mixinClassNames = new Set();
  for (const name of src.allNames || []) {
    if (!/\.mixins\.json$/i.test(name) || name.includes('/')) continue;
    const j = readJson(src, name);
    if (!j) continue;
    const classes = [...(j.mixins || []), ...(j.client || []), ...(j.server || [])];
    for (const c of classes) mixinClassNames.add(String(c).split('.').pop());
    mixins.push({
      file: name,
      package: j.package || '',
      declaredTargets: j.target || j.targets || [],
      classes: classes.slice(0, 40),
      count: classes.length,
      targets: [], // 解析 class 后填
    });
  }

  const classPaths = (src.allNames || []).filter((n) => n.endsWith('.class') && !n.startsWith('META-INF/'));
  if (classPaths.length > limit) {
    warnings.push(`class 数量 ${classPaths.length} 超过 ${limit}，只分析了前 ${limit} 个`);
  }
  const use = classPaths.slice(0, limit);

  const own = [];
  const allClasses = new Set();
  const allStrings = new Set();
  const memberNames = new Set();
  const mixinSignals = new Set();
  const mixinTargetHits = new Map(); // simpleName -> Set(类名)
  let parsed = 0;
  let broken = 0;

  for (const p of use) {
    let buf;
    try {
      buf = src.read(p);
    } catch {
      broken++;
      continue;
    }
    const c = parseClass(buf);
    if (!c.ok) {
      broken++;
      continue;
    }
    parsed++;
    for (const x of c.classes) allClasses.add(x);
    for (const x of c.strings) allStrings.add(x);
    for (const x of c.members) memberNames.add(x);
    for (const x of c.utf8) {
      if (x.includes('spongepowered/asm/mixin')) mixinSignals.add(x);
    }
    if (!isLibraryClass(c.className)) {
      own.push({
        name: c.className,
        simple: c.simpleName,
        superName: c.superName,
        methods: c.methods.length,
        strings: [...c.strings].slice(0, 12),
      });
    }
    // 注解描述符不会进 classes，单独扫一遍 utf8 里的 mixin 注解
    for (const x of c.utf8) {
      if (/^Lorg\/spongepowered\/asm\/mixin\/(injection\/)?[A-Z]/.test(x)) mixinSignals.add(x);
    }

    // 这个类是 mixin 吗？它引用的原版类就八成是注入目标
    if (mixinClassNames.has(c.simpleName)) {
      const hits = new Set();
      for (const x of c.classes) {
        if (x.startsWith('net/minecraft/')) hits.add(x);
      }
      mixinTargetHits.set(c.simpleName, hits);
    }
  }

  // 把猜出来的目标填回 mixin 配置。
  // 常量池里能拿到的原版类既有「注入目标」也有「顺手 import 的」，
  // 靠 mixin 类名去后缀的相似度排序，把最可能的排前面：
  //   ArrowMixin → 候选里含 "arrow" 的那个（AbstractArrow）得分最高
  for (const mx of mixins) {
    mx.details = mx.classes.map((cls) => {
      const bare = String(cls).split('.').pop();
      const hits = [...(mixinTargetHits.get(bare) || [])];
      const base = bare.replace(/Mixin$/i, '').toLowerCase();
      const scored = hits
        .map((h) => {
          const simple = h.split('/').pop().toLowerCase();
          let score = 0;
          if (base && simple.includes(base)) score += 10;
          else if (base && base.includes(simple)) score += 6;
          return { h, score };
        })
        .sort((a, b) => b.score - a.score);
      return { name: bare, targets: scored.slice(0, 3).map((x) => x.h) };
    });
    mx.targets = [...new Set(mx.details.flatMap((d) => d.targets))];
    if (mx.declaredTargets.length) mx.targets = [...mx.declaredTargets, ...mx.targets];
  }

  // ---- 规则匹配 ----
  const hay = `${[...allClasses].join('\n')}\n${[...allStrings].join('\n')}\n${[...memberNames].join('\n')}\n${[...mixinSignals].join('\n')}`;
  const abilities = [];
  for (const rule of RULES) {
    let hits = [];
    for (const key of rule.cls || []) {
      // 允许写「类#方法」表示两个都要有，例如 PlayerEntity#heal
      const parts = key.split('#');
      if (!parts.every((p) => p && hay.includes(p))) continue;
      const head = parts[0];
      const found = [...allClasses].find((c) => c.includes(head));
      hits.push(found || key);
    }
    for (const pat of rule.str || []) {
      try {
        if (new RegExp(pat, 'i').test(hay)) hits.push(`/${pat}/`);
      } catch {
        /* 规则写错不影响整体 */
      }
    }
    if (!hits.length) continue;
    abilities.push({
      id: rule.id,
      category: rule.category,
      name: rule.name,
      desc: rule.desc,
      packable: !!rule.packable,
      confidence: hits.length > 1 ? 'high' : 'medium',
      evidence: [...new Set(hits)].slice(0, 4),
    });
  }
  // 不再排序：RULES 的书写顺序本身就是「战斗→属性→移动→…→技术」这个阅读顺序，
  // 用 localeCompare 排中文只会把顺序打乱得更难读。界面按分类分组渲染。

  // ---- 命名空间里出现过的 id ----
  const nsList = opts.namespaces || [];
  const registeredIds = extractIds(allStrings, nsList);

  return {
    stats: { classFiles: classPaths.length, parsed, broken, ownClasses: own.length },
    ownClasses: own.sort((a, b) => b.methods - a.methods).slice(0, 200),
    mixins,
    abilities,
    registeredIds,
    warnings,
  };
}
