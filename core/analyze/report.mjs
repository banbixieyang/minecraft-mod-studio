/**
 * 分析报告 —— 把资源、代码、元数据三路结果合成一份人能读的东西。
 *
 * 设计原则：**只说自己确定的事**。
 * 从资源反推出来的内容，准确度接近 100%（那就是数据文件本身）；
 * 从常量池猜出来的能力，只能算「有证据表明」，所以每条都带 evidence 让你自己看。
 * 混在一起说会让人把猜测当结论。
 *
 * 元数据这一层单独放在 meta.mjs：别人的发布包格式比自己构建出来的杂得多，
 * 把「认它是谁」和「拆它有什么」分开，改格式支持时不会碰分析逻辑。
 */
import path from 'node:path';
import { openSource, detectNamespaces, looksLikeGradleProject } from './sources.mjs';
import { analyzeResources, collectTextures } from './resources.mjs';
import { analyzeCode } from './abilities.mjs';
import { readModMeta, detectObfuscation } from './meta.mjs';
import { activeExtensions, runExportHooks } from './ext/index.mjs';
import { makePack } from '../library/pack.mjs';

/** 打包时把加载器收敛到编辑器认识的目标平台 */
const PLATFORM_ALIAS = { quilt: 'fabric', neoforge: 'forge' };

/**
 * 分析一个 mod。
 * input 可以是 .jar 文件，也可以是解压目录 / 源码工程目录。
 */
export function analyze(input, opts = {}) {
  const src = openSource(input);

  // ---- 1. 元数据 + 包的物理特征 ----
  const { meta, packaging, warnings: metaWarnings } = readModMeta(src);
  const warnings = [...metaWarnings];

  // ---- 2. 命名空间 ----
  const namespaces = detectNamespaces(src);
  const mainNs = meta.id && namespaces.includes(meta.id) ? meta.id : namespaces[0] || meta.id || '';
  if (!namespaces.length) warnings.push('jar 里没有 assets/ 或 data/，可能是个纯代码 mod');

  // ---- 3. 资源 ----
  const res = analyzeResources(src, { namespaces, mainNs });
  const resWarnings = [...res.warnings];

  // ---- 3.5 扩展（像 mod 一样拓宽分析能力）----
  // 只对 match() 命中的 jar 激活；扩展往 res.contents 里塞新内容类型，
  // 并声明这些类型在拆解台里可编辑的字段。核心解析逻辑一律不碰。
  const extTypes = {};
  const extFields = {};
  const active = activeExtensions(meta);
  // 扩展接管的配方类型：核心报了「这类配方已跳过」，但扩展自己收走了，
  // 那条警告就不该再出现（否则会跟扩展的「已补回」自相矛盾）。
  const handledRecipeTypes = new Set();
  for (const ext of active) {
    try {
      const r = ext.analyze({ src, meta, mainNs, lang: res.lang, contents: res.contents });
      if (r && r.contents) {
        for (const [t, list] of Object.entries(r.contents)) {
          if (!Array.isArray(list)) continue;
          res.contents[t] = (res.contents[t] || []).concat(list);
          if (!extTypes[t] && ext.contentTypes && ext.contentTypes[t]) extTypes[t] = ext.contentTypes[t];
        }
      }
      if (r && Array.isArray(r.warnings)) resWarnings.push(...r.warnings);
      for (const t of ext.handlesRecipeTypes || []) handledRecipeTypes.add(t);
      for (const [t, flds] of Object.entries(ext.fields || {})) {
        if (Array.isArray(flds)) extFields[t] = (extFields[t] || []).concat(flds);
      }
    } catch (e) {
      resWarnings.push(`扩展「${ext.name || ext.id}」解析失败：${e.message}`);
    }
  }

  // 扩展接管的配方类型，不再报「已跳过」
  const keptResWarnings = resWarnings.filter((w) => {
    if (!/\d+ 条 .* 类型的配方暂不支持，已跳过/.test(w)) return true;
    return ![...handledRecipeTypes].some((t) => w.includes(t));
  });  warnings.push(...keptResWarnings);

  // ---- 4. 代码 ----
  const code = analyzeCode(src, { namespaces: namespaces.length ? namespaces : [mainNs] });
  warnings.push(...code.warnings);
  if (code.stats.broken) warnings.push(`${code.stats.broken} 个 class 解析失败（可能是加密或混淆过的）`);

  packaging.obfuscation = detectObfuscation(code);
  if (packaging.obfuscation.intermediary || packaging.obfuscation.srg) {
    warnings.push('class 里出现 intermediary / SRG 名，说明这是重映射过的发布包：能认出注册 id 和 API 用法，但方法名不可读，也没法直接还原 Java 源码。');
  }

  if (looksLikeGradleProject(src)) {
    warnings.push('这是个源码工程（有 build.gradle），分析的是它的构建产物目录，可能有重复');
  }

  // ---- 5. 体检：算一下内容规模 ----
  const counts = {};
  for (const [k, v] of Object.entries(res.contents)) counts[k] = v.length;

  // 只统计我们自己认识的东西，其余当「其它资源」
  const otherTextures = (src.allNames || []).filter((n) => /^assets\/[^/]+\/textures\/.+\.png$/.test(n)).length;
  const recognizedTextures = counts.item + counts.block;

  return {
    ok: true,
    source: { path: src.path, kind: src.kind, name: src.name, size: src.size },
    meta,
    packaging,
    namespaces,
    mainNs,
    counts,
    contents: res.contents,
    // 生效的扩展及其为拆解台注册的内容类型 / 可编辑字段
    extensionTypes: extTypes,
    extensionFields: extFields,
    extensions: active.map((e) => e.id),
    effects: res.effects || [],
    // 源码文件清单：只有 sources jar 才有 .java，普通发布包是空数组。
    // 拆讲台用它决定要不要显示「源码」分组，以及逐文件读取的入口。
    sourceFiles: (src.allNames || []).filter((n) => /\.java$/i.test(n)).sort(),
    lang: res.lang,
    code,
    assets: {
      textures: otherTextures,
      accountedTextures: recognizedTextures,
      langKeys: Object.keys(res.lang.zh_cn || {}).length,
    },
    warnings: [...new Set(warnings)],
    // 内部用：转包时还要读贴图
    __src: src,
  };
}

/** 分析完记得关掉（jar 模式目前不持有句柄，留着接口以防以后换流式读） */
export function closeReport(report) {
  report?.__src?.close?.();
}

/**
 * 把分析结果按用户勾选转成 Pack。
 *
 * selection:
 *   contents: { item: [ids], block: [...], recipe: [...], worldgen: [...], advancement: [...] }
 *   withTextures: boolean
 *   effectIds:  [effects.mjs 里的模板 id]，会额外带上一批可编译的效果代码
 *
 * opts.overrides: 拆解台「改数值」的核心。
 *   形状 { [type]: { [id]: { field: value } } }，只合并到被选中的条目上。
 *   例如把某个工具材质的耐久从默认 1561 改成 2000：
 *     { tier: { m_ruby: { durability: 2000 } } }
 *   合并时只写入条目「本来就有」的字段，避免客户端塞进陌生键污染生成器。
 */
/**
 * 把内容 id 洗成「能进包」的形式。
 *
 * 包里的条目 id 有硬性规则：小写字母开头、只含小写字母/数字/下划线、2~48 字符。
 * 别人的资源路径常常又长又带符号（比如
 * snowy_jade_slab_from_snowy_jade_tiles_stonecutting，53 个字符），
 * 直接塞进包会被校验拒掉、整个导出失败。
 * 这里统一洗一遍：合法就原样保留；不合法就小写化 + 换符号 + 截断 + 短哈希（防撞名）。
 */
export function packSafeId(raw, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const original = String(raw ?? '');
  let id = original.replace(/[^a-z0-9_]/gi, '_').toLowerCase().replace(/^[^a-z]+/, '');
  if (!id) id = 'x';
  if (id.length > 48) {
    let h = 0;
    for (let i = 0; i < original.length; i++) h = (h * 31 + original.charCodeAt(i)) >>> 0;
    id = `${id.slice(0, 41)}_${h.toString(36).slice(0, 6)}`;
  }
  if (id.length < 2) id = `${id}_x`;
  let out = id;
  let n = 2;
  while (used.has(out)) out = `${id.slice(0, 45)}_${n++}`;
  used.add(out);
  return out;
}

export async function reportToPack(report, selection = {}, opts = {}) {
  const sel = selection.contents || {};
  const src = report.__src;
  const overrides = opts.overrides || {};
  const entries = {};
  for (const [type, ids] of Object.entries(sel)) {
    const list = (report.contents[type] || []).filter((e) => ids.includes(e.id));
    if (!list.length) continue;
    const taken = new Set();
    entries[type] = list.map((e) => {
      const copy = JSON.parse(JSON.stringify(e));
      const ov = overrides[type] && overrides[type][e.id];
      if (ov && typeof ov === 'object') {
        for (const k of Object.keys(ov)) {
          // 只合并条目本身已有的字段：数值型（durability/stacksTo/...）或文本型（nameZh）都接受，
          // 但绝不凭空新增键。这样就算客户端传来恶意字段也不会影响生成器。
          if (k in copy) copy[k] = ov[k];
        }
      }
      // 包里的条目 id 有硬性规则（小写字母开头、只含小写字母/数字/下划线、2~48 字符）。
      // 别人的资源路径可能很长（比如 snowy_jade_slab_from_snowy_jade_tiles_stonecutting），
      // 直接塞进包会被校验拒掉，所以这里洗一遍；原 id 保留在 sourceId 里方便追溯。
      const safe = packSafeId(copy.id, taken);
      if (safe !== copy.id) {
        copy.sourceId = copy.id;
        copy.id = safe;
      }
      return copy;
    });
  }

  // 贴图：只带用户选的条目对应的
  let textures = [];
  if (selection.withTextures !== false && src) {
    // 条目可能来自不同命名空间，贴图要按条目自己的 ns 去找，
    // 所以这里传 { id, ns } 而不是裸 id。
    const pick = (type) => (report.contents[type] || [])
      .filter((e) => (sel[type] || []).includes(e.id))
      .map((e) => ({ id: e.id, ns: e.ns || report.mainNs }));
    textures = collectTextures(src, report.mainNs, {
      item: pick('item'),
      block: pick('block'),
    });
  }

  const total = Object.values(entries).reduce((n, l) => n + l.length, 0);
  const rawLoader = report.meta.loader || '';
  const platform = PLATFORM_ALIAS[rawLoader] || rawLoader;
  const authors = Array.isArray(report.meta.authors)
    ? report.meta.authors.join(', ')
    : String(report.meta.authors || '');
  const pack = makePack({
    id: opts.id,
    name: opts.name || `${report.meta.name || report.source.name} 的角色内容`,
    desc: opts.desc || `从 ${path.basename(report.source.path)} 提取：${total} 项内容`,
    tags: opts.tags || [],
    author: authors,
    origin: {
      kind: 'analyze',
      file: path.basename(report.source.path),
      ns: report.mainNs,
      modId: report.meta.id,
      modName: report.meta.name,
      at: Date.now(),
    },
    requires: {
      platform: platform && platform !== 'unknown' ? [platform] : [],
      mcVersion: report.meta.mcVersion ? [report.meta.mcVersion] : [],
      contentTypes: Object.keys(entries),
    },
    params: [],
    content: {
      entries,
      textures,
    },
  });

  // ---- 5. 导出钩子 ----
  // 有些 mod 的数值不在条目里（Goety 的数值在 Forge 配置里），
  // 光把条目打进包，改了值也不会生效。扩展在这里按「用户改了哪些值」
  // 生成对应的产物（toml 覆写 / 运行时代码），同样不改核心代码。
  const hook = await runExportHooks({
    report,
    selection: sel,
    overrides,
    pack,
    projectModId: opts.projectModId || '',
    projectPkg: opts.projectPkg || '',
  });
  if (hook.files.length) pack.content.files.push(...hook.files);
  if (hook.java.length) pack.content.java.push(...hook.java);
  if (hook.warnings.length) pack.warnings = [...(pack.warnings || []), ...hook.warnings];

  return pack;
}

/** 给界面用的摘要，去掉了 __src 这种不能序列化的东西 */
export function reportSummary(report) {
  const { __src, ...rest } = report;
  return rest;
}
