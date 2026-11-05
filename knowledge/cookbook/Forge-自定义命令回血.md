---
title: 任务卡：Forge 自定义命令回血
category: 任务卡
order: 10
level: 新手
platform: forge
tags: Forge,1.20.1,命令,RegisterCommandsEvent,brigadier,回血
evidence: verified-forge-1.20.1
summary: 注册一条 /healme 命令，输入就回 4 点血。学会 Forge 的运行时事件怎么挂。
---

# Forge：自定义命令回血

> **适用平台：Forge 1.20.1**。这张卡的代码会被 `tests/forge.mjs --build`
> 挂进 Forge 工程的 `init` 钩子真编译，不是纸上谈兵。
> 26.3 的写法完全不同，别拿 Fabric 任务卡的代码改两笔就用。

**目标**：在游戏里输入 `/healme`，立刻回 4 点血（2 颗心）。

## 前置

- 一个 **Forge 1.20.1** 工程（新建时目标下拉选它）
- 不需要新增任何物品，命令本身不依赖内容条目

## 步骤

1. 「代码」→ 新增 Java 钩子，锚点选 **`init`**（主类构造器里）
2. 把下面整段贴进去
3. 生成 → 构建 jar → 装进游戏
4. 进游戏输 `/healme`

也可以直接在 AI 助手里问「Forge 1.20.1 怎么注册命令」，把回答里的 Java 代码块点
「装成钩子」，先看落点预览，**确认后**才写进工程。

## 代码

```java
net.minecraftforge.common.MinecraftForge.EVENT_BUS.register(new Object() {
    @net.minecraftforge.eventbus.api.SubscribeEvent
    public void onRegisterCommands(net.minecraftforge.event.RegisterCommandsEvent event) {
        event.getDispatcher().register(
                net.minecraft.commands.Commands.literal("healme")
                        .executes(ctx -> {
                            ctx.getSource().getPlayerOrException().heal(4.0F);
                            return 1;
                        }));
    }
});
```

## 为什么这么写

**挂 `MinecraftForge.EVENT_BUS` 而不是 mod bus**：`RegisterCommandsEvent` 是运行时事件。
mod bus 只管加载期（注册、数据生成、创造栏），挂反了不会报错但命令永远不注册。

**用匿名对象 + `@SubscribeEvent`**：钩子是插进方法体的一段语句，不能声明类、
不能写 `import`，所以用全限定名。Forge 的事件总线靠反射扫描对象上的 `@SubscribeEvent`
方法，匿名对象完全可用；比 lambda 更稳（lambda 的泛型事件类型在运行时有时推断不出来）。

**`Commands.literal("healme")`**：brigadier 的字面命令节点，Forge 已经带了这个依赖。
返回值 `1` 是命令执行结果，控制台会显示「成功执行 1 次」。

**`getPlayerOrException()`**：命令只能由玩家执行，不是玩家时抛异常并给一句友好提示，
比自己判 `instanceof` 再 `return` 省事。

## 验证

进游戏（有作弊权限的单人档或 OP），输 `/healme`：
- 血量 +2 颗心
- 满血时执行也成功，只是血量不变
- 命令补全里能看到 `/healme`

## 变体

**改成回满血**：

```java
var player = ctx.getSource().getPlayerOrException();
player.setHealth(player.getMaxHealth());
```

**加个权限判断**（只有 OP 能用）：

```java
.executes(ctx -> {
    if (!ctx.getSource().hasPermission(2)) return 0;
    ctx.getSource().getPlayerOrException().heal(4.0F);
    return 1;
})
```

**带一个数值参数**（`/healme 10` 回 5 颗心）：

```java
net.minecraft.commands.Commands.literal("healme")
        .then(net.minecraft.commands.Commands.argument("amount",
                com.mojang.brigadier.arguments.FloatArgumentType.floatArg(0.0F, 20.0F))
                .executes(ctx -> {
                    float amount = com.mojang.brigadier.arguments.FloatArgumentType.getFloat(ctx, "amount");
                    ctx.getSource().getPlayerOrException().heal(amount);
                    return 1;
                }))
```

## 相关

- 事件总线与签名 → [1.20.1 注册签名速查]()
- 另一张卡 → [任务卡：Forge 击杀怪物掉宝]()
