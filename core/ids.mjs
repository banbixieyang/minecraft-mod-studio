/**
 * 标识符工具 —— 所有命名转换的唯一真源。
 * 模块与适配器都应该用这里的函数，保证全工程命名风格一致。
 */

/** 合法标识符：小写字母开头，仅含小写字母 / 数字 / 下划线，2-48 字符 */
export function isValidId(s) {
  return typeof s === 'string' && /^[a-z][a-z0-9_]{1,47}$/.test(s);
}

/** Minecraft 保留名，占用了会在注册时冲突或语义错乱 */
const RESERVED = new Set([
  'minecraft', 'air', 'item', 'block', 'entity', 'player', 'level', 'world',
  'server', 'client', 'null', 'true', 'false', 'class', 'interface', 'enum',
  'public', 'private', 'static', 'void', 'int', 'new', 'this', 'super', 'package',
]);

export function isReserved(s) {
  return RESERVED.has(s);
}

/** 校验并给出人类可读的错误原因，通过返回 null */
export function validateId(s) {
  if (!s) return '标识符不能为空';
  if (!/^[a-z]/.test(s)) return '标识符必须以小写字母开头';
  if (!/^[a-z0-9_]+$/.test(s)) return '只允许小写字母、数字、下划线';
  if (s.length < 2) return '至少 2 个字符';
  if (s.length > 48) return '最多 48 个字符';
  if (isReserved(s)) return `"${s}" 是保留字，请换一个`;
  return null;
}

/** snake_case → PascalCase */
export function toPascal(s) {
  return String(s)
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/** snake_case → camelCase */
export function toCamel(s) {
  const p = toPascal(s);
  return p ? p[0].toLowerCase() + p.slice(1) : '';
}

/** snake_case → UPPER_SNAKE */
export function toConstant(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** 由标识符推出一个可读的英文名，用于自动填充 */
export function toDisplay(s) {
  return String(s)
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * 生成在给定集合中不冲突的标识符。
 * 已有 ruby_ore 时，下一个是 ruby_ore_2。
 */
export function uniqueId(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Java 字符串字面量转义 */
export function javaStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/** 把用户输入的一串名字拆成数组（支持换行 / 逗号 / 顿号） */
export function splitList(s) {
  if (Array.isArray(s)) return s;
  return String(s || '')
    .split(/[\n,，、;；]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
