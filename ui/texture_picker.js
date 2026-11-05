/**
 * 贴图选择器。
 *
 * 目标：让不装画图软件的人也能得到像样的贴图，同时不挡住想用 Blockbench 的人。
 * 三种模式：自动推导 / 原版素材改色 / 矿石合成；外加一个逃生口「自己画」。
 */
import { el, setChildren, toast } from './ui.js';
import { api } from './api.js';

/** 预设配色的代表色，仅用于界面上的色块 */
const SWATCH = {
  ruby: '#d94b5a', crystal: '#e2e7ea', time: '#e0b23c', undead: '#5fa85a',
  ender: '#9a5fd0', void: '#4a3a63', emerald: '#3fae62', amber: '#d98b28',
  ice: '#7fc4e0', blood: '#b33131', copper: '#b5724a', shadow: '#3b3f5c',
  stone: '#9a9a9a',
};

export function renderTexturePicker(host, values, field, ctx) {
  const cur = normalize(values.texture);
  const state = { ...cur };

  const preview = el('img.texture-preview', { alt: '贴图预览' });
  const previewHint = el('div.texture-hint', { text: '正在生成预览…' });
  const modes = el('div.seg');
  const detail = el('div.texture-detail');

  const modeLabels = {
    auto: '自动',
    recolor: '原版改色',
    ore: '矿石合成',
    custom: '自己画',
  };

  const commit = () => {
    ctx.onChange({ texture: state.mode === 'auto' ? null : state });
    refreshPreview();
  };

  const paintModes = () => {
    setChildren(modes);
    for (const [m, label] of Object.entries(modeLabels)) {
      modes.append(
        el(`button.seg-btn${state.mode === m ? '.active' : ''}`, {
          type: 'button',
          onclick: () => {
            state.mode = m;
            paintModes();
            paintDetail();
            commit();
          },
        }, label),
      );
    }
  };

  const paintDetail = () => {
    setChildren(detail);
    if (state.mode === 'auto') {
      detail.append(
        el('p.note', { text: '根据物品类型自动挑底图：工具用钻石工具、盔甲用钻石甲、材料用宝石，方块按维度挑底岩。想微调就切到「原版改色」。' }),
        paletteRow(),
      );
      return;
    }
    if (state.mode === 'custom') {
      detail.append(
        el('p.note', { text: '自己画的贴图不会被生成器覆盖。可以从当前预览开始改，也可以直接用 Blockbench。' }),
        el(
          'div.row-actions',
          {},
          el('button.btn.small', {
            type: 'button',
            onclick: () => openPixelEditor(ctx, values, state),
          }, '打开像素画板'),
          el('button.btn.small.ghost', {
            type: 'button',
            onclick: () => openInBlockbench(ctx, values, state),
          }, '用 Blockbench 画'),
        ),
      );
      return;
    }

    // 素材选择
    const kindSel = el('select.input', {
      onchange: (e) => {
        state.kind = e.target.value;
        state.source = '';
        paintDetail();
        commit();
      },
    });
    kindSel.append(el('option', { value: 'item' }, '物品素材'));
    kindSel.append(el('option', { value: 'block' }, '方块素材'));
    kindSel.value = state.kind || 'item';

    const srcSel = el('select.input', {
      onchange: (e) => {
        state.source = e.target.value;
        commit();
      },
    });
    populateSources(srcSel, state.kind || 'item', state.source);

    detail.append(el('div.two-col', {}, el('div', {}, el('span.mini-label', { text: '素材来源' }), kindSel), el('div', {}, el('span.mini-label', { text: '底图' }), srcSel)));

    if (state.mode === 'ore') {
      const hostSel = el('select.input', {
        onchange: (e) => {
          state.host = e.target.value;
          commit();
        },
      });
      populateBlockList(hostSel, state.host || 'stone', '原版矿石的宿主岩石');

      const baseSel = el('select.input', {
        onchange: (e) => {
          state.base = e.target.value;
          commit();
        },
      });
      populateBlockList(baseSel, state.base || 'stone', '目标底岩');

      detail.append(
        el('div.two-col', {}, el('div', {}, el('span.mini-label', { text: '差分宿主（原版矿配同款岩石）' }), hostSel), el('div', {}, el('span.mini-label', { text: '目标底岩' }), baseSel)),
        el('p.note', { text: '矿石用「原版矿 与 它自己的宿主岩石」做逐像素差分来取矿点遮罩。宿主选错会把底色一起染掉。' }),
      );
    }

    detail.append(paletteRow());
  };

  const paletteRow = () => {
    const presets = ctx.presets || {};
    const box = el('div.palette-row');
    for (const [key, p] of Object.entries(presets)) {
      const active = state.palette === key;
      box.append(
        el(`button.swatch${active ? '.active' : ''}`, {
          type: 'button',
          title: p.label || key,
          style: { background: SWATCH[key] || '#888' },
          onclick: () => {
            state.palette = key;
            paintDetail();
            commit();
          },
        }),
      );
    }
    return el('div', {}, el('span.mini-label', { text: '配色' }), box);
  };

  const refreshPreview = async () => {
    try {
      const r = await api.texturePreview(ctx.root, ctx.type, { ...values, texture: state.mode === 'auto' ? null : state });
      if (r.dataUrl) {
        preview.src = r.dataUrl;
        previewHint.textContent = `${r.width}×${r.height}`;
      } else {
        preview.removeAttribute('src');
        previewHint.textContent = '没有预览';
      }
    } catch (e) {
      previewHint.textContent = '预览失败';
    }
  };

  paintModes();
  paintDetail();
  // 让「自己画」保存后能重绘整块面板
  paintModesSafe = () => {
    paintModes();
    paintDetail();
    refreshPreview();
  };

  host.append(
    el('div.texture-picker', {}, el('div.texture-left', {}, preview, previewHint), el('div.texture-right', {}, modes, detail)),
  );

  refreshPreview();
}

function normalize(t) {
  if (!t) return { mode: 'auto' };
  if (typeof t === 'string') return { mode: 'auto' };
  return { mode: t.mode || 'auto', ...t };
}

let vanillaCache = null;

async function ensureVanilla() {
  if (!vanillaCache) {
    const r = await api.vanilla();
    vanillaCache = r.vanilla;
  }
  return vanillaCache;
}

async function populateSources(sel, kind, current) {
  setChildren(sel);
  const v = await ensureVanilla();
  const list = v[kind] || [];
  if (!list.length) {
    sel.append(el('option', { value: '' }, '（没有可用素材）'));
    return;
  }
  for (const name of list) {
    sel.append(el('option', { value: name, selected: current === name }, name));
  }
  if (!current && list.length) sel.value = list[0];
}

async function populateBlockList(sel, current, label) {
  setChildren(sel);
  const v = await ensureVanilla();
  const rocks = ['stone', 'deepslate', 'netherrack', 'end_stone', 'tuff', 'calcite', 'blackstone', 'basalt_side'];
  for (const name of rocks) {
    if (!(v.block || []).includes(name)) continue;
    sel.append(el('option', { value: name, selected: current === name }, `${name}  (${label})`));
  }
  sel.value = current;
}

async function openPixelEditor(ctx, values, state) {
  const { openPixelModal } = await import('./pixel.js');
  const img = await api.texturePreview(ctx.root, ctx.type, { ...values, texture: state.mode === 'auto' ? null : state });
  openPixelModal({
    ctx,
    values,
    initialDataUrl: img.dataUrl,
    onSave: async (dataUrl) => {
      const rel =
        ctx.type === 'block'
          ? `src/main/resources/assets/${ctx.ns}/textures/block/${values.id}.png`
          : `src/main/resources/assets/${ctx.ns}/textures/item/${values.id}.png`;
      await api.saveTexture(ctx.root, rel, dataUrl);
      state.mode = 'custom';
      ctx.onChange({ texture: { mode: 'custom' } });
      toast('贴图已保存，下次生成不会被覆盖', 'ok');
      paintModesSafe();
    },
  });
}

// paintModes 在闭包里，这里用一个可替换的引用避免作用域问题
let paintModesSafe = () => {};

async function openInBlockbench(ctx, values, state) {
  try {
    const r = await api.bbOpen(ctx.root, ctx.type, values.id || '', '');
    if (r.launched) toast('已在 Blockbench 中打开', 'ok');
    else toast(r.reason || '没能启动 Blockbench，已导出 .bbmodel 供手动打开', 'warn');
  } catch (e) {
    toast(`Blockbench 打开失败：${e.message}`, 'error');
  }
}
