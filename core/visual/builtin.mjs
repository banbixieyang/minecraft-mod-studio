/**
 * 内置积木库 —— 常用逻辑开箱可用。
 *
 * 覆盖：事件、玩家、世界、方块、变量、流程、文本、数学。
 *
 * 积木定义的关键是 `java` 字段按目标分派：
 *   'fabric-26.3'  → Fabric 26.3 的写法
 *   'forge-1.20.1' → Forge 1.20.1 的写法
 * 两个目标 API 不同（sendSystemMessage vs displayClientMessage、
 * Identifier vs ResourceLocation、setBlock 参数个数不同），
 * 编译器按当前目标挑。
 *
 * ⚠️ 所有 API 签名都用 javap 核对过（见 docs/mc-api-reference.md）。
 *    新增积木后必须跑 `node tools/check-mc-api.mjs <target>`。
 *
 * 模板占位符：
 *   %name    参数槽。文本自动加引号；嵌套积木递归编译
 *   %field   菜单字段（字符串字面量）
 *   %body    容器型积木的子积木
 */

/** 事件（帽形积木） */
export const EVENT_BLOCKS = [
  {
    id: 'event.player_rightclick_block',
    category: 'event',
    shape: 'hat',
    label: '当玩家右键方块时',
    icon: '🖱',
    description: '玩家用鼠标右键一个方块时触发。',
    inputs: [], fields: [], java: {},
  },
  {
    id: 'event.entity_attack',
    category: 'event',
    shape: 'hat',
    label: '当玩家攻击生物时',
    icon: '⚔',
    description: '玩家攻击一个实体时触发。',
    inputs: [], fields: [], java: {},
  },
  {
    id: 'event.player_tick',
    category: 'event',
    shape: 'hat',
    label: '当玩家每 tick 时',
    icon: '⏱',
    description: '每个服务器 tick 对每个玩家触发一次。',
    inputs: [], fields: [], java: {},
  },
  {
    id: 'event.server_tick',
    category: 'event',
    shape: 'hat',
    label: '当服务器每 tick 时',
    icon: '⏱',
    description: '每个服务器 tick 触发一次。',
    inputs: [], fields: [], java: {},
  },
  {
    id: 'event.block_break',
    category: 'event',
    shape: 'hat',
    label: '当玩家破坏方块时',
    icon: '⛏',
    description: '玩家挖掉一个方块时触发。',
    inputs: [], fields: [], java: {},
  },
  {
    id: 'event.item_use',
    category: 'event',
    shape: 'hat',
    label: '当玩家使用物品时',
    icon: '✋',
    description: '玩家右键使用一个物品时触发。',
    inputs: [], fields: [], java: {},
  },
];

/** 玩家类积木 */
export const PLAYER_BLOCKS = [
  {
    id: 'player.message',
    category: 'player',
    shape: 'stack',
    label: '对玩家说：%text',
    icon: '💬',
    inputs: [{ name: 'text', kind: 'text', default: '你好！' }],
    fields: [
      { name: 'mode', kind: 'menu', options: ['聊天栏', '动作栏'], default: '聊天栏', string: true },
    ],
    java: {
      'fabric-26.3': `if (%mode.equals("动作栏")) {
    player.sendSystemMessage(net.minecraft.network.chat.Component.literal(%text), true);
} else {
    player.sendSystemMessage(net.minecraft.network.chat.Component.literal(%text), false);
}`,
      'forge-1.20.1': `if (%mode.equals("动作栏")) {
    player.displayClientMessage(net.minecraft.network.chat.Component.literal(%text), true);
} else {
    player.displayClientMessage(net.minecraft.network.chat.Component.literal(%text), false);
}`,
    },
  },
  {
    id: 'player.heal',
    category: 'player',
    shape: 'stack',
    label: '给玩家 %amount 点生命',
    icon: '❤️',
    inputs: [{ name: 'amount', kind: 'number', default: 5 }],
    fields: [],
    java: {
      'fabric-26.3': 'player.heal(%amount);',
      'forge-1.20.1': 'player.heal(%amount);',
    },
  },
  {
    id: 'player.give',
    category: 'player',
    shape: 'stack',
    label: '给玩家 %count 个 %item',
    icon: '🎁',
    inputs: [
      { name: 'item', kind: 'item', default: 'minecraft:stone' },
      { name: 'count', kind: 'number', default: 1 },
    ],
    fields: [],
    java: {
      'fabric-26.3': `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(
        net.minecraft.resources.Identifier.parse(%item)),
    %count);
player.getInventory().add(give);`,
      'forge-1.20.1': `net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(
    net.minecraft.core.registries.BuiltInRegistries.ITEM.get(
        net.minecraft.resources.ResourceLocation.parse(%item)),
    %count);
player.getInventory().add(give);`,
    },
  },
  {
    id: 'player.teleport',
    category: 'player',
    shape: 'stack',
    label: '把玩家传送到 %x , %y , %z',
    icon: '🧭',
    inputs: [
      { name: 'x', kind: 'number', default: 0 },
      { name: 'y', kind: 'number', default: 64 },
      { name: 'z', kind: 'number', default: 0 },
    ],
    fields: [],
    java: {
      'fabric-26.3': 'player.teleportTo(%x, %y, %z);',
      'forge-1.20.1': 'player.teleportTo(%x, %y, %z);',
    },
  },
  {
    id: 'player.set_gamemode',
    category: 'player',
    shape: 'stack',
    label: '把玩家游戏模式设为 %mode',
    icon: '🎮',
    inputs: [],
    fields: [
      { name: 'mode', kind: 'menu', options: ['SURVIVAL', 'CREATIVE', 'ADVENTURE', 'SPECTATOR'], default: 'SURVIVAL', raw: true },
    ],
    java: {
      'fabric-26.3': 'player.setGameMode(net.minecraft.world.level.GameType.%mode);',
      'forge-1.20.1': 'player.setGameMode(net.minecraft.world.level.GameType.%mode);',
    },
  },
  {
    id: 'player.health',
    category: 'player',
    shape: 'reporter',
    label: '玩家当前生命值',
    icon: '❤️',
    inputs: [], fields: [],
    java: {
      'fabric-26.3': 'player.getHealth()',
      'forge-1.20.1': 'player.getHealth()',
    },
  },
  {
    id: 'player.max_health',
    category: 'player',
    shape: 'reporter',
    label: '玩家最大生命值',
    icon: '💗',
    inputs: [], fields: [],
    java: {
      'fabric-26.3': 'player.getMaxHealth()',
      'forge-1.20.1': 'player.getMaxHealth()',
    },
  },
  {
    id: 'player.position',
    category: 'player',
    shape: 'reporter',
    label: '玩家 %axis 坐标',
    icon: '📍',
    inputs: [],
    fields: [
      { name: 'axis', kind: 'menu', options: ['X', 'Y', 'Z'], default: 'X', string: true },
    ],
    java: {
      'fabric-26.3': `(%axis.equals("X") ? player.getX() : %axis.equals("Y") ? player.getY() : player.getZ())`,
      'forge-1.20.1': `(%axis.equals("X") ? player.getX() : %axis.equals("Y") ? player.getY() : player.getZ())`,
    },
  },
  {
    id: 'player.game_mode',
    category: 'player',
    shape: 'reporter',
    label: '玩家的游戏模式',
    icon: '🎮',
    inputs: [], fields: [],
    java: {
      'fabric-26.3': 'player.gameMode()',
      'forge-1.20.1': 'player.gameMode.getGameModeForPlayer()',
    },
  },
];

/** 流程控制（容器型积木） */
export const FLOW_BLOCKS = [
  {
    id: 'flow.if',
    category: 'flow',
    shape: 'stack',
    label: '如果 %cond 那么',
    icon: '❓',
    inputs: [{ name: 'cond', kind: 'boolean', required: true, accept: ['boolean'] }],
    fields: [],
    java: {
      'fabric-26.3': 'if (%cond) {\n%body\n}',
      'forge-1.20.1': 'if (%cond) {\n%body\n}',
    },
  },
  {
    id: 'flow.if_else',
    category: 'flow',
    shape: 'stack',
    label: '如果 %cond 那么 否则',
    icon: '🔀',
    inputs: [{ name: 'cond', kind: 'boolean', required: true, accept: ['boolean'] }],
    fields: [],
    bodySlots: ['body', 'elseBody'],
    java: {
      'fabric-26.3': 'if (%cond) {\n%body\n} else {\n%elseBody\n}',
      'forge-1.20.1': 'if (%cond) {\n%body\n} else {\n%elseBody\n}',
    },
  },
  {
    id: 'flow.repeat',
    category: 'flow',
    shape: 'stack',
    label: '重复 %times 次',
    icon: '🔁',
    inputs: [{ name: 'times', kind: 'number', default: 10 }],
    fields: [],
    java: {
      'fabric-26.3': 'for (int i = 0; i < %times; i++) {\n%body\n}',
      'forge-1.20.1': 'for (int i = 0; i < %times; i++) {\n%body\n}',
    },
  },
  {
    id: 'flow.while',
    category: 'flow',
    shape: 'stack',
    label: '只要 %cond 就一直',
    icon: '🔄',
    inputs: [{ name: 'cond', kind: 'boolean', required: true, accept: ['boolean'] }],
    fields: [],
    java: {
      'fabric-26.3': 'while (%cond) {\n%body\n}',
      'forge-1.20.1': 'while (%cond) {\n%body\n}',
    },
  },
];

/** 变量与数学 */
export const VAR_BLOCKS = [
  {
    id: 'math.add',
    category: 'math',
    shape: 'reporter',
    label: '%a 加 %b',
    icon: '➕',
    inputs: [
      { name: 'a', kind: 'number', default: 1 },
      { name: 'b', kind: 'number', default: 1 },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a + %b)',
      'forge-1.20.1': '(%a + %b)',
    },
  },
  {
    id: 'math.sub',
    category: 'math',
    shape: 'reporter',
    label: '%a 减 %b',
    icon: '➖',
    inputs: [
      { name: 'a', kind: 'number', default: 1 },
      { name: 'b', kind: 'number', default: 1 },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a - %b)',
      'forge-1.20.1': '(%a - %b)',
    },
  },
  {
    id: 'math.mul',
    category: 'math',
    shape: 'reporter',
    label: '%a 乘 %b',
    icon: '✖',
    inputs: [
      { name: 'a', kind: 'number', default: 1 },
      { name: 'b', kind: 'number', default: 1 },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a * %b)',
      'forge-1.20.1': '(%a * %b)',
    },
  },
  {
    id: 'math.random',
    category: 'math',
    shape: 'reporter',
    label: '从 %min 到 %max 的随机数',
    icon: '🎲',
    inputs: [
      { name: 'min', kind: 'number', default: 1 },
      { name: 'max', kind: 'number', default: 6 },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(int) (%min + java.util.concurrent.ThreadLocalRandom.current().nextDouble() * (%max - %min + 1))',
      'forge-1.20.1': '(int) (%min + java.util.concurrent.ThreadLocalRandom.current().nextDouble() * (%max - %min + 1))',
    },
  },
  {
    id: 'math.compare',
    category: 'math',
    shape: 'boolean',
    label: '%a %op %b',
    icon: '🔍',
    inputs: [
      { name: 'a', kind: 'number', default: 1 },
      { name: 'b', kind: 'number', default: 1 },
    ],
    fields: [
      { name: 'op', kind: 'menu', options: ['<', '>', '<=', '>=', '==', '!='], default: '<', raw: true },
    ],
    java: {
      'fabric-26.3': '(%a %op %b)',
      'forge-1.20.1': '(%a %op %b)',
    },
  },
  {
    id: 'var.set',
    category: 'math',
    shape: 'stack',
    label: '把 %value 存入变量 %name',
    icon: '📦',
    inputs: [
      { name: 'name', kind: 'text', default: 'myVar' },
      { name: 'value', kind: 'number', default: 0 },
    ],
    fields: [],
    java: {
      'fabric-26.3': `VARS.put(%name, (double) (%value));`,
      'forge-1.20.1': `VARS.put(%name, (double) (%value));`,
    },
  },
  {
    id: 'var.get',
    category: 'math',
    shape: 'reporter',
    label: '变量 %name 的值',
    icon: '🔢',
    inputs: [{ name: 'name', kind: 'text', default: 'myVar' }],
    fields: [],
    java: {
      'fabric-26.3': '(VARS.containsKey(%name) ? VARS.get(%name).doubleValue() : 0.0)',
      'forge-1.20.1': '(VARS.containsKey(%name) ? VARS.get(%name).doubleValue() : 0.0)',
    },
  },
];

/** 条件 */
export const LOGIC_BLOCKS = [
  {
    id: 'logic.not',
    category: 'logic',
    shape: 'boolean',
    label: '不成立：%cond',
    icon: '🚫',
    inputs: [{ name: 'cond', kind: 'boolean', required: true, accept: ['boolean'] }],
    fields: [],
    java: {
      'fabric-26.3': '(!%cond)',
      'forge-1.20.1': '(!%cond)',
    },
  },
  {
    id: 'logic.and',
    category: 'logic',
    shape: 'boolean',
    label: '%a 并且 %b',
    icon: '&&',
    inputs: [
      { name: 'a', kind: 'boolean', required: true, accept: ['boolean'] },
      { name: 'b', kind: 'boolean', required: true, accept: ['boolean'] },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a && %b)',
      'forge-1.20.1': '(%a && %b)',
    },
  },
  {
    id: 'logic.or',
    category: 'logic',
    shape: 'boolean',
    label: '%a 或者 %b',
    icon: '||',
    inputs: [
      { name: 'a', kind: 'boolean', required: true, accept: ['boolean'] },
      { name: 'b', kind: 'boolean', required: true, accept: ['boolean'] },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a || %b)',
      'forge-1.20.1': '(%a || %b)',
    },
  },
  {
    id: 'logic.compare_text',
    category: 'logic',
    shape: 'boolean',
    label: '%a 等于 %b',
    icon: '🟰',
    inputs: [
      { name: 'a', kind: 'text', default: '' },
      { name: 'b', kind: 'text', default: '' },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(java.util.Objects.equals(%a, %b))',
      'forge-1.20.1': '(java.util.Objects.equals(%a, %b))',
    },
  },
];

/** 世界与方块 */
export const WORLD_BLOCKS = [
  {
    id: 'block.set',
    category: 'world',
    shape: 'stack',
    label: '把 %x , %y , %z 处的方块设为 %block',
    icon: '🧱',
    inputs: [
      { name: 'x', kind: 'number', default: 0 },
      { name: 'y', kind: 'number', default: 64 },
      { name: 'z', kind: 'number', default: 0 },
      { name: 'block', kind: 'blockRef', default: 'minecraft:stone' },
    ],
    fields: [],
    java: {
      'fabric-26.3': `level.setBlock(
    new net.minecraft.core.BlockPos(%x, %y, %z),
    net.minecraft.core.registries.BuiltInRegistries.BLOCK.getValue(
        net.minecraft.resources.Identifier.parse(%block)).defaultBlockState(),
    3);`,
      'forge-1.20.1': `level.setBlock(
    new net.minecraft.core.BlockPos(%x, %y, %z),
    net.minecraft.core.registries.BuiltInRegistries.BLOCK.get(
        net.minecraft.resources.ResourceLocation.parse(%block)).defaultBlockState(),
    3);`,
    },
  },
  {
    id: 'world.rain',
    category: 'world',
    shape: 'stack',
    label: '把雨量设为 %level',
    icon: '🌧',
    inputs: [{ name: 'level', kind: 'number', default: 1 }],
    fields: [],
    java: {
      'fabric-26.3': 'level.setRainLevel(%level);',
      'forge-1.20.1': 'level.setRainLevel(%level);',
    },
  },
  {
    id: 'world.thunder',
    category: 'world',
    shape: 'stack',
    label: '把雷暴强度设为 %level',
    icon: '⛈',
    inputs: [{ name: 'level', kind: 'number', default: 1 }],
    fields: [],
    java: {
      'fabric-26.3': 'level.setThunderLevel(%level);',
      'forge-1.20.1': 'level.setThunderLevel(%level);',
    },
  },
];

/** 文本工具 */
export const TEXT_BLOCKS = [
  {
    id: 'text.concat',
    category: 'text',
    shape: 'reporter',
    label: '把 %a 和 %b 拼起来',
    icon: '🔗',
    inputs: [
      { name: 'a', kind: 'text', default: '你好' },
      { name: 'b', kind: 'text', default: '世界' },
    ],
    fields: [],
    java: {
      'fabric-26.3': '(%a + %b)',
      'forge-1.20.1': '(%a + %b)',
    },
  },
  {
    id: 'text.number',
    category: 'text',
    shape: 'reporter',
    label: '数字 %n 变成文本',
    icon: '🔢',
    inputs: [{ name: 'n', kind: 'number', default: 0 }],
    fields: [],
    java: {
      'fabric-26.3': 'String.valueOf(%n)',
      'forge-1.20.1': 'String.valueOf(%n)',
    },
  },
];

/** 全部内置积木 */
export function builtinBlocks() {
  return [
    ...EVENT_BLOCKS,
    ...PLAYER_BLOCKS,
    ...FLOW_BLOCKS,
    ...VAR_BLOCKS,
    ...LOGIC_BLOCKS,
    ...WORLD_BLOCKS,
    ...TEXT_BLOCKS,
  ];
}

/** 内置积木的分类（界面上分组显示） */
export const BUILTIN_CATEGORIES = [
  { id: 'event', label: '事件', icon: '⚡', color: '#e8a33d' },
  { id: 'player', label: '玩家', icon: '👤', color: '#3d8bd4' },
  { id: 'world', label: '世界', icon: '🌍', color: '#3f9e6d' },
  { id: 'flow', label: '流程', icon: '🔀', color: '#8a63c4' },
  { id: 'logic', label: '条件', icon: '❓', color: '#c25f3d' },
  { id: 'math', label: '数学与变量', icon: '🔢', color: '#3d7fc4' },
  { id: 'text', label: '文本', icon: '💬', color: '#6e6e78' },
  // raw.java 是「原始代码」积木 —— 反编译兜底，也是手写代码的入口
  { id: 'raw', label: '原始代码', icon: '📄', color: '#7b8494' },
];
