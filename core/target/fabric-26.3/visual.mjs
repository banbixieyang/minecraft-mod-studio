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
 * @param {object} info { compiled: [{ op, methodName }] }
 * @returns {string} Java 代码（可为空）
 */
export function visualWiring(p, info) {
  const compiled = info?.compiled || [];
  if (!compiled.length) return '';

  const imports = new Set();
  const bodies = [];
  for (const item of compiled) {
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
