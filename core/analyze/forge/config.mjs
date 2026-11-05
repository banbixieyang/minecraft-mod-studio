/**
 * Forge 配置（ForgeConfigSpec）数值的通用提取器。
 *
 * 为什么抽出来：Goety 基础库、Goety Delight 这类 mod 都用同一套 Forge 配置机制，
 * 数值都写在各自 Config 类的 <clinit> 里，形如：
 *
 *   BUILDER.push("cake");
 *   BUILDER.comment("Effect radius for the cake item\n皇家蛋糕的效果半径");
 *   BUILDER.defineInRange("cakeEffectRadius", 32, 1, 256);
 *   CAKE_EFFECT_RADIUS = BUILDER.get();          // ← putstatic 是锚点
 *
 * 只要把字节码的常量流按「说明 / 路径 / 默认值 / 最小 / 最大」配对出来，
 * 就得到一张完整、可改、带取值范围的数值表 —— 也就是「各种效果」的真正数值所在。
 *
 * 这个模块与具体 mod 无关，任何用 ForgeConfigSpec 的 mod 都能用。
 */
import { parseClass } from '../classfile.mjs';

/** 配置路径的命名风格：lowerCamelCase 标识符 */
const PATH_RE = /^[a-z][A-Za-z0-9]*$/;

/** 读一个类，失败就返回 null（别人的包可能类结构不一样） */
export function readClass(src, path) {
  try {
    if (!src.has(path)) return null;
    const c = parseClass(src.read(path));
    return c && c.ok ? c : null;
  } catch {
    return null;
  }
}

/**
 * 提取一个 Forge 配置类的全部数值条目。
 *
 * 返回 [{ id(路径), group(配置类名), sections(分组层级), field(静态字段名),
 *         comment(说明), value(默认值), min, max }]
 */
export function extractConfigEntries(src, classPath) {
  const c = readClass(src, classPath);
  if (!c) return [];
  const clinit = c.methods.find((m) => m.name === '<clinit>');
  if (!clinit || !clinit.consts || !clinit.consts.seq) return [];
  const seq = clinit.consts.seq;
  const group = classPath.split('/').pop().replace(/\.class$/, '');
  const out = [];

  // ---- 先走一遍，维护分组栈（Forge 的 push/pop 决定 TOML 层级）----
  const groupAt = new Map(); // seq 下标 → 当时的分组路径
  const stack = [];
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    if (s.kind === 'call') {
      if (s.name === 'push' && typeof s.args[0] === 'string') stack.push(s.args[0]);
      else if (s.name === 'pop') stack.pop();
      groupAt.set(i, [...stack]);
    } else if (s.kind === 'put') {
      groupAt.set(i, [...stack]);
    }
  }

  /** 从下标 j 往回找，跳过 call / get 标记（它们不是配置数据） */
  const prevIdx = (j) => {
    let k = j - 1;
    while (k >= 0 && (seq[k].kind === 'call' || seq[k].kind === 'get')) k--;
    return k;
  };

  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    if (s.kind !== 'put') continue;

    // 往回收集紧挨着的数值：默认 / 最小 / 最大
    const nums = [];
    let j = prevIdx(i);
    while (j >= 0 && seq[j].kind === 'num' && nums.length < 3) { nums.unshift(seq[j].value); j = prevIdx(j); }
    if (!nums.length) continue;

    // 再往回一个应该是配置路径
    if (j < 0 || seq[j].kind !== 'str') continue;
    let path = seq[j].value;
    let defaultValue = nums[0];
    let min = nums[1];
    let max = nums[2];

    if (!PATH_RE.test(path)) {
      // 默认值本身是字符串：路径再往前一个
      const jj = prevIdx(j);
      if (jj >= 0 && seq[jj].kind === 'str' && PATH_RE.test(seq[jj].value)) {
        defaultValue = seq[j].value;
        path = seq[jj].value;
        j = jj;
      } else {
        continue;
      }
    }

    const jc = prevIdx(j);
    const comment = jc >= 0 && seq[jc].kind === 'str' ? seq[jc].value : '';
    out.push({
      id: path,
      group,
      sections: groupAt.get(i) || [], // TOML 层级，如 ['Spells', 'Vexing Spell']
      field: s.name,
      comment,
      value: defaultValue,
      min: min === undefined ? null : min,
      max: max === undefined ? null : max,
    });
  }
  return out;
}

/**
 * 从主类的构造器里读出「配置类 ↔ 配置文件」的对应关系。
 *
 * 注册代码长这样：
 *   ModLoadingContext.get().registerConfig(Type.COMMON, SpellConfig.SPEC, "goety/goety-spells.toml");
 * 路径里的 "goety/" 是相对 config 目录的子目录，改配置时要按这个落盘。
 *
 * @param mainClassPath 主类在 jar 里的路径
 * @param tomlFilter    只认路径里含这个片段的注册（可选，用于区分多个 mod 的注册）
 */
export function extractConfigFiles(src, mainClassPath, tomlFilter = '.toml') {
  const out = new Map(); // 配置文件路径 → { file, dir, path }
  const cls = readClass(src, mainClassPath);
  if (!cls) return out;

  for (const m of cls.methods || []) {
    const calls = m.consts?.calls || [];
    const regs = calls.filter((x) => x.name === 'registerConfig');
    if (!regs.length) continue;
    // registerConfig 的第三个参数就是配置文件路径。
    // 注意参数里可能残留上一个 toml 字符串（常量池里 ldc 过的都算进来），
    // 所以要取**最后一个** .toml —— 那才是这次真正注册的。
    for (const r of regs) {
      const tomls = r.args.filter((a) => typeof a === 'string' && a.includes(tomlFilter));
      const p = tomls[tomls.length - 1];
      if (!p) continue;
      const slash = p.lastIndexOf('/');
      out.set(p, { file: slash >= 0 ? p.slice(slash + 1) : p, dir: slash >= 0 ? p.slice(0, slash) : '' });
    }
  }
  return out;
}

/**
 * 配置文件 ↔ 配置类的对应关系。
 *
 * registerConfig 调用前的那个 getstatic XxxConfig.SPEC 就是对应的配置类。
 * 用字节码里的先后顺序配对（registerConfig 与 getstatic 严格交替出现），
 * 这样每个配置类都知道自己的数值该写到哪个 toml 文件里去。
 */
export function extractConfigClassFiles(src, mainClassPath) {
  const out = new Map(); // 配置类名 → { file, dir, path }
  const files = extractConfigFiles(src, mainClassPath);
  if (!files.size) return out;

  const cls = readClass(src, mainClassPath);
  if (!cls) return out;

  for (const m of cls.methods || []) {
    const seq = m.consts?.seq || [];
    if (!seq.length) continue;

    let pending = null; // 还没配上文件的 getstatic
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      if (s.kind === 'get') {
        // 只认「某个 Config 类的 SPEC 静态字段」
        if (!/SPEC$/.test(s.name || '')) continue;
        const cn = (s.cls || '').split('/').pop();
        if (!cn || !/Config$/.test(cn)) continue;
        pending = cn;
        continue;
      }
      if (s.kind !== 'call' || s.name !== 'registerConfig') continue;
      if (!pending) continue;
      const tomls = s.args.filter((a) => typeof a === 'string' && a.includes('.toml'));
      const p = tomls[tomls.length - 1];
      if (!p) continue;
      const slash = p.lastIndexOf('/');
      out.set(pending, {
        file: slash >= 0 ? p.slice(slash + 1) : p,
        dir: slash >= 0 ? p.slice(0, slash) : '',
        path: p,
      });
      pending = null;
    }
  }
  return out;
}

/** 包条目的 id 规则：小写字母开头，只含小写字母/数字/下划线，长度 2~48。 */
export function safeId(s) {
  let id = String(s).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  id = id.replace(/^[^a-z]+/, '');
  if (!id) id = 'x';
  if (id.length > 48) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    id = `${id.slice(0, 41)}_${h.toString(36).slice(0, 6)}`;
  }
  return id;
}
