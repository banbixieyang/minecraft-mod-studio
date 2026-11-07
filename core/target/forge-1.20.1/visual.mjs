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

import { toConstant } from '../../ids.mjs';

/** 条目 → 注册表引用 + 需要的 import（per-entry 接线用它来过滤「只有这个条目才触发」） */
function ownerRef(owner, pkg) {
  // 注意：这里只返回类的全限定名，import 前缀由 genVisual 统一加，否则会重复。
  // Forge 用 DeferredRegister，字段是 RegistryObject<Item/Block>，比较时要 .get() 取出真实实例，
  // 否则 `getItem() == ModItems.X` 会因「Item vs RegistryObject<Item>」类型不匹配编译失败。
  if (owner.type === 'block') {
    return { expr: `ModBlocks.${toConstant(owner.id)}.get()`, imp: `${pkg}.registry.ModBlocks` };
  }
  return { expr: `ModItems.${toConstant(owner.id)}.get()`, imp: `${pkg}.registry.ModItems` };
}

/**
 * per-entry 接线：条目类型 + 事件 op → 带 owner 过滤的处理器。
 * 全局程序（owner 为空）走下面的 WIRING，行为不变。
 */
const OWNED = {
  'event.item_use|item': {
    handlerName: 'onUseItem',
    eventClass: 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        if (player.getItemInHand(event.getHand()).getItem() == %ref) {
            %method(player, event.getLevel(), event.getHand());
        }
    }`,
  },
  'event.player_rightclick_block|item': {
    handlerName: 'onRightClickBlock',
    eventClass: 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        if (player.getItemInHand(event.getHand()).getItem() == %ref) {
            %method(player, event.getLevel(), event.getHand(), event.getHitVec());
        }
    }`,
  },
  'event.player_rightclick_block|block': {
    handlerName: 'onRightClickBlock',
    eventClass: 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        if (event.getLevel().getBlockState(event.getHitVec().getBlockPos()).getBlock() == %ref) {
            %method(player, event.getLevel(), event.getHand(), event.getHitVec());
        }
    }`,
  },
  'event.block_break|block': {
    handlerName: 'onBlockBreak',
    eventClass: 'net.minecraftforge.event.level.BlockEvent.BreakEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.level.BlockEvent.BreakEvent event) {
        if (!(event.getPlayer() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        if (event.getState().getBlock() == %ref) {
            %method(player, (net.minecraft.world.level.Level) event.getLevel(), event.getPos(), event.getState());
        }
    }`,
  },
  'event.entity_attack|item': {
    handlerName: 'onAttackEntity',
    eventClass: 'net.minecraftforge.event.entity.player.AttackEntityEvent',
    handler: `    @net.minecraftforge.eventbus.api.SubscribeEvent
    public static void %handler(net.minecraftforge.event.entity.player.AttackEntityEvent event) {
        if (!(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player)) return;
        if (player.getMainHandItem().getItem() == %ref) {
            %method(player, player.level(), event.getTarget());
        }
    }`,
  },
};

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
 * @param {object} info { compiled: [{ op, methodName, owner }] }
 * @returns {string} Java 代码（可为空）
 */
export function visualWiring(p, info) {
  const compiled = info?.compiled || [];
  if (!compiled.length) return '';

  const pkg = p?.meta?.pkg || 'com.example.mymod';
  const handlers = [];
  const imports = new Set();
  // 同一个事件写了两段程序 → 处理方法名要加后缀，否则 Java 报重复定义
  const usedHandlers = new Set();

  const addHandler = (def, methodName, refExpr, refImp) => {
    imports.add(def.eventClass);
    if (refImp) imports.add(refImp);
    let hn = def.handlerName;
    if (usedHandlers.has(hn)) {
      let k = 2;
      while (usedHandlers.has(`${def.handlerName}${k}`)) k++;
      hn = `${def.handlerName}${k}`;
    }
    usedHandlers.add(hn);
    let h = def.handler.split('%handler').join(hn).split('%method').join(methodName);
    if (refExpr !== undefined) h = h.split('%ref').join(refExpr);
    handlers.push(h);
  };

  for (const item of compiled) {
    // per-entry 程序：带 owner 过滤，只有对应的物品/方块才触发
    if (item.owner) {
      const def = OWNED[`${item.op}|${item.owner.type}`];
      if (!def) continue; // 非法组合已被编译器守卫拦下，这里兜底跳过
      const ref = ownerRef(item.owner, pkg);
      addHandler(def, item.methodName, ref.expr, ref.imp);
      continue;
    }
    // 全局程序：不加过滤，事件一律触发（保持原行为）
    const w = WIRING[item.op];
    if (!w) continue;
    addHandler(w, item.methodName);
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
