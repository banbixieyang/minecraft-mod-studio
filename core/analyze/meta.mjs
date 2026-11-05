/**
 * 读「这个 jar 是谁」—— 第三方发布包的元数据比自己构建出来的乱得多。
 *
 * 自己生成的包里 fabric.mod.json / mods.toml 长什么样我们说了算；
 * 别人给的包可能是：
 *   - Fabric / Quilt / 老 Forge(mcmod.info) / Forge / NeoForge
 *   - 一个 jar 里塞好几个 [[mods]]，或者把依赖 mod 打进 META-INF/jars/
 *   - mods.toml 用单引号、多行数组、三引号描述、${} 变量、注释
 *   - 带签名文件、带 sources、或干脆没有 mod 描述文件
 *
 * 所以这里不猜「一定是什么格式」，而是按格式逐个试，试不出来就明确告诉用户
 * 缺了什么，而不是悄悄当成 unknown 然后给一份空报告。
 */
import { readJson } from './sources.mjs';
import { nestedJarEntries } from './imports.mjs';

const MOD_FILES = /(^|\/)(fabric\.mod\.json|quilt\.mod\.json|mods\.toml|neoforge\.mods\.toml|mcmod\.info)$/i;

const asList = (v) => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x?.name || '')).map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
};

const firstVersion = (v) => {
  const s = Array.isArray(v) ? v.join(' ') : String(v || '');
  return s.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] || '';
};

/** 把 ${mod_id} 之类的占位符换掉；换不掉就回退到 jar 名，绝不留一串 ${} 给界面看 */
function expandVars(s, vars, fallback) {
  return String(s || '').replace(/\$\{([^}]+)\}/g, (_, k) => {
    const key = k.trim();
    return vars[key] ?? (key === 'mod_id' || key === 'modId' ? fallback : '');
  }).trim();
}

/** 去掉行尾注释，但不误伤引号里的 # */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && line[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(raw) {
  const s = String(raw).trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    // 只按顶层逗号切，数组元素里可能有引号逗号
    const out = [];
    let cur = '';
    let quote = null;
    for (const c of inner) {
      if (quote) {
        cur += c;
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
        cur += c;
      } else if (c === ',') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter((x) => x && x !== '').map((x) => parseValue(x));
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** 极简 TOML：只关心 [[mods]] / [[dependencies.x]] 这两类表 */
function parseTomlLite(text) {
  // 三引号多行字符串先压成一行，后面的逐行解析就不用管跨行状态
  const flat = String(text || '')
    .replace(/"""\s*([\s\S]*?)\s*"""/g, (_, s) => JSON.stringify(s.replace(/\r?\n/g, ' ')))
    .replace(/'''\s*([\s\S]*?)\s*'''/g, (_, s) => JSON.stringify(s.replace(/\r?\n/g, ' ')));
  const sections = [];
  const props = {};
  let cur = null;
  let pending = null;

  for (const rawLine of flat.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (pending) {
      pending.text += ` ${line}`;
      if (pending.depth <= 0 || (pending.text.match(/\[/g) || []).length <= (pending.text.match(/\]/g) || []).length) {
        pending.section.values[pending.key] = parseValue(pending.text);
        pending = null;
      }
      continue;
    }
    const table = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (table) {
      cur = { name: table[1].trim(), isArray: line.startsWith('[['), values: {} };
      sections.push(cur);
      continue;
    }
    const kv = line.match(/^([\w.\-"']+)\s*=\s*([\s\S]*)$/);
    if (!kv) continue;
    const key = kv[1].trim().replace(/^["']|["']$/g, '');
    const value = kv[2].trim();
    const opens = (value.match(/\[/g) || []).length;
    const closes = (value.match(/\]/g) || []).length;
    if (value.startsWith('[') && opens > closes) {
      pending = { section: cur || { values: props }, key, text: value, depth: opens - closes };
      continue;
    }
    const target = cur ? cur.values : props;
    target[key] = parseValue(value);
    if (!cur) props[key] = target[key];
  }
  return { sections, props };
}

function readFabricMeta(src, rel) {
  const j = readJson(src, rel);
  if (!j) return null;
  const dep = j.depends || {};
  const authors = asList(j.authors);
  return {
    loader: 'fabric',
    id: j.id || '',
    name: j.name || j.id || '',
    version: String(j.version || ''),
    description: typeof j.description === 'string' ? j.description : '',
    authors,
    license: typeof j.license === 'string' ? j.license : asList(j.license).join(', '),
    mcVersion: firstVersion(dep.minecraft),
    loaderVersion: String(dep.fabricloader || ''),
    apiVersion: String(dep['fabric-api'] || ''),
    javaVersion: String(dep.java || ''),
    entrypoints: j.entrypoints || {},
    mixinFiles: j.mixins || [],
    environment: j.environment || '*',
    depends: dep,
    sourceFile: rel,
  };
}

function readQuiltMeta(src, rel) {
  const j = readJson(src, rel);
  const q = j?.quilt_loader;
  if (!q) return null;
  const md = q.metadata || {};
  const deps = Array.isArray(q.depends) ? q.depends : [];
  const mc = deps.find((d) => String(d?.id) === 'minecraft');
  return {
    loader: 'quilt',
    id: q.id || '',
    name: md.name || q.id || '',
    version: String(q.version || ''),
    description: typeof md.description === 'string' ? md.description : '',
    authors: asList(md.authors || md.contributors),
    license: typeof md.license === 'string' ? md.license : asList(md.license).join(', '),
    mcVersion: firstVersion(mc?.versions || ''),
    loaderVersion: firstVersion(q.loader_version || ''),
    apiVersion: '',
    javaVersion: '',
    entrypoints: q.entrypoints || {},
    mixinFiles: j.mixin || [],
    environment: '*',
    depends: q.depends || [],
    sourceFile: rel,
  };
}

function readForgeMeta(src, rel) {
  const text = src.readText(rel);
  if (!text) return null;
  const { sections, props } = parseTomlLite(text);
  const modBlocks = sections.filter((s) => s.name === 'mods');
  const one = modBlocks[0]?.values || props;
  const fallbackId = String(one.modId || '').replace(/\$\{.*?\}/g, '') || src.name.replace(/[^a-z0-9_]/gi, '').toLowerCase();
  // props 里作者自己声明的 mod_id 优先；没声明才拿 jar 名兜底
  const vars = { mod_id: fallbackId, modId: fallbackId, ...props };
  const expand = (v) => expandVars(v, vars, fallbackId);
  const depBlocks = sections.filter((s) => s.name.startsWith('dependencies.'));
  const mcDep = depBlocks.find((s) => /minecraft/i.test(s.name) || /minecraft/i.test(String(s.values?.modId)))
    || depBlocks.find((s) => /\[?1?\d+\.\d+/i.test(String(s.values?.versionRange)));
  const loader = rel.includes('neoforge') ? 'neoforge' : 'forge';

  return {
    loader,
    id: expand(one.modId || fallbackId),
    name: expand(one.displayName || '') || expand(one.modId || fallbackId),
    version: expand(one.version || ''),
    description: expand(one.description || '').split('\n')[0],
    authors: asList(one.authors),
    license: String(one.license || props.license || ''),
    mcVersion: firstVersion(mcDep?.values?.versionRange || ''),
    loaderVersion: String(one.loaderVersion || props.loaderVersion || ''),
    apiVersion: '',
    javaVersion: '',
    entrypoints: {},
    mixinFiles: [],
    environment: '*',
    depends: {},
    modCount: modBlocks.length,
    embeddedMods: modBlocks.slice(1).map((s) => ({
      id: expand(s.values.modId || ''),
      name: expand(s.values.displayName || s.values.modId || ''),
      from: rel,
    })),
    sourceFile: rel,
  };
}

function readLegacyForgeMeta(src, rel) {
  const j = readJson(src, rel);
  const list = Array.isArray(j) ? j : Array.isArray(j?.modList) ? j.modList : [];
  const one = list[0];
  if (!one) return null;
  return {
    loader: 'forge',
    id: one.modid || '',
    name: one.name || one.modid || '',
    version: String(one.version || ''),
    description: String(one.description || ''),
    authors: asList(one.authors || one.credits),
    license: String(one.license || ''),
    mcVersion: firstVersion(one.mcversion || ''),
    loaderVersion: '',
    apiVersion: '',
    javaVersion: '',
    entrypoints: {},
    mixinFiles: [],
    environment: '*',
    depends: {},
    embeddedMods: list.slice(1).map((m) => ({ id: m.modid, name: m.name, from: rel })),
    sourceFile: rel,
  };
}

/** MANIFEST.MF 兜底：至少告诉用户这个 jar 叫什么 */
function readManifest(src) {
  const text = src.readText('META-INF/MANIFEST.MF') || '';
  const out = {};
  let last = '';
  for (const line of text.split(/\r?\n/)) {
    if (/^\s+/.test(line) && last) { out[last] += line.trim(); continue; }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m) { last = m[1]; out[last] = m[2]; }
  }
  return out;
}

/**
 * 返回 { meta, packaging, warnings }
 * meta 的字段形状与旧版完全一致（authors 一定是数组），下游不用改。
 */
export function readModMeta(src) {
  const warnings = [];
  const names = src.allNames || [];
  const find = (...candidates) => candidates.find((c) => src.has(c));
  const modFiles = names.filter((n) => MOD_FILES.test(n));

  let meta = null;
  const fabricRel = find('fabric.mod.json');
  const quiltRel = find('quilt.mod.json');
  const forgeRel = find('META-INF/neoforge.mods.toml', 'META-INF/mods.toml');
  const legacyRel = find('mcmod.info');
  if (fabricRel) meta = readFabricMeta(src, fabricRel);
  if (!meta && quiltRel) meta = readQuiltMeta(src, quiltRel);
  if (!meta && forgeRel) meta = readForgeMeta(src, forgeRel);
  if (!meta && legacyRel) meta = readLegacyForgeMeta(src, legacyRel);

  // fat jar / 二次打包：mod 描述文件不在根目录
  if (!meta) {
    for (const n of modFiles) {
      if (/fabric\.mod\.json$/i.test(n)) meta = readFabricMeta(src, n);
      else if (/quilt\.mod\.json$/i.test(n)) meta = readQuiltMeta(src, n);
      else if (/\.mods\.toml$|mods\.toml$/i.test(n)) meta = readForgeMeta(src, n);
      else if (/mcmod\.info$/i.test(n)) meta = readLegacyForgeMeta(src, n);
      if (meta) { warnings.push(`mod 描述文件在 ${n}，不是标准位置（这个包可能被二次打包过）`); break; }
    }
  }

  const mf = readManifest(src);
  if (!meta) {
    meta = {
      loader: 'unknown',
      id: '',
      name: (mf['Implementation-Title'] || mf['Specification-Title'] || src.name || '').trim(),
      version: (mf['Implementation-Version'] || mf['Specification-Version'] || '').trim(),
      description: '',
      authors: asList(mf['Implementation-Vendor'] || mf['Built-By']),
      license: '',
      mcVersion: '',
      loaderVersion: '',
      apiVersion: '',
      javaVersion: '',
      entrypoints: {},
      mixinFiles: [],
      environment: '*',
      depends: {},
      sourceFile: '',
    };
    warnings.push('没找到 fabric.mod.json / mods.toml / mcmod.info —— 可能不是 mod，或者是纯库 jar。资源与 class 仍然照常分析，但读不出加载器和版本。');
  }
  if (!Array.isArray(meta.authors)) meta.authors = asList(meta.authors);

  // ---- 包的物理特征 ----
  const signedFiles = names.filter((n) => /^META-INF\/[^/]+\.(SF|RSA|DSA|EC)$/i.test(n));
  const nested = nestedJarEntries(src).map((n) => ({
    name: n,
    size: Number(src.stat(n)?.rawSize || 0),
  }));
  const javaFiles = names.filter((n) => /\.java$/i.test(n) && !n.startsWith('META-INF/'));
  const embeddedMods = [
    ...(meta.embeddedMods || []),
    ...modFiles.filter((n) => n !== meta.sourceFile).map((n) => ({ id: '', name: n, from: n })),
  ];

  const packaging = {
    signed: signedFiles.length > 0,
    signedFiles: signedFiles.slice(0, 6),
    nestedJars: nested,
    javaSources: javaFiles.length,
    javaSample: javaFiles.slice(0, 10),
    embeddedMods,
    // 第三方发布包通常带签名或把依赖一起打进来；本机构建的 dev jar 一般没有
    releaseLike: signedFiles.length > 0 || nested.length > 0,
  };
  delete meta.embeddedMods;

  if (nested.length) {
    // 内嵌 jar 的可分析清单：让界面能列出「这个包里还塞了哪些 mod」，
    // 并且每个都能单独拆一遍（内嵌的往往是真正的功能所在 —— 库、附属包）。
    const nestedMods = [];
    for (const nj of src.nestedJars || []) {
      if (!nj.source) {
        nestedMods.push({ rel: nj.rel, name: nj.name, size: nj.size, readable: false });
        continue;
      }
      let innerMeta = null;
      try {
        innerMeta = readModMeta(nj.source).meta;
      } catch {
        /* 内嵌 jar 读不出元数据就跳过，不影响主流程 */
      }
      nestedMods.push({
        rel: nj.rel,
        name: nj.name,
        size: nj.size,
        readable: true,
        modId: innerMeta?.id || '',
        modName: innerMeta?.name || '',
        loader: innerMeta?.loader || '',
        fileCount: nj.source.allNames.length,
      });
    }
    packaging.nestedMods = nestedMods;
    const named = nestedMods.filter((n) => n.modId).length;
    warnings.push(
      named === nestedMods.length
        ? `内嵌的 ${named} 个 jar 已识别：${nestedMods.map((n) => n.modId).join('、')}。在「管理已导入」里展开它们可以单独拆解。`
        : `内嵌的 ${nestedMods.length} 个 jar 中有 ${named} 个能识别出 modId。`
    );
  }
  if (javaFiles.length) {
    warnings.push(`这个 jar 里带 ${javaFiles.length} 个 .java 源码文件（看起来是 sources jar），可以直接读源码，不需要反编译。`);
  }
  if (signedFiles.length && javaFiles.length === 0) {
    warnings.push('jar 有签名文件，属于发布版：class 里通常是 intermediary / SRG 名，能力识别以字符串证据为准，方法体逻辑无法从这里还原。');
  }
  if (modFiles.length > 1) {
    warnings.push(`发现 ${modFiles.length} 份 mod 描述文件，可能是整合包 / fat jar；当前以 ${meta.sourceFile || '主包'} 为准。`);
  }

  return { meta, packaging, warnings };
}

/** 从 class 常量池线索判断是不是重映射过的发布包 */
export function detectObfuscation(code) {
  const hay = [
    ...(code?.ownClasses || []).map((c) => `${c.name} ${(c.strings || []).join(' ')}`),
  ].join('\n');
  return {
    intermediary: /\bclass_\d+\b|\bfield_\d+\b|\bmethod_\d+\b/.test(hay),
    srg: /\b[fm]_\d+_\w*\b|\bsrg_/i.test(hay),
  };
}
