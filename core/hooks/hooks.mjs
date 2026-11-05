/**
 * 代码钩子 —— 扩展性的第二层。
 *
 * 模块注册表解决「加一种新内容类型」；
 * 钩子解决「在不放弃可视化的情况下插自己的代码」。
 *
 * 两种钩子：
 *  1. Java 片段钩子：把一段 Java 代码插进生成文件的锚点里。
 *     锚点在生成的 Java 里以 `// @hook:<名字>` 标记，例如 ModItems 里的 `// @hook:items`。
 *     这样你既能享受生成器维护的注册骨架，又能加生成器还不支持的东西。
 *  2. JS 钩子：在管线阶段调用一个 .mjs 文件，可以读改工程数据、额外产出文件。
 *     适合「批量按规则生成 100 个物品」这类程序化需求。
 *
 * 钩子失败不会中断生成，只会在报告里记一条错误 —— 可视化用户不该被高级功能的报错挡住。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 生成器里可用的锚点清单，界面会用它做下拉选项 */
export const ANCHORS = [
  { id: 'init', label: '主类 onInitialize（初始化逻辑）', file: 'Main.java' },
  { id: 'items', label: '物品注册表（追加物品字段）', file: 'registry/ModItems.java' },
  { id: 'blocks', label: '方块注册表（追加方块字段）', file: 'registry/ModBlocks.java' },
  { id: 'tabs', label: '创造栏（追加显示项）', file: 'registry/ModTabs.java' },
];

/**
 * 把 Java 片段插进锚点。
 * 钩子可以指定 target，也可以不指定（则尝试所有文件里的同名锚点）。
 */
export function applyJavaHooks(p, files) {
  const hooks = (p.hooks?.java || []).filter((h) => h && h.enabled !== false && String(h.code || '').trim());
  if (!hooks.length) return files;

  for (const h of hooks) {
    let applied = false;
    for (const f of files) {
      if (f.binary || typeof f.content !== 'string') continue;
      if (!f.path.endsWith('.java')) continue;
      const anchor = `// @hook:${h.target || 'init'}`;
      if (!f.content.includes(anchor)) continue;
      const indent = '    ';
      const body = String(h.code)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => (line.trim() ? indent + line : ''))
        .join('\n');
      const comment = `    // ---- 自定义代码（钩子：${h.name || h.target || 'init'}）----`;
      f.content = f.content.replace(anchor, `${comment}\n${body}\n${anchor}`);
      applied = true;
      if (h.target) break; // 指定了 target 就只插一个文件
    }
    if (!applied) {
      console.warn(`[hooks] Java 钩子「${h.name || h.target}」找不到锚点 @hook:${h.target || 'init'}，已跳过`);
    }
  }
  return files;
}

/**
 * 运行 JS 钩子。
 * 钩子文件约定：export default async function (ctx) { ... }
 * ctx: { project, entries(type), addFile(path, content), log(msg), nsId(v) }
 */
export async function runJsHooks(p, stage, ctx) {
  const hooks = (p.hooks?.js || []).filter((h) => h && h.enabled !== false && h.path && (h.stage || 'beforeWrite') === stage);
  for (const h of hooks) {
    const abs = path.isAbsolute(h.path) ? h.path : path.join(ctx.root || '.', h.path);
    if (!fs.existsSync(abs)) continue;
    try {
      const mod = await import(`${pathToFileURL(abs).href}?t=${Date.now()}`);
      const fn = mod.default || mod.run;
      if (typeof fn === 'function') {
        await fn({
          project: p,
          entries: (type) => p.entries[type] || [],
          addFile: (rel, content, o = {}) => ctx.addFile(rel, content, o),
          log: (m) => console.log(`[hook:${h.path}] ${m}`),
          nsId: (v) => (String(v).includes(':') ? v : `${p.meta.id}:${v}`),
        });
      }
    } catch (e) {
      console.warn(`[hooks] JS 钩子 ${h.path} 执行失败：${e.message}`);
    }
  }
}

/** 新建钩子时给的默认 JS 模板 */
export function jsHookTemplate() {
  return `/**
 * JS 钩子 —— 在生成前跑，可以改工程数据或额外产出文件。
 *
 * 导出的函数会收到：
 *   project  —— 整个工程数据（可以直接改，改完会保存）
 *   entries  —— entries('item') 取某类型的所有条目
 *   addFile  —— addFile('路径', '内容') 额外产出文件
 *   log      —— 打印到构建日志
 *   nsId     —— 短名补全成 '你的modid:短名'
 */
export default async function (ctx) {
  ctx.log('钩子开始跑，当前物品数：' + ctx.entries('item').length);

  // 例子：把所有材料的堆叠数改成 16
  // for (const it of ctx.entries('item')) {
  //   if (it.kind === 'material') it.stacksTo = 16;
  // }

  // 例子：额外产出一个说明文件
  // ctx.addFile('src/main/resources/说明.txt', '这个文件由钩子生成');
}
`;
}
