/**
 * 给 AI 拼上下文。
 *
 * 这里做的事情决定了 AI 是不是「懂这个版本」：
 *   1. 系统提示里写死这个平台的事实与坑（实测过的，不是猜的）；
 *   2. 工程摘要 —— 它得知道你现在有什么，才不会让你去注册一个已经存在的物品；
 *   3. 检索到的知识库片段，带来源和证据等级。
 *
 * 有多目标之后，第 1 条必须跟着工程走：Forge 1.20.1 工程拿到 Fabric 26.3 的
 * 「Item.Properties().setId()」这种事实，比不给事实还糟 —— 它会很有信心地写出
 * 一个根本不存在的 API。所以事实按 target 分档，未知目标宁可明说不确定。
 *
 * 有一点刻意为之：提示里明确要求「资料里没有就说没有」。
 * 模型最坏的行为不是不会，是编一个看起来很像的签名让你去编译半小时。
 */
import { buildContext } from '../knowledge/index.mjs';

/**
 * 这些是在本机 Fabric 26.3 上真编译过的结论（不是从 1.21 文档推的）。
 * 放在系统提示里每轮都可见 —— 比塞进检索结果更可靠，因为检索可能不命中。
 */
const FABRIC_263_FACTS = [
  '物品/方块注册：必须用 ResourceKey + Item.Properties().setId(key)，再 Registry.register(BuiltInRegistries.ITEM, key, item)。漏 setId 会抛 "Item id not set"。',
  'BuiltInRegistries.ITEM.get(id) 返回 Optional<Reference<Item>>，不是 Item。取物品要 get().value()，并且先判 isEmpty()。',
  'LivingEntity.spawnAtLocation(...) 在 26.3 已移除。掉物品用 entity.drop(ItemStack, boolean 是否打散, net.minecraft.util.Prediction.SERVER_ONLY)。',
  '标签用 TagKey.create(Registries.ITEM, Identifier) 建；ItemTags.create(...) 早已没有。',
  '装备是组件式的：工具用 new Item.Properties().sword(ToolMaterial, 攻击力, 攻速) / .pickaxe(...) / .axe(...)；盔甲用 .humanoidArmor(ArmorMaterial, ArmorType.HELMET)。没有旧的 Tier/ ArmorMaterial 构造装备那套写法。',
  'ToolMaterial 构造：(BlockTags.INCORRECT_FOR_DIAMOND_TOOL, 耐久, 速度, 攻击伤害加成, 附魔能力, 维修标签)——第一个参数是"挖不动什么"的方块标签。',
  'ArmorMaterial 构造：(耐久, Map<ArmorType,Integer> 防御, 附魔能力, Holder<SoundEvent> 装备音, 韧性, 击退抗性, 维修标签, ResourceKey<EquipmentAsset>)。',
  'mixin 配置 compatibilityLevel 填 JAVA_25；26.1 起不再混淆，method/target 字符串直接用官方名。',
  '文本用 net.minecraft.network.chat.Component.literal(...)；命令发送用 source.sendSuccess(() -> Component, boolean)。',
];

/**
 * Forge 1.20.1 的事实。来源：官方 MDK 1.20.1-47.4.0 解包 + 本仓库生成的
 * Forge 工程骨架，由 tests/forge.mjs --build 真编译背书。
 * 注意它和 26.3 是「两个时代」，不是同一个 API 的小改版。
 */
const FORGE_1201_FACTS = [
  '主类用 @Mod(MOD_ID)，构造器接收 FMLJavaModLoadingContext，从 context.getModEventBus() 拿 mod bus。注册挂 mod bus、游戏事件挂 MinecraftForge.EVENT_BUS，挂错不报错但完全不生效。',
  '注册一律用 DeferredRegister.create(ForgeRegistries.ITEMS, MOD_ID) + RegistryObject<Item>，并在主类里调用 register(modBus)。静态字段自己不会注册。',
  '命名空间 id 用 net.minecraft.resources.ResourceLocation，构造器是 public：new ResourceLocation(MOD_ID, "ruby")。26.3 的 Identifier 在这里不存在。',
  '物品是类继承式：new Item(new Item.Properties())、new SwordItem(Tier, int 伤害, float 攻速, Properties)、new ArmorItem(ArmorMaterial, ArmorItem.Type.HELMET, Properties)。Item.Properties 没有 setId()。',
  '自定义工具材质实现 net.minecraft.world.item.Tier 接口：getUses / getSpeed / getAttackDamageBonus / getLevel / getEnchantmentValue / getRepairIngredient，等级标签覆盖 default getTag()，返回 BlockTags.NEEDS_STONE_TOOL / NEEDS_IRON_TOOL / NEEDS_DIAMOND_TOOL。Tiers 是枚举不能扩展且没有 COPPER。26.x 的 getIncorrectBlocksForDrops() 与 INCORRECT_FOR_*_TOOL 是 1.20.5 之后才有的，1.20.1 里不存在（javap 核实）。',
  '自定义盔甲材质实现 net.minecraft.world.item.ArmorMaterial 接口。getName() 决定贴图：assets/minecraft/textures/models/armor/<name>_layer_1.png 与 _layer_2.png，缺了就是紫黑缺贴图。',
  '往原版创造栏加东西用 BuildCreativeModeTabContentsEvent（挂 mod bus），event.accept(RegistryObject)；没有 FabricItemGroupEvents，也不需要自己注册 CreativeModeTab。',
  '运行时事件挂 MinecraftForge.EVENT_BUS，@SubscribeEvent 的全限定名是 net.minecraftforge.eventbus.api.SubscribeEvent。事件方法签名以 1.20.1 为准，不要拿 1.16.5 的 getPlayer()/getEntityLiving() 混用。',
  '资源是 1.20.1 方言：pack_format 15、assets/<ns>/models/item/*.json、data/<ns>/recipes/、loot_tables/blocks/、tags/blocks/ 与 tags/items/、worldgen/configured_feature/；配方 result 是 {"item":...,"count":...}，战利品表用 functions，矿物 state 是 {"Name":"..."}。矿物还要有 forge/biome_modifier/ 才能生成。',
  '元信息是 META-INF/mods.toml（不是 fabric.mod.json）；构建是 ForgeGradle 6.x + Gradle 8.8 + JDK 17，jar 需要 reobfJar。',
];

const PROFILES = {
  'fabric-26.3': {
    key: 'fabric-26.3',
    label: 'Fabric 26.3',
    platform: 'fabric',
    factsTitle: '本机实测的平台事实（Fabric 26.3）',
    facts: FABRIC_263_FACTS,
    rule: '当前工程是 Fabric 26.3：不要用 Forge / NeoForge / Bukkit 的 API，也不要用 1.20.1 的类继承式物品或 DeferredRegister 写法。',
  },
  'forge-1.20.1': {
    key: 'forge-1.20.1',
    label: 'Forge 1.20.1',
    platform: 'forge',
    factsTitle: '核实过的平台事实（Forge 1.20.1，官方 MDK + 真编译）',
    facts: FORGE_1201_FACTS,
    rule: '当前工程是 Forge 1.20.1：不要用 net.fabricmc、Identifier、Item.Properties().setId()、组件式装备 API，也不要用 1.21+ 才有的类。资料里标 platform: fabric / 26.3 的签名属于另一个时代，不要照抄。',
  },
};

function unknownProfile(label) {
  return {
    key: 'unknown',
    label: label || '未知目标',
    platform: '',
    factsTitle: '平台事实',
    facts: ['这个目标没有内置的本机核实事实。不要从别的版本推断 API；资料没覆盖到的签名，一律明说不确定，让用户去查该版本官方 MDK / javadoc。'],
    rule: `当前工程目标是 ${label || '未知'}，内置资料没核实过它。回答时把「已确认」和「推测」分开写。`,
  };
}

const RULES = [
  '只依据【资料】和上面的平台事实回答。资料没覆盖到的，明说「这点我不确定」，不要编类名、方法名、maven 坐标。',
  '给代码就给完整能编译的：import 要么给全，要么全部用全限定名。插进方法体里的钩子代码加不了 import，一律用全限定名。',
  '要给用户能直接「装成钩子」的 Java 时，代码块只能是方法体里的语句：不能有 package / import / 类声明 / @Mod，也不能再带 @hook: 锚点。装钩子会做静态检查，这些写法会被拒绝。',
  '代码块标好语言（java / json / bash）。',
  '回答中文，简短直接，不要客套。先给结论或代码，再解释。',
  '涉及「插到哪」的时候，说清具体文件与位置（例如 src/main/java/<pkg>/custom/CustomContent.java 的 @hook 处）。',
  '不确定的东西不要混在确定的东西里说 —— 分开写。',
];

/**
 * 工程里的目标信息优先读顶层 project.target（工程模型真正存的位置），
 * 兼容早期「摊在 meta 上」的调用和老工程。写过 meta.platform 的测试也还能过。
 */
export function targetOf(project) {
  const t = project?.target || {};
  const platform = t.platform || project?.meta?.platform || 'fabric';
  const mcVersion = t.mcVersion || project?.meta?.mcVersion || '26.3';
  return {
    id: t.id || `${platform}-${mcVersion}`,
    platform,
    mcVersion,
    javaVersion: t.javaVersion || '',
    loaderVersion: t.loaderVersion || '',
    forgeVersion: t.forgeVersion || '',
  };
}

export function profileFor(target, platformOverride = '') {
  const t = targetOf(target?.platform ? target : null) || {};
  const p = platformOverride || target?.platform || t.platform || 'fabric';
  const v = String(target?.mcVersion || t.mcVersion || '');
  const id = String(target?.id || t.id || '');
  if (id === 'forge-1.20.1' || (p === 'forge' && v.startsWith('1.20.1'))) return PROFILES['forge-1.20.1'];
  if (id === 'fabric-26.3' || (p === 'fabric' && v.startsWith('26.'))) return PROFILES['fabric-26.3'];
  return unknownProfile(`${p} ${v}`.trim());
}

/** 工程摘要：让它知道你现在手上有什么 */
export function summarizeProject(project) {
  if (!project) return '';
  const t = targetOf(project);
  const entries = project.entries || {};
  const counts = Object.entries(entries)
    .map(([k, v]) => [k, (v || []).length])
    .filter(([, n]) => n);
  const ids = [];
  for (const [type, list] of Object.entries(entries)) {
    for (const e of list || []) ids.push(`${type}:${e.id}`);
  }
  const hooks = (project.hooks?.java || []).length;
  const js = (project.hooks?.js || []).length;
  const extra = [
    t.forgeVersion ? `Forge ${t.forgeVersion}` : '',
    t.loaderVersion ? `Loader ${t.loaderVersion}` : '',
    t.javaVersion ? `JDK ${t.javaVersion}` : '',
  ].filter(Boolean).join(' · ');
  const lines = [
    `工程：${project.meta?.name || '(未命名)'}（id=${project.meta?.id || '?'}，包名=${project.meta?.pkg || '?'}）`,
    `目标平台：${t.platform} ${t.mcVersion}（target.id=${t.id}${extra ? `，${extra}` : ''}）`,
  ];
  if (counts.length) lines.push(`已有内容：${counts.map(([k, n]) => `${k}×${n}`).join('，')}`);
  if (ids.length) lines.push(`已有条目 id：${ids.slice(0, 40).join('、')}${ids.length > 40 ? ` 等 ${ids.length} 个` : ''}`);
  if (hooks || js) lines.push(`已挂代码钩子：Java ${hooks} 段，JS ${js} 段`);
  return lines.join('\n');
}

export function buildSystemPrompt({ project, knowledge, mode = 'chat', platform = '' } = {}) {
  const t = targetOf(project);
  const profile = profileFor(platform ? { ...t, platform } : t);
  const facts = profile.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  const rules = [profile.rule, ...RULES].map((r, i) => `${i + 1}. ${r}`).join('\n');
  const proj = summarizeProject(project);

  return [
    `你是 MC Studio 内置的 Minecraft 模组开发助手，当前专精 ${profile.label}。`,
    'MC Studio 是一个可视化模组编辑器，用户在这个界面里填表单出内容、写钩子补逻辑、一键构建 jar。',
    mode === 'code' ? '当前任务：根据用户描述产出可直接粘贴进工程的代码。' : '',
    '',
    `【${profile.factsTitle}】`,
    facts,
    '',
    '【回答规则】',
    rules,
    proj ? `\n【当前工程】\n${proj}` : '',
    knowledge ? `\n【资料】\n${knowledge}\n\n引用资料时用「资料 N」指代，不要编造资料。` : '\n【资料】\n（这次没有检索到相关资料。回答时请明确说明依据来自通用知识，可能有版本差异。）',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 组装一次提问。
 * 历史只带最近 8 轮 —— 再往前对当前问题基本没帮助，只是白烧 token。
 */
export function buildRequest({ question, history = [], project, useKnowledge = true, hits, budget, platform } = {}) {
  const t = targetOf(project);
  const prefer = platform || t.platform;
  let knowledge = null;
  let sources = [];
  if (useKnowledge !== false) {
    const ctx = buildContext(question, {
      limit: hits || 6,
      budget: budget || 6000,
      // 工程是什么平台，就优先那个平台的资料；平台中立的构建/流程知识仍然保留
      preferPlatform: prefer,
    });
    knowledge = ctx.text;
    sources = ctx.sources;
  }

  const system = buildSystemPrompt({ project, knowledge, platform });
  const trimmed = (history || []).slice(-8).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));

  return {
    system,
    messages: [...trimmed, { role: 'user', content: String(question || '').trim() }],
    sources,
  };
}
