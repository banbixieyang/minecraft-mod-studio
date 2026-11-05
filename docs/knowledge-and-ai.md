# 知识库与 AI 助手

这两块解决的是同一件事的两面：

- **学习中心**——把「这个版本该怎么写」变成能搜、能跳、能引用的东西；
- **AI 助手**——让模型答在点子上，而不是给你一段 1.21 的代码让你编译半小时。

它们共用一份索引。AI 回答里引用的「资料 N」，就是学习中心里的那一节。

---

## 一、知识库从哪来

四个来源，前两个只读，后两个可写：

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| `builtin` 内置 | `<mcstudio>/knowledge/` | 随编辑器走。指南 / 速查 / 任务卡，每篇 front matter 标了 `platform`（fabric / forge）；两个平台的部分都本机真编译过 |
| `expert` 专家库 | 自动探测 `~/.workbuddy/plugins/**/minecraft-dev/skills` | 通用 MC 开发知识（Paper / Forge / NeoForge 都有）。探不到不影响功能 |
| `learned` 学习记录 | `~/.mcstudio/knowledge/learned/` | 分析别人的 mod 后点「存成笔记」沉淀下来的 |
| `user` 我的笔记 | `~/.mcstudio/knowledge/notes/` | 自己写的，放进这个目录就会被索引 |

为什么分用户级和工程级：分析别人的 mod 得到的是**你自己的见识**，不该跟着某个工程走。
所以 `learned` / `notes` 放在用户目录，换工程照样搜得到。

专家包的探测是广度优先找 `minecraft-dev/skills` 目录，深度限 6 层，找到就停，
结果缓存 —— 它在启动时跑一次，不会拖慢每次搜索。

内置文档可以在 front matter 写 `platform: forge`（不写的默认 `fabric`）。
检索时同平台 ×1.6、异平台 ×0.45，**只调权重不过滤** —— 平台中立的构建/流程知识不该被丢掉。
学习中心的搜索和 AI 的检索都会把当前工程平台带上；拼给模型的资料标题里也有「平台 forge」，
所以它自己能分辨哪段是 1.20.1 的签名、哪段是 26.3 的。
界面上非默认平台的目录项带一个小徽标，正文头部有「平台：Forge 1.20.1」。

---

## 二、检索是按「章节」走的

整篇 3000 字丢进检索有个具体后果：命中「时运」两个字，返回的是整篇速查，
你既定位不到那一段，AI 的上下文也会被无关段落挤满，回答反而更差。

所以文档在索引时就被切成章节（`##` 一级），检索返回的是章节：

```
26.3 注册签名速查 · 相关      ← 命中这一节
```

三个实现上的选择：

**中文按二元组切词，不引词典。** 「物品注册」→ `物品 / 品注 / 注册`。
引词典的代价是它会把 `ItemStack` 拆错，而类名拆错等于这次检索白做。
二元组的噪音用「标题命中加权 ×4」压下去。

**文档标题对整篇有效。** 搜「踩坑清单」时，标题里的词会加到这篇的**每一节**上，
而不是只有第一节沾光。曾经只在章节标题为空时退回用文档标题，结果正文分节的文档
第二段起就完全搜不到 —— 分析笔记这种文档最吃亏。

**同一篇最多 3 节，且第 2 节起打折（×0.55、×0.30）。** 只限数量不够：
标题加权会把整篇抬起来，前三条全是同一篇的相邻章节，界面上一片重复。

**平台权重。** 问 Fabric 的事命中 Spigot 的写法，是最典型的答非所问。
按 skill 目录名给文档标平台，命中同平台 ×1.6、异平台 ×0.45。
只调权重不过滤 —— 构建、Gradle、intake 这些知识是平台中立的，硬过滤会把它们丢掉。

---

## 三、证据等级

每篇文档都标了自己有多可信，界面上是一个小徽章：

| 标记 | 含义 |
| --- | --- |
| 实编验证 `verified-26.3` | 在本机 Fabric 26.3 上真编译过。最高等级 |
| Forge 实编 `verified-forge-1.20.1` | 在本机 Forge 1.20.1 上真编译过（官方 MDK 47.4.0 + ForgeGradle 8.8 / JDK 17），与上一档同级 |
| 官方文档 `official` | 来自官方文档站 |
| 版本推断 `inferred` | 从相邻版本/惯例推的，用之前要自己验 |

为什么「实编」是最高等级而不是官方文档：26.3 的官方文档站没有对应版本页，
查不到东西。这时候「在本机编过」比「文档上写着」更硬。
踩坑清单里那条「26.3 查不到官方文档怎么办」写的就是用 `javap` 反查真实签名。

---

## 四、自己加一篇

在 `~/.mcstudio/knowledge/notes/` 放一个 `.md` 就行，下次打开学习中心自动出现。
文件名就是标题（也可以在前面写 front matter 覆盖）：

```markdown
---
title: 我的红宝石矿笔记
category: 我的笔记
order: 1
tags: 矿物, 世界生成
evidence: inferred
summary: 一句话说明这篇讲什么，会显示在列表和搜索结果里
---

## 先说我踩到的坑

正文……
```

字段都能省，只有标题是必需的（没有就取文件名）。`category` 决定它归在左边哪一组，
组顺序是：指南 / 任务卡 / 速查 / 学习记录 / 我的笔记 / 专家库 · API / 专家库 · 规则 / 其他。

**写的时候有两个规矩**（不是风格问题，是会不会误导人）：

1. **代码块标语言。** 界面上会显示语言、给「复制」和「问 AI」按钮；AI 拿到片段时也靠它
   区分哪部分是代码。
2. **没验证的别写成验证过的。** `evidence` 填错比不填更糟 —— 下次你自己会信它。

---

## 五、AI 怎么接

顶栏 **AI** → 右上「设置」。四个预设，都是把接口形状填好，地址和模型都能改：

| 预设 | 协议 | 地址 |
| --- | --- | --- |
| OpenAI 兼容 | `POST {base}/chat/completions`，`Authorization: Bearer` | 任何兼容接口：DeepSeek、Kimi、通义、OpenRouter、本地 vLLM、公司网关 |
| DeepSeek | 同上 | `https://api.deepseek.com/v1` |
| Ollama | `POST {base}/api/chat`，不需要 key | `http://127.0.0.1:11434` |
| Anthropic | `POST {base}/v1/messages`，`x-api-key` + `anthropic-version` | `https://api.anthropic.com` |

**key 只存在本机** `~/.mcstudio/ai.json`，不进工程、不进 git。
读配置的接口只回「配没配、后四位是多少」，浏览器里翻不到明文。
也可以完全不写文件，用环境变量：`MCSTUDIO_AI_KEY` / `MCSTUDIO_AI_BASE` / `MCSTUDIO_AI_MODEL`。

配好点「测试连接」。注意它**先保存再测**，否则测的是旧配置 —— 这个坑我踩过。

### 回答是边生成边显示的

慢模型整段返回会让人干等几十秒，所以 `/api/ai/chat` 带 `stream: true` 时走 SSE：

| 事件 | 内容 | 前端拿它做什么 |
| --- | --- | --- |
| `meta` | 检索到的资料、模型名 | 先把引用来源挂上，回答还没出也能看见依据 |
| `delta` | 一小段文字 | 追加到当前气泡 |
| `done` | model / usage / 耗时 / 是否截断 | 结束，整篇换成 markdown 渲染 |
| `error` | code + 原文 | 转成可操作的错误卡片 |

三家的流格式并不一样，适配层把它们统一成上表这四种事件：
OpenAI 兼容是 SSE 的 `choices[0].delta.content` + `data: [DONE]`；
Anthropic 是带 `event:` 的帧（`message_start` / `content_block_delta` / `message_delta`）；
Ollama 是 **NDJSON**（每行一个 JSON），不是 SSE。请求形状集中在 `requestSpec()`，
整段返回和流式共用一份，避免以后加字段只改一条路径。

几个刻意的设计：

- **超时只约束「等到响应头」。** 长回答可能持续几分钟，用总时长掐断会把用户已经读到
  一半的内容砍掉。首字节到了就清掉计时器。
- **「停止」真的会掐断上游。** 前端 abort → 编辑器响应的 `close` → 上游 fetch 的
  AbortController。已生成的文字保留下来，气泡上标「已停止」，不当成错误。
  这里用的是 `res.on('close')` 而不是 `req.on('close')` —— 请求体一读完 `req` 就会
  emit close，拿它判断「用户断开了」会把每一次正常流式都掐掉。
- **流式期间只显示纯文本，结束后才整篇渲染 markdown。** 每个 delta 都重解析一遍
  markdown 会抖，代码块也会反复重建。
- **响应头写出去之后，错误只能走 `event: error`。** 此时再想发一次 HTTP 400 会撞
  `ERR_HTTP_HEADERS_SENT`。能在写头之前判定的（空问题、没配 key）仍走普通 400。
- OpenAI 兼容的服务若不开 `stream_options.include_usage`，流里就没有 token 用量；
  界面检测到 0 会自动不显示那一行，不会写个假的「in 0 / out 0」。

> 踩过的坑：`el()` 是用 `addEventListener` 绑事件的，事后再给 `node.onclick` 赋值
> 不会替换它，而是**多出一个 handler**。曾经把「发送/停止」用 `onclick` 切换，
> 结果点一次触发两次，第二次还会在 `send()` 中途把行为改成 abort，把刚启动的流
> 立刻掐断。现在只绑一次，函数内部按 `A.busy` 分派。

---

## 六、AI 每次看到什么

三块，缺一不可：

**1. 平台事实（写死在系统提示里）**

> 物品/方块注册必须 `ResourceKey` + `Item.Properties().setId(key)`，漏了抛 "Item id not set"。
> `BuiltInRegistries.ITEM.get(id)` 返回 `Optional<Reference<Item>>`，不是 `Item`。
> `spawnAtLocation` 在 26.3 已移除，掉物品用 `entity.drop(...)`。
> ……

这些是本机实测的结论，不是从别的版本文档推的。放在系统提示里每轮可见，
比塞进检索结果更可靠 —— 检索可能不命中，事实不能。

**事实按工程目标分档**：Fabric 26.3 工程拿上面这 9 条；Forge 1.20.1 工程换成一个时代的
另一批（`@Mod` + `FMLJavaModLoadingContext`、`DeferredRegister`、`getTag()` + `NEEDS_*_TOOL`、
`BuildCreativeModeTabContentsEvent`、1.20.1 资源方言、`mods.toml` / `reobfJar`……）。
给 Forge 工程塞 26.3 的 `setId()` 事实，比不给事实更糟 —— 模型会很有信心地写出不存在的 API。
未知目标不给事实，只要求模型明说不确定。工程摘要现在读顶层 `project.target`，
会带上 `target.id`、Forge 版本与 JDK 版本。

**2. 工程摘要**——它得知道你现在有什么，才不会让你去注册一个已经存在的物品。

**3. 检索到的知识片段**——带来源、平台与证据等级，编号成「资料 1」「资料 2」。
回答里引用时用这个编号，界面上能点回学习中心对应那一节。

提示里还有一条硬规矩：**资料没覆盖到的，明说「这点我不确定」，不要编类名、方法名、
maven 坐标。** 模型最坏的行为不是不会，是编一个看起来很像的签名。

**AI 给的代码不会直接写进工程**。回答里（以及学习中心里）的 Java 代码块可以点
「装成钩子」：服务端先做静态检查 —— 拒绝 `package` / `import` / 类声明 / `@Mod` /
外部命令 / 删文件 / 异平台 API，检查大括号与长度；然后给出**真实落点**（哪个 Java 文件、
第几行、插入前后长什么样）的只读预览。用户点确认后才写进 `.studio/project.json` 的
`hooks.java`；再点「生成」才插进 Java 源码，最后「构建」才进 jar。
同内容重复装会被拒绝，装错了可以在界面里删掉。整套链路是
「预览 → 确认 → 生成 → 构建」，没有任何一步让模型直接改文件。

---

## 七、分析 → 沉淀 → 下次能用

分析面板读完一个 jar 之后，底部有「存成笔记」。它会写一篇 markdown 到
`~/.mcstudio/knowledge/learned/<modid>.md`，进索引，立刻可搜、AI 立刻能引用。

**要分析的 jar 不用先搬到某个目录**：直接拖进面板顶部的拖放框即可（或点「选择文件」）。
上传副本落在 `~/.mcstudio/imports/`，按内容哈希去重，只读解析、不执行 jar 里的代码。
第三方发布包的 `mods.toml` / `fabric.mod.json` / `quilt.mod.json` / `mcmod.info`
都能认，带签名、重映射、内嵌 jar、中文文件名、ZIP64 这些怪癖也处理了；
报告里会单独标出包的特征，说明哪些是事实、哪些只是常量池证据。
发布版 jar 只有 `.class` —— 沉淀出来的笔记写的是「它用了什么 API」，
不会把猜出来的逻辑当原作者代码写进知识库。

笔记刻意把两类信息分开写，因为它们的可信度完全不同：

- **内容规模**（物品、方块、配方、材质……）——读 jar 里的资源文件得到的，是**事实**；
- **它做了哪些事**（吸血、伤害拦截、定时任务……）——读 class 常量池里引用了哪些 API，
  是**证据**。引用了某个 API 不等于逻辑就是这个意思。

末尾还会写一段「读这份笔记要注意」，把「数值读不出来、装备材质是按套装名推的默认值」
这类限制写在明面上。同一个 mod 重复分析会覆盖同一篇，不会攒一堆。

---

## 八、出问题怎么看

**AI 报错分八类，每类的下一步完全不同。** 一律「请求失败」等于没说：

| 提示 | 意思 | 下一步 |
| --- | --- | --- |
| key 被拒了（401/403） | key 无效或过期 | 换 key |
| 接口不存在（404） | baseUrl 或模型名不对 | 检查地址，OpenAI 兼容的要填到 `/v1` 为止 |
| 被限流了（429） | 请求太密 | 等一会，或换小模型 |
| 请求超时 | 服务很慢或地址不通 | 本地模型先确认服务起来了 |
| 连不上 | `ECONNREFUSED` / 域名解析不了 | Ollama 的话先 `ollama serve` |
| 模型服务自己出错了（5xx） | 上游挂了 | 看服务端原文，等 |
| 返回的不是 JSON | 把网页地址当接口地址填了 | 检查 baseUrl |
| 没配 key | 本地就拦住了，没发请求 | 点设置填 |

**学习中心搜不到东西**：先点右上「重新扫描」。如果是刚放进 `notes/` 的文件，
索引靠「文件数 + 最新 mtime + 总字节」判断要不要重建，重新扫描一定生效。

**没检测到专家包**：学习中心左下角会写「没检测到专家包，只用内置内容」。
这只是一个来源缺失，内置内容仍然完整可用。想接上就装一次 MC 开发专家包。

---

## 九、这块代码在哪

```
core/knowledge/parse.mjs    文档解析：front matter、按标题切章节（认围栏，别被代码里的 # 骗了）
core/knowledge/sources.mjs  来源发现：四个目录、专家包探测、平台标注
core/knowledge/index.mjs    索引与检索：倒排表、章节打分、平台权重、上下文预算
core/knowledge/learned.mjs  分析沉淀：报告 → markdown → 落盘
core/analyze/imports.mjs    导入缓存：上传落盘、哈希去重、删除白名单
core/analyze/zip.mjs        零依赖 ZIP 读取：前缀偏移 / GBK 名 / ZIP64 / data descriptor
core/analyze/meta.mjs       第三方元数据：多格式、TOML 子集、authors 归一、包特征
core/analyze/report.mjs     分析报告合成（元数据 / 资源 / 代码三路）
core/serve/routes_extras.mjs analyze/* 路由：上传、列表、删除、内嵌 jar 展开
core/ai/config.mjs          配置与预设（key 落本地，前端只拿后四位）
core/ai/providers.mjs       三家协议适配 + 错误分类
core/ai/context.mjs         平台事实、回答规则、工程摘要、拼装
core/ai/chat.mjs            提问主流程（薄，方便换壳）
core/serve/routes_kb.mjs    knowledge/* 与 ai/* 路由
ui/knowledge.js             学习中心
ui/ai.js                    AI 助手
ui/md.js                    零依赖 markdown 渲染（文本一律 textContent，不用 innerHTML）
```

`ui/md.js` 不用 `innerHTML` 是有原因的：知识库有一部分内容来自外部 jar，
HTML 注入不该有地方落脚。

---

## 十、回归

```bash
node tests/knowledge.mjs      # 索引 / 平台加权 / id 唯一 / 预算 / 沉淀往返（含 Forge authors 兼容）
node tests/ai.mjs             # 三家协议（整段 + 流式）/ 错误分类 / SSE / 平台上下文（本地 mock，不联网）
node tests/hooks.mjs          # 代码块 → 只读预览 → 确认红线 → 装钩子 → 生成 → 清理
node tests/cookbook.mjs --build   # Fabric 任务卡代码逐段真编译
node tests/forge.mjs --build      # Forge 1.20.1 骨架 + 2 张 Forge 任务卡真编译（JDK 17 / Gradle 8.8）
node tests/import.mjs         # 直接导入：ZIP 怪癖 / 各平台元数据 / 上传→分析→展开→删除
node tests/uitest.mjs         # 学习中心 / AI / 装钩子 / 存成笔记 / 拖入 jar 直接分析（无 key 配置）
```

任务卡按 front matter 的 `platform` 分组：Fabric 卡进 `cookbook.mjs --build` 的
Fabric 26.3 工程，Forge 卡进 `forge.mjs --build` 的 Forge 1.20.1 工程。
两边都是挂成 `init` 钩子后真跑 Gradle —— 把 1.20.1 的代码塞进 26.3 工程编译，
只会得到一堆必然失败，没有验证价值。Forge 那次还抓出过
`getIncorrectBlocksForDrops()` 是 1.20.5 才有的方法（1.20.1 只有 `getTag()`），
后来用 `javap` 从官方映射 jar 复核才定稿。

`knowledge/learn`（分析 → 存成笔记）也有一条多目标回归：Forge `mods.toml` 里的
`authors` 是字符串而不是数组，沉淀时不能假设形状，否则 `.join()` 会抛错、界面拿到 400。

`cookbook.mjs --build` 是最有价值的一个：知识库里的代码如果不能编译，
那份知识就是负资产。它把每张任务卡「## 代码」节的第一段 java 抽出来，
灌进一个真工程，跑 Gradle。曾经靠它抓出「物品冷却收的是 `ItemStack` 不是 `Item`」——
文档里写错了，编译不会骗人。

但编译只能覆盖「## 代码」那一段，「## 变体」里的碎片同样会被初学者照抄。
所以测试还有第 0 步：从 loom 映射后的 minecraft jar 里 `javap` 出 `MobEffects` 的
真实字段名，把 `knowledge/` 下**所有** java 代码块（含变体）里的 `MobEffects.*`
逐个核对。写错名字会直接报出是哪篇文档的哪个符号。这套校验从真实 jar 取真值，
不靠人工维护白名单；jar 还没构建出来时自动跳过，不影响纯静态环境。
它抓出过 `DIG_SPEED` / `MOVEMENT_SPEED` / `DAMAGE_BOOST` / `MOVEMENT_SLOWDOWN`
这四个 26.3 里根本不存在的名字 —— 对应《26.3 踩坑清单》第 17 条。

`tests/ai.mjs` 里的 mock 服务现在能按帧吐流，所以三家协议、首字节超时、中途停止、
上游 401/404/429/500、流中途的 `error` 帧、以及编辑器自己 SSE 路由的事件顺序，
全都不联网就能验。

界面侧要跑两套配置：默认实例没有 key，验的是「引导去设置」；
想验流式回答本身，用一个本地 mock 模型服务 + 临时 `MCSTUDIO_HOME` 起第二个实例，
再 `node tests/uitest.mjs --port <端口>`，它会走「有 key」分支，
检查进行态的「停止」键、停止后保留已生成的字、结束后 markdown/代码块/引用渲染。
只等「回答气泡出现」是不够的 —— 流式一开始气泡就在了，那时读到的是空内容。
