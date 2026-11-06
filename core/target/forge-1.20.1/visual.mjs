/**
 * Forge 1.20.1 的积木事件接线。
 *
 * Forge 用注解订阅：方法上加 `@SubscribeEvent`，再把类注册到
 * `MinecraftForge.EVENT_BUS`。
 *
 * ⚠️ 事件类名以 1.20.1 为准（不是 1.16.5 的 getPlayer()/getEntityLiving()）：
 *   PlayerInteractEvent.RightClickBlock  —— 取命中位置用 getHitVec()（不是 getHitResult）
 *   AttackEntityEvent
 *   BlockEvent.BreakEvent                —— getLevel() 返回 LevelAccessor，要转成 Level
 *   TickEvent.PlayerTickEvent            —— player 是 public final 字段（不是 getPlayer()）
 *   TickEvent.ServerTickEvent
 *
 * ⚠️ 1.20.1 没有 PlayerEntity，玩家类是 net.minecraft.world.entity.player.Player。
 */

/** 事件接线：帽形 op → { 处理方法名, 事件类, 处理代码模板 } */
const WIRING = {
  'event.player_rightclick_block': {
    handlerName: 'onRightClickBlock',
    eventClass: 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        %method(player, event.getLevel(), event.getHand(), event.getHitVec());
    }`,
  },
  'event.entity_attack': {
    handlerName: 'onAttackEntity',
    eventClass: 'net.minecraftforge.event.entity.player.AttackEntityEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.AttackEntityEvent event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        %method(player, player.level(), event.getTarget());
    }`,
  },
  'event.player_tick': {
    handlerName: 'onPlayerTick',
    eventClass: 'net.minecraftforge.event.TickEvent.PlayerTickEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.TickEvent.PlayerTickEvent event) {
        if (event.phase != net.minecraftforge.event.TickEvent.Phase.END) return;
        if (event.player instanceof net.minecraft.server.level.ServerPlayer sp) {
            %method(sp, sp.level());
        }
    }`,
  },
  'event.server_tick': {
    handlerName: 'onServerTick',
    eventClass: 'net.minecraftforge.event.TickEvent.ServerTickEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.TickEvent.ServerTickEvent event) {
        if (event.phase != net.minecraftforge.event.TickEvent.Phase.END) return;
        %method(event.getServer().overworld());
    }`,
  },
  'event.block_break': {
    handlerName: 'onBlockBreak',
    eventClass: 'net.minecraftforge.event.level.BlockEvent.BreakEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.level.BlockEvent.BreakEvent event) {
        if (!(event.getPlayer() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        %method(player, (net.minecraft.world.level.Level) event.getLevel(), event.getPos(), event.getState());
    }`,
  },
  'event.item_use': {
    handlerName: 'onUseItem',
    eventClass: 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        %method(player, event.getLevel(), event.getHand());
    }`,
  },
};

/**
 * 生成接线代码。
 * @param {object} p 工程数据
 * @param {object} info { compiled: [{ op, methodName }] }
 * @returns {string} Java 代码（可为空）
 */
export function visualWiring(p, info) {
  const compiled = info?.compiled || [];
  if (!compiled.length) return '';

  const handlers = [];
  const imports = new Set();
  // 同一个事件写了两段程序 → 处理方法名要加后缀，否则 Java 报重复定义
  const usedHandlers = new Set();

  for (const item of compiled) {
    const w = WIRING[item.op];
    if (!w) continue;
    imports.add(w.eventClass);
    let hn = w.handlerName;
    if (usedHandlers.has(hn)) {
      let k = 2;
      while (usedHandlers.has(`${w.handlerName}${k}`)) k++;
      hn = `${w.handlerName}${k}`;
    }
    usedHandlers.add(hn);
    handlers.push(
      w.handler
        .split('%handler').join(hn)
        .split('%method').join(item.methodName),
    );
  }
  if (!handlers.length) return '';

  const init = [
    '    /** 由可视化积木生成的事件接线 */',
    '    public static void init() {',
    '        net.minecraftforge.common.MinecraftForge.EVENT_BUS.register(Handler.class);',
    '    }',
    '',
    '    /** 事件处理器（Forge 用注解订阅） */',
    '    public static final class Handler {',
    handlers.join('\n\n'),
    '    }',
  ].join('\n');

  const importBlock = [...imports].sort().map((i) => `import ${i};`).join('\n');
  return `${init}\n\n// --- 积木接线所需的 import ---\n${importBlock}`;
}
