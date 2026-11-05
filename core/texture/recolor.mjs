/**
 * 贴图改色。
 *
 * 这里的所有算法都在真实工程里跑过、肉眼验证过，不要凭直觉调整：
 *  - 原版贴图大量是 4-bit 调色板 PNG，pnglib 已按位解包
 *  - 灰阶底图（铁、骨、下界合金）如果直接跳过，改色后还是灰的，
 *    所以灰阶像素也要上淡色，只保留纯黑描边与接近纯白的高光
 *  - 矿石不能按「饱和度低=背景」判定，下界岩底色本身就是高饱和红，
 *    会把整块底图染成矿点色 —— 必须用「原版矿 vs 它自己的宿主岩石」逐像素差分取遮罩
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from './pnglib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VANILLA_DIR = path.join(HERE, 'vanilla');

/** 预设配色。hue 0-360，sat/light 是强度系数 */
export const PRESETS = {
  ruby: { hue: 352, sat: 0.75, light: 1.05, label: '宝石红' },
  crystal: { hue: 205, sat: 0.12, light: 1.14, mono: true, label: '冷白（晶石）' },
  time: { hue: 45, sat: 0.9, light: 1.05, label: '时之金' },
  undead: { hue: 110, sat: 0.55, light: 1.0, label: '亡灵绿' },
  ender: { hue: 280, sat: 0.75, light: 1.05, label: '末影紫' },
  void: { hue: 270, sat: 0.65, light: 0.8, label: '虚空黑紫' },
  emerald: { hue: 140, sat: 0.7, light: 1.02, label: '翠绿' },
  amber: { hue: 30, sat: 0.85, light: 1.05, label: '琥珀' },
  ice: { hue: 190, sat: 0.5, light: 1.12, label: '冰蓝' },
  blood: { hue: 0, sat: 0.85, light: 0.95, label: '血红' },
  copper: { hue: 20, sat: 0.6, light: 1.0, label: '古铜' },
  shadow: { hue: 240, sat: 0.35, light: 0.62, label: '暗影' },
  stone: { hue: 210, sat: 0.05, light: 1.0, mono: true, label: '原色（几乎不改）' },
};

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hue2rgb(h + 1 / 3) * 255), Math.round(hue2rgb(h) * 255), Math.round(hue2rgb(h - 1 / 3) * 255)];
}

/** 单张图改色 */
export function recolor(img, pal) {
  const out = Buffer.from(img.data);
  const mono = !!pal.mono;
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    if (out[o + 3] < 8) continue;
    const [h, s, l] = rgbToHsl(out[o], out[o + 1], out[o + 2]);
    if (l < 0.06 || l > 0.97) continue; // 纯黑描边 / 高光保留原样

    let ns;
    if (mono) {
      // 白色系：压低饱和度，靠亮度分层
      ns = s < 0.12 ? 0.04 : Math.min(0.12, s * 0.2);
    } else if (s < 0.12) {
      // 灰阶底图：不上色就还是一块灰，给一点淡色
      ns = 0.1 + pal.sat * 0.18;
    } else {
      ns = Math.min(1, 0.45 + s * pal.sat);
    }
    const nl = Math.min(1, l * (pal.light ?? 1));
    const [r, g, b] = hslToRgb(pal.hue, ns, nl);
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * 矿石合成：斑点来自 spot 与原版宿主岩石的差分，底图来自目标底岩。
 * @param spot 原版矿石贴图（如 diamond_ore）
 * @param host spot 对应的原版宿主岩石（如 stone）
 * @param base 目标底岩（如 deepslate / netherrack / end_stone）
 */
export function composeOre(spot, host, base, pal) {
  const n = spot.width * spot.height;
  const out = Buffer.alloc(n * 4);
  const SPEC = 40;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const hi = (i % (host.width * host.height)) * 4;
    const bi = (i % (base.width * base.height)) * 4;
    const d = Math.max(
      Math.abs(spot.data[o] - host.data[hi]),
      Math.abs(spot.data[o + 1] - host.data[hi + 1]),
      Math.abs(spot.data[o + 2] - host.data[hi + 2]),
    );
    if (d <= SPEC) {
      out[o] = base.data[bi];
      out[o + 1] = base.data[bi + 1];
      out[o + 2] = base.data[bi + 2];
      out[o + 3] = 255;
      continue;
    }
    const [h, s, l] = rgbToHsl(spot.data[o], spot.data[o + 1], spot.data[o + 2]);
    let ns;
    if (pal.mono) ns = Math.min(0.12, 0.04 + s * 0.2);
    else ns = Math.min(1, 0.5 + s * pal.sat);
    const [r, g, b] = hslToRgb(pal.hue, ns, Math.min(1, l * (pal.light ?? 1)));
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return { width: spot.width, height: spot.height, data: out };
}

// ---------------- 素材库 ----------------

let vanillaCache = null;

/** 列出内置素材（去掉 .png 后缀） */
export function listVanilla() {
  if (vanillaCache) return vanillaCache;
  const out = { block: [], item: [] };
  for (const kind of ['block', 'item']) {
    const dir = path.join(VANILLA_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    out[kind] = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4))
      .sort();
  }
  vanillaCache = out;
  return out;
}

const imgCache = new Map();

export function readVanilla(kind, name) {
  const key = `${kind}/${name}`;
  if (imgCache.has(key)) return imgCache.get(key);
  const file = path.join(VANILLA_DIR, kind, `${name}.png`);
  if (!fs.existsSync(file)) throw new Error(`内置素材不存在：${key}`);
  const img = decodePNG(fs.readFileSync(file));
  // 只留最近 200 张，避免长跑占内存
  if (imgCache.size > 200) imgCache.clear();
  imgCache.set(key, img);
  return img;
}

export function readPNG(file) {
  return decodePNG(fs.readFileSync(file));
}

export function writePNG(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(img.width, img.height, img.data));
}

export function pngBuffer(img) {
  return encodePNG(img.width, img.height, img.data);
}

// ---------------- 由条目配置产出贴图 ----------------

/**
 * texture 字段的数据形状：
 * {
 *   mode: 'recolor' | 'ore' | 'custom' | 'none',
 *   kind: 'item' | 'block',        // 素材来自哪个目录
 *   source: 'diamond_sword',       // 底图
 *   host: 'stone',                 // 仅 ore：原版宿主岩石
 *   base: 'deepslate',             // 仅 ore：目标底岩
 *   palette: 'ruby' | {hue,sat,light,mono}
 * }
 */
export function buildTexture(cfg) {
  if (!cfg || cfg.mode === 'none') return null;
  const pal = typeof cfg.palette === 'string' ? PRESETS[cfg.palette] || PRESETS.ruby : { ...PRESETS.ruby, ...cfg.palette };

  if (cfg.mode === 'custom') return null; // 用户自己画的，不覆盖

  try {
    if (cfg.mode === 'ore') {
      const spotKind = cfg.kind || 'block';
      const spot = readVanilla(spotKind, cfg.source || 'diamond_ore');
      const host = readVanilla('block', cfg.host || 'stone');
      const base = readVanilla('block', cfg.base || 'stone');
      return composeOre(spot, host, base, pal);
    }
    const img = readVanilla(cfg.kind || 'item', cfg.source || 'diamond_sword');
    return recolor(img, pal);
  } catch (e) {
    return null;
  }
}

/** 给界面返回一张贴图的 base64（可直接当 img src 用） */
export function toDataUrl(img) {
  if (!img) return null;
  return `data:image/png;base64,${pngBuffer(img).toString('base64')}`;
}

/** 一张贴图的最近邻放大，用于界面预览 */
export function upscale(img, factor) {
  const w = img.width * factor;
  const h = img.height * factor;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
      const dst = (y * w + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = img.data[src + 3];
    }
  }
  return { width: w, height: h, data: out };
}
