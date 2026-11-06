/**
 * 积木库体检器。
 *
 * 为什么要有它：装库时的 validateLibrary() 只看「有没有 id / shape / java」，
 * 太浅了。真正会坑到人的是这些：
 *   · 模板里写了 %item 却没声明这个参数 → 生成的 Java 里残留一个 %item，编译直接挂
 *   · 声明了 bodySlots 却忘了在模板里放 %body → 凹槽里的积木全部悄悄消失
 *   · 只在 fabric-26.3 给了模板 → 分享给别人（用 Forge）时积木点了没反应
 *   · 分类只在积木里写了、没在 categories 登记 → 界面显示内部 id
 *
 * 这个模块把「能装」和「能用」分开：
 *   errors   —— 会导致生成坏代码 / 丢积木，必须修
 *   warnings —— 可用性问题，建议修
 *
 * 命令行：`node studio.mjs blocks validate <库文件...>`
 */
import { LIB_VERSION, validateLibrary } from './library.mjs';
import { SIGNATURES } from './compile.mjs';

/** 编译器自己会填的占位符，不是积木声明的参数 */
const RESERVED = new Set(['method', 'sig', 'body', 'elseBody', 'body2']);
/** Java 里常见的格式符 / 取模，别当成积木占位符误报 */
const FORMAT_TOKENS = new Set(['s', 'd', 'f', 'n', 't', 'x', 'c', 'b', 'e', 'g', 'a', 'o']);
const VALID_SHAPES = new Set(['hat', 'stack', 'reporter', 'boolean']);
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/;
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 把模板里所有 `%name` / `%{name}` 占位符抓出来。
 * @param {string} template
 * @param {Set<string>} [declared] 已声明的参数名 —— 声明过的优先当占位符，
 *        否则 `%x` 这种会被 Java 格式符白名单吃掉（真踩过：block.set 的 x 坐标）
 */
export function placeholdersOf(template, declared = null) {
  const out = new Set();
  const s = String(template || '');
  for (const m of s.matchAll(/%\{([A-Za-z_]\w*)\}/g)) out.add(m[1]);
  for (const m of s.matchAll(/%([A-Za-z_]\w*)\b/g)) {
    // `%{name}` 的花括号形式已经被上面收过，这里别重复；
    // `%s` 这种格式符跳过（Java String.format 很常见），
    // 但如果它确实是声明过的参数，就必须留下。
    if (FORMAT_TOKENS.has(m[1]) && m[1].length === 1 && !declared?.has?.(m[1])) continue;
    out.add(m[1]);
  }
  return out;
}

/**
 * 体检一个库对象。
 * @param {object} lib
 * @param {object} [opts]
 * @param {string[]} [opts.knownTargets] 认识的目标 id（默认从 block 里出现的推断）
 * @returns {{ok:boolean, errors:string[], warnings:string[], stats:object, coverage:object}}
 */
export function lintLibrary(lib, opts = {}) {
  const base = validateLibrary(lib);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  const stats = {
    blocks: 0,
    withTemplate: 0,
    hats: 0,
    targets: new Set(),
    placeholders: 0,
  };
  const coverage = {};
  const declaredCategories = new Set((lib?.categories || []).map((c) => c?.id));

  const blocks = Array.isArray(lib?.blocks) ? lib.blocks : [];
  const known = new Set(opts.knownTargets || []);
  for (const b of blocks) {
    if (!b || !b.id) continue;
    stats.blocks += 1;
    const tag = `积木 ${b.id}`;
    if (!ID_RE.test(String(b.id))) errors.push(`${tag}：id 不合法（只能用字母、数字、下划线、点）`);
    if (!VALID_SHAPES.has(b.shape)) errors.push(`${tag}：shape "${b.shape}" 不认识`);
    if (b.shape === 'hat') stats.hats += 1;

    const inputs = Array.isArray(b.inputs) ? b.inputs : [];
    const fields = Array.isArray(b.fields) ? b.fields : [];
    const declared = new Set();
    for (const list of [inputs, fields]) {
      for (const x of list) {
        if (!x || !x.name) { errors.push(`${tag}：有参数没有 name`); continue; }
        if (!NAME_RE.test(String(x.name))) errors.push(`${tag}：参数名 "${x.name}" 不合法`);
        if (declared.has(x.name)) errors.push(`${tag}：参数名 "${x.name}" 重复`);
        declared.add(x.name);
      }
    }

    // 分类登记
    if (b.category && declaredCategories.size && !declaredCategories.has(b.category)) {
      warnings.push(`${tag}：分类 "${b.category}" 没在 categories 里登记，界面上会显示内部 id`);
    }

    const java = b.java && typeof b.java === 'object' ? b.java : {};
    const targetIds = Object.keys(java);
    const isHatWithSignature = b.shape === 'hat' && !!SIGNATURES[b.id];
    if (!targetIds.length) {
      if (!isHatWithSignature) warnings.push(`${tag}：没有 Java 实现，点了不会生成代码`);
    } else {
      stats.withTemplate += 1;
    }

    const bodySlots = Array.isArray(b.bodySlots) ? b.bodySlots : [];
    const seenPlaceholderSets = new Map();

    for (const tid of targetIds) {
      stats.targets.add(tid);
      if (known.size && !known.has(tid)) {
        warnings.push(`${tag}：目标 "${tid}" 不在已知目标列表里，这个模板用不上`);
      }
      const tpl = java[tid];
      if (typeof tpl !== 'string' || !tpl.trim()) {
        errors.push(`${tag} / ${tid}：模板是空的`);
        continue;
      }
      const used = placeholdersOf(tpl, declared);
      stats.placeholders += used.size;
      seenPlaceholderSets.set(tid, used);

      for (const u of used) {
        if (RESERVED.has(u) || declared.has(u)) continue;
        errors.push(`${tag} / ${tid}：模板里的 %${u} 没有对应的参数声明（生成的 Java 会残留 %${u}）`);
      }
      for (const slot of bodySlots) {
        if (!new RegExp(`%${slot}\\b`).test(tpl)) {
          errors.push(`${tag} / ${tid}：声明了容器槽 ${slot}，模板里却没有 %${slot}（凹槽里的积木会丢失）`);
        }
      }
      // 模板里有容器标记但没声明 bodySlots 不算错 —— registry 会从模板自动推。
    }

    // 声明了参数却一个模板都没用：多半是漏了
    if (targetIds.length) {
      const union = new Set();
      for (const s of seenPlaceholderSets.values()) for (const p of s) union.add(p);
      for (const d of declared) {
        if (!union.has(d) && !RESERVED.has(d)) {
          warnings.push(`${tag}：参数 %${d} 声明了但模板里没用到`);
        }
      }
      // 跨目标的占位符集合不一致 —— 换目标时行为会变
      const sets = [...seenPlaceholderSets.entries()]
        .map(([tid, s]) => [tid, [...s].filter((p) => !RESERVED.has(p)).sort().join(',')]);
      if (sets.length > 1 && new Set(sets.map(([, v]) => v)).size > 1) {
        warnings.push(`${tag}：各目标模板用到的参数不一致（${sets.map(([t, v]) => `${t}: ${v || '无'}`).join(' / ')}）`);
      }
    }

    if (b.requiresMod && !targetIds.length) {
      warnings.push(`${tag}：标了需要 ${b.requiresMod}，却没有模板`);
    }
  }

  // 目标覆盖矩阵：每个目标下有多少积木能真正生成代码
  const allTargets = known.size ? [...known] : [...stats.targets].sort();
  for (const tid of allTargets) {
    let n = 0;
    for (const b of blocks) {
      if (b?.java?.[tid] && String(b.java[tid]).trim()) n += 1;
      else if (b?.shape === 'hat' && SIGNATURES[b.id]) n += 1;
    }
    coverage[tid] = { implemented: n, total: stats.blocks, percent: stats.blocks ? Math.round((n / stats.blocks) * 100) : 0 };
  }

  if (lib && lib.version != null && lib.version !== LIB_VERSION) {
    warnings.push(`库版本 ${lib.version}，当前工具认识的是 ${LIB_VERSION}`);
  }
  // 覆盖率 0% 不是错（很多 mod 本来就只支持一个加载器），
  // 但分享给别人之前该说清楚，免得对方装了库发现积木全是灰的。
  for (const [tid, c] of Object.entries(coverage)) {
    if (c.total && c.implemented === 0) {
      warnings.push(`这个库在目标 ${tid} 下没有任何可用积木（0/${c.total}）`);
    }
  }

  stats.targets = [...stats.targets].sort();
  return { ok: errors.length === 0, errors, warnings, stats, coverage };
}

/** 给 CLI 用的一行行摘要 */
export function lintSummary(result, label = '') {
  const lines = [];
  const head = `${label ? label + '  ' : ''}${result.ok ? '✓ 通过' : '✗ 有问题'}`
    + `  ${result.stats.blocks} 条积木 / ${result.stats.targets.length} 个目标`;
  lines.push(head);
  for (const t of Object.keys(result.coverage)) {
    const c = result.coverage[t];
    lines.push(`   ${t.padEnd(18)} ${String(c.implemented).padStart(3)}/${c.total} 可用  ${c.percent}%`);
  }
  for (const e of result.errors) lines.push(`   ERROR   ${e}`);
  for (const w of result.warnings) lines.push(`   warn    ${w}`);
  return lines;
}
