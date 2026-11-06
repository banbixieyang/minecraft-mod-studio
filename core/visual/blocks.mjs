/**
 * 积木定义注册表。
 *
 * 一个积木定义 = 描述（长什么样）+ 实现（编译成什么 Java）。
 * 实现按**目标**分派：Fabric 26.3 和 Forge 1.20.1 的 API 不一样，
 * 同一个积木在两个目标下要生成不同的 Java。
 *
 * 定义可以来自三个地方，合并后按 id 覆盖：
 *   · 内置库（builtin.mjs）
 *   · 目标适配器专属定义（core/target/<id>/blocks.mjs）
 *   · 加载进来的用户库（library.mjs）
 *
 * 模板语法：
 *   %name   —— 参数占位。文本参数自动加引号并转义；数字直接输出；
 *              嵌套积木递归编译成表达式。
 *   %body  —— 容器型积木的子积木编译结果（多行）
 *   %field —— 菜单字段，用 fields 里的 switch 分支替换
 */
import { SHAPES } from './model.mjs';

const registry = new Map();

/**
 * 分类元信息：category id → { id, label, icon, color }
 *
 * 为什么要单独存：
 *   库文件里定义了友好的分类名（"Goety · 灵魂能量"），
 *   但积木定义里只有 category id（"goety-soul"）。
 *   光按 id 聚合的话，界面上就会显示 "goety-soul" 这种内部 id，
 *   小朋友根本看不懂。装库时把库的分类信息存进来，界面才有 friendly name。
 */
const categories = new Map();

/** 记一批分类（装库时调） */
export function registerCategories(list) {
  for (const c of list || []) {
    if (!c || !c.id) continue;
    categories.set(c.id, {
      id: c.id,
      label: c.label || c.id,
      icon: c.icon || '',
      color: c.color || '',
      source: c.source || '',
    });
  }
}

/** 全部分类元信息 */
export function allCategories() {
  return [...categories.values()];
}

/** 清掉某个来源的分类（卸库时调） */
export function unregisterCategoriesBySource(source) {
  for (const [id, c] of categories) {
    if (c.source === source) categories.delete(id);
  }
}

/** 内置库是否已装载（clearBlocks 会把它清掉） */
let builtinInstalled = false;

/**
 * 注册一批积木定义。
 * @param {object[]} defs
 * @param {object} [opts]
 * @param {string} [opts.source] 来源标识（内置 / 库名 / 目标名）
 * @param {boolean} [opts.overwrite] 同 id 是否覆盖已有定义
 */
export function registerBlocks(defs, opts = {}) {
  const added = [];
  const skipped = [];
  for (const d of defs || []) {
    if (!d || !d.id) continue;
    if (!SHAPES.includes(d.shape)) {
      skipped.push({ id: d.id, why: `形状非法：${d.shape}` });
      continue;
    }
    const exist = registry.get(d.id);
    if (exist && !opts.overwrite) {
      // 允许「补实现」：已有描述但缺某目标的 java 模板时合并
      if (d.java && exist.java) {
        let merged = false;
        for (const [target, tpl] of Object.entries(d.java)) {
          if (!exist.java[target]) { exist.java[target] = tpl; merged = true; }
        }
        if (merged) { added.push(d.id); continue; }
      }
      skipped.push({ id: d.id, why: '已存在' });
      continue;
    }
    registry.set(d.id, normalize(d, opts.source));
    added.push(d.id);
  }
  return { added, skipped };
}

/** 补齐默认值 */
function normalize(d, source) {
  return {
    id: d.id,
    category: d.category || 'misc',
    shape: d.shape,
    label: d.label || d.id,
    icon: d.icon || '',
    description: d.description || '',
    inputs: d.inputs || [],
    fields: d.fields || [],
    // 容器型积木的额外 body 槽（如 if/else 的 else 分支）
    bodySlots: d.bodySlots || null,
    java: d.java || {},
    source: d.source || source || 'builtin',
    // 自定义积木块（用户从代码造的）：带 userDef，编译时走自定义路径
    userDef: d.userDef || null,
    // 依赖某个 mod 的积木（如 Goety 专属积木）：界面提示用户要装那个 mod
    requiresMod: d.requiresMod || null,
    // 未验证的积木：界面上标灰
    unverified: !!d.unverified,
  };
}

/** 查一个积木定义 */
export function getBlock(id) {
  return registry.get(id) || null;
}

/** 全部定义 */
export function allBlocks() {
  return [...registry.values()];
}

/** 按类别分组 */
export function blocksByCategory() {
  const map = new Map();
  for (const d of registry.values()) {
    if (!map.has(d.category)) map.set(d.category, []);
    map.get(d.category).push(d);
  }
  return map;
}

/** 清空注册表（测试用） */
export function clearBlocks() {
  registry.clear();
  categories.clear();
  // 内置库标记也要一起清 —— 否则清空之后 ensureBuiltin() 以为装过了，
  // 内置积木就再也回不来（卸库、换库时会踩到）。
  builtinInstalled = false;
}

/** 内置库装好了没有 */
export function isBuiltinInstalled() {
  return builtinInstalled;
}

/** 标记内置库已装载 */
export function markBuiltinInstalled() {
  builtinInstalled = true;
}

/** 卸载某个来源的全部定义（换库时用） */
export function unregisterBySource(source) {
  let n = 0;
  for (const [id, d] of registry) {
    if (d.source === source) { registry.delete(id); n++; }
  }
  return n;
}

/**
 * 取某个目标下的 Java 模板。
 * 找不到确切目标时，尝试用通配（比如 fabric-* 匹配 fabric-26.3）。
 */
export function templateFor(id, targetId) {
  const d = registry.get(id);
  if (!d) return null;
  if (!targetId) return d.java[Object.keys(d.java)[0]] || null;
  if (d.java[targetId]) return d.java[targetId];
  // 通配：fabric-* / forge-*
  const prefix = String(targetId).split('-')[0];
  for (const [tid, tpl] of Object.entries(d.java)) {
    if (tid.split('-')[0] === prefix) return tpl;
  }
  return null;
}

/**
 * 这条积木在当前目标下能不能编译。
 * @returns {{ok:boolean, reason?:string}}
 */
export function supportsTarget(id, targetId) {
  const d = registry.get(id);
  if (!d) return { ok: false, reason: '未知积木' };
  if (d.userDef) return { ok: true };
  if (!templateFor(id, targetId)) {
    return { ok: false, reason: `这条积木在目标 ${targetId} 下没有实现` };
  }
  return { ok: true };
}
