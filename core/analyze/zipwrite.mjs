/**
 * 最小 zip 写入器 —— 只为了造测试用的 jar（尤其是内嵌 jar 的包）。
 *
 * 为什么不用现成的库：这个工具的底线是「零依赖、双击就能跑」，
 * 不该为了测试去装依赖。真要装第三方 mod 时也是读别人的 jar，不是写。
 *
 * 只支持 store（不压缩）与 deflate 两种，够造测试包用了。
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * @param entries [{ path, data: Buffer|string, compress?: boolean }]
 * @returns Buffer
 */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.path.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const compress = e.compress !== false && raw.length > 0;
    const body = compress ? zlib.deflateRawSync(raw) : raw;
    const method = compress ? 8 : 0;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0x0800, 6);       // flags: UTF-8 名字
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);            // mod time
    lh.writeUInt16LE(0x21, 12);         // mod date（固定值，测试用无所谓）
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}
