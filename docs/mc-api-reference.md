# 积木用到的 Minecraft API（已用 javap 核对）

> 核对方式：`node tools/check-mc-api.mjs fabric-26.3` / `forge-1.20.1`
> 底层是 `javap -cp <已映射 jar>`，不是凭记忆。
>
> **26.3 的包结构大改**，这是最容易被写错的地方：
> | 旧（≤1.21） | 26.3 实际 |
> |---|---|
> | `net.minecraft.server.network.ServerPlayer` | `net.minecraft.server.level.ServerPlayer` |
> | `net.minecraft.world.entity.player.PlayerEntity` | `net.minecraft.world.entity.player.Player` |
> | `net.minecraft.util.Identifier` | `net.minecraft.resources.Identifier` |
> | `net.minecraft.text.Text` | `net.minecraft.network.chat.Component` |
> | `net.minecraft.registry.Registries` | `net.minecraft.core.registries.Registries` |
> | `player.getWorld()` | `player.level()` |
> | `player.sendMessage(Text, bool)` | `player.sendSystemMessage(Component, bool)` |
> | `player.changeGameMode(...)` | `player.setGameMode(GameType)` |
> | `level.setBlockState(pos, state)` | `level.setBlock(pos, state, flags)` |
> | `entity.getDamageSources()` | `net.minecraft.world.damagesource.DamageSources` 独立类 |

---

## 积木方法里的两个"约定变量"

每个事件方法都会带这两个变量，积木模板直接用，不用管来源：

| 变量 | 类型 | 含义 |
|---|---|---|
| `player` | `net.minecraft.server.level.ServerPlayer` | 当前玩家（只有服务端玩家才能发消息 / 改游戏模式，所以统一用 ServerPlayer） |
| `level` | `net.minecraft.world.level.Level` | 玩家所在的世界 |

> 没有玩家的事件（`server_tick`）只有 `level`，接线时用主世界（`server.overworld()`）。
>
> 目标适配器负责把各自的事件对象拆成这两个基础类型再传进来，
> 所以**同一个积木在 Fabric 和 Forge 下生成的 Java 结构完全一致**。

---

## Fabric 26.3

### ServerPlayer（`net.minecraft.server.level.ServerPlayer`）
```java
public void sendSystemMessage(net.minecraft.network.chat.Component);
public void sendSystemMessage(net.minecraft.network.chat.Component, boolean);   // boolean = 动作栏
public boolean setGameMode(net.minecraft.world.level.GameType);
public net.minecraft.world.level.GameType gameMode();
public void teleportTo(double, double, double);
public final net.minecraft.server.level.ServerPlayerGameMode gameMode;   // 字段
```

### Player（`net.minecraft.world.entity.player.Player`）
```java
public net.minecraft.world.entity.player.Inventory getInventory();
```

### LivingEntity（`net.minecraft.world.entity.LivingEntity`）
```java
public void heal(float);
public float getHealth();
public float getMaxHealth();
```

### Entity（`net.minecraft.world.entity.Entity`）
```java
public final double getX();
public final double getY();
public final double getZ();
public net.minecraft.world.level.Level level();
public void teleportTo(double, double, double);
```

### Level（`net.minecraft.world.level.Level`）
```java
// 26.3 的 Level 只有 4 参版本；3 参版本来自 LevelWriter 的 default 方法
public boolean setBlock(BlockPos, BlockState, int, int);        // Level
public default boolean setBlock(BlockPos, BlockState, int);      // LevelWriter
public void setRainLevel(float);
public void setThunderLevel(float);
```

### 注册表取值（26.3）
```java
// ❌ Registries.ITEM 是 ResourceKey，不是 Registry，不能 .get()
net.minecraft.core.registries.Registries.ITEM          // ResourceKey<Registry<Item>>
// ✅ 两种正确写法
net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(net.minecraft.resources.Identifier.parse("minecraft:apple"));
net.minecraft.core.Registry.getValue(net.minecraft.resources.Identifier.parse("minecraft:apple"));
```

### 标识符（26.3）
```java
net.minecraft.resources.Identifier.parse(String)               // ✅ 能处理 "ns:path"
net.minecraft.resources.Identifier.withDefaultNamespace(String) // ⚠️ 走 assertValidPath，**不能带 :**
net.minecraft.resources.Identifier.tryParse(String)
```

### 其它
```java
net.minecraft.network.chat.Component.literal(String)   // 没有 Text 类
net.minecraft.world.entity.player.Inventory.add(ItemStack) -> boolean
net.minecraft.world.item.ItemStack(ItemLike, int)
net.minecraft.core.BlockPos(int, int, int)
net.minecraft.world.level.block.Block.defaultBlockState()
```

---

## Fabric API 事件回调（26.3，已 javap 核对）

| 积木 | 回调接口 | 签名 |
|---|---|---|
| 右键方块 | `UseBlockCallback` | `interact(Player, Level, InteractionHand, BlockHitResult)` |
| 攻击生物 | `AttackEntityCallback` | `interact(Player, Level, InteractionHand, Entity, EntityHitResult)` |
| 使用物品 | `UseItemCallback` | `interact(Player, Level, InteractionHand)` —— **只有 3 参** |
| 破坏方块 | `PlayerBlockBreakEvents.AFTER` | `afterBlockBreak(Level, Player, BlockPos, BlockState, BlockEntity)` |
| 服务器 tick | `ServerTickEvents.END_SERVER_TICK` | `(MinecraftServer)` |

> 回调给的 `player` 是 `Player`（客户端玩家也会触发），
> 所以接线里先 `instanceof ServerPlayer` 再调，顺带过滤掉客户端。

---

## Forge 1.20.1

| 用途 | 类与方法 |
|---|---|
| 玩家 | `net.minecraft.server.level.ServerPlayer`（1.20.1 就在 `server.level`，与 26.3 同） |
| 发消息 | `player.displayClientMessage(Component, boolean)` |
| 游戏模式 | `player.setGameMode(GameType)`；**读取**用 `player.gameMode.getGameModeForPlayer()`（`gameMode` 是 public final 字段，1.20.1 没有 `gameMode()` 方法） |
| 世界 | `player.level()`（1.20.1 也有 `level()`） |
| 方块 | `level.setBlock(BlockPos, BlockState, int)`（1.20.1 直接有 3 参） |
| 标识符 | `net.minecraft.resources.ResourceLocation.parse(String)` |
| 注册表 | 取值用 `net.minecraft.core.registries.BuiltInRegistries.ITEM.get(ResourceLocation)`（`Registries.ITEM` 同样是 ResourceKey） |
| 文本 | `net.minecraft.network.chat.Component.literal(String)` |
| 背包 | `net.minecraft.world.entity.player.Inventory.add(ItemStack)` → boolean |

> **1.20.1 没有 `PlayerEntity`** —— 玩家类是 `net.minecraft.world.entity.player.Player`（26.3 也一样）。

### Forge 事件类（1.20.1，已 javap 核对）

| 积木 | 事件类 | 取值方式 |
|---|---|---|
| 右键方块 | `PlayerInteractEvent.RightClickBlock` | `getEntity()`→Player、`getLevel()`→Level、`getHand()`、`getHitVec()`→BlockHitResult（**不是 getHitResult**） |
| 使用物品 | `PlayerInteractEvent.RightClickItem` | `getEntity()`、`getLevel()`、`getHand()` |
| 攻击生物 | `AttackEntityEvent` | `getEntity()`→Player、`getTarget()`→Entity |
| 破坏方块 | `BlockEvent.BreakEvent` | `getPlayer()`→Player、`getLevel()`→**LevelAccessor**（要转成 `Level`）、`getPos()`、`getState()` |
| 玩家 tick | `TickEvent.PlayerTickEvent` | `player` 是 **public final 字段**（没有 `getPlayer()`）、`phase` 是 public final 字段 |
| 服务器 tick | `TickEvent.ServerTickEvent` | `getServer()`→MinecraftServer、`phase` 字段 |

> Forge 1.20.1 与 26.3 差异比想象中小（`Component`、`ResourceLocation`、`Registries` 同名不同包）。
> 真正不同的是：`ResourceLocation` vs `Identifier`、`setBlock` 参数个数、
> `displayClientMessage` vs `sendSystemMessage`、事件 getter 的名字与类型。

---

## 编写积木模板的规矩

1. **不要用 `player.getWorld()`** —— 两个目标都用 `player.level()`。
2. **不要用 `Text.literal`** —— 没有 `Text` 类，用 `Component.literal`。
3. **不要用 `Identifier.of`** —— 26.3 是 `Identifier.parse` / `withDefaultNamespace`；
   1.20.1 是 `ResourceLocation.parse`。
4. **不要用 `withDefaultNamespace` 处理带命名空间的 id** —— 它走 `assertValidPath`，
   传 `"minecraft:stone"` 会抛异常。**统一用 `parse`**。
5. **不要用 `setBlockState`** —— 用 `setBlock(pos, state, flags)`。
6. **不要用 `Registries.ITEM.get(...)`** —— `Registries.ITEM` 是 `ResourceKey`，
   不是 `Registry`。取值走 `BuiltInRegistries.ITEM.getValue(id)`（26.3）
   / `BuiltInRegistries.ITEM.get(id)`（1.20.1）。
7. **不要用 `player.gameMode()` 写 Forge 代码** —— 1.20.1 的 `gameMode` 是字段。
8. **不要用 `PlayerEntity`** —— 两个版本都叫 `Player`。
9. **不要假设菜单字段能加引号** —— 模板里的 `%field` 一律**不带**引号，
   引号由字段定义上的 `raw: true`（裸输出，如枚举常量 / 运算符）
   或 `string: true`（一定是字符串）决定。见 `core/visual/compile.mjs` 的 `fieldLiteralFor`。
10. **任何新积木加进来后，**必须**跑 `node tools/check-mc-api.mjs <target>`，
    再跑 `tests/visual-build.mjs` 真编译。
