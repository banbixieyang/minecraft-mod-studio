/**
 * Fabric 26.3 的积木事件接线。
 *
 * 帽形积木（事件）编译成方法后，需要注册到 Fabric API 的事件上。
 * 这里按「有哪些事件被用到」生成对应的注册代码。
 *
 * ⚠️ 回调签名都用 javap 核对过（fabric-events-interaction-v0 / fabric-lifecycle-events-v1）：
 *   UseBlockCallback.interact(Player, Level, InteractionHand, BlockHitResult)
 *   AttackEntityCallback.interact(Player, Level, InteractionHand, Entity, EntityHitResult)
 *   UseItemCallback.interact(Player, Level, InteractionHand)
 *   PlayerBlockBreakEvents.AFTER.afterBlockBreak(Level, Player, BlockPos, BlockState, BlockEntity)
 *   ServerTickEvents.END_SERVER_TICK
 *
 * ⚠️ 26.3 里 ServerPlayer 的包是 net.minecraft.server.level（不是 server.network）。
 *
 * 回调给的 player 是 Player（客户端玩家也会触发），
 * 所以这里先 cast 成 ServerPlayer 再调我们的方法 —— 顺带过滤掉客户端。
 */

import { toConstant } from '../../ids.mjs';

/** 条目 → 注册表引用 + 需要的 import（per-entry 接线用它来过滤「只有这个条目才触发」） */
function ownerRef(owner, pkg) {
  // 注意：这里只返回类的全限定名，import 前缀由 genVisual 统一加，
  // 否则会出现「import import ...」这种重复。
  if (owner.type === 'block') {
    return { expr: `ModBlocks.${toConstant(owner.id)}`, imp: `${pkg}.registry.ModBlocks` };
  }
  return { expr: `ModItems.${toConstant(owner.id)}`, imp: `${pkg}.registry.ModItems` };
}

/**
 * per-entry 接线：条目类型 + 事件 op → 带 owner 过滤的注册代码。
 * 全局程序（owner 为空）走下面的 WIRING，行为不变。
 */
const OWNED = {
  'event.item_use|item': (m, ref) => ({
    imports: ['net.fabricmc.fabric.api.event.player.UseItemCallback', 'net.minecraft.world.InteractionResult', ref.imp],
    code: `        UseItemCallback.EVENT.register((player, level, hand) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp && sp.getItemInHand(hand).getItem() == ${ref.expr}) {
                ${m}(sp, level, hand);
            }
            return InteractionResult.PASS;
        });`,
  }),
  'event.player_rightclick_block|item': (m, ref) => ({
    imports: ['net.fabricmc.fabric.api.event.player.UseBlockCallback', 'net.minecraft.world.InteractionResult', ref.imp],
    code: `        UseBlockCallback.EVENT.register((player, level, hand, hit) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp && sp.getItemInHand(hand).getItem() == ${ref.expr}) {
                ${m}(sp, level, hand, hit);
            }
            return InteractionResult.PASS;
        });`,
  }),
  'event.player_rightclick_block|block': (m, ref) => ({
    imports: ['net.fabricmc.fabric.api.event.player.UseBlockCallback', 'net.minecraft.world.InteractionResult', ref.imp],
    code: `        UseBlockCallback.EVENT.register((player, level, hand, hit) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp && hit.getBlockState().getBlock() == ${ref.expr}) {
                ${m}(sp, level, hand, hit);
            }
            return InteractionResult.PASS;
        });`,
  }),
  'event.block_break|block': (m, ref) => ({
    imports: ['net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents', ref.imp],
    code: `        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, entity) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp && state.getBlock() == ${ref.expr}) {
                ${m}(sp, world, pos, state);
            }
        });`,
  }),
  'event.entity_attack|item': (m, ref) => ({
    imports: ['net.fabricmc.fabric.api.event.player.AttackEntityCallback', 'net.minecraft.world.InteractionResult', ref.imp],
    code: `        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp && sp.getItemInHand(hand).getItem() == ${ref.expr}) {
                ${m}(sp, level, entity);
            }
            return InteractionResult.PASS;
        });`,
  }),
};

/** 事件接线：帽形 op → { 方法名, import, 注册代码模板 } */
const WIRING = {
  'event.player_rightclick_block': {
    imports: [
      'net.fabricmc.fabric.api.event.player.UseBlockCallback',
      'net.minecraft.world.InteractionResult',
    ],
    code: `        UseBlockCallback.EVENT.register((player, level, hand, hit) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp) {
                %method(sp, level, hand, hit);
            }
            return InteractionResult.PASS;
        });`,
  },
  'event.entity_attack': {
    imports: [
      'net.fabricmc.fabric.api.event.player.AttackEntityCallback',
      'net.minecraft.world.InteractionResult',
    ],
    code: `        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp) {
                %method(sp, level, entity);
            }
            return InteractionResult.PASS;
        });`,
  },
  'event.player_tick': {
    imports: [
      'net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents',
    ],
    code: `        ServerTickEvents.END_SERVER_TICK.register(server -> {
            for (net.minecraft.server.level.ServerPlayer sp : server.getPlayerList().getPlayers()) {
                %method(sp, sp.level());
            }
        });`,
  },
  'event.server_tick': {
    imports: [
      'net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents',
    ],
    code: `        ServerTickEvents.END_SERVER_TICK.register(server -> {
            %method(server.overworld());
        });`,
  },
  'event.block_break': {
    imports: [
      'net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents',
    ],
    code: `        PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, entity) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp) {
                %method(sp, world, pos, state);
            }
        });`,
  },
  'event.item_use': {
    imports: [
      'net.fabricmc.fabric.api.event.player.UseItemCallback',
      'net.minecraft.world.InteractionResult',
    ],
    code: `        UseItemCallback.EVENT.register((player, level, hand) -> {
            if (player instanceof net.minecraft.server.level.ServerPlayer sp) {
                %method(sp, level, hand);
            }
            return InteractionResult.PASS;
        });`,
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
  const imports = new Set();
  const bodies = [];
  for (const item of compiled) {
    // per-entry 程序：带 owner 过滤，只有对应的物品/方块才触发
    if (item.owner) {
      const gen = OWNED[`${item.op}|${item.owner.type}`];
      if (!gen) continue; // 非法组合已被编译器守卫拦下，这里兜底跳过
      const ref = ownerRef(item.owner, pkg);
      const built = gen(item.methodName, ref);
      for (const i of built.imports) if (i) imports.add(i);
      bodies.push(built.code);
      continue;
    }
    // 全局程序：不加过滤，事件一律触发（保持原行为）
    const w = WIRING[item.op];
    if (!w) continue;
    for (const i of w.imports) imports.add(i);
    bodies.push(w.code.split('%method').join(item.methodName));
  }
  if (!bodies.length) return '';

  const init = [
    '    /** 由可视化积木生成的事件接线 */',
    '    public static void init() {',
    bodies.join('\n'),
    '    }',
  ].join('\n');

  // import 语句放在文件头
  const importBlock = [...imports].sort().map((i) => `import ${i};`).join('\n');
  return `${init}\n\n// --- 积木接线所需的 import ---\n${importBlock}`;
}

/**
 * 按键事件的**客户端**接线 —— 生成 ModClient.java。
 *
 * 按键是客户端概念：注册成 KeyMapping 后会自动出现在游戏的「按键设置」里，
 * 玩家能随时改键（绑定名稳定，改键结果持久化在 options.txt）。
 * 客户端每 tick 检测一次 wasPressed()，按下就调 ModLogic 里对应的方法。
 *
 * @param {object} p 工程数据
 * @param {object} info { compiled: [{ op, methodName, bindId, key }] }
 * @returns {{path:string, content:string}|null}
 */
export function visualClientWiring(p, info) {
  const keys = (info?.compiled || []).filter((c) => c.op === 'event.key_pressed');
  if (!keys.length) return null;

  const pkg = p?.meta?.pkg || 'com.example.mymod';
  const ns = p?.meta?.id || 'mymod';
  const dir = pkg.replace(/\./g, '/');

  const fields = keys.map((k, i) => {
    const bindId = k.bindId || `kb${i}`;
    // 26.3 把按键常量挪进了 InputConstants（不再依赖 LWJGL 的 GLFW 类），
    // 类型枚举也从 KEYSYM 改名成 KEYBOARD。老的 GLFW_KEY_R 值也能兼容。
    const keyConst = String(k.key || 'KEY_R').replace(/^GLFW_/, '');
    return `    private static final net.minecraft.client.KeyMapping KEY_${bindId.toUpperCase()} = new net.minecraft.client.KeyMapping(
            "${ns}.${bindId}",
            com.mojang.blaze3d.platform.InputConstants.Type.KEYBOARD,
            com.mojang.blaze3d.platform.InputConstants.${keyConst},
            net.minecraft.client.KeyMapping.Category.MISC);`;
  }).join('\n\n');

  const calls = keys.map((k, i) => {
    const bindId = k.bindId || `kb${i}`;
    const f = `KEY_${bindId.toUpperCase()}`;
    return `        net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper.registerKeyMapping(${f});
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (${f}.consumeClick()) {
                net.minecraft.client.player.LocalPlayer player = client.player;
                net.minecraft.client.multiplayer.ClientLevel level = client.level;
                if (player != null && level != null) {
                    ${pkg}.custom.ModLogic.${k.methodName}(player, level);
                }
            }
        });`;
  }).join('\n\n');

  const content = `package ${pkg}.client;

import ${pkg}.custom.ModLogic;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.multiplayer.ClientLevel;

/**
 * 由 MC Studio 可视化积木生成的「按下按键」客户端逻辑。
 *
 * <p>这里注册的按键会出现在游戏的「按键设置」里，玩家可以随时改键。
 * 按键只在客户端触发（Minecraft 的按键本来就是客户端概念）。
 */
public class ModClient implements ClientModInitializer {
${fields}

    @Override
    public void onInitializeClient() {
${calls}
    }
}
`;
  return { path: `src/main/java/${dir}/client/ModClient.java`, content };
}
