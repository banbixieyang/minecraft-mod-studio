# 模块开发指南

工具本身不写死任何内容类型。物品、方块、配方、矿物生成、进度……都是「模块」声明的。
**加一种新内容类型不用改引擎一行代码**，只要放一个目录进去。

---

## 一、两层扩展，先搞清楚你要动哪一层

| 你想做的 | 该动哪里 | 要写代码吗 |
| --- | --- | --- |
| 加一种内容类型（药水效果、附魔、结构、自定义模型） | 模块（`modules/xxx/`） | 写 `module.json`，可选一个 `.mjs` |
| 让已有类型多产出几个文件 | 模块的 `generate.mjs` | 是 |
| 在生成的 Java 里插一段自己的逻辑 | Java 钩子（工程里的 `hooks.java`） | 写 Java 片段 |
| 批量按规则改数据、额外产文件 | JS 钩子（工程里的 `.mjs`） | 写 JS |
| 支持新的 MC 版本 / 新加载器（NeoForge 等） | 目标适配器（`core/target/xxx/`） | 是 |

模块和钩子的区别：模块是**给大家用的**（发布出来别人装上就有），钩子是**只作用于当前工程**的。

---

## 二、一个模块长什么样

```
modules/
└── core-advancement/
    ├── module.json      ← 声明：我叫什么、我提供哪些内容类型、每种类型有哪些字段
    └── generate.mjs     ← 可选：这些数据该产出什么文件
```

模块可以放在两个地方：

- `modules/` —— 内置模块，所有工程都能用
- `<工程目录>/.studio/modules/` —— 工程私有模块，只对这个工程生效（优先级低于内置，同 id 会被内置的盖掉）

放进去之后重启编辑器（或点「模块管理」里的刷新）就会被扫描到。

---

## 三、module.json

```json
{
  "id": "core-advancement",
  "name": "进度",
  "version": "1.0.0",
  "order": 60,
  "description": "原版进度（成就）。纯数据驱动，不需要写 Java。",
  "contentTypes": [
    {
      "id": "advancement",
      "label": "进度",
      "singular": "进度",
      "group": "扩展",
      "icon": "★",
      "generate": "./generate.mjs",
      "fields": [
        { "key": "id", "label": "标识符", "type": "id", "required": true },
        { "key": "titleZh", "label": "标题", "type": "text", "required": true }
      ]
    }
  ]
}
```

### 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 模块唯一标识，重复会被跳过 |
| `name` | 是 | 显示名 |
| `version` | 否 | 版本号，纯展示 |
| `order` | 否 | 排序权重，越小越靠前（默认 100） |
| `description` | 否 | 一句话说明，显示在模块管理里 |
| `contentTypes` | 是 | 这个模块提供的内容类型，**一个模块可以给多个**（`core-material` 就同时给了工具材质和盔甲材质） |

### contentTypes 里的字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一，同时是 `project.json` 里 `entries` 的 key |
| `label` | 是 | 左栏显示的名字（复数/集合） |
| `singular` | 否 | 单数形式，用于「新建××」按钮文案 |
| `group` | 否 | 左栏分组，默认「内容」 |
| `icon` | 否 | 一个字符当图标，默认 ◆ |
| `fields` | 是 | 字段定义，决定表单长什么样 |
| `generate` | 否 | 相对本模块目录的 `.mjs` 路径 |

**硬性要求**：`fields` 里必须有一个 `key` 为 `id` 的字段 —— 引擎靠它做唯一标识、文件名、去重。

---

## 四、字段类型参考

字段定义的结构是 `{ key, label, type, ...选项 }`，`type` 决定界面控件。

| type | 长什么样 | 特有选项 |
| --- | --- | --- |
| `id` | 单行输入 + 实时合法性校验 | `placeholder` |
| `text` | 单行输入 | `placeholder` |
| `textarea` | 多行输入 | `rows` |
| `number` | 数字输入 | `min` `max` `step` |
| `select` | 下拉框（**必须有 options**） | `options: [{value, label}]` |
| `checkbox` | 开关 | — |
| `list` | 可增删的字符串列表（每项一行） | `placeholder` |
| `ref` | 从工程里已有条目中挑一个 | `refType`（如 `"item"`） |
| `grid9` | 3×3 合成网格 | — |
| `drops` | 掉落物表格（物品/最小/最大/时运） | — |
| `tags` | 多选标签 | `options` |
| `texture` | 贴图来源选择器（自动/改色/合成/手画） | — |

所有类型都支持这些通用选项：

| 选项 | 说明 |
| --- | --- |
| `label` | 字段名 |
| `hint` | 字段下方的小字说明。**认真写**，这是新手唯一能看到的帮助 |
| `placeholder` | 输入框占位符 |
| `default` | 新建条目时的默认值 |
| `required` | 必填，校验时会检查 |
| `readonly` | 只读 |
| `showIf` | 条件显示，见下 |

### showIf：字段联动

表单会跟着其它字段的值自动显示/隐藏，这是做出「同一类型不同形态」的关键。

```json
{ "key": "toolType",   "label": "工具种类", "type": "select",
  "options": [...], "showIf": { "field": "kind", "in": ["tool"] } },
{ "key": "armorSlot",  "label": "装备部位", "type": "select",
  "options": [...], "showIf": { "field": "kind", "equals": "armor" } },
{ "key": "tier",       "label": "工具材质", "type": "ref", "refType": "tier",
  "showIf": [{ "field": "kind", "equals": "tool" },
             { "field": "materialMode", "equals": "custom" }] }
```

条件支持四种写法（数组表示「同时满足」）：

| 写法 | 含义 |
| --- | --- |
| `{ field, in: [值...] }` | 字段值在列表里 |
| `{ field, equals: 值 }` | 等于 |
| `{ field, notEquals: 值 }` | 不等于 |
| `{ field, truthy: true / false }` | 真值判定 |

---

## 五、generate.mjs：模块怎么产文件

模块的 `generate` 指向一个 ES 模块，导出 `default.emit(ctx, contentType)`。

```js
export default {
  emit(ctx, contentType) {
    for (const entry of ctx.entriesOf('advancement')) {
      ctx.addFile(`src/main/resources/data/${ctx.ns}/advancement/${entry.id}.json`,
        JSON.stringify({ /* ... */ }, null, 2));
    }
  },
};
```

### ctx 提供的接口

| 成员 | 说明 |
| --- | --- |
| `ctx.project` | 整个工程数据，可读可改（改了会被保存） |
| `ctx.ns` | 模组 id，如 `mymod` |
| `ctx.pkg` | Java 包名，如 `com.example.mymod` |
| `ctx.adapter` | 当前目标适配器（能读版本号、能力开关、路径规则） |
| `ctx.entriesOf(type)` | 取某个内容类型的全部条目 |
| `ctx.addFile(path, content, opts)` | 产出一个文件。路径是相对工程根目录的 |
| `ctx.addLang(key, zh, en)` | 往语言文件里插一条翻译，两个 json 已经存在，模块不用操心 |
| `ctx.nsId(v)` | 短名补全成 `mymod:v` |
| `ctx.log(msg)` | 打印到生成日志 |

`addFile` 的 `opts` 支持：

- `{ createOnly: true }` —— 只在文件不存在时写入，永不覆盖（手写区用这个）
- `{ binary: true }` —— 内容是 Buffer（贴图之类）

### 生成阶段与顺序

```
骨架 → 平台元数据 → Java → 资源/数据 → 贴图 → 手写区
     → 模块 generate → JS 钩子 → Java 锚点注入 → 写盘
```

模块在**资源生成之后**跑，所以 `addLang` 能找到已经生成好的语言文件。
写盘时按路径去重：同一个路径后面产出的会覆盖前面的，所以模块也能**改引擎生成的任何文件**（慎用）。

---

## 六、走读一个真实模块：进度

`modules/core-advancement/` 是完整可用的例子，建议直接读。

它做了三件值得学的事：

**1. 一个类型覆盖两种形态。**
有「触发物品」就生成 `inventory_changed` 触发器；没有就用 `minecraft:impossible`，
进度照样存在、能挂树上、能当展示，只是不会自己弹出来。

**2. 短名要补命名空间。**
玩家在表单里填 `ruby`，得判断这是本模组的 `mymod:ruby` 还是原版的 `minecraft:ruby`：

```js
const ownIds = new Set([...items.map(i => i.id), ...blocks.map(b => b.id)]);
const resolve = (ref, fallback) => {
  const v = String(ref || '').trim();
  if (!v) return fallback;
  if (v.includes(':')) return v;
  return ownIds.has(v) ? `${ns}:${v}` : `minecraft:${v}`;
};
```

> 方块也是物品，图标同样能用方块 —— 这一点一开始漏了，`ruby_block` 被解析成了 `minecraft:ruby_block`。

**3. 用 `addLang` 而不是自己写语言文件。**
自己写会撞上引擎生成的同名文件，改 `addLang` 就一笔带过。

---

## 七、加一个新的游戏版本 / 加载器

`core/target/` 下每个目录是一个目标适配器，导出统一接口：

```js
export default {
  id: 'neoforge-26.3',
  label: 'NeoForge 26.3',
  platform: 'neoforge',
  mcVersion: '26.3',
  javaVersion: 25,

  defaults: { /* loaderVersion, apiVersion, … */ },

  // 能力开关：模块靠这些开关决定生成策略，不用自己判断版本号
  features: {
    componentItems: true,
    itemModelDef: true,
    equipmentAssets: true,
    creativeTabEvent: 'CreativeModeTabEvents',
    worldgenFeatureDir: 'feature',
    lootConditionStyle: 'compact',
  },

  paths: {
    javaDir: (pkg) => `...`,
    assets: (ns) => `...`,
    data: (ns) => `...`,
  },

  scaffold(p, opts)   { /* 构建脚本、wrapper、mod 元数据 */ },
  metadata(p)         { /* 每次都会刷新的元数据文件 */ },
  javaFiles(p)        { /* Java 源码 */ },
  handWritten(p)      { /* 手写区模板，带 createOnly */ },
};
```

然后在 `core/target/registry.mjs` 里登记一行：

```js
import neoforge263 from './neoforge-26.3/adapter.mjs';
export const ADAPTERS = new Map([[fabric263.id, fabric263], [neoforge263.id, neoforge263]]);
```

界面上的版本下拉会自动多一项，工程也能切过去。

**Forge 1.20.1 是这条路第一个走通的实例**（`core/target/forge-1.20.1/`），可以直接照抄：
官方 MDK 的 `build.gradle` / `mods.toml` / wrapper、`DeferredRegister` 版 Java 生成器、
以及 1.20.1 资源方言。真正需要「if 版本号」的地方只有两处，都在通用生成器里按
`adapter.features.resourceFormat` 分派：`core/generator/resources.mjs`（`recipes/` vs `recipe/`、
`loot_tables/blocks/` vs `loot_table/blocks/`、`functions` vs `modifier`、ore state 对象、
`forge/biome_modifier/`）和 `core/generator/textures.mjs`（盔甲层贴图路径）。
模块层一行版本判断都不用写。

工程数据里的 `target` 存完整 `id` + 适配器 `defaults`；老工程只有 `platform + mcVersion`，
`core/project.mjs` 的 `migrate()` 会自动补 `id`。AI 上下文也会按 `target` 换平台事实
（见 `core/ai/context.mjs`），新增目标时记得给它补一份事实集，否则 AI 会拿默认平台的 API 回答。

---

## 八、调试

**模块没出现？**
- `node studio.mjs modules` 直接看引擎扫到了什么。解析失败会打印原因（一般是 JSON 多了个逗号）。
- 同 id 的模块只会加载第一个，检查是不是和内置的重名了。

**生成时提示「模块 xxx 生成失败」？**
模块抛异常不会中断整个生成，只在报告里记一条。用 CLI 跑一次能看到完整堆栈：

```bash
node studio.mjs generate projects/我的mod
```

**想验证产出的 JSON 真的能被游戏吃下去？**
最硬的验证是起一个服务端：

```bash
cd projects/我的mod
./gradlew runServer
```

数据包解析错误会在启动时刷红字（`Couldn't parse ...`），比对着 schema 猜可靠得多。

**改了生成器之后别忘跑回归：**

```bash
node tests/smoke.mjs projects/testmod   # 生成 + 格式断言 + 指纹冲突检查
node tests/uitest.mjs                   # 无头浏览器点一遍界面，收集 JS 报错
```

---

## 九、几条经验

1. **`hint` 写清楚**。这个工具的目标是让不会写代码的人也能用，表单里的小字就是他们全部的资料。
2. **用 `showIf` 做形态分支**，不要给一个类型堆 30 个字段然后让用户自己猜该填哪些。
3. **幂等**。`emit` 每次生成都会被调用，产出要完全由数据决定，不能依赖上一次运行的状态。
4. **别碰生成区的手写内容**。要用户能改的东西，走 `{ createOnly: true }`。
5. **版本差异写进适配器，别写进模块**。模块里出现 `if (mcVersion === '26.3')` 就说明位置放错了。
