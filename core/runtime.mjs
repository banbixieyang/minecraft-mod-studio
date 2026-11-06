/**
 * 运行时契约。
 *
 * 引擎里有三处注册表（目标适配器 / 转换规则 / mod 积木包）用 createRequire
 * 同步加载 ESM 插件，目的是让 listTargets() / getTarget() / libraryFromReport()
 * 保持同步 API。这个能力 Node 22.12+ 默认开启，20.19+ 需带实验开关，
 * 更早的版本直接抛 ERR_REQUIRE_ESM。
 *
 * 以前的坑：这些加载失败只是被 catch 记进 diagnostics，引擎照常出结果 ——
 * Node 18/20 上会「全部插件静默消失」，甚至把 forge 工程建成 fabric 参数。
 * 现在统一在这里做能力自检：宁可启动就报错，也不给出看似成功、实则错误的数据。
 */
import { createRequire } from 'node:module';

/** 给报错看的推荐版本；实际判定以 requireEsmSupported() 的实测为准。 */
export const MIN_NODE = '22.12.0';

let cached = null;

/** 实测当前 Node 能不能同步 require 一个 ESM 文件。 */
export function requireEsmSupported() {
  if (cached !== null) return cached;
  try {
    const req = createRequire(import.meta.url);
    req('./runtime-probe.mjs');
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** 这类错误不是「某个插件写坏了」，是运行时根本不支持，必须炸出来。 */
export function isRequireEsmError(e) {
  return e?.code === 'ERR_REQUIRE_ESM'
    || /require\(\) of ES Module|A cycle involving require\(esm\)/i.test(String(e?.message || ''));
}

/**
 * 入口自检。失败时抛出的信息要能直接告诉用户「升级 Node」，
 * 而不是让人去猜为什么插件全没了。
 */
export function assertRuntime() {
  if (requireEsmSupported()) return { ok: true, node: process.versions.node };
  throw new Error(
    `MC Studio 需要支持 require(esm) 的 Node.js（推荐 >= ${MIN_NODE}，或 20.19+；当前 ${process.versions.node}）。` +
    ' 引擎用它同步加载目标适配器、转换规则与积木包插件；当前运行时会让这些插件全部加载失败，' +
    '并可能生成目标参数错配的工程。请升级 Node 后重试。'
  );
}

/** 给诊断面板 / CLI 看的运行时摘要。 */
export function runtimeInfo() {
  return {
    node: process.versions.node,
    minRecommended: MIN_NODE,
    requireEsm: requireEsmSupported(),
  };
}
