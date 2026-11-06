/**
 * Java → 积木（反编译，尽力而为）。
 *
 * 策略：**基于积木定义库做模式匹配**，不是通用 Java 解析器。
 * 这样做的理由：通用解析器要处理完整的 Java 语法树，代价高且容易出错；
 * 而我们的积木库是有限的，把模板反着匹配就能覆盖绝大多数实际用法。
 *
 * 保证（这是设计红线）：
 *   · 永不抛异常、永不失败
 *   · 解析不了的代码用「原始代码」积木兜住，一行都不丢
 *   · 用户在界面里仍能编辑那些兜底积木
 */
import { allBlocks, templateFor } from './blocks.mjs';

/** 哨兵：不可能出现在 Java 源码里的字符 */
const SENTINEL = '\u0001';
const SENTINEL_END = '\u0002';

/**
 * 把 Java 模板转成正则。
 *
 * 做法：先把每个占位符换成一个不可能出现在 Java 里的哨兵，
 * 转义整个字符串，再把哨兵换回捕获组。
 * （哨兵必须先替换再转义，否则哨兵会被转义规则破坏。）
 */
export function templateToRegex(tpl) {
  const names = [];
  let s = tpl.replace(/%\{(\w+)\}|%(\w+)/g, (m, a, b) => {
    const name = a || b;
    names.push(name);
    // ⚠️ 必须加括号：SENTINEL + names.length - 1 会被当成 (字符串+数字)-1 = NaN
    return `${SENTINEL}${names.length - 1}${SENTINEL_END}`;
  });
  // 转义正则特殊字符（哨兵不在特殊字符集里，安全）
  s = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 哨兵 → 捕获组。用 [^;{}]*? 保证不跨语句。
  s = s.replace(new RegExp(SENTINEL + '(\\d+)' + SENTINEL_END, 'g'), '([^;{}]*?)');
  return { source: s, names };
}

/**
 * 为一个积木定义构造匹配器。
 * 只有「单行模板」的积木好反向匹配；多行的（if / for）先不参与，
 * 因为它们的 body 是子结构，反向匹配要重建嵌套树，复杂度高、收益低。
 */
function makeMatcher(def, targetId) {
  const tpl = templateFor(def.id, targetId);
  if (!tpl) return null;
  if (tpl.includes('%body')) return null;
  if (tpl.includes('\n')) return null;

  const { source, names } = templateToRegex(tpl);
  const byName = new Map();
  for (const inp of def.inputs || []) byName.set(inp.name, inp);

  let re;
  try {
    re = new RegExp(`^\\s*${source}\\s*;?\\s*$`);
  } catch {
    return null;
  }
  return { def, re, names, byName };
}

/** 缓存匹配器 */
const matcherCache = new Map();
function matchers(targetId) {
  if (matcherCache.has(targetId)) return matcherCache.get(targetId);
  const list = [];
  for (const def of allBlocks()) {
    if (def.shape !== 'stack') continue;
    const m = makeMatcher(def, targetId);
    if (m) list.push(m);
  }
  // 长模板优先匹配（更具体的先试）。
  // ⚠️ 「原始代码」积木的模板是 %code，能匹配任何一行 ——
  //    必须放最后，否则所有行都会被它吃掉。
  list.sort((a, b) => {
    const ai = a.def.id === 'raw.java' ? 1 : 0;
    const bi = b.def.id === 'raw.java' ? 1 : 0;
    if (ai !== bi) return ai - bi;
    return String(b.def.java[targetId]?.length || 0).length
      - String(a.def.java[targetId]?.length || 0).length;
  });
  matcherCache.set(targetId, list);
  return list;
}

/** 清缓存（装了新库之后要调） */
export function clearDecompileCache() {
  matcherCache.clear();
}

/**
 * 从一行代码里反推菜单字段的值。
 * 做法：在模板里找 `"候选1"|"候选2"` 这种形态，匹配上就是那个值。
 */
function guessField(def, targetId, line) {
  const fields = {};
  for (const f of def.fields || []) {
    let value = f.default;
    for (const opt of f.options || []) {
      if (line.includes(`"${opt}"`)) { value = opt; break; }
    }
    fields[f.name] = value;
  }
  return fields;
}

/**
 * 反编译一段 Java。
 *
 * @param {string} code Java 源码片段
 * @param {object} opts
 * @param {string} opts.targetId 目标 id
 * @param {string} [opts.op] 帽形积木 id（决定生成的程序类型）
 * @returns {{ok:boolean, program:object|null, matched:number, unmatched:number, notes:string[]}}
 */
export function decompile(code, opts = {}) {
  const targetId = opts.targetId || 'fabric-26.3';
  const notes = [];
  const lines = String(code || '').split('\n');

  const stmts = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    stmts.push(line);
  }
  if (!stmts.length) {
    return { ok: false, program: null, matched: 0, unmatched: 0, notes: ['没有可解析的代码'] };
  }

  const list = matchers(targetId);
  const blocks = [];
  let matched = 0;
  let unmatched = 0;

  for (const line of stmts) {
    let hit = null;
    for (const m of list) {
      const mm = line.match(m.re);
      if (!mm) continue;

      // 校验捕获组
      const inputs = {};
      let bad = false;
      for (let i = 0; i < m.names.length; i++) {
        const name = m.names[i];
        const inp = m.byName.get(name);
        const raw = (mm[i + 1] || '').trim();
        if (!inp) continue; // 菜单字段
        if (inp.kind === 'number') {
          // Java 数值字面量带后缀（5.0F / 5L / 5.0D），要先剥掉
          const n = Number(String(raw).replace(/[fFdDlL]$/, ''));
          if (!Number.isFinite(n)) { bad = true; break; }
          inputs[name] = { type: 'value', kind: 'number', value: n };
        } else if (inp.kind === 'boolean') {
          inputs[name] = { type: 'value', kind: 'boolean', value: raw === 'true' };
        } else {
          let t = raw;
          if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
            t = t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
          inputs[name] = { type: 'value', kind: inp.kind || 'text', value: t };
        }
      }
      if (bad) continue;
      hit = { op: m.def.id, inputs, fields: guessField(m.def, targetId, line) };
      break;
    }

    if (hit) {
      // 「原始代码」是兜底，不算真正认出来
      if (hit.op === 'raw.java') unmatched++;
      else matched++;
      blocks.push(hit);
    } else {
      unmatched++;
      // 兜底：原始代码积木，一行都不丢
      blocks.push({
        op: 'raw.java',
        inputs: { code: { type: 'value', kind: 'text', value: line } },
      });
    }
  }

  // 串成语句链
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = blocks[i + 1];
  if (blocks.length) blocks[blocks.length - 1].next = null;

  const hatOp = opts.op || 'event.player_rightclick_block';
  const program = { op: hatOp, inputs: {}, fields: {}, body: [], next: null };
  if (blocks.length) program.next = blocks[0];

  if (unmatched) {
    notes.push(`${unmatched} 行没能匹配到积木，已用「原始代码」积木保留`);
  }

  return { ok: true, program, matched, unmatched, notes };
}

/**
 * 「原始代码」积木的定义 —— 反编译的兜底，也是用户手写代码的入口。
 * 它把任意 Java 语句原样塞进方法体。
 */
export const RAW_JAVA_BLOCK = {
  id: 'raw.java',
  category: 'raw',
  shape: 'stack',
  label: '原始代码：%code',
  icon: '📄',
  description: '直接写入的 Java 代码。反编译时无法识别的语句会变成这个积木，保证代码不丢。',
  inputs: [{ name: 'code', kind: 'text', default: '' }],
  fields: [],
  java: {
    'fabric-26.3': '%code',
    'forge-1.20.1': '%code',
  },
};
