/**
 * 钩子代码的静态检查与落点预览。
 *
 * 为什么单独一个文件：AI 给的代码要经过「预览 → 人确认 → 才落盘」。
 * 检查规则必须是服务端说了算，界面只是把它显示出来；放在 core/ 下也方便单测直接调，
 * 不必起 HTTP 服务。
 *
 * 这里只做「人一眼能判断」的检查，不假装自己是编译器。
 * 真正的语法/类型错误由「生成 → 构建 jar」暴露，那一步本来就在工作流里。
 */
import { ANCHORS } from './hooks.mjs';

export const MAX_CODE_CHARS = 20000;
export const MAX_CODE_LINES = 300;

/** 这些写法一旦插进方法体，Java 一定编不过（不是风格问题，是语法错误） */
const ILLEGAL_TOP_LEVEL = [
  { re: /^\s*package\s+[\w.]+/m, why: 'package 声明只能出现在文件开头，钩子是插进方法体里的' },
  { re: /^\s*import\s+[\w.*]+/m, why: '钩子位置加不了 import；改用全限定名，例如 net.minecraft.world.item.ItemStack' },
  { re: /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?class\s+\w+/m, why: '钩子是语句片段，不能声明类' },
  { re: /^\s*@Mod\b/m, why: '@Mod 是主类注解，不该出现在钩子里' },
  { re: /\/\/ @hook:/m, why: '代码里不能再写 @hook: 锚点，会把生成器锚点弄乱' },
];

/** 这些是「能编译，但会动到本机」的写法。AI 生成的内容一律硬拦，没有商量余地 */
const UNSAFE_CALLS = [
  { re: /Runtime\.getRuntime\s*\(\s*\)\s*\.exec/m, why: '会执行外部命令' },
  { re: /\bProcessBuilder\b/m, why: '会启动外部进程' },
  { re: /System\.exit\s*\(/m, why: '会直接结束游戏进程' },
  { re: /\bjava\.nio\.file\.Files\.delete|Files\.deleteIfExists|\.toFile\(\)\.delete\s*\(/m, why: '会删本机文件' },
];

/**
 * 静态检查。
 * @returns {{errors: string[], warnings: string[], lines: number, chars: number}}
 */
export function inspectHookCode(code, project = {}) {
  const text = String(code || '').replace(/\r\n/g, '\n');
  const errors = [];
  const warnings = [];
  const lines = text.split('\n').length;

  if (!text.trim()) errors.push('代码是空的');
  if (text.length > MAX_CODE_CHARS) errors.push(`代码超过 ${MAX_CODE_CHARS} 字符，先精简一下`);
  if (lines > MAX_CODE_LINES) errors.push(`代码超过 ${MAX_CODE_LINES} 行，钩子不适合放这么长的实现，建议拆到手写区`);

  for (const r of ILLEGAL_TOP_LEVEL) if (r.re.test(text)) errors.push(r.why);
  for (const r of UNSAFE_CALLS) if (r.re.test(text)) errors.push(`拒绝安装：${r.why}`);

  // 大括号不平衡：不必拒绝（可能只是字符串里有括号），但预览里值得提一句
  const opens = (text.match(/{/g) || []).length;
  const closes = (text.match(/}/g) || []).length;
  if (text.trim() && opens !== closes) {
    warnings.push(`大括号数量不等（{ ${opens} / } ${closes}）。如果代码里没有字符串包含括号，多半是复制时截断了`);
  }

  // 平台不匹配：知识库的 26.3 任务卡被装进 Forge 工程时最常见的翻车方式。
  // 检的是「对方平台」的包名 —— Fabric 工程里出现 net.minecraftforge 才可疑。
  const platform = String(project?.target?.platform || '').toLowerCase();
  const alien =
    platform === 'fabric' ? { re: /net\.minecraftforge\b/, name: 'Forge' }
      : platform === 'forge' ? { re: /net\.fabricmc\b/, name: 'Fabric' }
        : null;
  if (alien && alien.re.test(text)) {
    warnings.push(`这段代码引用了 ${alien.name} 的类，而当前工程是 ${platform}；生成后大概率编译不过`);
  }
  if (platform && platform !== 'fabric' && /\b(?:Identifier|ResourceKey|Component\.literal|BuiltInRegistries)\b/.test(text)) {
    warnings.push('代码里出现了 26.x Fabric 常见的类名；当前工程不是 Fabric 26.3，请确认这些 API 在该版本存在');
  }

  return { errors, warnings, lines, chars: text.length };
}

/** 锚点是否合法 */
export function validAnchor(target) {
  return ANCHORS.some((a) => a.id === target);
}

/**
 * 在生成文件清单里找锚点落点。返回插入前后的真实片段 —— 预览必须是真的，
 * 不能靠「大概会插到 Main.java」这种猜法。
 * @param {Array<{path:string,content:string}>} files preview() 的结果
 */
export function findAnchorPreview(files, target, code) {
  const anchor = `// @hook:${target}`;
  const file = (files || []).find((f) => /\.java$/.test(f.path) && String(f.content).includes(anchor));
  if (!file) {
    return { file: '', found: false, context: '', injected: '', anchor };
  }

  const src = String(file.content).replace(/\r\n/g, '\n');
  const at = src.indexOf(anchor);
  const lineNo = src.slice(0, at).split('\n').length;
  const srcLines = src.split('\n');
  const from = Math.max(0, lineNo - 5);
  const context = srcLines.slice(from, lineNo + 3).join('\n');

  const indent = '    ';
  const body = String(code || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? indent + line : ''))
    .join('\n');
  // lineNo 是 1-based，锚点本身在 index lineNo-1；预览里只保留锚点前的几行 + 新代码 + 锚点
  const injected = srcLines
    .slice(Math.max(0, lineNo - 3), lineNo - 1)
    .concat([`    // ---- 自定义代码（钩子：${target}）----`, body, anchor])
    .join('\n');

  return {
    file: file.path,
    found: true,
    lineNo,
    anchor,
    context,
    injected,
  };
}

/** 构造一条将要写进 project.hooks.java 的记录 */
export function makeHookRecord({ code, target, name, source }) {
  const id = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: String(name || '').trim() || `AI 代码 · ${target}`,
    target,
    code: String(code).replace(/\r\n/g, '\n').trimEnd() + '\n',
    enabled: true,
    source: String(source || 'ai').slice(0, 40),
    installedAt: Date.now(),
  };
}

/** 同内容去重：反复点「装成钩子」不该把工程塞满同一段代码 */
export function isDuplicate(project, code) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const want = norm(code);
  return (project?.hooks?.java || []).some((h) => norm(h.code) === want);
}
