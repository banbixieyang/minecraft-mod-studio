---
title: 指南：Forge 1.20.1 从零到出 jar
category: 指南
order: 5
level: 新手
platform: forge
tags: Forge,1.20.1,入门,构建,mods.toml,Gradle,Java17
evidence: official
summary: 选目标、填内容、生成、构建、装进游戏的完整流程，以及 1.20.1 与 26.3 的差异。
---

# Forge 1.20.1 从零到出 jar

> **证据等级 `official`**：版本、骨架与 API 依据 Forge 官方 MDK `1.20.1-47.4.0` 解包核对，
> 并由 `tests/forge.mjs --build` 用 Gradle 真编译背书。与 26.3 那套组件式 API **不是一个时代**，别混着抄。

**目标**：不写一行 Java，用表单做出一个带矿物、装备、配方和世界生成的 Forge 模组，最后拿到能装进游戏的 jar。

## 1. 选目标

欢迎页新建工程时，「目标平台」下拉要选 **Forge 1.20.1**。这一步决定了后面所有产出：

| 目标 | 加载器 | MC | JDK | 构建 |
|---|---|---|---|---|
| Fabric 26.3 | Fabric Loader 0.19.5 | 26.3 | 25 | Loom + Gradle 9.5.1 |
| **Forge 1.20.1** | Forge 47.4.0 | 1.20.1 | **17** | ForgeGradle 6.x + Gradle 8.8 |

工程会把选中的目标完整写进 `.studio/project.json` 的 `target`（含 `id`、`forgeVersion`、`mappingChannel` 等）。
以后加新版本，就是在目标注册表里多登记一个适配器，界面和生成器都不用改。

> **JDK 17 是硬要求**：1.20.1 用 Java 17，用 JDK 25 去编会在 ForgeGradle 阶段直接失败。
> 本机如果找不到 JDK 17，`build.gradle` 里的 foojay 插件会尝试自动准备。

## 2. 环境准备

工程目录里已经带好了 `gradlew` / `gradlew.bat` / `gradle/wrapper/gradle-wrapper.jar`，
**不用自己装 Gradle**，wrapper 会拉 8.8。

首次构建会下载 Forge、Minecraft 和反编译产物，比较久，属于正常现象。
如果卡在 `gradle-8.8-bin.zip` 不动，是 wrapper 下载源的问题：
可以手动把 Gradle 8.8 发行包放进 `~/.gradle/wrapper/dists/gradle-8.8-bin/<hash>/`
（解压成 `gradle-8.8/` 并放一个空的 `gradle-8.8-bin.zip.ok`），wrapper 就会直接用本地的。

## 3. 填内容

在界面里按需添加条目，各类型都会生成 1.20.1 方言的资源：

- **物品**：普通物品、工具（剑/镐/斧/铲/锄）、盔甲
- **工具材质 / 盔甲材质**：自定义 `Tier` / `ArmorMaterial`
- **方块**：矿石、普通方块，自动生成 `BlockItem` 和方块模型
- **配方 / 战利品表 / 标签 / 世界生成**

其中世界生成会自动多写一份 `data/<id>/forge/biome_modifier/*.json` —— 1.20.1 的
`configured_feature` 不挂 biome modifier 是**不会生成**的，这一步编辑器已经替你做了。

## 4. 生成与构建

1. 点「生成」：把内容写成 `src/main/java/...`、`src/main/resources/...`
2. 点「构建 jar」：跑 `gradlew build`
3. 产物在 `build/libs/<模组id>-<版本>.jar`

`jar` 任务挂了 `finalizedBy 'reobfJar'`：开发环境用官方映射名，运行时是混淆名，
reobf 负责转换。别把这个去掉，否则装进游戏会 `NoClassDefFoundError`。

## 5. 装进游戏

1. 用 Forge 47.x 安装器装好 1.20.1 的 Forge
2. 把 jar 放进该实例的 `mods/`
3. 启动游戏，日志里应该看到主类打印的 `[<模组id>] 已加载`

`META-INF/mods.toml` 里的 `modId` 必须和工程 id 一致，且全是小写；
`[[dependencies.<modId>]]` 段声明了 forge `[47,)` 和 minecraft `[1.20.1,1.21)` 的版本范围，改 id 时记得一起改。

## 6. 想加逻辑：手写区与钩子

- `src/main/java/<pkg>/custom/CustomContent.java` 是**手写区**，只在第一次生成时创建，之后不会被覆盖。
  注册事件、命令、能力都写这里，参数是 `IEventBus modEventBus`。
- 「代码」区可以加 Java 钩子，锚点有 `init`（主类构造器）、`items`、`blocks`、`tabs`。
  AI 回答里的 Java 代码块可以点「装成钩子」，会先给真实落点预览，**确认后**才写进工程配置；
  再点「生成」才真正插进 Java 源码，最后「构建」才生效。任何一步都不会偷偷改你的 Java。

钩子是插在方法体里的语句，所以：

```java
// ✓ 全限定名 + 语句
net.minecraftforge.common.MinecraftForge.EVENT_BUS.register(new Object() {
    @net.minecraftforge.eventbus.api.SubscribeEvent
    public void onTick(net.minecraftforge.event.TickEvent.ServerTickEvent.Post event) {
        // 你的逻辑
    }
});
```

不能写 `package`、`import`、类声明、`@Mod`，也不用写 `// @hook:` 锚点 —— 生成器自己有。

## 7. 与 26.3 的关键差异

| 事情 | Forge 1.20.1 | Fabric 26.3 |
|---|---|---|
| 注册 | `DeferredRegister` + `RegistryObject` | `Registry.register(BuiltInRegistries...)` |
| 命名空间 id | `new ResourceLocation(ns, path)` | `Identifier.fromNamespaceAndPath(...)` |
| 物品 | `new SwordItem(Tier, ...)` 类继承式 | `Item.Properties().sword(ToolMaterial, ...)` 组件式 |
| 自定义材质 | 实现 `Tier` / `ArmorMaterial` 接口 | 构造 `ToolMaterial` / `ArmorMaterial` record |
| 创造栏 | `BuildCreativeModeTabContentsEvent` | Fabric 的 tab builder / `ItemGroupEvents` |
| 盔甲贴图 | `assets/minecraft/textures/models/armor/<name>_layer_1.png` | `assets/<ns>/textures/entity/equipment/...` |
| 配方目录 | `data/<ns>/recipes/`，`result: {"item":...}` | `data/<ns>/recipe/`，`result: {"id":...}` |
| 元信息 | `META-INF/mods.toml` | `fabric.mod.json` |
| pack_format | 15 | 26.x 的值 |

**一句话**：看到 `Identifier`、`setId()`、`ToolMaterial`、`net.fabricmc` 就知道那是 26.3 的资料，
在 1.20.1 工程里一律不能用。知识库每篇都标了 `platform`，检索会按当前工程加权。

## 8. 常见失败

| 现象 | 原因 / 处理 |
|---|---|
| 编译报 `invalid target release: 17` 或 toolchain 找不到 | 本机 JDK 版本不对，装 JDK 17 或让 foojay 自动装 |
| `gradle-8.8-bin.zip` 下载卡住 | 见第 2 节，手动备好发行包 |
| 游戏里物品是紫黑方块 | `models/item/<id>.json` 缺了，或贴图路径不对 |
| 穿上盔甲没贴图 | 少了 `<name>_layer_1.png` / `_layer_2.png`，名字由 `ArmorMaterial.getName()` 决定 |
| 矿物一个都不生成 | 没写 `forge/biome_modifier/`，或 `configured_feature` 的 `state` 写成了字符串（1.20.1 要 `{"Name":"..."}` 对象） |
| 启动时报 mod 依赖不满足 | `mods.toml` 的版本范围 / `modId` 与工程 id 不一致 |
| 装进游戏 `NoClassDefFoundError` | jar 没经过 `reobfJar`，别把 `finalizedBy` 去掉 |

## 相关

- 注册怎么写 → [1.20.1 注册签名速查]()
- 资源目录与坑 → [1.20.1 踩坑清单]()
- 现成可粘的逻辑 → 任务卡里的 Forge 两张
