/**
 * Pack —— 可复用的「效果包」。
 *
 * 这是整个复用体系的原子单位。一个 Pack 可以只装几条内容（一整套装备），
 * 也可以只装一段代码（吸血逻辑），还可以两者都有。
 *
 * 为什么要统一成一种格式：
 *  - 编辑器里手工攒的东西、分析外部 mod 提取出来的东西，产物必须是同一种东西，
 *    否则「分析完能不能用」这件事就永远说不清。
 *  - 导出给别人就是发一个 json 文件。
 *
 * 结构：
 * {
 *   format: 'mcstudio.pack', formatVersion: 1,
 *   id, name, kind: 'content'|'effect'|'mixed', desc, tags, author, createdAt,
 *   requires: { platform:[], mcVersion:[], modules:[], contentTypes:[] },
 *   params:  [{ key, label, type, default, min, max, step, options, hint }],
 *   content: {
 *     entries:  { <contentType>: [entry...] },
 *     java:     [{ target:'init', name, code }],
 *     js:       [{ path, code }],
 *     lang:     { zh_cn:{}, en_us:{} },
 *     files:    [{ path, content, createOnly }],
 *     textures: [{ path, dataUrl }],
 *   }
 * }
 *
 * 参数化：代码/文本里写 {{key}}，安装时替换成用户填的值。
 * 用 {{}} 而不是 ${} 是为了能在 Java 字符串、JSON、JS 模板串里通用。
 */
import crypto from 'node:crypto';
import { isValidId } from '../ids.mjs';

export const PACK_FORMAT = 'mcstudio.pack';
export const PACK_VERSION = 1;
export const PACK_EXT = '.mcpkg.json';

/** 参数占位符：{{name}} */
const PARAM_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export class PackError extends Error {}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** 空的 content 骨架 */
export function blankContent() {
  return {
    entries: {},
    java: [],
    js: [],
    lang: {},
    files: [],
    textures: [],
  };
}

/**
 * 组装一个 Pack。传进来的东西可能缺胳膊少腿，这里统一补齐并算出 kind。
 */
export function makePack(input = {}) {
  const content = { ...blankContent(), ...asObject(input.content) };
  content.entries = asObject(content.entries);
  content.java = asArray(content.java);
  content.js = asArray(content.js);
  content.lang = asObject(content.lang);
  content.files = asArray(content.files);
  content.textures = asArray(content.textures);

  // 丢掉空类型，避免 pack 里躺着一堆 []
  for (const [k, v] of Object.entries(content.entries)) {
    if (!asArray(v).length) delete content.entries[k];
  }

  const hasContent = Object.keys(content.entries).length > 0 || content.textures.length > 0 || content.files.length > 0;
  const hasCode = content.java.length > 0 || content.js.length > 0;

  const name = String(input.name || '').trim() || '未命名效果';
  const id = String(input.id || '').trim() || slugId(name);

  return {
    format: PACK_FORMAT,
    formatVersion: PACK_VERSION,
    id,
    name,
    kind: input.kind || (hasContent && hasCode ? 'mixed' : hasCode ? 'effect' : 'content'),
    desc: String(input.desc || ''),
    tags: asArray(input.tags).map(String).filter(Boolean),
    author: String(input.author || ''),
    createdAt: input.createdAt || Date.now(),
    // 来源信息：分析出来的 pack 会带上原始出处，方便追溯
    origin: input.origin || null,
    requires: {
      platform: asArray(input.requires?.platform),
      mcVersion: asArray(input.requires?.mcVersion),
      modules: asArray(input.requires?.modules),
      contentTypes: asArray(input.requires?.contentTypes),
    },
    params: asArray(input.params).filter((x) => x && x.key).map(normalizeParam),
    content,
  };
}

function normalizeParam(p) {
  return {
    key: String(p.key),
    label: String(p.label || p.key),
    type: p.type || 'text',
    default: p.default ?? '',
    min: p.min,
    max: p.max,
    step: p.step,
    options: asArray(p.options),
    hint: p.hint || '',
  };
}

/** 把中文名之类转成一个能当文件名的 id */
export function slugId(s) {
  const ascii = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii && isValidId(ascii)) return ascii;
  // 全中文名字：用内容哈希给个稳定 id，至少不会撞
  const h = crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
  return `pack_${h}`;
}

/** 校验。返回错误消息数组，空数组代表没问题。 */
export function validatePack(pack) {
  const out = [];
  if (!pack || typeof pack !== 'object') return ['不是合法的对象'];
  if (pack.format !== PACK_FORMAT) out.push(`不是 ${PACK_FORMAT} 文件`);
  if (Number(pack.formatVersion) > PACK_VERSION) {
    out.push(`包格式版本 ${pack.formatVersion} 比当前编辑器（${PACK_VERSION}）新，请升级编辑器`);
  }
  if (!pack.id) out.push('缺少 id');
  else if (!isValidId(pack.id)) out.push(`id「${pack.id}」不合法（只能小写字母、数字、下划线）`);
  if (!pack.name) out.push('缺少 name');

  const c = pack.content || {};
  for (const [type, list] of Object.entries(c.entries || {})) {
    if (!Array.isArray(list)) {
      out.push(`content.entries.${type} 不是数组`);
      continue;
    }
    const seen = new Set();
    for (const e of list) {
      if (!e || !e.id) {
        out.push(`content.entries.${type} 里有条目缺少 id`);
        continue;
      }
      if (!isValidId(e.id)) out.push(`条目 id「${e.id}」不合法`);
      if (seen.has(e.id)) out.push(`content.entries.${type} 里 ${e.id} 重复`);
      seen.add(e.id);
    }
  }
  for (const j of c.java || []) {
    if (!j || !String(j.code || '').trim()) out.push('有一条 Java 片段是空的');
  }
  for (const j of c.js || []) {
    if (!j || !String(j.code || '').trim()) out.push('有一条 JS 片段是空的');
  }
  return out;
}

/**
 * 记下 Pack 里用到的参数名（用来提示「你漏填了」）。
 * 扫 code / 文件内容 / 文本字段。
 */
export function usedParams(pack) {
  const found = new Set();
  const scan = (s) => {
    if (typeof s !== 'string') return;
    let m;
    PARAM_RE.lastIndex = 0;
    while ((m = PARAM_RE.exec(s))) found.add(m[1]);
  };
  const walk = (v) => {
    if (typeof v === 'string') return scan(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v).forEach(walk);
  };
  walk(pack.content);
  return [...found];
}

/** 参数的默认值表 */
export function defaultParamValues(pack) {
  const out = {};
  for (const p of pack.params || []) out[p.key] = p.default;
  return out;
}

/** 把值规范成能塞进代码的字符串 */
function paramToText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  return String(v);
}

/**
 * 渲染一段文本里的 {{参数}}。
 * 未提供的参数用默认值；默认值也没有就保留原样并记一条缺失。
 */
export function renderText(text, values, missing) {
  if (typeof text !== 'string') return text;
  return text.replace(PARAM_RE, (whole, key) => {
    if (values && Object.prototype.hasOwnProperty.call(values, key)) return paramToText(values[key]);
    const def = missing?.defaults?.[key];
    if (def !== undefined) return paramToText(def);
    missing?.keys?.add(key);
    return whole;
  });
}

/**
 * 用参数值渲染整个 Pack，产出可以直接安装的副本。
 * 不修改原 pack。
 */
export function renderPack(pack, values = {}) {
  const defaults = defaultParamValues(pack);
  const merged = { ...defaults, ...values };
  const missing = { keys: new Set(), defaults };

  const render = (v) => {
    if (typeof v === 'string') return renderText(v, merged, missing);
    if (Array.isArray(v)) return v.map(render);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = render(x);
      return o;
    }
    return v;
  };

  const out = { ...pack, content: render(pack.content) };
  out.params = pack.params; // 参数定义本身不渲染
  out.__missingParams = [...missing.keys];
  return out;
}

/** 内容规模摘要，界面和列表都用它 */
export function summarizePack(pack) {
  const c = pack.content || {};
  const counts = {};
  let entryTotal = 0;
  for (const [type, list] of Object.entries(c.entries || {})) {
    counts[type] = asArray(list).length;
    entryTotal += asArray(list).length;
  }
  return {
    entries: entryTotal,
    byType: counts,
    java: asArray(c.java).length,
    js: asArray(c.js).length,
    files: asArray(c.files).length,
    textures: asArray(c.textures).length,
    langKeys: Object.values(asObject(c.lang)).reduce((n, obj) => n + Object.keys(asObject(obj)).length, 0),
    params: asArray(pack.params).length,
  };
}

/** 序列化成可读 JSON（导出用） */
export function serializePack(pack) {
  const clone = JSON.parse(JSON.stringify(pack));
  delete clone.__missingParams;
  return JSON.stringify(clone, null, 2) + '\n';
}

/** 从文本解析并做基本校验 */
export function parsePack(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new PackError(`不是合法的 JSON：${e.message}`);
  }
  const pack = makePack(raw);
  const errs = validatePack(pack);
  if (errs.length) throw new PackError(`包校验失败：${errs.join('；')}`);
  return pack;
}

/** 文件名：<id>.mcpkg.json */
export function packFileName(pack) {
  return `${pack.id}${PACK_EXT}`;
}
