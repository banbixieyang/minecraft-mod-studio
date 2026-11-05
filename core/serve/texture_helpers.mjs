/**
 * 贴图相关的服务端辅助。
 * 主要工作是给界面准备好可以直接塞进 <img src> 的数据。
 */
import fs from 'node:fs';
import { decodePNG } from '../texture/pnglib.mjs';
import { listVanilla, PRESETS, toDataUrl, upscale, readVanilla } from '../texture/recolor.mjs';

export { listVanilla, PRESETS, toDataUrl, upscale, readVanilla };

export function decodeFromFile(file) {
  return decodePNG(fs.readFileSync(file));
}

/** 给界面用的素材缩略图：把一批原版素材转成 data url */
export function thumbnails(kind, names, factor = 2) {
  const out = {};
  for (const name of names) {
    try {
      out[name] = toDataUrl(upscale(readVanilla(kind, name), factor));
    } catch {
      /* 素材不存在就跳过 */
    }
  }
  return out;
}
