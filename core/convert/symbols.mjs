/**
 * 转换器的事实来源。
 *
 * 这里**只登记能从仓库里找到证据的 API 对应关系**：
 *   · 积木库 builtin.mjs 里同一个 op 的两个目标模板（这两份都真编译过）
 *   · 效果 / 任务卡里标注了 evidence 的写法
 * 猜不出来的一律不进表，改由 events.mjs 标成「需人工」，绝不硬翻。
 *
 * 两个能力：
 *   1. blockConcepts()      从积木定义反推「同一语义的两个写法」
 *   2. applySymbolTable()   对任意 Java 做符号级替换（低风险才自动改）
 */
import { ensureBuiltin } from '../visual/registry.mjs';
import { allBlocks, templateFor } from '../visual/blocks.mjs';

/**
 * 低风险符号对：两边拼写一一对应、参数形状相同，替换后语义不变。
 * 顺序无所谓，applySymbolTable 会按长度从长到短排，避免前缀误伤。
 */
export const SYMBOL_TABLE = [
  {
    concept: '资源 id 解析类',
    evidence: 'builtin:player.give / block.set',
    variants: {
      'fabric-26.3': ['net.minecraft.resources.Identifier.parse', 'net.minecraft.resources.Identifier', 'Identifier.parse'],
      'forge-1.20.1': ['net.minecraft.resources.ResourceLocation.parse', 'net.minecraft.resources.ResourceLocation', 'ResourceLocation.parse'],
    },
  },
  {
    concept: '原版注册表按 id 取值',
    evidence: 'builtin:player.give / block.set',
    variants: {
      'fabric-26.3': ['BuiltInRegistries.ITEM.getValue(', 'BuiltInRegistries.BLOCK.getValue('],
      'forge-1.20.1': ['BuiltInRegistries.ITEM.get(', 'BuiltInRegistries.BLOCK.get('],
    },
  },
  {
    concept: '给玩家发消息',
    evidence: 'builtin:player.message',
    variants: {
      'fabric-26.3': ['player.sendSystemMessage('],
      'forge-1.20.1': ['player.displayClientMessage('],
    },
  },
  {
    concept: '取玩家游戏模式',
    evidence: 'builtin:player.game_mode',
    variants: {
      'fabric-26.3': ['player.gameMode()'],
      'forge-1.20.1': ['player.gameMode.getGameModeForPlayer()'],
    },
  },
];

/**
 * 加载器专属的事件/注册 API。这些不是「换个类名」就能搬：
 * 回调签名、注册入口、生命周期都不一样，只能给做法提示，不能静默替换。
 */
export const EVENT_CONCEPTS = [
  {
    concept: '实体受到伤害之后',
    fabric: 'ServerLivingEntityEvents.AFTER_DAMAGE',
    forge: 'LivingDamageEvent',
    how: 'Forge 用 MinecraftForge.EVENT_BUS.addListener(LivingDamageEvent.class, e -> {...})；回调里改用 e.getEntity() / e.getSource() / e.getAmount()，没有 blocked 参数。',
  },
  {
    concept: '实体受伤前可否结算',
    fabric: 'ServerLivingEntityEvents.ALLOW_DAMAGE',
    forge: 'LivingAttackEvent',
    how: 'Forge 的 LivingAttackEvent 用 e.setCanceled(true) 取消，不是 return false。',
  },
  {
    concept: '服务器每 tick',
    fabric: 'ServerTickEvents.END_SERVER_TICK',
    forge: 'TickEvent.ServerTickEvent',
    how: 'Forge 用 e.phase == TickEvent.Phase.END 判断阶段，再从 e.getServer() 取玩家列表。',
  },
  {
    concept: '玩家右键方块',
    fabric: 'UseBlockCallback.EVENT',
    forge: 'PlayerInteractEvent.RightClickBlock',
    how: 'Forge 用 e.getEntity() / e.getLevel() / e.getHand() / e.getPos()，并用 e.setCanceled(true) 拦截。',
  },
  {
    concept: '注册自定义命令',
    fabric: 'ServerLifecycleEvents / CommandRegistrationCallback',
    forge: 'RegisterCommandsEvent',
    how: 'Forge 在 RegisterCommandsEvent 里用 e.getDispatcher().register(...)，参考知识库任务卡《Forge：自定义命令回血》。',
  },
  {
    concept: '按 id 取注册物品',
    fabric: 'Registries.ITEM / BuiltInRegistries.ITEM',
    forge: 'ForgeRegistries.ITEMS',
    how: 'Forge 用 ForgeRegistries.ITEMS.getValue(new ResourceLocation(...))，参考知识库任务卡《Forge：击杀怪物掉宝》。',
  },
];

/** 看到这些就说明代码绑死在某个加载器上了。 */
export const LOADER_MARKERS = {
  fabric: [
    'net.fabricmc.fabric.api',
    'net.fabricmc.loader.api.FabricLoader',
    'ServerLivingEntityEvents', 'ServerTickEvents', 'UseBlockCallback',
    'CommandRegistrationCallback', 'Registry.register(',
  ],
  forge: [
    'net.minecraftforge', 'MinecraftForge.EVENT_BUS', 'ForgeRegistries',
    'LivingDamageEvent', 'LivingAttackEvent', 'RightClickBlock', 'RegisterCommandsEvent',
  ],
};

export function loaderMarkersIn(code, platform) {
  const list = LOADER_MARKERS[platform] || [];
  return list.filter((s) => String(code).includes(s));
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把模板变成可捕获占位符的正则；重复占位符用命名反向引用保证取值一致。 */
function templateToRegex(tpl) {
  const re = /%([A-Za-z_][A-Za-z0-9_]*)/g;
  const names = [];
  let pattern = '';
  let last = 0;
  let m;
  while ((m = re.exec(tpl))) {
    pattern += escapeRegex(tpl.slice(last, m.index));
    const key = `p_${m[1]}`;
    if (names.includes(m[1])) pattern += `\\k<${key}>`;
    else { names.push(m[1]); pattern += `(?<${key}>[\\s\\S]*?)`; }
    last = m.index + m[0].length;
  }
  pattern += escapeRegex(tpl.slice(last));
  try { return { regexp: new RegExp(pattern, 'g'), names }; }
  catch { return null; }
}

function fillTemplate(tpl, groups) {
  return String(tpl).replace(/%([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => groups[`p_${n}`] ?? `%${n}`);
}

/**
 * 从积木定义里抽出「同一语义、两个目标都有**确切**模板」的概念。
 * 只用 d.java[targetId] 精确匹配，不用 templateFor 的 fabric-* 通配 ——
 * 通配只说明写法可能一样，不是证据。
 */
export function blockConcepts(fromId, toId, opts = {}) {
  ensureBuiltin();
  const defs = opts.defs || allBlocks();
  const out = [];
  for (const d of defs) {
    if (!d || !d.java || typeof d.java !== 'object' || d.userDef) continue;
    const from = d.java[fromId];
    const to = d.java[toId];
    if (!from || !to || from === to) continue;
    out.push({ id: d.id, label: d.label || d.id, from, to, evidence: `builtin:${d.id}` });
  }
  return out;
}

/** 同模板但两个目标写法一样 —— 用来给用户一个「这段天生可移植」的交代。 */
export function portableConcepts(fromId, toId, opts = {}) {
  ensureBuiltin();
  const defs = opts.defs || allBlocks();
  return defs.filter((d) => d?.java?.[fromId] && d.java[fromId] === d.java[toId]).map((d) => d.id);
}

/**
 * 在一段 Java 里找源目标模板，替换成目标目标模板（参数原样带过去）。
 * 返回 { code, hits:[{concept,label,evidence,count,before,after}] }
 */
export function matchBlockTemplates(code, fromId, toId, opts = {}) {
  const source = String(code || '');
  let out = source;
  const hits = [];
  for (const c of opts.concepts || blockConcepts(fromId, toId)) {
    const built = templateToRegex(c.from);
    if (!built) continue;
    let count = 0;
    let sample = null;
    out = out.replace(built.regexp, (...args) => {
      const groups = args[args.length - 1] || {};
      count += 1;
      const after = fillTemplate(c.to, groups);
      if (!sample) sample = { before: args[0], after };
      return after;
    });
    if (count) hits.push({ concept: c.id, label: c.label, evidence: c.evidence, count, before: sample.before, after: sample.after });
  }
  return { code: out, hits };
}

/**
 * 符号级替换：只处理 SYMBOL_TABLE 里的低风险对，双向可用。
 * 没登记在表里的加载器 API 保持原样，由 events 规则标 manual。
 */
export function applySymbolTable(code, fromId, toId, opts = {}) {
  const table = opts.table || SYMBOL_TABLE;
  let out = String(code || '');
  const changes = [];
  for (const entry of table) {
    const a = entry.variants?.[fromId];
    const b = entry.variants?.[toId];
    if (!a || !b || a === b) continue;
    const fromList = Array.isArray(a) ? a : [a];
    const toList = Array.isArray(b) ? b : [b];
    const pairs = fromList
      .map((s, i) => ({ from: String(s), to: String(toList[Math.min(i, toList.length - 1)]) }))
      .filter((p) => p.from && p.to && p.from !== p.to)
      .sort((x, y) => y.from.length - x.from.length);
    for (const p of pairs) {
      if (!out.includes(p.from)) continue;
      const n = out.split(p.from).length - 1;
      out = out.split(p.from).join(p.to);
      changes.push({ concept: entry.concept, evidence: entry.evidence, from: p.from, to: p.to, count: n });
    }
  }
  return { code: out, changes };
}
