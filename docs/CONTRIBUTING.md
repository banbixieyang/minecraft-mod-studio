# 贡献指南

感谢你愿意动手。这个项目不需要多余的仪式 —— 改完、测过、提 PR 就行。

## 环境

不需要 `npm install`，本项目零 npm 依赖，只用 Node 标准库。

- Node.js >= 18
- 想跑真编译的用例，还需要对应目标的 JDK：
  - Fabric 26.3 → JDK 25
  - Forge 1.20.1 → JDK 17

## 起服务

```bash
node studio.mjs start
```

浏览器打开 `http://127.0.0.1:4173`。

## 提交前跑一遍

```bash
# 单元测试（快，几秒钟）
node tests/analyze.mjs
node tests/ext.mjs
node tests/pack.mjs
node tests/import.mjs
node tests/inspect.mjs
node tests/generality.mjs   # 分析器通用性回归
node tests/docs.mjs         # 文档一致性

# 浏览器冒烟（需要 Edge 或 Chrome）
node tests/uitest.mjs
node tests/tutorial.mjs
```

改到生成链路或目标适配器，还要跑真编译（慢，几分钟）：

```bash
node tests/cookbook.mjs --build
node tests/forge.mjs --build
```

跑测试前先把服务起在 `4173`（`uitest.mjs` 默认连这个端口）。

## 代码约定

- **引擎不碰 DOM**。`core/` 下全是纯 Node 模块，界面在 `ui/`。
  引擎和界面彻底分开，是为了以后能换壳（Electron / VSCode / CI）不动引擎。
- **引擎不判断版本号**。版本差异一律由 `core/target/<id>/adapter.mjs` 声明，
  生成器按 `features.resourceFormat` 分派。新增一个「加载器 + MC 版本」
  = 写一个适配器 + 在 `core/target/registry.mjs` 登记一行。
- **新增内容类型** 写成模块放 `modules/`，不要改引擎核心。
  细节见 [`module-guide.md`](docs/module-guide.md)。
- **新增分析能力** 写成扩展放 `core/analyze/ext/<名字>/index.mjs`，
  不要往核心里加 if。扩展契约见 [`module-guide.md`](docs/module-guide.md)。

  > ⚠️ 扩展是**服务启动时一次性装载**的。改完扩展必须重启服务才生效，
  > 这一点和 MC 的 mod 语义一致，是刻意对齐的。

- 注释写「为什么」，不写「做了什么」。

## 文档

`knowledge/guides/` 是正本，`docs/guides/` 是同步出来的副本。

```bash
node tools/sync-docs.mjs          # 同步
node tools/sync-docs.mjs --check  # 只校验不写（CI 用这个）
```

**改文档请改正本**，然后跑一次同步。`tests/docs.mjs` 会检查两边是否一致、
以及所有相对链接是否有效。

## 提交信息

用中文或英文都行，说清「改了什么」和「为什么」。

```
fix(分析器): 依赖 mod 的资源不再混进内容清单

多命名空间 jar（主 mod + 依赖 mod 打包在一起）会把依赖的物品
也扫进来，导致清单虚高 143 条。改为按语言文件判定归属。
```

## 报告问题

带上这些信息，别人才复现得出来：

- MC Studio 版本（`git log -1`）
- 目标平台（Fabric 26.3 / Forge 1.20.1）
- Node 版本
- 如果跟分析器有关：被分析的 jar 来源与 MC 版本
- 复现步骤

## 许可

贡献即表示你同意你的贡献以 MIT 许可发布。
