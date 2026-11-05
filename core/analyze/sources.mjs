/**
 * 分析对象的统一入口 —— 不管是 jar、解压后的 jar，还是别人的源码工程，
 * 都收敛成同一套 { list / read / readText }，后面的分析逻辑只认这个接口。
 */
import fs from 'node:fs';
import path from 'node:path';
import { openZip } from './zip.mjs';

const MAX_FILES = 30000;

/** 递归列目录（相对路径，正斜杠） */
function walkDir(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let ents;
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // 跳过明显的无关目录，否则分析别人工程时会去数 .git 里的文件
        if (['.git', 'node_modules', '.gradle', 'build', 'out', '.idea', 'run', '.studio'].includes(e.name)) continue;
        stack.push(r);
      } else if (e.isFile()) {
        out.push(r);
      }
    }
  }
  return out;
}

/**
 * 打开一个分析对象。
 * 返回 { kind, path, name, list(prefix), has(rel), read(rel), readText(rel), close() }
 */
export function openSource(input) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在：${abs}`);

  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (!/\.(jar|zip)$/i.test(abs)) throw new Error('只支持 .jar / .zip 文件，或一个目录');
    const buf = fs.readFileSync(abs);
    const zip = openZip(buf);
    const src = {
      kind: 'jar',
      path: abs,
      name: path.basename(abs, path.extname(abs)),
      size: st.size,
      list: (prefix) => zip.list(prefix || ''),
      has: (rel) => zip.has(rel),
      stat: (rel) => zip.stat(rel),
      read: (rel) => zip.read(rel),
      readText: (rel) => zip.readText(rel),
      allNames: zip.names,
      close() {},
    };
    // ---- 内嵌 jar（Fabric 的 META-INF/jars/、Forge 的 jarjar）----
    //
    // 整合包与「把依赖打进来」的发布包很常见。用户想拆的是里面的内容，
    // 但外层 jar 只是个壳。所以这里提供嵌套 jar 的读取入口，
    // 让上层能对每个内嵌 jar 单独跑一次分析。
    const nested = zip.names.filter((n) => /^META-INF\/(?:jars|jarjar)\/[^/]+\.jar$/i.test(n));
    if (nested.length) {
      src.nestedJars = nested.map((rel) => {
        const name = rel.split('/').pop();
        try {
          const inner = openZip(zip.read(rel));
          return {
            rel,
            name,
            size: zip.stat(rel)?.rawSize || 0,
            source: {
              kind: 'jar',
              path: `${abs}!/${rel}`,
              name: name.replace(/\.jar$/i, ''),
              size: zip.stat(rel)?.rawSize || 0,
              list: (prefix) => inner.list(prefix || ''),
              has: (r) => inner.has(r),
              stat: (r) => inner.stat(r),
              read: (r) => inner.read(r),
              readText: (r) => inner.readText(r),
              allNames: inner.names,
              close() {},
            },
          };
        } catch {
          // 内嵌 jar 读不出来（损坏 / 不是 zip）就不给，别让整个分析挂掉
          return { rel, name, size: zip.stat(rel)?.rawSize || 0, source: null, error: '读不出来' };
        }
      });
    }
    return src;
  }

  const files = walkDir(abs);
  const set = new Set(files);
  return {
    kind: 'dir',
    path: abs,
    name: path.basename(abs),
    size: 0,
    list: (prefix) => files.filter((f) => f.startsWith(prefix || '')),
    has: (rel) => set.has(rel),
    stat: (rel) => (set.has(rel) ? { name: rel } : null),
    read: (rel) => fs.readFileSync(path.join(abs, rel)),
    readText(rel) {
      try {
        return fs.readFileSync(path.join(abs, rel), 'utf8');
      } catch {
        return null;
      }
    },
    allNames: files,
    close() {},
  };
}

/** 猜这个目录是不是一个 Gradle 源码工程 */
export function looksLikeGradleProject(src) {
  if (src.kind !== 'dir') return false;
  return src.has('build.gradle') || src.has('build.gradle.kts') || src.has('gradlew');
}

/** 从一堆路径里找出所有命名空间（assets/<ns>/ 与 data/<ns>/） */
export function detectNamespaces(src) {
  const ns = new Set();
  for (const name of src.allNames || []) {
    const m = name.match(/^(?:assets|data)\/([^/]+)\//);
    if (m) ns.add(m[1]);
  }
  return [...ns];
}

/** 读一段 JSON，坏掉返回 null（别人的 mod 里可能有 BOM、注释） */
export function readJson(src, rel) {
  const text = src.readText(rel);
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}
