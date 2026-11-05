import zlib from 'node:zlib';

let CRC_TABLE = null;
export function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 支持 colorType 0/2/3/4/6，bitDepth 1/2/4/8。
 * Minecraft 原版贴图大量使用 4-bit 调色板 PNG，必须按位解包。
 */
export function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bitsPerPixel = channels * bitDepth;
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const out = Buffer.alloc(height * bytesPerRow);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const rb = raw[rp++];
      const a = x >= filterBpp ? out[rowStart + x - filterBpp] : 0;
      const b = y > 0 ? out[rowStart - bytesPerRow + x] : 0;
      const c = x >= filterBpp && y > 0 ? out[rowStart - bytesPerRow + x - filterBpp] : 0;
      let v;
      switch (filter) {
        case 0: v = rb; break;
        case 1: v = rb + a; break;
        case 2: v = rb + b; break;
        case 3: v = rb + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = rb;
      }
      out[rowStart + x] = v & 0xff;
    }
  }

  const sample = (rowStart, index) => {
    if (bitDepth === 8) return out[rowStart + index];
    if (bitDepth === 4) {
      const byte = out[rowStart + (index >> 1)];
      return index % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
    }
    if (bitDepth === 2) {
      const byte = out[rowStart + (index >> 2)];
      const shift = (3 - (index % 4)) * 2;
      return (byte >> shift) & 0x03;
    }
    const byte = out[rowStart + (index >> 3)];
    const shift = 7 - (index % 8);
    return (byte >> shift) & 0x01;
  };

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (colorType === 3 && palette) {
        const idx = sample(rowStart, x);
        rgba[i * 4] = palette[idx * 3];
        rgba[i * 4 + 1] = palette[idx * 3 + 1];
        rgba[i * 4 + 2] = palette[idx * 3 + 2];
        rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 6) {
        const o = rowStart + x * 4;
        rgba[i * 4] = out[o]; rgba[i * 4 + 1] = out[o + 1];
        rgba[i * 4 + 2] = out[o + 2]; rgba[i * 4 + 3] = out[o + 3];
      } else if (colorType === 2) {
        const o = rowStart + x * 3;
        rgba[i * 4] = out[o]; rgba[i * 4 + 1] = out[o + 1];
        rgba[i * 4 + 2] = out[o + 2]; rgba[i * 4 + 3] = 255;
      } else if (colorType === 4) {
        const o = rowStart + x * 2;
        rgba[i * 4] = out[o]; rgba[i * 4 + 1] = out[o];
        rgba[i * 4 + 2] = out[o]; rgba[i * 4 + 3] = out[o + 1];
      } else {
        const g = bitDepth === 8 ? out[rowStart + x] : sample(rowStart, x) * (255 / ((1 << bitDepth) - 1));
        rgba[i * 4] = g; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = g; rgba[i * 4 + 3] = 255;
      }
    }
  }
  return { width, height, data: rgba };
}

export function encodePNG(width, height, rgba) {
  // 允许直接传 Uint8Array / ArrayBuffer 视图，不必调用方自己包 Buffer
  const src = Buffer.isBuffer(rgba)
    ? rgba
    : Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.byteLength);
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
