/**
 * 效果模板库 —— 「分析出来这个 mod 有吸血」之后，真的能给你一段能用的吸血代码。
 *
 * 为什么不是「反编译它的代码然后抄过来」：
 *  反编译出来的代码依赖它自己的类、自己的工具方法、自己的注册表，
 *  搬到你的工程里十条有九条编译不过。抄过来的不是能力，是包袱。
 *
 * 这里的做法是：为每种常见能力准备一份**独立、可编译、参数化**的实现。
 * 代码全部用全限定名写（钩子是插进方法体的，加不了 import），
 * 只依赖 Fabric API 和原版类，装到任何工程都能直接用。
 *
 * 每一段都在 packs/ 测试工程里真编译过 —— 见 tests/effects.mjs。
 */

/**
 * 参数类型：
 *   number / text / select
 * 代码里用 {{key}} 引用。
 */
export const EFFECTS = [
  {
    id: 'attack_lifesteal',
    name: '攻击吸血',
    category: '战斗',
    abilities: ['attack_hit', 'damage_after', 'heal'],
    desc: '打中目标后按伤害比例回血。原版没有对应附魔，所以能和附魔叠加。',
    tags: ['战斗', '生存'],
    params: [
      { key: 'ratio', label: '吸血比例', type: 'number', default: 0.3, min: 0, max: 3, step: 0.1, hint: '0.3 = 造成伤害的 30% 转成回血' },
      { key: 'cap', label: '单次回血上限', type: 'number', default: 8, min: 0, step: 0.5, hint: '防止一刀吸满，填 0 表示不限' },
    ],
    java: [
      {
        target: 'init',
        name: '攻击吸血',
        code: `// 攻击吸血：造成伤害后按比例回血（不是附魔，可与附魔叠加）
        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DAMAGE.register(
                (entity, source, baseDamage, damageTaken, blocked) -> {
                    if (blocked || damageTaken <= 0.0F) {
                        return;
                    }
                    if (!(source.getEntity() instanceof net.minecraft.server.level.ServerPlayer attacker)) {
                        return;
                    }
                    float heal = damageTaken * {{ratio}}F;
                    float cap = {{cap}}F;
                    if (cap > 0.0F && heal > cap) {
                        heal = cap;
                    }
                    attacker.heal(heal);
                });`,
      },
    ],
  },

  {
    id: 'damage_dodge',
    name: '概率免伤',
    category: '战斗',
    abilities: ['damage_allow'],
    desc: '挨打时按概率直接免疫这一下。适合做「虚空化」「闪避」这类设定。',
    tags: ['战斗', '生存'],
    params: [
      { key: 'chance', label: '免伤概率', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05, hint: '0.25 = 25%' },
    ],
    java: [
      {
        target: 'init',
        name: '概率免伤',
        code: `// 概率免伤：返回 false 表示这次伤害不结算
        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.ALLOW_DAMAGE.register(
                (entity, source, amount) -> {
                    if (!(entity instanceof net.minecraft.server.level.ServerPlayer player)) {
                        return true;
                    }
                    if (player.getRandom().nextDouble() >= {{chance}}) {
                        return true;
                    }
                    player.level().sendParticles(
                            net.minecraft.core.particles.ParticleTypes.REVERSE_PORTAL,
                            player.getX(), player.getY() + 1.0, player.getZ(),
                            20, 0.3, 0.6, 0.3, 0.05);
                    return false;
                });`,
      },
    ],
  },

  {
    id: 'fall_immune',
    name: '摔落免疫',
    category: '移动',
    abilities: ['fall_protect'],
    desc: '免疫摔落伤害。比靴子的冰霜行者更彻底，且不占附魔位。',
    tags: ['移动', '生存'],
    params: [],
    java: [
      {
        target: 'init',
        name: '摔落免疫',
        code: `// 摔落免疫
        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.ALLOW_DAMAGE.register(
                (entity, source, amount) -> !(entity instanceof net.minecraft.server.level.ServerPlayer
                        && source.is(net.minecraft.tags.DamageTypeTags.IS_FALL)));`,
      },
    ],
  },

  {
    id: 'held_attribute',
    name: '手持/穿戴时加属性',
    category: '属性',
    abilities: ['attribute_modifier', 'scheduler'],
    desc: '主手拿着某件物品时持续获得属性加成（最大生命、攻击、移速、挖掘效率…）。用独立的属性修饰符 id，能和原版附魔叠加。',
    tags: ['属性', '装备'],
    params: [
      { key: 'item', label: '物品 id', type: 'text', default: 'ruby_sword', hint: '本模组内的短名即可，例如 ruby_sword' },
      {
        key: 'attribute', label: '属性', type: 'select', default: 'MAX_HEALTH',
        options: ['MAX_HEALTH', 'ATTACK_DAMAGE', 'MOVEMENT_SPEED', 'ATTACK_SPEED', 'MINING_EFFICIENCY', 'ARMOR', 'KNOCKBACK_RESISTANCE'],
        hint: 'MAX_HEALTH=最大生命，MOVEMENT_SPEED=移速，MINING_EFFICIENCY=挖掘效率',
      },
      { key: 'amount', label: '数值', type: 'number', default: 4, step: 0.5, hint: 'ADD_VALUE 是直接加；移速类建议改用 ADD_MULTIPLIED_BASE' },
      {
        key: 'operation', label: '叠加方式', type: 'select', default: 'ADD_VALUE',
        options: ['ADD_VALUE', 'ADD_MULTIPLIED_BASE', 'ADD_MULTIPLIED_TOTAL'],
      },
    ],
    java: [
      {
        target: 'init',
        name: '手持加属性',
        code: `// 手持指定物品时获得属性加成
        final net.minecraft.resources.Identifier modifierId = id("effect_held_{{attribute}}_modifier");
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            for (net.minecraft.server.level.ServerPlayer player : server.getPlayerList().getPlayers()) {
                var inst = player.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.{{attribute}});
                if (inst == null) {
                    continue;
                }
                var heldId = net.minecraft.core.registries.BuiltInRegistries.ITEM
                        .getKey(player.getMainHandItem().getItem());
                boolean shouldHave = id("{{item}}").equals(heldId);
                boolean present = inst.getModifier(modifierId) != null;
                if (shouldHave && !present) {
                    inst.addTransientModifier(new net.minecraft.world.entity.ai.attributes.AttributeModifier(
                            modifierId, {{amount}},
                            net.minecraft.world.entity.ai.attributes.AttributeModifier.Operation.{{operation}}));
                } else if (!shouldHave && present) {
                    inst.removeModifier(modifierId);
                }
            }
        });`,
      },
    ],
  },

  {
    id: 'held_flight',
    name: '手持时允许飞行',
    category: '移动',
    abilities: ['flight', 'gravity'],
    desc: '拿着某件物品就能飞，放下就掉下来。比创造模式飞行更好控制，不会污染玩家状态。',
    tags: ['移动'],
    params: [
      { key: 'item', label: '物品 id', type: 'text', default: 'ender_cloak', hint: '本模组内的短名' },
    ],
    java: [
      {
        target: 'init',
        name: '手持飞行',
        code: `// 手持指定物品允许飞行
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            for (net.minecraft.server.level.ServerPlayer player : server.getPlayerList().getPlayers()) {
                if (player.isCreative() || player.isSpectator()) {
                    continue;
                }
                var heldId = net.minecraft.core.registries.BuiltInRegistries.ITEM
                        .getKey(player.getMainHandItem().getItem());
                boolean allow = id("{{item}}").equals(heldId);
                var abilities = player.getAbilities();
                if (allow && !abilities.mayfly) {
                    abilities.mayfly = true;
                    player.onUpdateAbilities();
                } else if (!allow && abilities.mayfly) {
                    abilities.mayfly = false;
                    abilities.flying = false;
                    player.onUpdateAbilities();
                }
            }
        });`,
      },
    ],
  },

  {
    id: 'periodic_heal',
    name: '范围周期效果',
    category: '属性',
    abilities: ['scheduler', 'heal'],
    desc: '每隔一段时间给附近玩家/生物上效果。做「反时间场」「恢复光环」这类。',
    tags: ['属性', '辅助'],
    params: [
      { key: 'interval', label: '间隔（tick）', type: 'number', default: 40, min: 1, step: 1, hint: '20 tick = 1 秒' },
      { key: 'radius', label: '半径（格）', type: 'number', default: 8, min: 1, step: 1 },
    ],
    java: [
      {
        target: 'init',
        name: '范围周期恢复',
        code: `// 每 {{interval}} tick 给半径 {{radius}} 格内的玩家恢复生命
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            if (server.getTickCount() % {{interval}} != 0) {
                return;
            }
            for (net.minecraft.server.level.ServerPlayer player : server.getPlayerList().getPlayers()) {
                var box = player.getBoundingBox().inflate({{radius}});
                for (net.minecraft.server.level.ServerPlayer other
                        : player.level().getEntitiesOfClass(net.minecraft.server.level.ServerPlayer.class, box)) {
                    if (other.getHealth() < other.getMaxHealth()) {
                        other.heal(1.0F);
                    }
                }
            }
        });`,
      },
    ],
  },

  {
    id: 'kill_reward',
    name: '击杀奖励',
    category: '战斗',
    abilities: ['death_hook'],
    desc: '击杀生物时给击杀者掉落/奖励。',
    tags: ['战斗', '掉落'],
    params: [
      { key: 'item', label: '物品 id', type: 'text', default: 'zhi_dust', hint: '本模组内的短名' },
      { key: 'count', label: '数量', type: 'number', default: 1, min: 1, step: 1 },
    ],
    java: [
      {
        target: 'init',
        name: '击杀奖励',
        code: `// 击杀生物时掉落指定物品
        // 注意两个 26.3 的坑：
        //   1. BuiltInRegistries.ITEM.get() 返回 Optional<Reference<Item>>，不是 Item
        //   2. LivingEntity 没有 spawnAtLocation 了，改用 drop(堆, 是否打散, Prediction)
        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register(
                (entity, source) -> {
                    if (!(source.getEntity() instanceof net.minecraft.server.level.ServerPlayer killer)) {
                        return;
                    }
                    var holder = net.minecraft.core.registries.BuiltInRegistries.ITEM.get(id("{{item}}"));
                    if (holder.isEmpty()) {
                        return;
                    }
                    killer.drop(new net.minecraft.world.item.ItemStack(holder.get().value(), {{count}}),
                            false, net.minecraft.util.Prediction.SERVER_ONLY);
                });`,
      },
    ],
  },
];

/** 按 id 取模板 */
export function getEffect(id) {
  return EFFECTS.find((e) => e.id === id) || null;
}

/** 这个能力（分析结果里的 abilities[].id）有哪些现成模板 */
export function effectsForAbility(abilityId) {
  return EFFECTS.filter((e) => (e.abilities || []).includes(abilityId));
}

/**
 * 把模板变成 Pack。
 * 用户可以传 ownParams 覆盖默认值，也可以改代码。
 */
export function effectToPack(effect, overrides = {}) {
  return {
    format: 'mcstudio.pack',
    formatVersion: 1,
    id: effect.id,
    name: overrides.name || effect.name,
    kind: 'effect',
    desc: overrides.desc || effect.desc,
    tags: effect.tags || [],
    author: 'MC Studio 内置',
    createdAt: Date.now(),
    origin: { kind: 'template', template: effect.id },
    requires: { platform: ['fabric'], mcVersion: ['26.3'], modules: [], contentTypes: [] },
    params: effect.params || [],
    content: {
      entries: {},
      java: (effect.java || []).map((j) => ({
        target: j.target || 'init',
        name: j.name || effect.name,
        code: overrides.code || j.code,
      })),
      js: [],
      lang: {},
      files: [],
      textures: [],
    },
  };
}
