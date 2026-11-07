# 直接复制这段发给 AI

> 用法：把下面 `---` 之间的全部内容复制给 AI（Claude / GPT / 任意对话模型），
> 再补一句你想做什么 mod。如果对方能读本地文件，让它读 `docs/ai-handoff.md` 更省事。

---

我要用 **MC Studio** 做 Minecraft mod。它是一个跑在我电脑上的本地工具，你通过命令行操作它。
你的主要工作是**填结构化数据**，不是手写 Java —— Java 代码、配方 JSON、贴图、元数据都由它生成。

## 工具是什么

- 零 npm 依赖，纯 Node.js（≥ 22.12），不需要 `npm install`
- 入口是 `studio.mjs`。下面所有命令都在**含 `studio.mjs` 的目录**执行
- 工程在 `projects/<id>/`，**唯一数据源是 `projects/<id>/.studio/project.json`**
- 界面（`node studio.mjs start`）和你改文件读写的是同一份数据，你可以完全不碰界面

**只支持两个目标，请不要答应别的（NeoForge / Paper / 1.21.x 都不行）**：

| target id | MC | JDK |
|---|---|---|
| `fabric-26.3` | 26.3 | 25（自动） |
| `forge-1.20.1` | 1.20.1 | 17（可能要设 JAVA_HOME） |

## 命令

```bash
node studio.mjs targets                  # 看目标
node studio.mjs modules                  # 看内容类型
node studio.mjs new 我的mod --id mymod --pkg com.example.mymod --target fabric-26.3
node studio.mjs generate projects/mymod  # 生成/更新代码
node studio.mjs build    projects/mymod  # Gradle 真编译，产物在 build/libs/
```

`new` 会自动生成一遍骨架。之后每次改完数据就跑一次 `generate`，最后 `build`。

## project.json 的形状

```json
{
  "meta":     { "name": "我的mod", "id": "mymod", "pkg": "com.example.mymod", "version": "0.1.0" },
  "target":   { "id": "fabric-26.3", "...": "由 new 填好，别动" },
  "entries":  { "item": [ ... ], "block": [ ... ], "recipe": [ ... ] },
  "hooks":    { "java": [], "js": [] }
}
```

`entries` 的键是内容类型，值是条目数组。常见类型：
`item` 物品 · `block` 方块 · `recipe` 配方 · `worldgen` 矿物生成 · `dimension` 维度 ·
`biome` 群系 · `structure` 结构 · `loot_table` 战利品表 · `tier` 工具材质 ·
`armorMaterial` 盔甲材质 · `advancement` 进度 · `hud` HUD 面板

## 开工前：先把字段表拿到手

**字段名和下拉取值以工具的 module.json 为准，不要凭印象编。** 如果我还没给你字段表，
让我跑下面这条命令，把输出贴给你：

```bash
node --input-type=module -e "
import { listContentTypes } from './core/modules/registry.mjs';
for (const ct of listContentTypes()) {
  console.log('## ' + ct.id);
  for (const f of ct.fields) console.log('  ' + f.key + ':' + f.type + (f.required ? '*' : '')
    + (f.options ? ' = ' + f.options.map(o => o.value).join(' | ') : ''));
}"
```

（`type` 的含义：`id` 小写标识符 · `text` 字符串 · `number` 数字 · `checkbox` true/false ·
`select` 只能填列出的值 · `list` 字符串数组 · `ref` 填另一类型某条目的 id ·
`grid9` 9 个字符串的数组，空槽写 `""` · `drops` 形如 `[{item,min,max,fortune}]` ·
`texture` 通常直接不写 = 自动贴图）

## 引用 id 的规则（这里最容易出错，请严格遵守）

- 引用**原版**东西：写全 `minecraft:diamond`
- 引用**我自己的**物品/方块：配方、掉落物、矿物生成、结构战利品表里可以写短 id（`ruby`，会自动补命名空间）
- **但这几处必须写全 `<modid>:<id>`，写短的会被错补成 `minecraft:` 然后静默失效**：
  - `dimension.biome`（指向自己的群系时）
  - `structure.block` / `accentBlock` / `floorBlock`（用自己方块时）
  - `tier.repairItems` / `armorMaterial.repairItems`（完全不补，必须全 id）
- `item.tier` / `item.armorMaterial` 这类 `ref` 字段，填**工程内条目的 id**（短 id）
- 引用**别的模组**的东西：永远写全 `othermod:thing`

## 红线

1. **不要改生成出来的文件**（`src/` 下除 `custom/` 之外的东西）—— 下次 `generate` 会覆盖或报冲突。
   要写逻辑，用 `hooks.java`（短逻辑，必须写全限定名，没有 import 可用），
   或写进 `src/main/java/<pkg>/custom/`（永不被覆盖）。
2. **不要手写** `fabric.mod.json`、配方 JSON、战利品表、贴图 —— 生成器已经在做。
3. **不要猜字段名/枚举值**，先拿 §字段表。
4. **不要跳过 `build` 就宣布完成**。
5. 改 `entries` 时要保留已有条目（读出来再改，不要整体替换成你新写的那几条）。
6. 不要删除我的工程目录或构建产物。

## 怎么算做完

```bash
node studio.mjs generate projects/<id>   # 期望：冲突 0，没有 "! " 错误行
node studio.mjs build    projects/<id>   # 期望：退出码 0，"构建成功" + jar 路径
```

交活时告诉我：改了哪些条目、`generate` 和 `build` 的实际输出、产物 jar 在哪。
如果构建失败，把报错的关键几行贴给我并说明你打算怎么修 —— 不要说"基本完成"。

## 当前任务

（在这里写你要做的 mod：目标平台、大致内容、有没有参考对象）
