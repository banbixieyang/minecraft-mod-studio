/**
 * 外部目标适配器 —— 最小可照抄样板。
 *
 * 放哪里（三选一）：
 *   1. ~/.mcstudio/targets/*.mjs             装一次，所有工程可用
 *   2. MCSTUDIO_TARGETS=<目录>                 CI / 多版本切换用，多个目录用路径分隔符隔开
 *   3. 在代码里调 registerTarget(adapter)     插件式集成
 *
 * 放好后 `node studio.mjs blocks targets` 就能看到，界面目标下拉也会出现。
 * 引擎启动时自动扫描，不需要改引擎任何一行代码。
 *
 * 必填：id / label / platform / mcVersion
 * 其余接口（defaults / features / paths / scaffold / java）见
 * core/target/registry.mjs 文件头，以及内置适配器的实现。
 *
 * ⚠️ 这个样板是「派生自内置 Fabric 适配器」的演示：它改了 id 和显示名，
 *    其余能力照抄。真要支持一个新平台，把 scaffold() 和 java/ 换成自己的实现。
 *    直接拿它建工程生成的仍是 Fabric 骨架 —— 所以它标了 experimental。
 */
import base from '../../../core/target/fabric-26.3/adapter.mjs';

export default {
  ...base,
  id: 'fabric-26.3-demo',
  label: 'Fabric 26.3（外部示例）',
  platform: 'fabric',
  mcVersion: '26.3',
  experimental: true,
  // 外部目标可以声明「实测法」要用的 MC jar：
  // apiJar: ({ home }) => path.join(home, '.gradle/caches/.../minecraft.jar'),
  // 或 apiJar: 'C:/path/to/minecraft.jar'
};
