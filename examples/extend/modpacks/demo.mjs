/**
 * 外部 mod 专属积木包 —— 最小可照抄样板。
 *
 * 通用扫描（modlib.mjs）给你「调用 XxxUtil.foo(a,b,c)」这种零件；
 * 专属包给的是**积木级语义**：「给玩家发一条消息」而不是四个参数的方法调用。
 * 小朋友用后者。
 *
 * 放哪里（三选一）：
 *   1. ~/.mcstudio/modpacks/*.mjs                 装一次，所有工程可用
 *   2. MCSTUDIO_MODPACKS=<目录>                    CI / 多版本切换用
 *   3. <工程>/.studio/modpacks/*.mjs              只在当前工程生效
 *
 * 契约：导出 `pack`，字段如下 ——
 *   id        唯一标识
 *   label     生成日志里显示的名字
 *   modIds    按 mod id / namespace 命中（数组，小写）
 *   match     可选，(report) => boolean，写复杂判断用；给了它就不看 modIds
 *   build     必填，({ targetId, report, opts }) => { blocks, categories, notes }
 *
 * 引擎会自动发现、自动匹配、自动合并。一个包写崩了只跳过它，不影响其它包。
 * 外部包 id 与内置包相同时，外部优先 —— 可以拿它修内置包的 bug。
 *
 * 查看：`node studio.mjs blocks packs --mod examplemod`
 */
export const pack = {
  id: 'example-pack',
  label: '示例 mod · 专属积木',
  modIds: ['examplemod', 'demo-mod'],

  build({ targetId, report }) {
    return {
      blocks: [
        {
          id: 'demo.say',
          category: 'demo',
          shape: 'stack',
          label: '对玩家说：%text',
          icon: '👋',
          inputs: [{ name: 'text', kind: 'text', default: '你好，积木世界！' }],
          fields: [],
          // 模板按目标分派。这两条 API 都 javap 核过、在真工程里编译通过。
          java: {
            'fabric-26.3': 'player.sendSystemMessage(net.minecraft.network.chat.Component.literal(%text));',
            'forge-1.20.1': 'player.displayClientMessage(net.minecraft.network.chat.Component.literal(%text), false);',
          },
        },
      ],
      categories: [
        { id: 'demo', label: '示例 mod · 专属', icon: '🧪', color: '#3aa8a0' },
      ],
      notes: [`命中 mod ${report?.meta?.id || '?'}，目标 ${targetId}`],
    };
  },
};
