/**
 * 积木 → Java 编译器。
 *
 * 这是整个可视化编程的核心保证：**编译出来的 Java 必须真能过编译**。
 * 所以这里不做任何「猜测」，模板从积木定义来，占位符严格按定义填。
 *
 * 编译流程：
 *   1. 从帽形积木（hat）出发，每个帽生成一个方法
 *   2. 方法体 = 顺着 next 链 + body 递归编译
 *   3. 每个 stack 积木 → 一行（或多行）Java 语句
 *   4. 每个 reporter/boolean 积木 → 一个 Java 表达式
 *
 * 事件方法的参数由「事件签名表」决定（见 SIGNATURES），
 * 因为不同事件的可用变量不一样（右键方块有 state/player，tick 没有）。
 */
import { getBlock, templateFor } from './blocks.mjs';
import { walk } from './model.mjs';
import { getTarget } from '../target/registry.mjs';

/**
 * 事件签名表：帽形积木的 id → 该事件方法的 Java 参数与方法体模板。
 *
 * ⚠️ 所有签名都用 javap 核对过（见 docs/mc-api-reference.md）：
 *   Fabric API 的事件回调参数在 26.3 变过 —— 比如 UseBlockCallback 现在是
 *   interact(Player, Level, InteractionHand, BlockHitResult)。
 *
 * key 是帽形积木的 op。
 *   fabric26 —— Fabric 26.3 的回调参数
 *   forge    —— Forge 1.20.1 的回调参数
 *
 * 设计上两个目标用**同一套基础类型签名**：
 * 目标适配器负责把各自的事件对象拆成这些基础类型再传进来。
 * 这样积木模板（player.xxx / level.xxx）不用为两个目标写两遍，
 * 也保证「同一个积木在两个目标下生成的 Java 结构一致」。
 *
 * 约定：
 *   · player —— 当前玩家，一律是 ServerPlayer（只有服务端玩家才能发消息、
 *     改游戏模式）。没有玩家的事件（server_tick）就没有这个参数。
 *   · level  —— 玩家所在的世界。server_tick 用主世界代替。
 *   积木模板里直接用 player / level 这两个名字，不用管来源。
 */
export const SIGNATURES = {
  'event.player_rightclick_block': {
    fabric26: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.InteractionHand hand, net.minecraft.world.phys.BlockHitResult hit',
    forge: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.InteractionHand hand, net.minecraft.world.phys.BlockHitResult hit',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
  'event.entity_attack': {
    fabric26: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.entity.Entity target',
    forge: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.entity.Entity target',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
  'event.player_tick': {
    fabric26: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level',
    forge: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
  'event.server_tick': {
    fabric26: 'net.minecraft.world.level.Level level',
    forge: 'net.minecraft.world.level.Level level',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
  'event.block_break': {
    fabric26: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState state',
    forge: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState state',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
  'event.item_use': {
    fabric26: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.InteractionHand hand',
    forge: 'net.minecraft.server.level.ServerPlayer player, net.minecraft.world.level.Level level, net.minecraft.world.InteractionHand hand',
    body: 'public static void %method(%{sig}) {\n%body\n}',
  },
};

/** 帽形积木对应的方法名前缀 */
export const METHOD_PREFIX = {
  'event.player_rightclick_block': 'on_player_rightclick_block',
  'event.entity_attack': 'on_entity_attack',
  'event.player_tick': 'on_player_tick',
  'event.server_tick': 'on_server_tick',
  'event.block_break': 'on_block_break',
  'event.item_use': 'on_item_use',
};

/** Java 字符串字面量转义 */
export function javaStr(s) {
  return `"${String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/** Java 数值字面量 */
function javaNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : `${n}F`;
}

/** Java 布尔字面量 */
function javaBool(v) {
  return v ? 'true' : 'false';
}

/**
 * 编译单个积木的值（reporter / boolean）。
 * @returns {string} Java 表达式
 */
export function compileValue(b, ctx) {
  if (!b) return ctx?.defaultExpr || 'null';

  // 纯值
  if (!b.op) {
    switch (b.kind) {
      case 'number': return javaNum(b.value);
      case 'boolean': return javaBool(b.value);
      case 'text': return javaStr(b.value);
      case 'menu': return javaStr(b.value);
      case 'json': return javaStr(b.value);
      default: return javaStr(b.value);
    }
  }

  const def = getBlock(b.op);
  if (!def) {
    ctx.warnings.push(`未知积木「${b.op}」，按 null 处理`);
    return 'null';
  }
  const tpl = templateFor(b.op, ctx.targetId);
  if (!tpl) {
    ctx.warnings.push(`积木「${def.label || b.op}」在目标 ${ctx.targetId} 下没有实现`);
    return 'null';
  }
  if (def.shape === 'boolean') {
    // 布尔积木在表达式位置：模板里通常自带括号，这里不再额外包一层，
    // 否则会出现 if (((a < b))) 这种三层括号。
    return fillTemplate(tpl, b, ctx, true);
  }
  return fillTemplate(tpl, b, ctx, true);
}

/**
 * 编译单个语句积木（stack）。
 * @returns {string} Java 语句（可能多行）
 */
export function compileStatement(b, ctx) {
  if (!b) return '';
  if (!b.op) return '';

  const def = getBlock(b.op);
  if (!def) {
    ctx.warnings.push(`未知积木「${b.op}」，已跳过`);
    return '';
  }
  const tpl = templateFor(b.op, ctx.targetId);
  if (!tpl) {
    ctx.warnings.push(`积木「${def.label || b.op}」在目标 ${ctx.targetId} 下没有实现，已跳过`);
    return '';
  }
  return fillTemplate(tpl, b, ctx, false);
}

/**
 * 填模板。
 * @param {string} tpl 模板
 * @param {object} b 积木
 * @param {object} ctx 编译上下文
 * @param {boolean} exprMode 值模式（不生成换行）
 */
function fillTemplate(tpl, b, ctx, exprMode) {
  let out = String(tpl);
  const def = getBlock(b.op) || { inputs: [] };

  // 菜单字段：%field 或 %{field} 形式
  // 同样按名字长度降序，避免 %mode 命中 %modifier。
  // ⚠️ 字段没设值时要用定义里的默认值 —— 界面上新建的积木往往没填字段。
  const fieldDefs = new Map((def.fields || []).map((f) => [f.name, f]));
  const fieldNames = new Set([
    ...Object.keys(b.fields || {}),
    ...fieldDefs.keys(),
  ]);
  const fieldEntries = [...fieldNames]
    .map((fname) => [fname, b.fields?.[fname] !== undefined ? b.fields[fname] : fieldDefs.get(fname)?.default])
    .filter(([, v]) => v !== undefined && v !== null)
    .sort((x, y) => String(y[0]).length - String(x[0]).length);
  for (const [fname, fval] of fieldEntries) {
    // 字段的呈现方式由定义里的标志决定：
    //   raw:true   —— 裸输出（运算符、枚举常量）
    //   string:true —— 一定是字符串字面量（带引号）
    //   都没写     —— 语句位置带引号，表达式位置看内容（标识符裸输出）
    const literal = fieldLiteralFor(fval, fieldDefs.get(fname), exprMode);
    out = out.split(`%{${fname}}`).join(literal);
    // 用函数形式替换：literal 里可能有 $，字符串形式会被当成替换模式引用
    out = out.replace(new RegExp(`%${fname}\\b`, 'g'), () => literal);
  }

  // 参数槽
  // ⚠️ 必须按参数名长度降序替换：否则 %a 会先命中 %amount 的前缀，
  //    把 "amount" 变成 "mount1" 这种垃圾。
  const inputs = def.inputs || [];
  const sorted = [...inputs].sort((x, y) => String(y.name).length - String(x.name).length);
  for (const inp of sorted) {
    const slot = b.inputs?.[inp.name];
    let literal;
    if (slot && slot.op) {
      literal = compileValue(slot, ctx);
    } else if (slot && slot.type === 'value') {
      // 纯值槽：kind 决定怎么转成字面量
      literal = literalOf(slot, inp);
    } else {
      literal = literalOf({ kind: inp.kind, value: inp.default }, inp);
    }
    // 带花括号的形式先替（更明确），再替裸形式
    out = out.split(`%{${inp.name}}`).join(literal);
    out = out.replace(new RegExp(`%${inp.name}\\b`, 'g'), () => literal);
  }

  // body（容器型积木的子积木）
  // 支持多个 body 槽：bodySlots 列出用了哪几个，默认只有 body。
  const bodySlots = def.bodySlots && def.bodySlots.length ? def.bodySlots : ['body'];
  for (const slotName of bodySlots) {
    const marker = `%${slotName}`;
    if (!out.includes(marker)) continue;
    const src = slotName === 'body' ? b.body : b[slotName];
    const inner = compileSequence(src, ctx);
    // ⚠️ 子积木永远比当前语句深一级（4 空格）。
    //    模板里 %body 标记出现在哪一行，子积木就从那一行的位置往下缩进，
    //    这样多层嵌套的相对缩进自然是对的（Scratch 的 C 型槽就是这个道理）。
    const indented = inner ? indent(inner, 1) : '';
    // ⚠️ 必须用函数形式替换：字符串里有 $ 时会被当成替换模式引用（$& 等）。
    out = out.replace(new RegExp(`%${slotName}\\b`, 'g'), () => indented);
  }

  // 换行处理：值模式压成一行
  if (exprMode) {
    out = out.replace(/\s*\n\s*/g, ' ').trim();
  }
  return out;
}

/** 参数槽的默认值转字面量 */
function literalOf(slot, inp) {
  switch (slot.kind) {
    case 'number': return javaNum(slot.value ?? inp?.default);
    case 'boolean': return javaBool(slot.value ?? inp?.default);
    default: return javaStr(slot.value ?? inp?.default ?? '');
  }
}

/** 菜单字段转字面量 */
function fieldLiteral(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return javaNum(v);
  return javaStr(v);
}

/**
 * 菜单字段转字面量。
 *
 * @param {*} v 字段值
 * @param {object} [fdef] 字段定义（看 raw / string 标志）
 * @param {boolean} [exprMode] 是否在表达式位置
 */
function fieldLiteralFor(v, fdef, exprMode) {
  // 菜单选项可以是 { value, label } —— 界面上显示 label，代码里用 value
  if (v && typeof v === 'object' && 'value' in v) v = v.value;
  if (fdef?.raw === true) return fieldLiteralRaw(v);
  if (fdef?.string === true) return javaStr(v);
  return exprMode ? fieldLiteralExpr(v) : fieldLiteral(v);
}

/** 裸字面量：运算符、枚举常量这类不能加引号的东西 */
function fieldLiteralRaw(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return javaNum(v);
  const s = String(v);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) return s;
  if (/^[<>=!&|+\-*/%^]+$/.test(s)) return s;
  return javaStr(s);
}

/**
 * 菜单字段用在**表达式**位置时不能加引号。
 *
 * 例：比较积木的模板是 `(%a %op %b)`，op 的值是 `<`，
 * 加引号会变成 `10 "<" 5` —— 编译不过。
 *
 * 判断依据：菜单的选项里如果有「看起来像运算符 / 标识符」的，
 * 就按裸字面量输出；否则（中文选项）保持引号。
 */
function fieldLiteralExpr(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return javaNum(v);
  const s = String(v);
  // 纯 ASCII 且含运算符特征 → 裸输出
  if (/^[<>=!&|+\-*/%^]+$/.test(s)) return s;
  // 是合法的 Java 标识符 → 裸输出（枚举常量之类）
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) return s;
  return javaStr(s);
}

/**
 * 编译一个语句序列（body 槽里的子积木）。
 *
 * ⚠️ 序列有两种表示方式，界面上两种都会出现，必须都支持：
 *   · 数组本身就是一个序列（每个元素独立）—— 界面上往 body 里拖积木就是这个形态
 *   · 数组第一个元素的 next 链继续往下接 —— 反编译器产出的就是这个形态
 *
 * 只按数组编译会丢掉 next 链上的积木（曾经真的丢过一次：
 * body 里放了「治疗」+「说话」，生成的 Java 只有治疗）。
 *
 * @param {object[]|undefined} list
 * @param {object} ctx
 * @returns {string} 多行 Java
 */
function compileSequence(list, ctx) {
  if (!Array.isArray(list) || !list.length) return '';
  const out = [];
  const seen = new Set();
  for (const first of list) {
    if (!first || !first.op) continue;
    // 沿着 next 链一路走下去
    let cur = first;
    let guard = 0;
    while (cur && cur.op && guard++ < 500) {
      if (seen.has(cur)) break;   // 别把同一条链编译两遍
      seen.add(cur);
      const stmt = compileStatement(cur, ctx);
      if (stmt) out.push(stmt);
      cur = cur.next;
    }
  }
  return out.join('\n');
}

/** 缩进 */
export function indent(text, level) {
  const pad = '    '.repeat(Math.max(0, level));
  return String(text)
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/**
 * 编译一段程序。
 *
 * @param {object} program 根积木（帽形）
 * @param {object} opts
 * @param {string} opts.targetId 目标 id（如 fabric-26.3）
 * @param {string} [opts.className] 生成的类名
 * @param {string} [opts.pkg] 包名
 * @returns {{ok:boolean, code:string, methods:string[], warnings:string[], errors:string[]}}
 */
export function compileProgram(program, opts = {}) {
  const ctx = {
    targetId: opts.targetId || 'fabric-26.3',
    warnings: [],
    errors: [],
    tempCounter: 0,
  };

  if (!program || !program.op) {
    return { ok: false, code: '', methods: [], warnings: ctx.warnings, errors: ['程序为空'] };
  }

  const def = getBlock(program.op);
  if (!def) {
    return { ok: false, code: '', methods: [], warnings: ctx.warnings, errors: [`未知积木「${program.op}」`] };
  }
  if (def.shape !== 'hat') {
    return { ok: false, code: '', methods: [], warnings: ctx.warnings, errors: ['程序必须以帽形积木（事件）开头'] };
  }

  const sig = SIGNATURES[program.op];
  if (!sig) {
    return { ok: false, code: '', methods: [], warnings: ctx.warnings, errors: [`事件「${program.op}」没有签名定义`] };
  }

  // 编译 body
  // ⚠️ 程序根是帽形积木，帽形本身没有 java 模板（它的签名在 SIGNATURES 里）。
  //    它的 next 链才是语句序列 —— 所以语句链从 program.next 开始走，
  //    否则每次编译都会多出一条「帽形积木没有实现」的假警告。
  const bodyLines = [];
  let cur = program.next;
  let guard = 0;
  while (cur && cur.op && guard++ < 500) {
    const stmt = compileStatement(cur, ctx);
    if (stmt) bodyLines.push(stmt);
    cur = cur.next;
  }
  if (guard >= 500) ctx.warnings.push('语句链过长（可能有环），已截断');

  const methodName = opts.methodName || `${METHOD_PREFIX[program.op] || 'program'}`;
  const sigText = pickSignature(sig, ctx.targetId);
  const body = bodyLines.length ? indent(bodyLines.join('\n'), 1) : '        // （空程序）';

  const method = sig.body
    .replace('%method', methodName)
    .replace('%{sig}', sigText)
    .replace('%body', body);

  const pkg = opts.pkg || 'com.example.mymod';
  const className = opts.className || 'ModLogic';
  const imports = collectImports(ctx);

  const code = [
    `package ${pkg}.custom;`,
    '',
    ...(imports.length ? imports.map((i) => `import ${i};`) : []),
    ...(imports.length ? [''] : []),
    `/**`,
    ` * 由 MC Studio 可视化积木生成的逻辑。`,
    ` *`,
    ` * <p>这个文件是「生成区」，重新生成会覆盖；`,
    ` * 想手写代码请改同目录下的其它类，或把积木拆成多个程序。`,
    ` */`,
    `public final class ${className} {`,
    indent(method, 1),
    '',
    `    private ${className}() {`,
    `    }`,
    `}`,
  ].join('\n');

  return {
    ok: ctx.errors.length === 0,
    code,
    // 方法片段（不含外层类），供工程级编译拼装用
    methodCode: method,
    methods: [{ name: methodName, event: program.op, signature: sigText }],
    warnings: ctx.warnings,
    errors: ctx.errors,
  };
}

/**
 * 按目标挑事件签名。
 *
 * ⚠️ 以前靠 `targetId.startsWith('forge')` 猜 —— 外部目标叫
 *    `neoforge-1.21.1` 会被当成 Fabric，生成的事件参数全是错的。
 *    现在优先查适配器声明的 platform / signatureKey，只有目标压根没登记
 *    才退回字符串猜测（保证老数据仍能编）。
 */
function pickSignature(sig, targetId) {
  // 1. 签名表里针对这个目标单独写了一份，最精确
  if (sig[targetId]) return sig[targetId];

  let adapter = null;
  try { adapter = getTarget(targetId); } catch { /* 未登记的目标走兜底 */ }
  if (adapter?.signatureKey && sig[adapter.signatureKey]) return sig[adapter.signatureKey];

  const platform = String(adapter?.platform || '').toLowerCase();
  const byPlatform = platform === 'forge' || platform === 'neoforge' ? 'forge'
    : platform === 'fabric' ? 'fabric26'
      : '';
  if (byPlatform && sig[byPlatform]) return sig[byPlatform];

  // 2. 兜底：跟老版本完全一致的行为
  const prefix = String(targetId).startsWith('forge') ? 'forge' : 'fabric26';
  return sig[prefix] ?? sig.fabric26 ?? '';
}

/** 收集用到的 import */
function collectImports(ctx) {
  const set = new Set();
  for (const w of ctx.imports || []) set.add(w);
  return [...set].sort();
}

/**
 * 编译一个工程里的所有积木程序。
 * @param {object} project 工程数据
 * @param {object} opts
 * @returns {{ok:boolean, files:object[], warnings:string[], errors:string[]}}
 */
export function compileProject(project, opts = {}) {
  const programs = project?.visual?.programs || [];
  const targetId = opts.targetId || project?.target?.id || 'fabric-26.3';
  const pkg = opts.pkg || project?.meta?.pkg || 'com.example.mymod';

  const methods = [];
  const warnings = [];
  const errors = [];
  // 方法名去重：同一个事件写了两段程序，默认方法名会撞车
  // （Java 不允许同名方法，编译会失败）。
  const usedNames = new Set();

  programs.forEach((prog) => {
    const baseName = prog.methodName || METHOD_PREFIX[prog.op] || 'program';
    let name = baseName;
    if (usedNames.has(name)) {
      let k = 2;
      while (usedNames.has(`${baseName}_${k}`)) k++;
      name = `${baseName}_${k}`;
    }
    usedNames.add(name);

    const r = compileProgram(prog, {
      targetId,
      pkg,
      methodName: name,
      className: 'ModLogic',
    });
    warnings.push(...r.warnings);
    errors.push(...r.errors);
    if (!r.ok) return;
    methods.push({ program: prog, method: r.methods[0], methodCode: r.methodCode });
  });

  // 合成一个文件
  const className = 'ModLogic';
  const allImports = new Set();
  for (const m of methods) {
    for (const line of (m.methodCode || '').split('\n')) {
      const mm = /^import (.+);$/.exec(line);
      if (mm) allImports.add(mm[1]);
    }
  }

  const bodies = methods.map((m) => indent(m.methodCode || '', 1));

  const file = [
    `package ${pkg}.custom;`,
    '',
    ...[...allImports].sort().map((i) => `import ${i};`),
    ...(allImports.size ? [''] : []),
    `/**`,
    ` * 由 MC Studio 可视化积木生成的逻辑。`,
    ` *`,
    ` * <p>这是「生成区」：重新生成会覆盖这一段。`,
    ` * 想保留手写代码，请写到别的类里，或把逻辑拆成多个积木程序。`,
    ` */`,
    `public final class ${className} {`,
    `    /** 积木变量表：名字 → 数值 */`,
    `    private static final java.util.Map<String, Double> VARS = new java.util.concurrent.ConcurrentHashMap<>();`,
    '',
    // ⚠️ 不能写成 ...bodies.join(...)：字符串被展开会逐字符拆开。
    ...(bodies.length ? [bodies.join('\n\n')] : ['    // 还没有积木程序']),
    '',
    `    private ${className}() {`,
    `    }`,
    `}`,
  ].join('\n');

  return {
    ok: errors.length === 0,
    files: methods.length ? [{ path: `src/main/java/${pkg.replace(/\./g, '/')}/custom/ModLogic.java`, content: file }] : [],
    // 编译成功的程序清单：事件 id + 实际方法名。
    // 目标适配器用它来生成事件接线（接线必须调到正确的方法名）。
    compiled: methods.map((m) => ({
      op: m.program.op,
      methodName: m.method.name,
      program: m.program,
    })),
    warnings,
    errors,
  };
}
