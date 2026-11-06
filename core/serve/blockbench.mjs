/**
 * Blockbench 对接。
 *
 * 定位很清楚：编辑器的像素画板只是应急用的，Blockbench 才是主力画图工具。
 * 所以这里不做「替代 Blockbench」，只做两件事：
 *   1. 把当前条目导出成一个最小可用的 .bbmodel，里面已经挂好贴图
 *   2. 尝试用 Blockbench 打开它，用户画完导出 PNG 覆盖回去即可
 *
 * .bbmodel 是纯 JSON，格式稳定，不需要额外依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadProject, findEntry, stripNs } from '../project.mjs';
import { decodePNG } from '../texture/pnglib.mjs';

export const BB_FORMAT_VERSION = '4.10';

/** 生成一个只含「一张平面 + 一张贴图」的 bbmodel，够 Blockbench 打开画图用 */
export function buildBbmodel({ name, textureName, textureB64, width, height }) {
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

  const texUuid = uuid();
  const elUuid = uuid();

  return {
    meta: {
      format_version: BB_FORMAT_VERSION,
      model_format: 'free',
      box_uv: false,
    },
    name,
    model_identifier: '',
    visible_box: [1, 1, 0],
    variable_placeholders: '',
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width, height },
    elements: [
      {
        name: 'plane',
        box_uv: false,
        rescale: false,
        locked: false,
        light_emission: 0,
        render_order: 'default',
        allow_mirror_modeling: true,
        from: [0, 0, 0],
        to: [width, height, 0],
        autouv: 0,
        color: 0,
        origin: [0, 0, 0],
        faces: {
          north: { uv: [0, 0, width, height], texture: 0 },
          east: { uv: [0, 0, 0, 0], texture: null },
          south: { uv: [0, 0, 0, 0], texture: null },
          west: { uv: [0, 0, 0, 0], texture: null },
          up: { uv: [0, 0, 0, 0], texture: null },
          down: { uv: [0, 0, 0, 0], texture: null },
        },
        type: 'cube',
        uuid: elUuid,
      },
    ],
    outliner: [{ name: 'root', origin: [0, 0, 0], uuid: uuid(), export: true, mirror_uv: true, children: [elUuid] }],
    textures: [
      {
        path: '',
        name: textureName,
        folder: 'blockbench_export',
        namespace: '',
        id: '0',
        group: '',
        width,
        height,
        uv_width: width,
        uv_height: height,
        particle: false,
        use_as_default: false,
        layers_enabled: false,
        sync_to_project: '',
        render_mode: 'default',
        render_sides: 'auto',
        frame_time: 1,
        frame_order_type: 'loop',
        frame_order: '',
        frame_interpolate: false,
        visible: true,
        mode: 'bitmap',
        saved: false,
        uuid: texUuid,
        relative_path: '',
        source: `data:image/png;base64,${textureB64}`,
      },
    ],
  };
}

/**
 * 把某个条目导出成 .bbmodel 到工程目录里。
 * 贴图取工程里已生成的 PNG；还没生成就先跑一次生成。
 */
export function writeBbmodel(root, type, id, texturePathOverride) {
  const data = loadProject(root);
  const entry = findEntry(data, type, id);
  if (!entry) throw new Error(`找不到条目 ${type}/${id}`);

  const ns = data.meta.id;
  const guessRel =
    type === 'block'
      ? `src/main/resources/assets/${ns}/textures/block/${id}.png`
      : `src/main/resources/assets/${ns}/textures/item/${id}.png`;
  const rel = texturePathOverride || guessRel;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`贴图还没生成：${rel}。先在界面上点一次「生成」`);
  }
  const buf = fs.readFileSync(abs);
  const img = decodePNG(buf);

  const model = buildBbmodel({
    name: entry.nameZh || entry.nameEn || id,
    textureName: `${ns}_${id}`,
    textureB64: buf.toString('base64'),
    width: img.width,
    height: img.height,
  });

  const outDir = path.join(root, '.studio', 'blockbench');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${ns}_${id}.bbmodel`);
  fs.writeFileSync(file, JSON.stringify(model, null, 2), 'utf8');

  return { file, texture: abs, textureRel: rel, size: `${img.width}x${img.height}` };
}

/** 常见的 Blockbench 安装位置，按平台分开 —— Windows 路径在 POSIX 上只会变成无意义的相对路径。 */
function blockbenchCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const list = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    list.push(
      path.join(local, 'Programs', 'Blockbench', 'Blockbench.exe'),
      path.join(local, 'Blockbench', 'Blockbench.exe'),
      path.join(roaming, 'Blockbench', 'Blockbench.exe'),
      path.join('C:', 'Program Files', 'Blockbench', 'Blockbench.exe'),
      path.join('C:', 'Program Files (x86)', 'Blockbench', 'Blockbench.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Blockbench.app/Contents/MacOS/Blockbench');
    list.push(path.join(home, 'Applications', 'Blockbench.app', 'Contents', 'MacOS', 'Blockbench'));
  } else {
    list.push(
      '/usr/bin/blockbench',
      '/usr/local/bin/blockbench',
      '/opt/Blockbench/blockbench',
      path.join(home, '.local', 'bin', 'blockbench'),
      path.join(home, 'Applications', 'Blockbench.AppImage'),
    );
  }
  return list.filter((f) => {
    try {
      return fs.existsSync(f);
    } catch {
      return false;
    }
  });
}

export function detectBlockbench() {
  const found = blockbenchCandidates();
  return found.length ? found[0] : null;
}

/**
 * 尝试用 Blockbench 打开文件。
 * 找不到 Blockbench 不报错 —— 返回 { launched:false, reason }，界面提示用户手动打开。
 */
export async function openInBlockbench(file) {
  const exe = detectBlockbench();
  if (!exe) {
    return { launched: false, reason: '没检测到 Blockbench。可以手动打开 .bbmodel，或在设置里指定路径', file };
  }
  try {
    const child = spawn(exe, [file], { detached: true, stdio: 'ignore' });
    child.unref();
    return { launched: true, exe, file };
  } catch (e) {
    return { launched: false, reason: e.message, file };
  }
}
