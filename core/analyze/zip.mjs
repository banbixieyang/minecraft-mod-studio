/**
 * 最小 ZIP 读取 —— 只为读 jar 而生，零依赖。
 *
 * 为什么不用 npm 的 yauzl/unzipper：这个项目从头到尾刻意零依赖，
 * 装个包反而让「双击就能跑」的承诺打折。ZIP 的中央目录结构本身很简单，
 * 自己读两百行足够，还能顺带看清 jar 里到底有什么。
 *
 * 只支持 store(0) / deflate(8)，这两种覆盖了 99.9% 的 jar。
 *
 * 「别人的 jar」比自己构建出来的麻烦，这里专门处理了四种真实存在的怪癖：
 *  1. 自解压/加壳包前面有一段前缀，中央目录里的本地头偏移是相对 zip 起点的，
 *     直接拿来读会全错 —— 用 cdStart - cdOffset 反推出前缀长度补上。
 *  2. 中文文件名用 GBK 而不是 UTF-8（没有通用位标志 0x800 时）。
 *  3. 文件数超过 65535 / 偏移超过 4GB 的 ZIP64 结束记录。
 *  4. 流式生成的 jar 带 data descriptor —— 本地头里大小是 0，中央目录才有真值。
 */
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOC_SIG = 0x07064b50;

export class ZipError extends Error {}

/** 从尾部往前找 EOCD（注释最长 65535） */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('找不到 ZIP 结束标记，可能不是 zip/jar 文件');
}

/** ZIP64 EOCD locator 在 EOCD 前 20 字节；签名对不上就在附近找 */
function readZip64(buf, eocd) {
  let z64 = -1;
  const loc = eocd - 20;
  if (loc >= 0 && buf.readUInt32LE(loc) === ZIP64_LOC_SIG) {
    const guess = Number(buf.readBigUInt64LE(loc + 8));
    if (guess >= 0 && guess + 56 <= buf.length && buf.readUInt32LE(guess) === ZIP64_EOCD_SIG) z64 = guess;
  }
  if (z64 < 0) {
    const lo = Math.max(0, eocd - 4096);
    for (let i = eocd - 56; i >= lo; i--) {
      if (buf.readUInt32LE(i) === ZIP64_EOCD_SIG) { z64 = i; break; }
    }
  }
  if (z64 < 0 || z64 + 56 > buf.length) throw new ZipError('这个 jar 用了 ZIP64，但结束记录读不出来（文件可能损坏）');
  const total = Number(buf.readBigUInt64LE(z64 + 32));
  const cdSize = Number(buf.readBigUInt64LE(z64 + 40));
  const cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  const recordLen = Number(buf.readBigUInt64LE(z64 + 4)) + 12;
  return { total, cdSize, cdOffset, recordLen };
}

/** 没有 UTF-8 标志时，按 UTF-8 → GBK/GB18030 → 单字节兜底逐个试 */
function decodeName(raw, flags) {
  if (flags & 0x800) return raw.toString('utf8');
  const utf8 = raw.toString('utf8');
  if (!utf8.includes('\ufffd')) return utf8;
  for (const enc of ['gb18030', 'gbk', 'ibm866']) {
    try {
      const s = new TextDecoder(enc).decode(raw);
      if (s && !s.includes('\ufffd')) return s;
    } catch { /* 这个构建没带该编码 */ }
  }
  return raw.toString('latin1');
}

/** 条目里出现 0xffffffff 时，真值藏在 extra field 的 0x0001 段里 */
function zip64Extra(buf, start, extraLen, need) {
  const out = {};
  if (!need || extraLen < 4) return out;
  let p = start;
  const end = start + extraLen;
  while (p + 4 <= end) {
    const id = buf.readUInt16LE(p);
    const len = buf.readUInt16LE(p + 2);
    if (id !== 0x0001 || p + 4 + len > end) { p += 4 + len; continue; }
    let q = p + 4;
    const take = () => {
      const v = Number(buf.readBigUInt64LE(q));
      q += 8;
      return v;
    };
    if (need.rawSize && q + 8 <= p + 4 + len) out.rawSize = take();
    if (need.compSize && q + 8 <= p + 4 + len) out.compSize = take();
    if (need.locOffset && q + 8 <= p + 4 + len) out.locOffset = take();
    break;
  }
  return out;
}

/**
 * 打开一个 zip。
 * 返回 { names, has(name), stat(name), read(name), readText(name), list(prefix) }
 */
export function openZip(buffer) {
  const buf = buffer;
  const eocd = findEocd(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let z64 = null;
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    z64 = readZip64(buf, eocd);
    count = z64.total;
    cdSize = z64.cdSize;
    cdOffset = z64.cdOffset;
  }

  // 中央目录一定紧挨着 EOCD 前面（ZIP64 时中间还夹着两条结束记录）。
  // 先用几何关系定位，再用签名验证；比直接信 cdOffset 靠谱得多。
  const candidates = [
    eocd - cdSize,
    cdOffset,
    z64 ? eocd - cdSize - 20 - z64.recordLen : -1,
  ];
  let cdStart = -1;
  for (const c of candidates) {
    if (c >= 0 && c + 4 <= buf.length && buf.readUInt32LE(c) === CEN_SIG) { cdStart = c; break; }
  }
  if (cdStart < 0) {
    const lo = Math.max(0, eocd - cdSize - 4096);
    for (let i = Math.max(0, eocd - cdSize); i >= lo; i--) {
      if (i + 4 <= buf.length && buf.readUInt32LE(i) === CEN_SIG) { cdStart = i; break; }
    }
  }
  if (cdStart < 0) throw new ZipError('ZIP 中央目录定位失败，文件可能损坏或不是标准 jar');
  if (cdStart + cdSize > buf.length) throw new ZipError('ZIP 中央目录越界，文件可能损坏');

  // 自解压前缀 / 加壳包：本地头偏移要整体平移这一段
  const baseOffset = cdStart - cdOffset;

  const entries = new Map();
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let locOffset = buf.readUInt32LE(p + 42);
    const nameRaw = buf.subarray(p + 46, p + 46 + nameLen);
    const name = decodeName(nameRaw, flags);

    if (compSize === 0xffffffff || rawSize === 0xffffffff || locOffset === 0xffffffff) {
      const x = zip64Extra(buf, p + 46 + nameLen, extraLen, {
        rawSize: rawSize === 0xffffffff,
        compSize: compSize === 0xffffffff,
        locOffset: locOffset === 0xffffffff,
      });
      if (x.rawSize !== undefined) rawSize = x.rawSize;
      if (x.compSize !== undefined) compSize = x.compSize;
      if (x.locOffset !== undefined) locOffset = x.locOffset;
    }
    entries.set(name, { name, method, compSize, rawSize, locOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  /** 真正解压一个条目 */
  function read(name) {
    const e = entries.get(name);
    if (!e) throw new ZipError(`jar 里没有 ${name}`);
    const lp = e.locOffset + baseOffset;
    if (lp < 0 || lp + 30 > buf.length) throw new ZipError(`${name} 的本地头越界（jar 可能被截断过）`);
    if (buf.readUInt32LE(lp) !== LOC_SIG) throw new ZipError(`${name} 的本地头签名不对`);
    const nameLen = buf.readUInt16LE(lp + 26);
    const extraLen = buf.readUInt16LE(lp + 28);
    const start = lp + 30 + nameLen + extraLen;
    if (start + e.compSize > buf.length) throw new ZipError(`${name} 的数据越界（jar 可能被截断过）`);
    const raw = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(raw);
    if (e.method === 8) return zlib.inflateRawSync(raw);
    throw new ZipError(`${name} 用了不支持的压缩方式 ${e.method}（只支持 store / deflate）`);
  }

  const names = [...entries.keys()];

  return {
    names,
    count: names.length,
    has: (name) => entries.has(name),
    stat: (name) => entries.get(name) || null,
    read,
    readText(name) {
      try {
        return read(name).toString('utf8');
      } catch {
        return null;
      }
    },
    /** 按前缀列条目 */
    list(prefix) {
      return names.filter((n) => n.startsWith(prefix) && !n.endsWith('/'));
    },
  };
}

/** 判断一段 buffer 是不是 zip */
export function looksLikeZip(buf) {
  try {
    findEocd(buf);
    return true;
  } catch {
    return false;
  }
}
