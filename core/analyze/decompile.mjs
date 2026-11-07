/**
 * jar → 可读 Java 源码（反编译）+ 引用索引。
 *
 * 为什么单独一个模块：
 *   · 发布版 mod jar 只有 .class，没有 .java，常量池分析只能告诉你「用了哪些 API」，
 *     看不到方法体。要回答「这个道具的效果到底怎么实现的」，必须反编译。
 *   · 反编译用 ForgeFlower（Fernflower 分支，ForgeGradle 本来就会下载它），
 *     不额外依赖 npm 包；找不到就明确报错，绝不拿常量池证据冒充源码。
 *
 * 缓存：按 jar 的「路径 + 大小 + mtime」做 key，反编译结果放在
 * `~/.mcstudio/decompile/<key>/src`，同一份 jar 只编一次。
 * 刻意不写在 jar 旁边 —— 分析别人的发布包不该往人家 build/libs 里扔目录。
 *
 * 反编译器查找顺序：
 *   1. 环境变量 MCSTUDIO_DECOMPILER（用户指定任意 fernflower/forgeflower jar）
 *   2. 工程 tools/forgeflower.jar
 *   3. ForgeGradle 缓存 ~/.gradle/caches/forge_gradle/.../forgeflower/<ver>/*.jar
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openZip } from './zip.mjs';
import { mcstudioHome } from '../knowledge/sources.mjs';

/** 默认缓存根目录 */
export function decompileCacheDir() {
  return path.join(mcstudioHome(), 'decompile');
}

/** 找反编译器，找不到返回 null */
export function findDecompiler() {
  const candidates = [];
  if (process.env.MCSTUDIO_DECOMPILER) candidates.push(process.env.MCSTUDIO_DECOMPILER);
  candidates.push(path.resolve('tools/forgeflower.jar'));

  const cacheRoot = path.join(
    os.homedir(), '.gradle', 'caches', 'forge_gradle', 'maven_downloader',
    'net', 'minecraftforge', 'forgeflower',
  );
  if (fs.existsSync(cacheRoot)) {
    let versions = [];
    try { versions = fs.readdirSync(cacheRoot).sort().reverse(); } catch { /* ignore */ }
    for (const v of versions) {
      candidates.push(path.join(cacheRoot, v, `forgeflower-${v}.jar`));
      candidates.push(path.join(cacheRoot, v, 'forgeflower.jar'));
    }
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch { /* ignore */ }
  }
  return null;
}

/** 把内存里的 zip 解到目录（只写普通文件，拒绝路径穿越） */
function extractZipBuffer(buf, destDir) {
  const zip = openZip(buf);
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });
  for (const name of zip.names) {
    if (!name || name.endsWith('/')) continue;
    const out = path.resolve(root, name);
    if (!out.startsWith(root + path.sep)) continue; // 路径穿越，跳过
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip.read(name));
  }
  return zip.names;
}

/**
 * 反编译一个 jar。
 *
 * @param {string} jarPath
 * @param {object} [opts]
 * @param {string} [opts.cacheDir] 自定义缓存根目录
 * @param {boolean} [opts.force] 忽略缓存重编
 * @returns {{dir:string, decompiler:string, cached:boolean, files:number}}
 */
export function decompileJar(jarPath, opts = {}) {
  const abs = path.resolve(String(jarPath || ''));
  if (!fs.existsSync(abs)) throw new Error(`找不到 jar：${abs}`);
  if (!/\.(jar|zip)$/i.test(abs)) throw new Error('只支持 .jar / .zip');

  const decompiler = findDecompiler();
  if (!decompiler) {
    throw new Error(
      '找不到反编译器（ForgeFlower）。把 forgeflower*.jar 放到 tools/forgeflower.jar，'
      + '或设置环境变量 MCSTUDIO_DECOMPILER 指向它。',
    );
  }

  const st = fs.statSync(abs);
  const key = crypto
    .createHash('sha1')
    .update(`${abs}:${st.size}:${st.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const cacheRoot = opts.cacheDir || decompileCacheDir();
  const outDir = path.join(cacheRoot, key);
  const srcDir = path.join(outDir, 'src');
  const marker = path.join(outDir, '.done');

  if (!opts.force && fs.existsSync(marker) && fs.existsSync(srcDir)) {
    return { dir: srcDir, decompiler, cached: true, files: countJava(srcDir) };
  }

  // 重编先清场：否则上一轮的产出 jar / 源码会被当成本轮结果
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    if (/\.jar$/i.test(f)) fs.rmSync(path.join(outDir, f), { force: true });
  }
  fs.rmSync(marker, { force: true });
  const r = spawnSync('java', ['-jar', decompiler, '-dgs=1', '-hdc=0', abs, outDir], {
    cwd: outDir,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`反编译没跑起来：${r.error.message}`);
  if (r.status !== 0) {
    const tail = String(`${r.stderr || ''}\n${r.stdout || ''}`).trim().split('\n').slice(-12).join('\n');
    throw new Error(`反编译失败（exit ${r.status}）：\n${tail}`);
  }

  // ForgeFlower 会把源码打成 <name>.jar 放进输出目录
  const outJar = fs.readdirSync(outDir).find((f) => /\.jar$/i.test(f));
  if (!outJar) throw new Error('反编译完成但没有产出源码 jar');
  extractZipBuffer(fs.readFileSync(path.join(outDir, outJar)), srcDir);
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');

  return { dir: srcDir, decompiler, cached: false, files: countJava(srcDir) };
}

function countJava(dir) {
  let n = 0;
  for (const rel of listJavaFiles(dir)) if (rel) n++;
  return n;
}

/** 递归列出 .java（返回相对路径，posix 分隔） */
export function listJavaFiles(dir) {
  const root = path.resolve(dir);
  const out = [];
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && /\.java$/i.test(e.name)) out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** 读一个源码文件（相对 dir） */
export function readJavaFile(dir, rel) {
  const root = path.resolve(dir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new Error('路径越界');
  return fs.readFileSync(abs, 'utf8');
}

/**
 * 建引用索引：类名 → 源码路径，以及「谁引用了它」。
 *
 * 这是**基于反编译源码的轻量分析**（不是完整 Java 解析器）：
 *   · 认 package / import / 顶层 class 名；
 *   · 方法调用用 `Type.method(` 与 `new Type(` 粗匹配。
 * 对「想知道这个道具实现了什么、调了哪些类」足够用，而且不会假装精确。
 *
 * 索引按目录缓存：一个几千类的 mod 包重建一次要读几千个文件，
 * 而界面每切一个类就请求一次，不缓存会明显卡。目录内容变了（重新反编译）
 * 目录 mtime 就变，缓存自动失效。
 */
const indexCache = new Map(); // 绝对路径 → { stamp, index }

export function buildReferenceIndex(dir) {
  const root = path.resolve(dir);
  let stamp = 0;
  try { stamp = fs.statSync(root).mtimeMs; } catch { stamp = 0; }
  const hit = indexCache.get(root);
  if (hit && hit.stamp === stamp) return hit.index;

  const files = listJavaFiles(root);
  const classes = [];
  const byFull = new Map();
  const bySimple = new Map();

  for (const rel of files) {
    let text = '';
    try { text = readJavaFile(root, rel); } catch { continue; }
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(text)?.[1] || '';
    const cls = /^\s*(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/m.exec(text)?.[1]
      || path.basename(rel, '.java');
    const fqcn = pkg ? `${pkg}.${cls}` : cls;
    const imports = [...text.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm)].map((m) => m[1]);
    const info = { rel, pkg, className: cls, fqcn, imports };
    classes.push(info);
    byFull.set(fqcn, info);
    if (!bySimple.has(cls)) bySimple.set(cls, []);
    bySimple.get(cls).push(info);
  }

  // 反向引用：A import / 提到 B，就记一条 A → B
  const referencedBy = new Map(); // fqcn → Set<fqcn>
  const addRev = (target, from) => {
    if (!target || !from || target === from) return;
    if (!referencedBy.has(target)) referencedBy.set(target, new Set());
    referencedBy.get(target).add(from);
  };
  for (const info of classes) {
    let text = '';
    try { text = readJavaFile(root, info.rel); } catch { continue; }
    // import 精确命中
    for (const imp of info.imports) addRev(imp, info.fqcn);
    // 源码里出现的类型名（粗匹配）。允许单字母类名（A/B/T 这类短名在
    // 混淆 jar、内部类和工具类里很常见），否则反查引用会漏掉。
    for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const simple = m[1];
      for (const target of bySimple.get(simple) || []) addRev(target.fqcn, info.fqcn);
    }
  }

  const index = { dir: root, classes, byFull, bySimple, referencedBy };
  indexCache.set(root, { stamp, index });
  return index;
}

/** 按全限定名或简单名找类 */
export function findClass(index, name) {
  const q = String(name || '').trim();
  if (!q) return null;
  if (index.byFull.has(q)) return index.byFull.get(q);
  const list = index.bySimple.get(q) || [];
  return list[0] || null;
}

/**
 * 一个类的「实现了什么」：源码 + 它引用的类 + 引用它的类。
 * @returns {{className, fqcn, rel, source, refs:string[], referencedBy:string[]}}
 */
export function classSource(index, name) {
  const info = findClass(index, name);
  if (!info) throw new Error(`反编译结果里没有类「${name}」`);
  const source = readJavaFile(index.dir, info.rel);

  // 它引用了谁：import + 源码里的类型名
  const refs = new Set();
  for (const imp of info.imports) refs.add(imp);
  for (const m of source.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const simple = m[1];
    if (simple === info.className) continue;
    for (const target of index.bySimple.get(simple) || []) refs.add(target.fqcn);
  }

  const rev = [...(index.referencedBy.get(info.fqcn) || [])].sort();
  return {
    className: info.className,
    fqcn: info.fqcn,
    rel: info.rel,
    source,
    refs: [...refs].sort(),
    referencedBy: rev,
  };
}
