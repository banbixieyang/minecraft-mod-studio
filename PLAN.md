# 可视化编程（积木系统）实施计划

> 目标：在 MC Studio 里加一套 Scratch 式嵌套积木编辑器。
> 积木能编译成**真实可编译的 Java**；反过来贴一段 Java 也能尽力解析回积木。
> 常用逻辑、Goety 三包、任意 mod 的内容，都能打包成可加载的积木库。
> 任何人写的一段代码，也能封装成一个可复用的积木块。

---

## 1. 目标与验收标准

### 1.1 功能目标

| # | 目标 | 验收标准 |
|---|---|---|
| G1 | 嵌套积木编辑器 | 拖拽积木、上下插槽嵌套、点数字/文本可改、积木可删除可复制 |
| G2 | 积木 → Java | 编译产物是**真能过编译的 Java**，落在 `custom/CustomContent.java` 或独立方法体里 |
| G3 | Java → 积木 | 贴一段 Java，尽力解析成积木；解析不了的部分保留原文，不报错 |
| G4 | 内置常用积木库 | 玩家/世界/物品/方块/变量/流程/文本 等类别开箱可用 |
| G5 | Goety 三包转积木库 | 92 状态效果 + 125 法术 + 1600 数值 → 可加载的 `.mcblocks.json` 库 |
| G6 | 任意 mod 自动转库 | 分析器对任意 mod 都能导出「可拖拽的积木库」，机制通用不只 Goety |
| G7 | 从代码反向造积木 | 用户选一段 Java + 定义输入输出，封装成自定义积木块，可复用、可分享 |
| G8 | 积木库可加载 | 库文件能装进工程，也能从包库/文件系统导入导出 |
| G9 | 代码编辑不受影响 | 原有手写代码路径完全不变，积木是**并行**的第二条路 |

### 1.2 非目标（明确不做）

- 不做完整的 Scratch 语义（克隆体、广播、角色）。只做**事件驱动的逻辑积木**。
- 不做多语言代码生成（只有 Java + JS 钩子）。
- 不做在线积木市场。

---

## 2. 平台 + 版本 + 时代理由

| 项 | 值 | 理由 |
|---|---|---|
| 目标平台 | Fabric 26.3（主）+ Forge 1.20.1（次） | 工具已支持这两个目标，积木必须两边都能编译 |
| 积木生成语言 | Java | 两个目标都是 Java 模组，生成的代码得能直接编译 |
| JS 钩子 | 保持现有 | JS 钩子已在管线阶段运行，不与积木冲突 |

**关键约束**：积木编译出的 Java 必须**跟着目标走**。Fabric 26.3 与 Forge 1.20.1 的 API 不同
（`ServerPlayer` vs `Player`、`ItemStack` 构造不同、事件类不同）。
因此积木定义不能写死 API，必须**由目标适配器提供 Java 片段模板**。

---

## 3. 文件归属表

### 3.1 新增：引擎层（`core/visual/`）

| 文件 | 职责 |
|---|---|
| `core/visual/model.mjs` | 积木数据结构定义 + 校验（积木树、输入槽、嵌套） |
| `core/visual/blocks.mjs` | **积木定义注册表**：积木 id → 定义（类别、形状、参数、Java 模板） |
| `core/visual/compile.mjs` | **积木 → Java** 编译器 |
| `core/visual/decompile.mjs` | **Java → 积木** 反编译器（尽力而为） |
| `core/visual/library.mjs` | 积木库格式（`.mcblocks.json`）的读写、装库、导出 |
| `core/visual/builtin.mjs` | 内置常用积木库定义 |
| `core/visual/registry.mjs` | 库注册表：内置库 + 工程库 + 用户库，三层查找 |

### 3.2 新增：界面层（`ui/`）

| 文件 | 职责 |
|---|---|
| `ui/visual.js` | 积木编辑器面板：画布、积木库抽屉、属性编辑 |
| `ui/visual-blocks.js` | 积木的 DOM 渲染与拖拽交互 |
| `ui/visual-style.css`（并入 `style.css`） | 积木样式 |

### 3.3 新增：目标适配器扩展

| 文件 | 职责 |
|---|---|
| `core/target/fabric-26.3/blocks.mjs` | Fabric 26.3 的 Java 模板（Player/ServerPlayer/ServerLevel/ItemStack…） |
| `core/target/forge-1.20.1/blocks.mjs` | Forge 1.20.1 的 Java 模板 |

### 3.4 修改：既有文件

| 文件 | 改动 |
|---|---|
| `core/project.mjs` | 工程数据加 `visual: { programs: [], libraries: [] }` 字段 |
| `core/serve/routes_visual.mjs` | **新建** HTTP 入口（积木列表、编译、装库、反编译） |
| `core/serve/server.mjs` | 注册 `visual/*` 路由 |
| `core/generator/pipeline.mjs` | 生成阶段把积木编译产物写进 `custom/CustomContent.java` |
| `core/target/registry.mjs` | 暴露每个目标的积木模板 |
| `ui/app.js` | 顶栏加「积木」按钮，打开积木面板 |
| `ui/api.js` | 加 `visual.*` API 封装 |
| `core/analyze/report.mjs` | 导出「积木库」的能力（任意 mod → 积木库） |

### 3.5 新增：工具与测试

| 文件 | 职责 |
|---|---|
| `tools/export-block-library.mjs` | 把 Goety 三包（或任意 mod）导出成 `.mcblocks.json` |
| `tests/visual.mjs` | 积木引擎单元测试 |
| `tests/visual-build.mjs` | 积木 → Java → **真跑 Gradle 编译** |

---

## 4. 积木模型（核心数据结构）

积木用**树 + 序列**双结构（Scratch 的经典做法）：

```js
{
  op: 'mc.player.message',      // 积木定义 id
  inputs: {                      // 输入槽（可以嵌套另一个积木）
    target: { type: 'value', value: 'player' },
    text:   { type: 'value', value: '你好' },
  },
  fields: {                      // 下拉/开关等常量槽
    mode: 'chat',
  },
  body: [                        // 容器型积木（C 形）的子积木序列
    { op: 'mc.player.heal', inputs: { amount: { type: 'value', value: 5 } } },
  ],
  next: null,                    // 语句积木的下一块
}
```

**形状**（决定能否嵌套）：

| shape | 形态 | 例子 |
|---|---|---|
| `hat` | 帽形（事件起点） | `当玩家右键方块时` |
| `stack` | 积木（语句） | `给玩家 5 点生命` |
| `reporter` | 圆角（值） | `玩家当前生命值` |
| `boolean` | 六边形（条件） | `玩家生命值 < 20` |

**规则**：
- `stack` 可以接 `next`；`reporter`/`boolean` 可以塞进 `inputs`。
- `hat` 是一段程序的根。
- 积木不能循环嵌套自己（`body` 里不允许出现同一 op 的 hat）。

---

## 5. 积木定义格式

一个积木定义（block definition）：

```js
{
  id: 'mc.player.message',
  category: 'player',
  shape: 'stack',
  label: '对 %1 说话：%2',
  // 参数定义
  inputs: [
    { name: 'target', kind: 'entity', default: 'player' },
    { name: 'text',   kind: 'text',   default: '你好' },
  ],
  fields: [
    { name: 'mode', kind: 'menu', options: ['chat','actionbar','title'], default: 'chat' },
  ],
  // Java 生成模板（按目标适配器分派）
  java: {
    'fabric-26.3': 'target.sendMessage(Text.literal(%text), false);',
    'forge-1.20.1': 'target.displayClientMessage(Component.literal(%text), false);',
  },
}
```

**关键设计**：模板里的 `%name` 占位符由编译器替换成 Java 表达式。
- 文本参数 → `"字面量"`（自动转义）
- 数字参数 → `5.0`
- 嵌套积木 → 递归编译出的表达式
- 菜单字段 → 通过 `switch` 或常量映射

`body` 型积木用 `%body` 占位符插入子积木的编译结果。

---

## 6. Java → 积木（反编译，尽力而为）

策略：**基于积木定义库做模式匹配**，不是通用 Java 解析器。

1. 把 Java 源码切成语句行。
2. 对每行，用积木定义里 `java` 模板做反向匹配（把模板里的 `%x` 当通配正则）。
3. 匹配上 → 生成对应积木；匹配不上 → 保留原文，插入「原始代码」积木（一个能装任意 Java 语句的积木）。
4. 递归处理嵌套：匹配到的参数位置若含嵌套积木，继续匹配。

**保证**：反编译永不失败、永不丢代码。解析不了的部分用「原始代码」积木兜住，用户在界面里仍能编辑。

---

## 7. 积木库格式（`.mcblocks.json`）

```js
{
  "format": "mcblocks",
  "version": 1,
  "name": "Goety 基础库",
  "id": "goety-base",
  "description": "92 个状态效果、125 个法术、1600+ 可调数值",
  "source": { "type": "mod", "modId": "goety", "mcVersion": "1.20.1" },
  "categories": [
    { "id": "spell", "label": "法术", "icon": "✦" },
    { "id": "statusEffect", "label": "状态效果", "icon": "☠" },
  ],
  "blocks": [ /* 积木定义数组 */ ],
}
```

**装库位置**（三层查找，先到先得）：
1. 内置库（`knowledge/blocks/` 或代码内）
2. 工程库（`<工程>/.studio/blocks/`）
3. 用户库（`~/.mcstudio/blocks/`）

---

## 8. 积木 → 代码的落点

**编译产物形态**：`custom/CustomContent.java`（`createOnly`，手写区，重生成不覆盖）。

原因：
- 用户可以在编译后**继续手改** Java，积木和手写能共存。
- 每次生成时把积木编译结果写进一个**独立区段**（带标记），不覆盖用户手写部分。

```java
public final class CustomContent {
    // ==== MC Studio 积木生成区 开始 ====
    public static void program_player_rightclick_block(BlockState state, ServerPlayer player) {
        // 积木：给玩家 5 点生命
        player.heal(5.0F);
    }
    // ==== MC Studio 积木生成区 结束 ====
}
```

**事件接线**：帽形积木（hat）定义自己的触发点（`rightclick_block` / `tick` / `attack` / `break_block`），
编译器生成对应方法，方法名固定为 `program_<事件>_<序号>`，并生成注册代码插进 `CustomContent.init()`。

### 8.1 条目级（Per-Entry）积木绑定

除了挂在工程全局 `visual.programs` 的程序，每个**物品 / 方块条目**也能自带积木程序
（`entry.visualPrograms`），实现「某把剑使用时有专属效果、某方块被右键才触发」这类需求——
事件只对该条目触发，不和其它条目混在一起。

- **数据**：条目对象加 `visualPrograms: [ { op: 'event.item_use', next: … } ]`；
  编译时带上 `owner: { type: 'item'|'block', id }`，用于方法名作用域与接线过滤。
- **守卫**：`OWNER_EVENT_RULES` 限定「条目类型 + 事件 op」的合法配对（见下表），
  不兼容的组合在**编译期直接报错**（`checkOwnerEvent` 返回中文原因），绝不生成一段永远触发不到的方法。
- **方法名作用域**：per-entry 程序的方法名强制带 owner 后缀，
  `${METHOD_PREFIX[op]}_${owner.type}_${sanitizeOwnerId(id)}`（如 `on_item_use_item_ruby`），
  保证不同条目互不撞车。全局程序（`owner: null`）仍走原有的 `program_<事件>_<序号>` 规则。
- **接线过滤**：`core/target/*/visual.mjs` 的 `OWNED` 表按 `事件|类型` 给出带 owner 过滤的
  回调模板（如 `item_use` 对 item 过滤 `player.getItemInHand(hand).getItem() == ModItems.RUBY`）；
  无 owner 的程序走原 `WIRING` 表。两个目标的 import 都只引入 `ModItems`/`ModBlocks`
  的 FQN 一次，避免重复 import 导致编译失败。

| 条目类型 | 可拥有的事件 |
|---|---|
| `item` | `event.item_use`（使用物品）、`event.player_rightclick_block`（手持右键）、`event.entity_attack`（手持攻击） |
| `block` | `event.player_rightclick_block`（被右键）、`event.block_break`（被破坏） |

> UI 入口已完成：物品/方块编辑面板新增「积木效果」区块，点击进入积木面板并锁定到该条目（scope）。
> 面板标题/副标题显示当前条目，保存走 `entry.visualPrograms`，编译预览带 `owner` 触发守卫。
> 路由新增 `GET/PUT /api/visual/entry-program`，`visual/compile` 支持 `owner` 参数；
> 前端 `ui/visual.js` 改为 scope-aware，`tests/visual-routes.mjs` [9] 覆盖读写与守卫。

### 8.2 按键事件（客户端 + 可改键）

`event.key_pressed` 是**客户端**事件：帽形积木带一个 `key` 菜单字段（字母 / 数字 / F1–F12 /
空格 / Tab / `~`），生成时由目标适配器注册成游戏原生键位，**自动出现在「选项 → 按键设置」里，
玩家可以随时改键**（绑定名稳定，改键结果持久化在 `options.txt`）。

- **不进服务端接线**：按键只存在于客户端，所以它**不会**进 `ModLogic.init()`；
  目标适配器额外产出 `client/ModClient.java`：
  - Fabric 26.3：`ClientModInitializer` + `KeyMappingHelper.registerKeyMapping`，
    `ClientTickEvents.END_CLIENT_TICK` 里 `consumeClick()` 检测；
    `fabric.mod.json` 的 `entrypoints.client` 指向 `pkg.client.ModClient`。
  - Forge 1.20.1：`@Mod.EventBusSubscriber(Dist.CLIENT)` 两个嵌套订阅类
    （`RegisterKeyMappingsEvent` 在 MOD 总线、`ClientTickEvent` 在 FORGE 总线），
    `consumeClick()` 检测。
- **签名**：事件方法用基类 `Player` / `Level`（不是 `ServerPlayer`），
  这样同一个方法在客户端（`LocalPlayer`）也能编过。
- **按键常量**：积木里存中立的 `KEY_R`；Fabric 拼成 `InputConstants.KEY_R`
  （26.3 已不依赖 LWJGL 的 GLFW 类），Forge 拼成 `GLFW.GLFW_KEY_R`。
- **限制**：按键程序在客户端执行；要改世界（服务端权威）的逻辑需用「原始代码」积木自行发包。
- **语言文件**：`resources.mjs` 给每个绑定补 `ns.kb0` / `ns.key.category`，
  按键设置里显示「快捷键 1」而不是原始翻译键。
- **验证**：`tests/visual.mjs` [25] 覆盖签名 / 绑定 id / 双目标客户端接线；
  `tests/visual-build.mjs` 对 Fabric 与 Forge 各跑一次**真 Gradle 编译**。

---

## 9. API 点与来源（不许凭记忆）

| API | 来源 | 状态 |
|---|---|---|
| `ServerPlayer#sendMessage(Text, boolean)` | Fabric 26.3 API（`net.minecraft.server.network.ServerPlayer`） | 需编译验证 |
| `Player#displayClientMessage(Component, boolean)` | Forge 1.20.1（`net.minecraft.network.chat.Component`） | 需编译验证 |
| `LivingEntity#heal(float)` | 两版同名 | 需编译验证 |
| `ServerLevel#getBlockState(BlockPos)` | 两版同名 | 需编译验证 |
| `ItemStack` 构造 | 两版不同 | 需编译验证 |
| 事件回调签名 | Fabric `AttackEntityCallback` / Forge `AttackEntityEvent` | 需编译验证 |

**规则**：所有签名在 `tests/visual-build.mjs` 里**真跑 Gradle 编译**验证。
编译不过的积木标 `UNVERIFIED` 并在界面上标灰，不假装能用。

---

## 10. 风险清单

| 风险 | 影响 | 对策 |
|---|---|---|
| 两目标 API 差异大 | 积木在另一目标编译失败 | 模板按目标分派；每个目标都跑真编译 |
| 积木定义爆炸式增长 | 维护成本高 | 定义用模板 + 数据驱动，别手写一堆 if |
| 反编译准确率不高 | 用户体验差 | 兜底「原始代码」积木，永不丢代码 |
| 拖拽交互在无框架下难写 | 前端复杂度高 | 纯 DOM + Pointer Events，不引入框架 |
| 积木库 schema 演进 | 老库失效 | 带 `version` 字段 + 迁移函数 |
| 事件签名随版本变 | 编译失败 | 每个目标独立维护 `blocks.mjs`，编译验证兜底 |

---

## 11. 阶段划分

| 阶段 | 产出 | 判据 |
|---|---|---|
| A 规划 | 本文件 | 文件归属表、API 来源、风险清单齐全 |
| B 骨架 | `core/visual/*` 模型 + 编译器 + 库格式 | 单元测试通过，能编译出正确 Java |
| C 内容 | 内置库 + Goety 库 + 界面 | 界面能拖、能编译、库能装 |
| D 验证 | 构建报告 | 两个目标都真跑 Gradle 编译通过，无残留 TODO |

---

## 12. 决策记录（已与用户确认）

1. **积木形态**：嵌套积木（Scratch 式）
2. **代码落地形态**：独立方法体（编译产物在 `custom/CustomContent.java` 的独立区段）
3. **库来源**：常用积木（内置）+ Goety 三包转库 + 任意 mod 分析自动转库 + 从代码反向造积木
4. **双向要求**：积木→代码（必须正确）+ 代码→积木（尽力而为，不丢代码）

---

## 13. 拆解侧：真反编译 + 引用索引

需求原文：「拆解 jar 时要有它原本代码和引用查看，也就是说，我可以知道原本一个道具的效果是怎么实现的。」

### 13.1 为什么必须真反编译

已有的 class 分析（`core/analyze/classfile.mjs`）读的是常量池：能证明「引用了哪些 API、
出现了哪些数字」，**看不到方法体**。要回答「这道具的效果怎么实现的」，只有两条路：
读源码（发布包没有），或者反编译。

选择 **ForgeFlower**（Fernflower 分支）的原因：ForgeGradle 本来就会把它下载到
`~/.gradle/caches/forge_gradle/maven_downloader/net/minecraftforge/forgeflower/<ver>/`，
**不引入任何新依赖**，也不需要 npm 包或联网。

### 13.2 模块与接口

`core/analyze/decompile.mjs`：

| 导出 | 作用 |
|---|---|
| `findDecompiler()` | 按 `MCSTUDIO_DECOMPILER` → `tools/forgeflower.jar` → ForgeGradle 缓存 找；找不到返回 `null` |
| `decompileJar(path, {cacheDir, force})` | 反编译成 `.java` 目录，返回 `{dir, cached, files, decompiler}` |
| `buildReferenceIndex(dir)` | 类 → 源码的索引 + 反向引用（谁引用了谁） |
| `classSource(index, name)` | 一个类的源码 + `refs` + `referencedBy` |
| `decompileCacheDir()` | 默认 `~/.mcstudio/decompile` |

- **缓存**：key = `sha1(绝对路径 + size + mtime)`，产出目录带 `.done` 标记；
  命中直接复用。重编先清场，避免上一轮的产出 jar 被当成本轮结果。
- **不放 jar 旁边**：分析别人的发布包不该往人家 `build/libs` 里扔目录。
- **索引缓存**：按目录 mtime 失效 —— 界面每切一个类请求一次，不缓存会重读上千个文件。
- **引用匹配**：`import` 精确命中 + 源码里出现的 `[A-Z][A-Za-z0-9_]*` 类型名。
  允许单字母类名（`A`/`B`/`T` 在混淆包和内部类里很常见），否则反查会漏。
  这是粗匹配，**不假装是 Java 解析器**：只对「想知道它调了哪些类」够用。

### 13.3 界面

分析面板顶栏 →「反编译看源码」：

- 左：全部类的可搜索列表（类名 + 包名），默认选中主类（不含 `$` 的最短 FQN）
- 右：真 Java 源码，可复制；「引用 N」按钮收起引用列表把高度还给源码
- 下：`用到了` / `被谁用` 两行标签 —— **包内的类可点击跳转**，外部依赖（gson、原版）只展示

界面验证方式：`tests/visual-ui.mjs` + CDP 脚本驱动真浏览器，实测 366 类的真实
mod 包 —— 反编译 13.4s、索引 0.5s、切类 <10ms、引用跳转与搜索均生效。

### 13.4 边界

- 反编译**不是**反混淆：被重映射的方法名（`m_12345_`）还是不可读，但控制流在。
- 参数名可能是 `var0`/`var1` —— 发布包没带局部变量表，原件就没存名字。
- 没有 ForgeFlower 时按钮明确报错并说清往哪放，**绝不拿常量池证据冒充源码**。
