/**
 * 目标适配器注册表。
 *
 * 「目标」= 加载器 + MC 版本 的组合，例如 fabric + 26.3。
 * 新增一个目标，只需要在 target/<id>/adapter.mjs 里导出同样的接口，
 * 然后在下面的 ADAPTERS 里登记一行。引擎、模块、界面都不用改。
 *
 * 适配器接口（约定，不是 TS 类型）：
 *   id            string    唯一标识，如 'fabric-26.3'
 *   label         string    界面显示名
 *   platform      string    'fabric' | 'neoforge' | 'forge' | 'paper' | ...
 *   mcVersion     string
 *   javaVersion   number    目标 JDK
 *   defaults      object    该目标的默认版本号，用于新建工程
 *   paths         object    目录约定函数
 *   features      object    能力开关，模块据此决定生成策略
 *   scaffold(ctx) Array<{path, content}>   生成工程骨架文件
 *   java          object    代码生成辅助（见各适配器实现）
 */
import fabric263 from './fabric-26.3/adapter.mjs';
import forge1201 from './forge-1.20.1/adapter.mjs';

// 新增目标只在这里加一行：适配器导出同样的接口，引擎 / 模块 / 界面都不用改
const ADAPTERS = new Map([
  [fabric263.id, fabric263],
  [forge1201.id, forge1201],
]);

export function listTargets() {
  return [...ADAPTERS.values()].map((a) => ({
    id: a.id,
    label: a.label,
    platform: a.platform,
    mcVersion: a.mcVersion,
    javaVersion: a.javaVersion,
    defaults: a.defaults,
    experimental: !!a.experimental,
  }));
}

export function getTarget(id) {
  const a = ADAPTERS.get(id);
  if (!a) throw new Error(`未知目标 "${id}"，可选：${[...ADAPTERS.keys()].join(', ')}`);
  return a;
}

export function hasTarget(id) {
  return ADAPTERS.has(id);
}

/**
 * 从工程数据里解析出目标 id。
 *
 * 老工程只有 platform + mcVersion，新工程带 target.id。两条路都要认：
 * 用户手改过 project.json、或者从旧版本编辑器迁移过来的工程不能突然打不开。
 * 解析不出来时返回一个拼出来的 id，让 getTarget() 去抛那句带候选列表的清晰错误。
 */
export function resolveTargetId(target) {
  if (!target) return 'fabric-26.3';
  if (target.id && ADAPTERS.has(target.id)) return target.id;
  const composed = `${target.platform || 'fabric'}-${target.mcVersion || ''}`.replace(/-$/, '');
  if (ADAPTERS.has(composed)) return composed;
  // 兼容早期只写 platform 的工程
  if (ADAPTERS.has(target.platform)) return target.platform;
  return composed;
}

/** 工程 → 适配器。管线里统一用这个，别再自己拼字符串 */
export function getTargetFor(project) {
  return getTarget(resolveTargetId(project?.target));
}

/** 按平台的显示色，界面用来做标签 */
export const PLATFORM_COLORS = {
  fabric: '#dbc17a',
  neoforge: '#e08a3c',
  forge: '#7a8fa6',
  paper: '#6aa84f',
  spigot: '#c9a227',
};
