/**
 * 转换器引擎：把一份 Feature IR 从源目标搬到目标目标。
 *
 * 三条红线：
 *   1. **不猜**。有证据的整段改写标 ported，符号替换标 adapted，
 *      加载器事件和 jar 只能标 manual / blocked，绝不说「已转好」。
 *   2. **只读预览**。convert() 不改任何文件；落盘只在 applyConversion() 里、
 *      且必须由调用方显式确认。
 *   3. **规则可插拔**。这里不 import 任何具体规则，全走 registry.mjs 的发现。
 */
import { getTarget, hasTarget, listTargets } from '../target/registry.mjs';
import { matchingRules, listRules, convertDiagnostics, registerRule, loadRules, clearRules } from './registry.mjs';
import { collectParts, setPart, inferTargetId, featureSummary, featureFromProject } from './ir.mjs';
import { blockConcepts, SYMBOL_TABLE, loaderMarkersIn } from './symbols.mjs';
import { saveProject, loadProject } from '../project.mjs';

export { listRules, convertDiagnostics, registerRule, loadRules, clearRules };

function side(t) {
  return {
    id: t.id, label: t.label, platform: t.platform, mcVersion: t.mcVersion,
    javaVersion: t.javaVersion, features: t.features || {},
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function item(raw, ruleId) {
  return {
    id: raw.id || 'item',
    kind: raw.kind || 'other',
    label: raw.label || raw.id || '部件',
    status: ['ported', 'adapted', 'manual', 'blocked'].includes(raw.status) ? raw.status : 'manual',
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0.5,
    rule: raw.rule || ruleId || 'engine',
    ...(raw.before !== undefined ? { before: String(raw.before) } : {}),
    ...(raw.after !== undefined ? { after: String(raw.after) } : {}),
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
    ...(raw.suggestion ? { suggestion: String(raw.suggestion) } : {}),
  };
}

/**
 * 预览转换。
 * @param {object} feature IR
 * @param {object} opts { targetId | toTargetId, fromTargetId, rules? }
 */
export function convert(feature, opts = {}) {
  const errors = [];
  const warnings = [];
  const fromId = String(opts.fromTargetId || inferTargetId(feature) || '');
  const toId = String(opts.toTargetId || opts.targetId || '');
  if (!toId) errors.push('要给目标：--to <targetId>');
  if (!hasTarget(fromId)) errors.push(`未知源目标 "${fromId}"`);
  if (toId && !hasTarget(toId)) errors.push(`未知目标 "${toId}"`);
  if (errors.length) {
    return {
      ok: false, errors, warnings, from: { id: fromId }, to: { id: toId },
      summary: emptySummary(), items: [], rules: [], notes: [], result: clone(feature), patch: null,
    };
  }

  const fromT = getTarget(fromId);
  const toT = getTarget(toId);
  const from = side(fromT);
  const to = side(toT);
  const draft = clone(feature);
  const notes = [];
  const items = [];
  const appliedChanges = [];
  const ruleHits = [];

  const ctx = {
    from, to, feature: clone(feature), parts: collectParts(draft),
    targets: listTargets(),
  };
  const active = opts.rules ? [...opts.rules].sort((a, b) => (b.priority || 0) - (a.priority || 0)) : matchingRules(ctx);

  for (const r of active) {
    // 每条规则开始前刷新部件：前一条规则改过的代码，后一条要看得见。
    ctx.parts = collectParts(draft);
    let out;
    try {
      out = r.convert(ctx, draft) || {};
    } catch (e) {
      warnings.push(`规则 ${r.id} 执行失败，已跳过：${e.message}`);
      ruleHits.push({ id: r.id, label: r.label, hits: 0, failed: e.message });
      continue;
    }
    const rawItems = Array.isArray(out.items) ? out.items : [];
    const changes = out.changes && typeof out.changes === 'object' ? out.changes : {};
    for (const raw of rawItems) items.push(item(raw, r.id));
    for (const note of Array.isArray(out.notes) ? out.notes : []) notes.push(String(note));
    for (const [partId, patch] of Object.entries(changes)) {
      if (setPart(draft, partId, patch)) appliedChanges.push(partId);
      else warnings.push(`规则 ${r.id} 回填了未知部件 ${partId}，已忽略`);
    }
    ruleHits.push({ id: r.id, label: r.label, hits: rawItems.length });
  }

  // 没有任何规则认领的部件，不能默默当成功 —— 给一个明确交代。
  const finalParts = collectParts(draft);
  for (const p of finalParts) {
    const covered = items.some((i) => i.id === p.id || i.id.startsWith(`${p.id}/`));
    if (covered) continue;
    if (p.kind === 'lang') {
      items.push(item({ id: p.id, kind: 'lang', label: p.label, status: 'ported', confidence: 1, notes: ['语言文件与加载器无关，原样可用。'] }, 'engine'));
      continue;
    }
    if (p.kind === 'java') {
      const markers = [...loaderMarkersIn(p.code, from.platform), ...loaderMarkersIn(p.code, to.platform)];
      items.push(item({
        id: p.id, kind: 'java', label: p.label,
        status: markers.length ? 'manual' : 'ported',
        confidence: markers.length ? 0.4 : 1,
        notes: markers.length
          ? [`检测到加载器专属符号（${markers.slice(0, 3).join('、')}），但没有规则处理，原样保留。`]
          : ['没有命中任何平台差异写法，两边通用，原样保留。'],
      }, 'engine'));
      continue;
    }
    items.push(item({
      id: p.id, kind: p.kind, label: p.label, status: 'manual', confidence: 0.4,
      notes: ['没有规则处理这个部件，已原样保留。'],
      suggestion: '若这是平台专属内容，写一条自定义转换规则补上映射。',
    }, 'engine'));
  }

  const summary = summarize(items);
  const blocked = items.filter((i) => i.status === 'blocked');
  const manual = items.filter((i) => i.status === 'manual');
  return {
    ok: true,
    from, to,
    sourceKind: feature.origin?.type || 'unknown',
    summary,
    items,
    rules: ruleHits,
    diagnostics: convertDiagnostics(),
    warnings,
    errors,
    notes,
    needsReview: manual.length + blocked.length,
    result: draft,
    patch: {
      targetId: to.id,
      entries: draft.content.entries,
      java: draft.content.java,
      programs: draft.content.programs,
      files: draft.content.files,
      deps: draft.content.deps,
      requires: draft.requires,
      changedParts: [...new Set(appliedChanges)],
    },
  };
}

function emptySummary() {
  return { total: 0, ported: 0, adapted: 0, manual: 0, blocked: 0, autoRate: 0, coverage: 0 };
}

function summarize(items) {
  const s = emptySummary();
  s.total = items.length;
  for (const i of items) s[i.status] = (s[i.status] || 0) + 1;
  s.autoRate = s.total ? Math.round(((s.ported + s.adapted) / s.total) * 100) : 0;
  s.coverage = s.total ? Math.round(((s.ported + s.adapted * 0.85 + s.manual * 0.3) / s.total) * 100) : 0;
  return s;
}

/** 能力矩阵：任意两个已登记目标之间，有多少有证据的映射可用。 */
export function conversionMatrix() {
  const targets = listTargets().map((t) => ({ id: t.id, label: t.label, platform: t.platform, mcVersion: t.mcVersion }));
  const pairs = [];
  for (const a of targets) {
    for (const b of targets) {
      if (a.id === b.id) continue;
      const concepts = blockConcepts(a.id, b.id).map((c) => ({ id: c.id, label: c.label }));
      const symbols = SYMBOL_TABLE.filter((e) => e.variants?.[a.id] && e.variants?.[b.id]).length;
      pairs.push({
        from: a.id, to: b.id,
        crossLoader: a.platform !== b.platform,
        verifiedTemplates: concepts.length,
        symbolGroups: symbols,
        concepts: concepts.slice(0, 8),
        verdict: concepts.length || symbols ? '可自动转换一部分' : '只有结构与资源可自动转换',
      });
    }
  }
  return { targets, pairs, rules: listRules().length, diagnostics: convertDiagnostics() };
}

/**
 * 把转换结果落到工程里（唯一会写盘的入口）。
 * 只改工程数据：切换目标 + 回填转换后的 Java / 积木程序 / 条目；
 * 资源由 generate() 按新目标重出，不在这里手塞生成文件。
 */
export function applyConversion(root, report, opts = {}) {
  if (!report?.ok || !report.patch) throw new Error('没有可应用的转换结果，先跑一次转换预览');
  if (opts.confirmed !== true) throw new Error('应用会改工程数据，必须显式确认（confirmed=true / --yes）');
  const targetId = opts.targetId || report.to.id;
  const t = getTarget(targetId);
  const p = loadProject(root);
  const before = p.target?.id || '';

  p.target = { ...(t.defaults || {}), id: t.id };
  const fromProject = report.sourceKind === 'project';
  if (Array.isArray(report.patch.java)) {
    p.hooks = p.hooks || { java: [], js: [] };
    const converted = report.patch.java.map((h) => ({ name: h.name, target: h.target || 'init', code: h.code }));
    // 源是「一段代码 / 一个效果 / 一个包」时是往当前工程里加东西，不能把已有钩子清掉。
    p.hooks.java = fromProject
      ? converted
      : [...(p.hooks.java || []).filter((h) => !converted.some((c) => c.name === h.name)), ...converted];
  }
  if (Array.isArray(report.patch.programs) && report.patch.programs.length) {
    p.visual = p.visual || { programs: [], libraries: [] };
    p.visual.programs = fromProject ? clone(report.patch.programs) : [...(p.visual.programs || []), ...clone(report.patch.programs)];
  }
  if (report.sourceKind === 'project' && report.patch.entries && Object.keys(report.patch.entries).length) {
    p.entries = clone(report.patch.entries);
  }
  if (Array.isArray(report.patch.deps)) p.localDeps = clone(report.patch.deps);
  p.state = p.state || {};
  p.state.convert = {
    from: report.from.id, to: t.id, at: new Date().toISOString(),
    autoRate: report.summary.autoRate, needsReview: report.needsReview,
  };
  saveProject(root, p);

  // 资源不在这里写：应用完由调用方跑 generate(root)，让目标适配器整套重出。
  // 生成器是 async 的，塞进这个同步函数会把 CLI 的纯预览路径也拖成异步。
  return {
    ok: true, root, from: before, to: t.id,
    changedParts: report.patch.changedParts,
    hooks: p.hooks.java.length,
    programs: p.visual.programs.length,
    needsReview: report.needsReview,
    next: '跑一次「生成」，让目标适配器按新目标重出 Java 与资源；再构建验证。',
  };
}

/** 把转换后的 Java 拼成一份可直接看的文本（CLI --out 用）。 */
export function convertedJava(report) {
  if (!report?.result?.content?.java) return '';
  return report.result.content.java
    .map((h) => `// ---- ${h.name} (${h.target}) ----\n${h.code}`)
    .join('\n\n');
}

/** 从工程目录直接转换（CLI / HTTP 的常用捷径）。 */
export function convertProject(root, opts = {}) {
  return convert(featureFromProject(root), opts);
}

export { featureSummary };
