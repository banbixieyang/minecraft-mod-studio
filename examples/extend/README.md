# 扩展样板

这两个文件是**能跑的最小扩展**，也是 `tests/extensible.mjs` 的测试夹具 ——
测试跟这里给用户照抄的是同一份，不会出现「测试里行、照着做却不行」。

| 文件 | 扩展什么 | 放哪儿才能生效 |
|---|---|---|
| `targets/fabric-demo.mjs` | 新目标（加载器 + MC 版本组合） | `~/.mcstudio/targets/` 或 `MCSTUDIO_TARGETS=<本目录>` |
| `modpacks/demo.mjs` | 某个 mod 的专属积木包 | `~/.mcstudio/modpacks/` 或 `MCSTUDIO_MODPACKS=<本目录>` |

快速看效果（在项目根目录跑）：

```bash
MCSTUDIO_TARGETS=examples/extend/targets \
MCSTUDIO_MODPACKS=examples/extend/modpacks \
node studio.mjs blocks targets

MCSTUDIO_MODPACKS=examples/extend/modpacks \
node studio.mjs blocks packs --mod examplemod
```

> Windows PowerShell 里用 `$env:MCSTUDIO_TARGETS = "examples/extend/targets"` 这种写法，
> 不要用上面的 `VAR=value` 语法。

契约、字段表、常见问题见 [《09 · 扩展与工具包》](../knowledge/guides/09-扩展与工具包.md)。

⚠️ `fabric-demo.mjs` 是派生自内置 Fabric 适配器的演示，标了 `experimental`，
别拿它真建工程 —— 它只是告诉你「最小改动长什么样」。
