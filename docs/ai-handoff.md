# 用 MC Studio 做 Minecraft mod —— 交给 AI 的说明书

> **读者**：要替用户做 Minecraft mod 的 AI（Claude / GPT / Cursor / 其它 agent）。
> 读完这份，你应该知道：改哪个文件、跑哪条命令、怎么证明做对了。
>
> 对应版本：MC Studio 0.1.0。文中每条命令、每个字段、每条坑，都在当前仓库上实跑核对过。
> 如果只能读一节，读 §0 和 §9。

---

## §0 三十秒版

MC Studio 是一个**零 npm 依赖的本地 Node 工具**。做 mod 就三步：

```
往 .studio/project.json 填结构化数据  →  node studio.mjs generate <工程>  →  node studio.mjs build <工程>
```

**你不该手写 Java 样板，也不该手写 `fabric.mod.json` / 配方 JSON / 战利品表 / 贴图。**
这些都由生成器按模板产出。你的工作是**填对数据**。

界面（`node studio.mjs start`）和命令行读写的是**同一份数据**，用界面改和用文件改等价。
你完全可以不碰界面。

支持两个目标，只承诺这两个：

| target id | 加载器 | MC | JDK | 构建栈 |
|---|---|---|---|---|
| `fabric-26.3` | Fabric Loader 0.19.5 | 26.3 | 25 | Loom 1.17.21 + Gradle 9.5.1 |
| `forge-1.20.1` | Forge 47.4.0 | 1.20.1 | 17 | ForgeGradle 6.x + Gradle 8.8 |

NeoForge / Paper / 1.21.x / 1.19 —— **不要答应**。适配器机制能挂外部目标，但内置模板、积木库、
版本方言分支只覆盖上面两个，答应了大概率交付不了。

一句话判据：**`build` 退出码 0 且 `build/libs/*.jar` 存在，才算做完。** 编译失败不叫"基本完成"。

---

## §1 环境

| 项 | 要求 |
|---|---|
| Node.js | ≥ 22.12（`package.json` 的 `engines`）。低版本会在启动时明确报错 |
| 依赖安装 | **不需要**。`node_modules` 不存在也能跑，全程只用 Node 标准库 |
| JDK | `fabric-26.3` → 25（toolchain 会自动 provision）；`forge-1.20.1` → 17（见 §9.3） |
| 首次构建 | 慢（下载 Gradle 发行包 + 平台依赖），几分钟正常。已有 `~/.gradle` 缓存时，一个空工程约 40 秒出 jar |

**工作目录**：下文所有命令都在**含 `studio.mjs` 的那一层**执行（下称「工具根」）。
工程本身在 `projects/<id>/`，你也可以用绝对路径指向任意位置的工程。

---

## §2 命令表

```bash
node studio.mjs targets                 # 列可用目标（id / MC / JDK）
node studio.mjs modules                 # 列模块与 12 种内容类型
node studio.mjs start [--port 4173]     # 开界面（你不用，但用户可能用）
node studio.mjs new <名字> --id <id> --pkg <pkg> --target fabric-26.3
node studio.mjs generate <工程目录> [--force]
node studio.mjs build    <工程目录> [--deploy <客户端 mods 目录>]
```

- `new` 把工程建到 `projects/<id>/`，**并且立刻生成一遍**（所以新建后就有可编译骨架）。
- `generate` 只同步文件，不编译。输出形如
  `写入 32 / 未变 0 / 冲突 0 / 删除 0`，后面可能跟 `! 错误` 与 `· 警告`。
- `build` 调工程自带的 `gradlew` 真编译，产物打印为 `产物：<路径> (KB)`。
- 其它子命令（积木、转换器、工具索引）见 §12。

---

## §3 工程长什么样

```
projects/<id>/
├── .studio/project.json      ← 唯一数据源。你只改这个
├── .studio/files.json        ← 生成指纹（判断「生成区被手改过」）。别动
├── build.gradle  gradle/  gradlew*  settings.gradle   ← 脚手架产物
├── src/main/java/<pkg 路径>/ ← 生成 + 你自己写的
└── src/main/resources/       ← 生成的资源与数据包
```

`.studio/project.json` 的完整形状：

```json
{
  "studioVersion": 1,
  "meta": {
    "name": "红宝石工坊",
    "id": "rubycraft",
    "pkg": "com.example.rubycraft",
    "version": "0.1.0",
    "authors": "",
    "description": "",
    "license": "MIT",
    "icon": ""
  },
  "target": {
    "id": "fabric-26.3",
    "platform": "fabric",
    "mcVersion": "26.3",
    "loaderVersion": "0.19.5",
    "apiVersion": "0.164.0+26.3",
    "javaVersion": 25
  },
  "entries": {
    "item":  [ { "id": "ruby", "nameZh": "红宝石", "...": "..." } ],
    "block": [ ],
    "recipe": [ ]
  },
  "files": {},
  "state": {},
  "hooks": { "java": [], "js": [] },
  "localDeps": [],
  "visual": { "programs": [], "libraries": [] }
}
```

- `meta.id` = 命名空间（ns）。所有资源路径、注册名都挂在它下面。
- `entries` 的键就是 §5 里的**内容类型 id**，值是条目数组。没写的类型视为空。
- `files` / `state` / `visual` 由工具维护，**不要手写**。
- `hooks` 见 §11；`localDeps` 见 §12。

---

## §4 标准流程

```bash
# 1. 建工程（会自动生成一遍）
node studio.mjs new 红宝石工坊 --id rubycraft --pkg com.example.rubycraft --target fabric-26.3

# 2. 填内容（见 §5，别手拼字段）

# 3. 重新生成
node studio.mjs generate projects/rubycraft

# 4. 出 jar
node studio.mjs build projects/rubycraft
```

改一次数据就跑一次 `generate`；`build` 放在最后，或每轮收尾跑一次确认没把编译搞坏。

---

## §5 造条目的正确姿势（最省事、也最不容易缺字段）

条目的字段由 `modules/*/module.json` 声明，**界面、生成器、字段一致性测试共用这一份声明**。
所以最稳的做法不是手写 JSON，而是让引擎替你填默认值：

```js
// 在工具根执行：node --input-type=module -e "<这段>"
import { loadProject, saveProject } from './core/project.mjs';
import { listContentTypes, blankEntry } from './core/modules/registry.mjs';

const ROOT = 'projects/rubycraft';
const p = loadProject(ROOT);
const ct = Object.fromEntries(listContentTypes().map((c) => [c.id, c]));

const item = blankEntry(ct.item, 'ruby');   // 拿到带全部默认值的条目
item.nameZh = '红宝石';
item.nameEn = 'Ruby';
item.kind = 'material';
item.rarity = 'rare';

p.entries.item = [...(p.entries.item || []), item];
saveProject(ROOT, p);
```

`blankEntry` 会按 module.json 的 `default` 补齐每个字段（没有 default 的按类型给
`false` / `0` / `[]` / `''`）。这样不会出现"少写一个键，生成器读到 undefined"的情况。

要查某个类型有哪些字段、下拉有哪些取值，跑这段：

```bash
node --input-type=module -e "
import { listContentTypes } from './core/modules/registry.mjs';
for (const ct of listContentTypes()) {
  console.log('## ' + ct.id + '  (' + ct.moduleName + ')');
  for (const f of ct.fields) {
    const opts = f.options ? ' = ' + f.options.map(o => o.value).join(' | ') : '';
    console.log('  ' + f.key + ':' + f.type + (f.required ? '*' : '') + opts);
  }
}"
```

**module.json 是唯一权威**。§6 是当前快照，字段以后可能增加 —— 有疑问就跑上面这段，别猜。

---

## §6 十二种内容类型

格式：`字段:类型`，`*` = 必填，`(a|b)` = 下拉取值。`ref:xxx` = 填该类型某条目的 `id`。

### item —— 物品（17 字段）
`id:id*` `nameZh:text*` `nameEn:text` `kind:select`(material|simple|tool|armor)
`toolType:select`(sword|pickaxe|axe|shovel|hoe) `materialMode:select`(preset|custom)
`materialPreset:select`(wood|stone|copper|iron|gold|diamond|netherite) `tier:ref:tier`
`attackDamage:number` `attackSpeed:number` `armorSlot:select`(helmet|chestplate|leggings|boots)
`armorMaterial:ref:armorMaterial` `rarity:select`(common|uncommon|rare|epic)
`stacksTo:number` `fireResistant:checkbox` `tooltip:list` `texture:texture`

> `kind=material` 是纯材料；`tool` 才需要 `toolType` + `materialMode`；`armor` 才需要 `armorSlot` + `armorMaterial`。
> `materialMode=preset` 用原版数值（`materialPreset`），`custom` 才需要 `tier`。

### block —— 方块（15 字段）
`id:id*` `nameZh:text*` `nameEn:text` `kind:select`(ore|storage|plain) `hardness:number`
`resistance:number` `sound:select`(stone|deepslate|nether_ore|metal|amethyst|gravel|wood)
`xpMin:number` `xpMax:number` `lightLevel:number` `requiresTool:checkbox` `silkTouch:checkbox`
`tooltip:list` `drops:drops` `texture:texture`

> `kind=ore` 会额外产出深层变体、矿物标签、掉落经验。

### recipe —— 配方（13 字段）
`id:id*` `mode:select`(shaped|shapeless|smelting|blasting|smoking|campfire|stonecutting|smithing)
`grid:grid9` `ingredients:list` `ingredient:text` `base:text` `addition:text` `template:text`
`result:text*` `count:number` `experience:number` `cookingTime:number`
`category:select`(building|equipment|misc|redstone)

> - `shaped` 用 `grid`（9 个字符串，**空槽写 `""`**，会自动裁成最小包围盒）
> - `shapeless` 用 `ingredients`
> - `smelting|blasting|smoking|campfire|stonecutting` 用 `ingredient`
> - `smithing` 用 `base` + `addition`（`template` 可选）

### tier —— 工具材质（10 字段）
`id:id*` `nameZh:text*` `nameEn:text` `durability:number` `speed:number`
`attackDamageBonus:number` `enchantmentValue:number` `incorrectFor:select`(stone|iron|diamond|netherite)
`level:number` `repairItems:list`

### armorMaterial —— 盔甲材质（14 字段）
`id:id*` `nameZh:text*` `nameEn:text` `durability:number` `defHelmet:number` `defChest:number`
`defLegs:number` `defBoots:number` `enchantmentValue:number` `toughness:number`
`knockbackResistance:number` `equipSound:select`(leather|chain|iron|gold|diamond|netherite)
`texturePalette:select`(空|ruby|crystal|time|undead|ender|void|emerald|amber|ice|blood|copper|shadow|stone)
`repairItems:list`

### worldgen —— 矿物生成（11 字段）
`id:id*` `dimension:select`(overworld|nether|end) `overworldBlock:text` `deepslateBlock:text`
`block:text*` `size:number` `count:number` `rarity:number` `minY:number` `maxY:number`
`discardChance:number`

### dimension —— 自定义维度（22 字段）
`id:id*` `effects:select`(overworld|nether|end) `hasSkylight:checkbox` `hasCeiling:checkbox`
`ultrawarm:checkbox` `natural:checkbox` `piglinSafe:checkbox` `bedWorks:checkbox`
`respawnAnchorWorks:checkbox` `hasRaids:checkbox` `coordinateScale:number` `ambientLight:number`
`fixedTime:number` `minY:number` `height:number` `logicalHeight:number`
`monsterSpawnLightLevel:number` `monsterSpawnBlockLightLimit:number`
`generator:select`(noise|flat|debug) `biome:text` `seed:number` `flatBlock:text`

> `effects` 是"观感预设"，两个版本都会据此推出天空/雾/环境光/烧不烧等一整套字段。

### biome —— 生物群系（13 字段）
`id:id*` `precipitation:select`(none|rain|snow) `temperature:number`
`temperature_modifier:select`(none|icy) `downfall:number` `sky_color:text` `fog_color:text`
`water_color:text` `water_fog_color:text` `foliage_color:text` `grass_color:text`
`grass_color_modifier:select`(none|dark_forest|swamp) `dimension:text`

> 颜色写 `#88CCFF` 这种十六进制串。`dimension` 留空会自动配一个单群系的测试维度
> `<id>_world`（`/execute in <ns>:<id>_world run tp @s ~ ~ ~` 进去）。

### structure —— 结构（15 字段）
`id:id*` `biomes:list` `step:select`(surface_structures|underground_structures|strongholds|top_layer_modification)
`terrain_adaptation:select`(none|beard_thin|beard_box|bury|encapsulate) `spacing:number`
`separation:number` `salt:number` `block:text*` `accentBlock:text` `accentChance:number`
`width:number` `height:number` `hollow:checkbox` `floorBlock:text` `lootTable:text`

> 生成的是**完全自定义的 Java 结构**：`<Cls>Structure` + `<Cls>Piece` + `ModStructures` 注册表，
> 由代码摆方块，不需要 `.nbt`。`biomes` 填 `all` 会展开成本模组全部群系。

### loot_table —— 战利品表（7 字段）
`id:id*` `type:select`(minecraft:chest|minecraft:block|minecraft:entity|minecraft:fishing|minecraft:empty)
`items:list` `countMin:number` `countMax:number` `weight:number` `enchant:checkbox`

### advancement —— 进度（12 字段）
`id:id*` `titleZh:text*` `titleEn:text` `descriptionZh:textarea` `descriptionEn:textarea`
`icon:ref:item` `triggerItem:ref:item` `frame:select`(task|goal|challenge) `parent:text`
`background:select`(minecraft:.../stone.png 等 4 种) `hidden:checkbox` `announce:checkbox`

### hud —— 自定义 HUD 面板（12 字段）
`id:id*` `title:text` `anchor:select`(top_left|top_right|bottom_left|bottom_right)
`offsetX:number` `offsetY:number` `scale:number` `visible:checkbox` `bgColor:text`
`textColor:text` `lineSpacing:number` `vars:multiselect`(health|max_health|pos_x|pos_y|pos_z|game_mode)
`toggleKey:select`(KEY_A…KEY_Z|KEY_0…KEY_9|KEY_F1…KEY_F12|KEY_SPACE|KEY_TAB|KEY_GRAVE)

---

## §7 字段类型的实际存法

| type | 存什么 |
|---|---|
| `id` | 小写字母/数字/下划线，如 `ruby_ore`。全工程同类型内不许重复 |
| `text` / `textarea` | 字符串 |
| `number` | 数字（别写成字符串） |
| `checkbox` | `true` / `false` |
| `select` | 上面列出的取值字符串（**别填中文 label**） |
| `list` | 字符串数组 `["a", "b"]` |
| `multiselect` | 字符串数组 |
| `ref` | 目标类型里某个条目的 `id`（短 id，不带命名空间） |
| `grid9` | 9 个字符串的数组，空槽 `""` |
| `drops` | `[{ "item": "ruby", "min": 1, "max": 2, "fortune": true }]` |
| `texture` | 见下 |

`texture` 只有四种形态：

```json
null                                     // 自动（按 kind 猜底图 + 改色）
{ "mode": "recolor", "source": "diamond", "palette": "ruby" }
{ "mode": "ore", "source": "diamond_ore", "host": "stone", "base": "stone", "palette": "ruby" }
{ "mode": "custom" }                     // 自己画，生成器不覆盖你的 png
```

**不写 `texture` 字段 = 自动**，这通常是最好选择（生成器会挑合适底图并上色）。

---

## §8 引用与命名空间：这里是最大的坑

不同字段对"短 id"的处理**不一致**。写错不会报错，会**静默生成一个指向不存在对象的数据**。
以下按生成器真实行为归类：

### A. 短 id 自动补本模组 `<ns>:`（放心写短 id）
- `recipe` 的 `grid` / `ingredients` / `ingredient` / `result` / `base` / `addition` / `template`
- `block.drops[].item`
- `worldgen` 的 `overworldBlock` / `deepslateBlock` / `block`
- `structure.lootTable`、`structure.biomes`
- `advancement.icon` / `triggerItem`

### B. 短 id 会被补成 `minecraft:`（危险）
- `dimension.biome` —— 想把维度指到**自己模组**的群系，必须写 `<ns>:crystal_forest`；
  只写 `crystal_forest` 会变成 `minecraft:crystal_forest`（不存在，进不去维度）
- `structure.block` / `accentBlock` / `floorBlock` —— 用**本模组**方块时必须写全 id；
  写短的会被当成 `minecraft:xxx`，运行时找不到方块，**静默退回 `minecraft:stone_bricks`**
- `dimension.flatBlock` 同上（默认补 `minecraft:`）

### C. 完全不补（必须写全 id）
- `tier.repairItems` / `armorMaterial.repairItems` —— 直接写进物品标签。
  写成 `["ruby"]` 会生成一个引用 `ruby:` 的坏标签，**必须写 `["rubycraft:ruby"]`**

### D. 不涉及命名空间
- `item.tier` / `item.armorMaterial`（ref）：填工程里的条目 id，生成器按 id 查表

**经验法则**：引用**原版**东西写 `minecraft:diamond`；引用**本模组**东西，A 类可以写短的，
B/C 类一律写 `<ns>:<id>`；引用**别人的模组**永远写全 id。

---

## §9 生成区、覆盖规则与版本差异

### 9.1 哪些文件会被覆盖

`generate` 会重写它产出的所有文件。它用 `.studio/files.json` 记录上次生成的内容：

- 文件内容与上次生成一致 → 跳过（`未变`）
- 文件**被你或用户手改过** → 不覆盖，报 `冲突`（除非 `--force`）

所以红线是：**不要手改生成出来的文件**。要加逻辑走 §11 的两条路。

`generate --force` 会强推覆盖。除非你确认用户不要那些手改，否则别用。

### 9.2 两个目标的资源目录名不一样

| 东西 | fabric-26.3 | forge-1.20.1 |
|---|---|---|
| 配方 | `data/<ns>/recipe/` | `data/<ns>/recipes/` |
| 战利品表 | `data/<ns>/loot_table/` | `data/<ns>/loot_tables/` |
| 物品模型定义 | `assets/<ns>/items/<id>.json` | `assets/<ns>/models/item/<id>.json` |

**这些由生成器自动分派，你不用管。** 但如果你手工往 `resources/` 里加数据文件，
必须按目标的目录名放 —— 放错整份文件会被游戏静默忽略。

### 9.3 JDK

- `fabric-26.3`：Gradle toolchain 会自己 provision JDK 25，**不要设 `JAVA_HOME`**。
- `forge-1.20.1`：需要 JDK 17 跑 Gradle。构建报 JDK 版本/工具链错误时，
  把 `JAVA_HOME` 指到 JDK 17 再跑，例如：
  ```bash
  JAVA_HOME="C:/Users/<you>/AppData/Roaming/.minecraft/runtime/java-runtime-beta" \
    node studio.mjs build projects/<id>
  ```

---

## §10 红线

1. **不要手写 Java 样板 / 注册表 / 元数据文件**。生成器已经覆盖；手写的会被下次 `generate` 覆盖或冲突。
2. **不要改 `entries` 以外的 JSON 结构**（`files` / `state` / `visual` 是工具内部状态）。
3. **不要猜字段名和枚举值**。跑 §5 的自检命令，或读 `modules/<module>/module.json`。
4. **不要跨目标承诺**。只做 `fabric-26.3` 与 `forge-1.20.1`。
5. **不要手改生成物**（§9.1）。要写代码去 §11。
6. **不要跳过 `build` 就说完成**。
7. **不要一次改一大片再验证**。每加 2–3 个条目就 `generate` 一次，出错好定位。
8. **不要删除用户的工程或构建产物**。要清理先问。

---

## §11 要写真正的逻辑（表单做不出来的部分）

### 11.1 Java 钩子（短逻辑）

写进 `project.json` 的 `hooks.java`，生成时插到锚点处：

```json
{
  "hooks": {
    "java": [
      {
        "anchor": "init",
        "code": "net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register((e, s) -> { });"
      }
    ]
  }
}
```

锚点：`init`（主类初始化，绝大多数事件注册）、`items` / `blocks` / `tabs`（往对应注册类里塞字段）。

> **硬规则：钩子代码必须用全限定名。** 钩子被插进已有方法体，**没有 import 可加**，
> 写 `ItemStack` 编不过，必须写 `net.minecraft.world.item.ItemStack`。
> 写的是**语句**，不是方法（别写 `public void foo() {}`）。

### 11.2 `custom/` 手写区（长逻辑）

`src/main/java/<pkg 路径>/custom/` 下的文件**永远不会被生成器覆盖**。
长逻辑、多个方法、自己新建的类放这里。生成的主类会调用 `CustomContent.init()`。

### 11.3 可视化积木（可选）

有 CLI：`node studio.mjs blocks list|compile|from-jar|validate|install|new`。
积木最终也编译成 Java 参与构建。除非用户明确要"拖积木"，否则直接用 `entries` 更省事。

---

## §12 还能做什么

```bash
node studio.mjs blocks help     # 积木：列表 / 编译 / 从 jar 造库 / 体检 / 装库
node studio.mjs convert help    # 功能转换器：跨版本、跨加载器搬功能（分级报告）
node studio.mjs tools           # tools/ 脚本索引
```

功能转换器值得知道：它能把一个工程/一段 Java 从一个目标搬到另一个目标，
输出四档 `自动完成 / 已改写 / 需人工 / 做不到`，不敢硬改的地方写 `// TODO(转换)`。
`convert run` 只读预览，`convert apply --yes` 才落盘。

外部模组依赖：`project.json` 的 `localDeps: [{ "name": "...", "path": "<jar 绝对路径>" }]`，
让构建时挂上那个 jar（生成的代码要引用它的类时必须加）。

---

## §13 验收清单

做完一条需求，逐条过：

```bash
# 1. 生成无错误
node studio.mjs generate projects/<id>
#    期望：冲突 0，且没有 "! " 开头的错误行

# 2. 编译通过
node studio.mjs build projects/<id>
#    期望：退出码 0 + "构建成功" + 打印 jar 路径

# 3. 关键产物存在（示例）
ls projects/<id>/src/main/resources/assets/<ns>/lang/zh_cn.json
ls projects/<id>/src/main/resources/data/<ns>/recipe/
```

再对一遍语义：

- [ ] 每个条目的 `id` 在全工程同类型内唯一
- [ ] 所有 `ref` 指向的条目真实存在（`item.tier` → `entries.tier` 里有那个 id）
- [ ] 配方 `result` 指向存在的物品/方块
- [ ] §8 的 B/C 类引用写了全 id
- [ ] 改动的字段**真的出现在产物里**（打开对应 JSON 看一眼，别只看"生成成功"）
- [ ] 用户原有的条目没被删（`entries` 是整体替换的，改之前先读出来）

---

## §14 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| `generate` 报 `冲突 <路径>` | 那个生成文件被手改过 | 把改动挪进 `custom/` 或 `hooks`，再 `generate`；确认不要了才 `--force` |
| `写入 0 / 未变 N` | 数据没变，正常 | 无 |
| 游戏里物品没贴图 | `texture.mode = "custom"` 但没放 png | 改成不写 `texture` 字段（自动） |
| 维度进不去 / 群系是 plains | `dimension.biome` 少了命名空间 | 见 §8-B |
| 结构里全是石砖 | `structure.block` 少了命名空间，退回默认 | 见 §8-B |
| 物品无法修复 | `repairItems` 少了命名空间 | 见 §8-C |
| Forge 构建报 JDK / toolchain | `JAVA_HOME` 不是 17 | 见 §9.3 |
| 首次构建卡在下载 | 网络 | 等；或检查 `~/.gradle` 缓存。**不要假报成功** |
| `new` 报"已存在工程目录" | id 撞了 | 换 `--id`，或直接改现有工程 |

---

## §15 更多资料（在工具根下）

| 想知道 | 看 |
|---|---|
| 完整用户手册 | `docs/guides/00-使用手册.md` |
| 从零到出 jar 的walkthrough | `docs/guides/01-从零到出jar.md` |
| 物品/方块细节 | `docs/guides/02-物品与方块.md` |
| 配方/掉落/矿物生成 | `docs/guides/03-配方掉落与生成.md` |
| 事件与钩子（写 Java 前必读） | `docs/guides/04-事件与钩子.md` |
| Forge 1.20.1 专线 | `docs/guides/05-Forge-1.20.1-从零到出jar.md` |
| 积木编程 | `docs/guides/07-积木编程.md` |
| 加新平台 / 写模块 | `docs/module-guide.md` |
| 26.3 / 1.20.1 API 对照 | `docs/mc-api-reference.md` |

---

## 附录：各类型最小可用条目

从这些改起，比从空白开始安全。

```json
// item
{ "id": "ruby", "nameZh": "红宝石", "nameEn": "Ruby", "kind": "material", "rarity": "rare", "stacksTo": 64 }

// item（工具）
{ "id": "ruby_sword", "nameZh": "红宝石剑", "nameEn": "Ruby Sword", "kind": "tool",
  "toolType": "sword", "materialMode": "preset", "materialPreset": "diamond", "attackDamage": 7 }

// block
{ "id": "ruby_ore", "nameZh": "红宝石矿石", "nameEn": "Ruby Ore", "kind": "ore",
  "hardness": 3, "resistance": 3, "requiresTool": true, "xpMin": 3, "xpMax": 7,
  "drops": [{ "item": "ruby", "min": 1, "max": 1, "fortune": true }] }

// recipe（有序）
{ "id": "ruby_block", "mode": "shaped", "category": "building",
  "grid": ["ruby","ruby","ruby","ruby","ruby","ruby","ruby","ruby","ruby"],
  "result": "ruby_block", "count": 1 }

// recipe（熔炼）
{ "id": "ruby_from_ore", "mode": "smelting", "ingredient": "ruby_ore",
  "result": "ruby", "count": 1, "experience": 0.7, "cookingTime": 200 }

// worldgen（矿物）
{ "id": "ruby_ore", "dimension": "overworld", "overworldBlock": "ruby_ore",
  "deepslateBlock": "deepslate_ruby_ore", "block": "ruby_ore",
  "size": 4, "count": 1, "rarity": 6, "minY": -16, "maxY": 64 }

// dimension
{ "id": "crystal", "effects": "end", "hasSkylight": false,
  "generator": "noise", "biome": "rubycraft:crystal_forest" }

// biome
{ "id": "crystal_forest", "precipitation": "none", "temperature": 0.8,
  "sky_color": "#88CCFF", "fog_color": "#AACCEE",
  "water_color": "#3F76E4", "water_fog_color": "#050533" }

// structure
{ "id": "crystal_tower", "biomes": ["rubycraft:crystal_forest"],
  "step": "surface_structures", "spacing": 32, "separation": 8,
  "block": "minecraft:purpur_block", "width": 9, "height": 12, "hollow": true,
  "lootTable": "diamond_chest" }

// loot_table
{ "id": "diamond_chest", "type": "minecraft:chest",
  "items": ["minecraft:diamond", "minecraft:iron_ingot"],
  "countMin": 1, "countMax": 3, "weight": 10, "enchant": true }

// tier
{ "id": "ruby", "nameZh": "红宝石", "durability": 1561, "speed": 8,
  "attackDamageBonus": 3, "enchantmentValue": 10, "incorrectFor": "diamond",
  "repairItems": ["rubycraft:ruby"] }

// armorMaterial
{ "id": "ruby", "nameZh": "红宝石", "durability": 33,
  "defHelmet": 3, "defChest": 8, "defLegs": 6, "defBoots": 3,
  "toughness": 2, "equipSound": "diamond",
  "repairItems": ["rubycraft:ruby"] }

// advancement
{ "id": "get_ruby", "titleZh": "拿到红宝石", "descriptionZh": "挖到第一颗红宝石",
  "icon": "ruby", "triggerItem": "ruby", "frame": "goal", "announce": true }

// hud
{ "id": "main", "title": "状态", "anchor": "top_left", "scale": 1,
  "vars": ["health", "pos_x", "pos_y", "pos_z"], "toggleKey": "KEY_H" }
```

> 附录里的示例是**形状示范**，不是完整条目。实际写入时用 §5 的 `blankEntry` 补全其余字段，
> 除非你确实想把它们设成默认值以外的值。
