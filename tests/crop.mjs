/**
 * 调试用：裁剪并放大截图，方便逐块检查界面细节。
 *   node tests/crop.mjs <源图> <输出> <x> <y> <w> <h> [放大倍数]
 */
import { readPNG, writePNG } from '../core/texture/recolor.mjs';

const [src, out, x, y, w, h, scale = '2'] = process.argv.slice(2);
if (!src || !out || [x, y, w, h].some((v) => v === undefined || Number.isNaN(Number(v)))) {
  console.log('用法: node tests/crop.mjs <源图> <输出> <x> <y> <w> <h> [放大倍数=2]');
  console.log('这是手动裁图工具，不是回归测试；无需在自检里跑。');
  process.exit(0);
}
const img = readPNG(src);
const sx = Number(x), sy = Number(y), sw = Number(w), sh = Number(h), k = Number(scale);

const W = Math.round(sw * k), H = Math.round(sh * k);
const dst = { width: W, height: H, data: new Uint8Array(W * H * 4) };

for (let dy = 0; dy < H; dy++) {
  const oy = sy + Math.floor(dy / k);
  for (let dx = 0; dx < W; dx++) {
    const ox = sx + Math.floor(dx / k);
    const di = (dy * W + dx) * 4;
    if (ox < 0 || oy < 0 || ox >= img.width || oy >= img.height) {
      dst.data[di] = 255; dst.data[di + 1] = 255; dst.data[di + 2] = 255; dst.data[di + 3] = 255;
      continue;
    }
    const si = (oy * img.width + ox) * 4;
    dst.data[di] = img.data[si];
    dst.data[di + 1] = img.data[si + 1];
    dst.data[di + 2] = img.data[si + 2];
    dst.data[di + 3] = img.data[si + 3];
  }
}
writePNG(out, dst);
console.log(`已输出 ${out} (${W}x${H})`);
