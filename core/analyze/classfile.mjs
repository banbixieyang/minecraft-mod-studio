/**
 * Java 字节码指令总长度（含操作码本身），按操作码索引。
 * -1 = 非法；0 = 变长（tableswitch/lookupswitch/wide，下面单独处理）。
 * 有了这张表才能安全地线性扫过方法体、只认出真正的 ldc 指令，
 * 否则操作数里的字节会被误当成操作码。
 */
const OPCODE_LEN = (() => {
  const L = new Int8Array(256).fill(1);
  const set = (op, len) => { L[op] = len; };
  for (let op = 0x15; op <= 0x19; op++) set(op, 2); // iload/lload/fload/dload/aload
  for (let op = 0x36; op <= 0x3a; op++) set(op, 2); // istore/lstore/fstore/dstore/astore
  set(0x10, 2); // bipush
  set(0x11, 3); // sipush
  set(0x12, 2); // ldc
  set(0x13, 3); // ldc_w
  set(0x14, 3); // ldc2_w
  set(0x84, 3); // iinc
  for (let op = 0x99; op <= 0xa6; op++) set(op, 3); // if<cond> / if_icmp / if_acmp
  set(0xa7, 3); // goto
  set(0xa8, 3); // jsr
  set(0xa9, 2); // ret
  set(0xaa, 0); // tableswitch
  set(0xab, 0); // lookupswitch
  for (let op = 0xb2; op <= 0xb5; op++) set(op, 3); // get/put static/field
  set(0xb6, 3); // invokevirtual
  set(0xb7, 3); // invokespecial
  set(0xb8, 3); // invokestatic
  set(0xb9, 5); // invokeinterface
  set(0xba, 5); // invokedynamic
  set(0xbb, 3); // new
  set(0xbc, 2); // newarray
  set(0xbd, 3); // anewarray
  set(0xc0, 3); // checkcast
  set(0xc1, 3); // instanceof
  set(0xc4, 0); // wide
  set(0xc5, 4); // multianewarray
  set(0xc6, 3); // ifnull
  set(0xc7, 3); // ifnonnull
  set(0xc8, 5); // goto_w
  set(0xc9, 5); // jsr_w
  return L;
})();

/** 按常量池 tag 取数值：Integer→int、Float→float、Long→number、Double→number */
function constNumber(c) {
  if (!c) return undefined;
  if (c.tag === 3) return c.v;
  if (c.tag === 4) return c.f;
  if (c.tag === 5 || c.tag === 6) return c.v;
  return undefined;
}

/**
 * 扫一遍方法体的字节码，把「这个方法里被压栈的常量」捞出来。
 * 返回 { numbers:[...], strings:[...] }。
 *
 * 为什么要这个：Goety 的法术把灵魂消耗、吟唱时长、冷却时间分别写在
 * defaultSoulCost / defaultCastDuration / defaultSpellCooldown 三个方法里，
 * 光看常量池只能拿到一堆「无主」的数值；按方法切开之后，
 * 每个数字才能对上名字，成为可编辑的字段。
 */
function scanCodeConsts(code, pool, utf8) {
  const numbers = [];
  const strings = [];
  const seq = [];       // 保序常量流：{ kind:'num'|'str'|'put', value } —— 配对参数靠它
  const fieldRefs = []; // getstatic / getfield 引用的字段：{ cls, name, desc, static }
  const methodRefs = [];// invokevirtual / invokestatic 等引用的方法：{ cls, name, desc }
  const calls = [];     // 方法调用（含调用前的字符串参数）：{ cls, name, args:[str] }
  const returns = [];   // return 语句返回的数值：{ value } —— 用来读「这个方法返回什么」
  let p = 0;
  // 上一次调用之后压栈的常量 —— 那正好是这次调用的参数。
  // 用独立的缓冲而不是回看整条流：回看会把上一次调用残留的值也捞进来
  //（比如 push("Spells") 前面还留着 comment 的字符串）。
  let pending = [];
  const pushNum = (v) => { numbers.push(v); seq.push({ kind: 'num', value: v }); pending.push(v); };
  const pushStr = (s) => { strings.push(s); seq.push({ kind: 'str', value: s }); pending.push(s); };

  /**
   * 取这次调用的参数：从 pending 尾部按确切个数取。
   *
   * count 由方法描述符算出来（见 countParams）—— 必须按确切个数取，
   * 否则会把不属于这次调用的值也当成参数，
   * 于是 push("Spells") 被读成 push("别的字符串") —— 分组层级就乱了。
   */
  const takeArgs = (count) => {
    if (count <= 0) return [];
    const args = pending.slice(Math.max(0, pending.length - count));
    pending = [];
    return args;
  };
  while (p < code.length) {
    const op = code[p];
    const len = OPCODE_LEN[op];
    if (len === -1) break;
    if (len === 0) {
      // 变长指令：先按 4 字节对齐跳过填充
      let q = p + 1;
      while (q % 4 !== 0) q++;
      if (op === 0xaa) { // tableswitch
        const low = code.readInt32BE(q + 4);
        const high = code.readInt32BE(q + 8);
        p = q + 12 + (high - low + 1) * 4;
      } else if (op === 0xab) { // lookupswitch
        const npairs = code.readInt32BE(q + 4);
        p = q + 8 + npairs * 8;
      } else if (op === 0xc4) { // wide
        p = code[p + 1] === 0x84 ? p + 6 : p + 4;
      }
      continue;
    }
    if (op === 0x12) { // ldc → 常量池 1 字节索引
      const c = pool[code[p + 1]];
      if (c) {
        const n = constNumber(c);
        if (n !== undefined) pushNum(n);
        else if (c.tag === 8) { const s = utf8[c.str]; if (s) pushStr(s); }
      }
    } else if (op === 0x13 || op === 0x14) { // ldc_w / ldc2_w → 2 字节索引
      const c = pool[code.readUInt16BE(p + 1)];
      if (c) {
        const n = constNumber(c);
        if (n !== undefined) pushNum(n);
        else if (c.tag === 8) { const s = utf8[c.str]; if (s) pushStr(s); }
      }
    } else if (op === 0x10) { // bipush → 直接内联的 int
      pushNum(code.readInt8(p + 1));
    } else if (op === 0x11) { // sipush → 直接内联的 int
      pushNum(code.readInt16BE(p + 1));
    } else if (op >= 0x03 && op <= 0x08) { // iconst_m1 .. iconst_5 → 值就编在操作码里
      pushNum(op - 0x03);
    } else if (op === 0x09 || op === 0x0a) { // lconst_0 / lconst_1
      pushNum(op - 0x09);
    } else if (op >= 0x0b && op <= 0x0d) { // fconst_0 .. fconst_2
      pushNum(op - 0x0b);
    } else if (op === 0x0e || op === 0x0f) { // dconst_0 / dconst_1
      pushNum(op - 0x0e);
    } else if (op === 0xb2 || op === 0xb4) { // getstatic / getfield → 记下引用的字段
      const fr = pool[code.readUInt16BE(p + 1)];
      if (fr && fr.cls != null) {
        const nt = pool[fr.nt];
        if (nt) {
          const ref = {
            cls: utf8[pool[fr.cls]?.name] || '',
            name: utf8[nt.name] || '',
            desc: utf8[nt.desc] || '',
            static: op === 0xb2,
          };
          fieldRefs.push(ref);
          // 也进保序流：要和调用记录交替出现才能配对
          // （比如 registerConfig 前面的 getstatic XxxConfig.SPEC）
          seq.push({ kind: 'get', cls: ref.cls, name: ref.name, desc: ref.desc });
        }
      }
    } else if (op === 0xb3) { // putstatic → 写字段，进保序流
      const fr = pool[code.readUInt16BE(p + 1)];
      if (fr && fr.cls != null) {
        const nt = pool[fr.nt];
        if (nt) {
          seq.push({
            kind: 'put',
            cls: utf8[pool[fr.cls]?.name] || '',
            name: utf8[nt.name] || '',
          });
        }
      }
    } else if (op === 0xb6 || op === 0xb7 || op === 0xb8 || op === 0xb9 || op === 0xba) {
      // invoke* → 记下被调用的方法（owner + 名字）
      // 用途一：判断「这个值能不能在运行时改」——比如配置字段是不是被 ConfigValue.get() 读出来。
      // 用途二：还原 Forge 配置的分组层级 —— BUILDER.push("Spells") 决定了 TOML 里的 [Spells]。
      const mr = pool[code.readUInt16BE(p + 1)];
      if (mr && mr.cls != null) {
        const nt = pool[mr.nt];
        if (nt) {
          methodRefs.push({
            cls: utf8[pool[mr.cls]?.name] || '',
            name: utf8[nt.name] || '',
            desc: utf8[nt.desc] || '',
          });
          // 调用参数：按方法签名取确切个数（Forge 的 push/comment/define 都这样）
          const args = takeArgs(countParams(utf8[nt.desc] || ''));
          calls.push({
            cls: utf8[pool[mr.cls]?.name] || '',
            name: utf8[nt.name] || '',
            desc: utf8[nt.desc] || '',
            args,
          });
          // 也进保序流：Forge 配置的分组层级靠 BUILDER.push("分组") 还原，
          // 必须和后面的 define 保持先后顺序，所以要留在流里。
          seq.push({ kind: 'call', cls: utf8[pool[mr.cls]?.name] || '', name: utf8[nt.name] || '', args });
        }
      }
    } else if (op === 0xac || op === 0xad || op === 0xae || op === 0xaf || op === 0xb0) {
      // return 系列 → 栈顶就是要返回的值。
      // 记下来，扩展就能知道「这个方法返回什么」——
      // 比如附魔的 getMaxLevel() 返回 3，那就是最大等级 3。
      // 取 pending 的最后一个：紧挨着 return 压栈的那个数才是返回值。
      const last = pending[pending.length - 1];
      if (typeof last === 'number') {
        returns.push(last);
        seq.push({ kind: 'ret', value: last });
      }
    }
    p += len;
  }
  return { numbers, strings, seq, fieldRefs, methodRefs, calls, returns };
}

/**
 * 数一个方法描述符有几个参数。
 * 描述符形如 (Ljava/lang/String;II)Lnet/minecraftforge/...$Builder;
 * 对象类型从 L 到 ; 算一个，原始类型（I/J/F/D/Z/B/C/S）各算一个。
 *
 * 为什么需要它：调用前压栈的常量不一定都是参数
 * （比如 push 之前可能还留着别的字符串）。
 * 不知道确切个数就会把不属于这次调用的值也当成参数，
 * 于是 push("Spells") 被读成 push("别的字符串") —— 分组层级就乱了。
 */
function countParams(desc) {
  const s = String(desc || '');
  const open = s.indexOf('(');
  const close = s.indexOf(')');
  if (open < 0 || close < 0 || close < open) return 0;
  const inner = s.slice(open + 1, close);
  let n = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === 'L') {
      while (i < inner.length && inner[i] !== ';') i++;
      n++;
    } else {
      n++;
    }
  }
  return n;
}

/**
 * Java class 文件常量池解析 —— 分析器的「眼睛」。
 *
 * 为什么要自己读 class 而不是直接反编译：
 *  1. 反编译要 JDK + 一个反编译器，装不装得上、跑不跑得快都不由我控制；
 *  2. 分析 mod「用了哪些 API、注册了什么 id、注入到哪个类」这件事，
 *     看常量池就够了 —— 类引用和字符串字面量全是明文躺在里面的。
 *
 * 真正要看方法体逻辑时再上反编译（那是下一步的活），
 * 这一步先把「这个 mod 由什么构成」摸清楚。
 */

const ACC_STATIC = 0x0008;
const ACC_INTERFACE = 0x0200;
const ACC_ANNOTATION = 0x2000;

/** 常量池 tag 名，调试用 */
const TAG_NAMES = {
  1: 'Utf8', 3: 'Integer', 4: 'Float', 5: 'Long', 6: 'Double',
  7: 'Class', 8: 'String', 9: 'Fieldref', 10: 'Methodref', 11: 'InterfaceMethodref',
  12: 'NameAndType', 15: 'MethodHandle', 16: 'MethodType',
  17: 'Dynamic', 18: 'InvokeDynamic', 19: 'Module', 20: 'Package',
};

/**
 * 解析 class 文件。
 * 返回 {
 *   ok, error?, className, simpleName, superName, interfaces,
 *   classes:Set<string>, strings:Set<string>, members:Set<string>,
 *   methods:[{name, desc, access}], fields:[{name, desc, access}],
 *   access, mixinHints:Set<string>
 * }
 */
export function parseClass(buf) {
  try {
    return parseInner(buf);
  } catch (e) {
    return { ok: false, error: e.message, errorStack: e.stack, className: '', classes: new Set(), strings: new Set(), members: new Set(), methods: [], fields: [], interfaces: [] };
  }
}

function parseInner(buf) {
  if (buf.length < 10 || buf.readUInt32BE(0) !== 0xcafebabe) {
    throw new Error('不是 class 文件');
  }
  const major = buf.readUInt16BE(6);
  const cpCount = buf.readUInt16BE(8);
  let p = 10;

  const utf8 = [];
  const pool = [null];
  const numbers = []; // 数值常量：{ tag, value }，扩展用来挖效果/法术的倍率数值

  for (let i = 1; i < cpCount; i++) {
    const tag = buf[p++];
    switch (tag) {
      case 1: {
        const len = buf.readUInt16BE(p);
        p += 2;
        const s = buf.toString('utf8', p, p + len);
        utf8[i] = s;
        pool[i] = { tag, s };
        p += len;
        break;
      }
      case 3:
      case 4: {
        const raw = buf.readInt32BE(p);
        pool[i] = tag === 3 ? { tag, v: raw } : { tag, v: raw, f: buf.readFloatBE(p) };
        numbers.push({ tag, value: tag === 3 ? raw : buf.readFloatBE(p) });
        p += 4;
        break;
      }
      case 5:
      case 6: {
        pool[i] = { tag, v: tag === 5 ? Number(buf.readBigInt64BE(p)) : buf.readDoubleBE(p) };
        numbers.push({ tag, value: pool[i].v });
        p += 8;
        i++; // long/double 占两个槽
        break;
      }
      case 7:
        pool[i] = { tag, name: buf.readUInt16BE(p) };
        p += 2;
        break;
      case 8:
        pool[i] = { tag, str: buf.readUInt16BE(p) };
        p += 2;
        break;
      case 9:
      case 10:
      case 11:
        pool[i] = { tag, cls: buf.readUInt16BE(p), nt: buf.readUInt16BE(p + 2) };
        p += 4;
        break;
      case 12:
        pool[i] = { tag, name: buf.readUInt16BE(p), desc: buf.readUInt16BE(p + 2) };
        p += 4;
        break;
      case 15:
        pool[i] = { tag, kind: buf[p], ref: buf.readUInt16BE(p + 1) };
        p += 3;
        break;
      case 16:
        pool[i] = { tag, desc: buf.readUInt16BE(p) };
        p += 2;
        break;
      case 17:
      case 18:
        pool[i] = { tag, nt: buf.readUInt16BE(p + 2) };
        p += 4;
        break;
      case 19:
      case 20:
        pool[i] = { tag, name: buf.readUInt16BE(p) };
        p += 2;
        break;
      default:
        throw new Error(`未知常量池 tag ${tag}（${TAG_NAMES[tag] || '?'}）`);
    }
  }

  const access = buf.readUInt16BE(p);
  const thisClass = buf.readUInt16BE(p + 2);
  const superClass = buf.readUInt16BE(p + 4);
  p += 6;

  const className = pool[thisClass] ? utf8[pool[thisClass].name] || '' : '';
  const superName = superClass ? utf8[pool[superClass]?.name] || '' : '';

  const ifaceCount = buf.readUInt16BE(p);
  p += 2;
  const interfaces = [];
  for (let i = 0; i < ifaceCount; i++) {
    const idx = buf.readUInt16BE(p);
    p += 2;
    const n = utf8[pool[idx]?.name];
    if (n) interfaces.push(n);
  }

  // 收集引用
  const classes = new Set();
  const strings = new Set();
  const members = new Set();
  for (const c of pool) {
    if (!c) continue;
    if (c.tag === 7) {
      const n = utf8[c.name];
      if (n) classes.add(n);
    } else if (c.tag === 8) {
      const s = utf8[c.str];
      if (s) strings.add(s);
    } else if (c.tag === 12) {
      const n = utf8[c.name];
      if (n) members.add(n);
    }
  }

  // 方法表
  const readMembers = () => {
    const count = buf.readUInt16BE(p);
    p += 2;
    const out = [];
    for (let i = 0; i < count; i++) {
      const acc = buf.readUInt16BE(p);
      const nameIdx = buf.readUInt16BE(p + 2);
      const descIdx = buf.readUInt16BE(p + 4);
      const attrCount = buf.readUInt16BE(p + 6);
      p += 8;
      const attrs = [];
      for (let a = 0; a < attrCount; a++) {
        const attrNameIdx = buf.readUInt16BE(p);
        const attrLen = buf.readUInt32BE(p + 2);
        p += 6;
        attrs.push({ name: utf8[attrNameIdx] || '', info: buf.subarray(p, p + attrLen) });
        p += attrLen;
      }
      const m = { name: utf8[nameIdx] || '', desc: utf8[descIdx] || '', access: acc };
      // 方法体里的常量：按方法切开，扩展才能把数值对上名字
      for (const a of attrs) {
        if (a.name !== 'Code' || a.info.length < 8) continue;
        const codeLen = a.info.readUInt32BE(4);
        const code = a.info.subarray(8, 8 + codeLen);
        m.consts = scanCodeConsts(code, pool, utf8);
        break;
      }
      out.push(m);
    }
    return out;
  };

  const fields = readMembers();
  const methods = readMembers();

  return {
    ok: true,
    version: major - 44,
    access,
    isInterface: !!(access & ACC_INTERFACE),
    isAnnotation: !!(access & ACC_ANNOTATION),
    className,
    simpleName: className.split('/').pop(),
    superName,
    interfaces,
    classes,
    strings,
    members,
    // 全集：注解描述符（Lorg/spongepowered/asm/mixin/injection/Inject;）也在这里面，
    // 认 mixin 用法只能靠它 —— 注解类型不会出现在 Class 常量里
    utf8: new Set(utf8.filter(Boolean)),
    numbers,
    fields,
    methods,
  };
}

/** 默认包名过滤：这些前缀下的类不算「这个 mod 自己的类」 */
const LIB_PREFIXES = [
  'java/', 'javax/', 'jdk/', 'sun/', 'com/sun/',
  'net/minecraft/', 'net/fabricmc/', 'org/spongepowered/',
  'com/mojang/', 'org/slf4j/', 'org/apache/', 'com/google/', 'it/unimi/',
  'org/jetbrains/', 'kotlin/', 'kotlinx/', 'org/intellij/', 'io/netty/',
];

export function isLibraryClass(name) {
  return LIB_PREFIXES.some((p) => name.startsWith(p));
}

/** 把一个类名缩成「好认的短名」，用于展示 */
export function shortClass(name) {
  if (!name) return '';
  const parts = name.split('/');
  return parts[parts.length - 1];
}
