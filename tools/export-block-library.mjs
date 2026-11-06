/**
 * 把一个 mod jar 转成可视化积木库（.mcblocks.json）。
 *
 * 用法：
 *   node tools/export-block-library.mjs <mod.jar> [选项]
 *
 * 选项：
 *   --out <文件>     输出路径（默认写到用户库目录 ~/.mcstudio/blocks/）
 *   --target <id>    强制目标（fabric-26.3 / forge-1.20.1）；默认按 mod 的加载器自动判断
 *   --no-api         不扫「可调用功能」那类行为型积木（只要数据型的）
 *   --api-limit <n>  行为型积木最多导多少条（默认 120）
 *   --print          只打印摘要，不写文件
 *
 * 例子：
 *   node tools/export-block-library.mjs "C:/Users/xxx/Downloads/goety-2.5.55.4.jar"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { libraryFromJar } from '../core/visual/modlib.mjs';
import { writeLibrary } from '../core/visual/library.mjs';
import { userBlocksDir } from '../core/visual/registry.mjs';

const args = process.argv.slice(2);
const jar = args.find((a) => !a.startsWith('--'));
if (!jar) {
  console.error('用法：node tools/export-block-library.mjs <mod.jar> [--out 文件] [--target id] [--no-api] [--print]');
  process.exit(1);
}
if (!fs.existsSync(jar)) {
  console.error(`找不到 jar：${jar}`);
  process.exit(1);
}

const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const has = (name) => args.includes(`--${name}`);

const opts = {
  targetId: typeof flag('target') === 'string' ? flag('target') : undefined,
  withApi: !has('no-api'),
  apiLimit: Number(flag('api-limit', 120)) || 120,
};

console.log(`分析：${jar}`);
const t0 = Date.now();
const { library, warnings, target } = libraryFromJar(jar, opts);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log(`\n库：${library.name}（${library.id}）`);
console.log(`目标：${target || '未识别（只出了描述，没有 Java 模板）'}`);
console.log(`积木：${library.blocks.length} 条`);
for (const c of library.categories) {
  const n = library.blocks.filter((b) => b.category === c.id).length;
  console.log(`  · ${c.label}：${n} 条`);
}
if (warnings.length) {
  console.log('\n提示：');
  for (const w of warnings) console.log(`  - ${w}`);
}

if (has('print')) {
  console.log('\n（--print：没有写文件）');
  process.exit(0);
}

const out = typeof flag('out') === 'string'
  ? flag('out')
  : path.join(userBlocksDir(), `${library.id}.mcblocks.json`);
writeLibrary(library, out);
console.log(`\n已写入：${out}`);
console.log('下次打开 MC Studio 时它会自动出现在「积木库」列表里。');
