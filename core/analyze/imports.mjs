/**
 * 「直接解析别人的 jar」的落盘层。
 *
 * 设计上刻意只做一件事：把浏览器上传 / 内嵌解出来的字节，安全地放进
 * ~/.mcstudio/imports/，然后**返回一个本地路径**。
 * 后面的分析、打包、存笔记、效果模板全部沿用原来那套按路径工作的接口，
 * 一行都不用改 —— 上传不是新的一条分析链路，只是给旧链路补了个入口。
 *
 * 安全红线：
 *  - 只收 .jar / .zip，且必须是合法 ZIP（尾部能找到 EOCD）
 *  - 大小硬上限，文件名只取 basename，绝不接受客户端给的完整路径
 *  - 内容哈希命名，重复上传同一个包不会堆一地副本
 *  - 删除只允许删 imports 目录内的文件
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mcstudioHome } from '../knowledge/sources.mjs';
import { looksLikeZip } from './zip.mjs';

export const MAX_UPLOAD = 256 * 1024 * 1024; // 256 MB，够装下任何正常 mod 包

export function importsDir() {
  return path.join(mcstudioHome(), 'imports');
}

function ensureDir() {
  const d = importsDir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 客户端给的文件名只用来显示：去掉路径、控制字符和 Windows 保留字符 */
export function safeDisplayName(name) {
  let s = String(name || 'mod.jar');
  try { s = decodeURIComponent(s); } catch { /* 不是编码过的就原样用 */ }
  s = s.replace(/[\\/]/g, '_').replace(/[\x00-\x1f\x7f]/g, '').replace(/[:*?"<>|]/g, '_');
  s = s.trim().slice(0, 120) || 'mod.jar';
  if (!/\.(jar|zip)$/i.test(s)) s += '.jar';
  return s;
}

function safeStoredName(display) {
  return display.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 90);
}

/** 校验一段字节是不是能分析的 jar */
export function validateJarBuffer(buf, name) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('文件太小，不是完整的 jar');
  if (buf.length > MAX_UPLOAD) throw new Error(`超过 ${Math.round(MAX_UPLOAD / 1024 / 1024)} MB 上限`);
  const display = safeDisplayName(name);
  if (!/\.(jar|zip)$/i.test(display)) throw new Error('只收 .jar / .zip 文件');
  if (!looksLikeZip(buf)) throw new Error('不是有效的 jar / zip（找不到 ZIP 结束标记），文件可能损坏或没传完');
  return display;
}

/**
 * 存一段 jar 字节，返回 { path, name, size, reused }。
 * 同名同内容会复用旧文件，不产生副本。
 */
export function saveJarBytes(buf, name) {
  const display = validateJarBuffer(buf, name);
  const dir = ensureDir();
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const stored = `${safeStoredName(path.parse(display).name)}-${hash}${path.extname(display).toLowerCase()}`;
  const dest = path.join(dir, stored);
  if (fs.existsSync(dest)) {
    return { path: dest, name: display, size: buf.length, reused: true };
  }
  // 先写临时文件再改名，避免上传中断留个半截 jar 被当成可分析对象
  const tmp = path.join(dir, `.${stored}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return { path: dest, name: display, size: buf.length, reused: false };
}

/** 列出已经导入过的 jar */
export function listImportedJars() {
  const dir = ensureDir();
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.') || !/\.(jar|zip)$/i.test(f)) continue;
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      out.push({ name: f, path: full, size: st.size, mtime: st.mtimeMs });
    } catch { /* ignore */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** 只允许删自己缓存目录里的文件 */
export function removeImportedJar(p) {
  const abs = path.resolve(String(p || ''));
  const base = path.resolve(importsDir());
  if (!abs.startsWith(base + path.sep)) throw new Error('只能删除导入缓存里的文件');
  if (!fs.existsSync(abs)) return { removed: false };
  const st = fs.statSync(abs);
  if (!st.isFile() || !/\.(jar|zip)$/i.test(abs)) throw new Error('这不是一个导入的 jar');
  fs.unlinkSync(abs);
  return { removed: true };
}

/** 内嵌 jar 的条目名白名单：Fabric 的 META-INF/jars/ 与 Forge 的 jarjar */
export function isNestedJarEntry(name) {
  return /^META-INF\/(?:jars|jarjar)\/[^/]+\.jar$/i.test(name) && !name.includes('..');
}

export function nestedJarEntries(src) {
  return (src.allNames || []).filter(isNestedJarEntry);
}
