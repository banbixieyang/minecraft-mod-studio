---
title: 任务卡：Forge 击杀怪物掉宝
category: 任务卡
order: 11
level: 新手
platform: forge
tags: Forge,1.20.1,击杀,掉落,LivingDeathEvent,spawnAtLocation,ForgeRegistries
evidence: verified-forge-1.20.1
summary: 玩家击杀怪物时额外掉一个自己注册的物品，学会按 id 取注册物与生成掉落物。
---

# Forge：击杀怪物掉宝

> **适用平台：Forge 1.20.1**。这段代码同样由 `tests/forge.mjs --build`
> 挂进 Forge 工程真编译验证。26.3 里 `spawnAtLocation` 已被移除，别混用。

**目标**：玩家杀死任意怪物时，额外掉 1 个本模组自己的物品（例如 `ruby`）。

## 前置

- 一个 **Forge 1.20.1** 工程
- 一个物品条目，例如 `ruby`（类型选「普通物品/材料」）
- 把下面代码里的 `"mymod"` 换成你的模组 id，`"ruby"` 换成你的物品 id

## 步骤

1. 「物品」标签里建 `ruby`
2. 「代码」→ 新增 Java 钩子，锚点选 **`init`**
3. 贴下面整段，改掉模组 id / 物品 id
4. 生成 → 构建 → 进游戏打一只僵尸

## 代码

```java
net.minecraftforge.common.MinecraftForge.EVENT_BUS.register(new Object() {
    @net.minecraftforge.eventbus.api.SubscribeEvent
    public void onMonsterDeath(net.minecraftforge.event.entity.living.LivingDeathEvent event) {
        if (!(event.getSource().getEntity() instanceof net.minecraft.world.entity.player.Player)) return;
        if (!(event.getEntity() instanceof net.minecraft.world.entity.monster.Monster)) return;
        var ruby = net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(
                new net.minecraft.resources.ResourceLocation("mymod", "ruby"));
        if (ruby == null) return;
        event.getEntity().spawnAtLocation(new net.minecraft.world.item.ItemStack(ruby));
    }
});
```

## 为什么这么写

**先判击杀者是玩家**：`DamageSource.getEntity()` 是造成伤害的实体。
不判的话，怪物被岩浆、摔落、别的怪物打死也会掉，刷起来不可控。

**再判死的是怪物**：`net.minecraft.world.entity.monster.Monster` 是 1.20.1 怪物共用的接口，
比罗列 `Zombie / Skeleton / Creeper` 稳，模组加的怪物只要实现这个接口也能覆盖。

**按 id 反查注册物**：`ForgeRegistries.ITEMS.getValue(ResourceLocation)` 不要求你在钩子里
拿到 `RegistryObject` 的引用 —— 钩子插在主类里，用全限定名按 id 取最省事。
返回可能是 `null`（物品没注册或 id 写错），所以判一次空，避免生成空栈时 NPE。

**`spawnAtLocation(ItemStack)`**：1.20.1 的实体方法，会在实体位置生成掉落物并带一点随机散开。
26.3 已移除它、改用 `entity.drop(...)`；反过来在 1.20.1 写 `drop(...)` 也编不过。

**不用判客户端**：`LivingDeathEvent` 只在服务端触发，这里不需要 `isClientSide()` 检查，
也不该在钩子里随手引 `level()` 之类的版本敏感方法。

## 验证

进游戏 `/give @s mymod:ruby` 确认物品存在，再杀一只僵尸：
- 怪物原地额外掉 1 个 `ruby`
- 怪物自然死亡（摔死、被别的怪打死）时**不**掉
- 控制台没有报错

## 变体

**掉 1~3 个**：

```java
int count = 1 + event.getEntity().getRandom().nextInt(3);
event.getEntity().spawnAtLocation(new net.minecraft.world.item.ItemStack(ruby, count));
```

**只掉原版物品**（不想依赖自己的条目）：

```java
event.getEntity().spawnAtLocation(
        new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND));
```

**改成 10% 概率**：

```java
if (event.getEntity().getRandom().nextFloat() >= 0.1F) return;
```

放在判空之后、`spawnAtLocation` 之前。

## 相关

- 事件与注册签名 → [1.20.1 注册签名速查]()
- 另一张卡 → [任务卡：Forge 自定义命令回血]()
