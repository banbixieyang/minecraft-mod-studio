/**
 * 像素画编辑器。
 *
 * 定位是「应急画板」：改个颜色、点几下像素够用，正经画图还是去 Blockbench。
 * 所以这里只做最必要的几件事，不追求图层、动画、选区。
 */
import { el, setChildren, toast } from './ui.js';

const DEFAULT_COLORS = [
  '#ffffff', '#c6c6c6', '#8b8b8b', '#5a5a5a', '#2b2b2b', '#000000',
  '#d94b5a', '#b33131', '#e0b23c', '#d98b28', '#5fa85a', '#3fae62',
  '#7fc4e0', '#4a86c8', '#9a5fd0', '#6a3fa0', '#e2e7ea', '#8a5a3b',
];

export function openPixelModal({ ctx, values, initialDataUrl, onSave }) {
  const SIZE = 16;
  const SCALE = 24;

  const buf = new Uint8ClampedArray(SIZE * SIZE * 4); // RGBA
  let color = '#d94b5a';
  let tool = 'pen';
  const history = [];
  const future = [];

  const canvas = el('canvas.pixel-canvas', { width: SIZE * SCALE, height: SIZE * SCALE });
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  const pushHistory = () => {
    history.push(buf.slice());
    if (history.length > 40) history.shift();
    future.length = 0;
  };

  const draw = () => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        const a = buf[i + 3];
        if (a === 0) {
          // 透明格子画棋盘
          const dark = (x + y) % 2 === 0;
          g.fillStyle = dark ? '#e9e9ee' : '#f7f7fa';
          g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        } else {
          g.fillStyle = `rgba(${buf[i]},${buf[i + 1]},${buf[i + 2]},${a / 255})`;
          g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    }
    // 网格线
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    for (let i = 1; i < SIZE; i++) {
      g.beginPath();
      g.moveTo(i * SCALE + 0.5, 0);
      g.lineTo(i * SCALE + 0.5, SIZE * SCALE);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * SCALE + 0.5);
      g.lineTo(SIZE * SCALE, i * SCALE + 0.5);
      g.stroke();
    }
  };

  const hexToRgb = (hex) => {
    const m = hex.replace('#', '');
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  };

  const paintAt = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * SIZE);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    if (tool === 'picker') {
      if (buf[i + 3] > 0) {
        color = rgbToHex(buf[i], buf[i + 1], buf[i + 2]);
        paintPalette();
        toast(`已取色 ${color}`, 'info', 1200);
      }
      return;
    }
    if (tool === 'eraser') {
      buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
    } else {
      const [r, gg, b] = hexToRgb(color);
      buf[i] = r;
      buf[i + 1] = gg;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
    draw();
  };

  let drawing = false;
  let dirty = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    pushHistory();
    drawing = true;
    dirty = true;
    paintAt(e);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (drawing) paintAt(e);
  });
  window.addEventListener('mouseup', () => {
    drawing = false;
  });

  // ---- 工具栏 ----
  const toolBar = el('div.seg');
  for (const [t, label] of [['pen', '画笔'], ['eraser', '橡皮'], ['picker', '吸管']]) {
    toolBar.append(
      el(`button.seg-btn${tool === t ? '.active' : ''}`, {
        type: 'button',
        onclick: (e) => {
          tool = t;
          for (const b of toolBar.children) b.classList.remove('active');
          e.currentTarget.classList.add('active');
        },
      }, label),
    );
  }

  // ---- 调色板 ----
  const paletteBox = el('div.pixel-palette');
  const paintPalette = () => {
    setChildren(paletteBox);
    const colors = [...new Set([...DEFAULT_COLORS, color, ...extractColors()])];
    for (const c of colors) {
      paletteBox.append(
        el(`button.pixel-swatch${c.toLowerCase() === color.toLowerCase() ? '.active' : ''}`, {
          type: 'button',
          style: { background: c },
          title: c,
          onclick: () => {
            color = c;
            paintPalette();
          },
        }),
      );
    }
    const picker = el('input', { type: 'color', value: color, class: 'color-input' });
    picker.addEventListener('input', () => {
      color = picker.value;
      paintPalette();
    });
    paletteBox.append(picker);
  };

  const extractColors = () => {
    const set = new Map();
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] === 0) continue;
      const hex = rgbToHex(buf[i], buf[i + 1], buf[i + 2]);
      set.set(hex, (set.get(hex) || 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
  };

  // ---- 撤销 / 重做 ----
  const undo = () => {
    if (!history.length) return;
    future.push(buf.slice());
    buf.set(history.pop());
    draw();
  };
  const redo = () => {
    if (!future.length) return;
    history.push(buf.slice());
    buf.set(future.pop());
    draw();
  };

  window.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(canvas)) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
  });

  // ---- 从现有贴图初始化 ----
  const loadFromDataUrl = async (url) => {
    if (!url) return;
    await new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const tmp = document.createElement('canvas');
        tmp.width = SIZE;
        tmp.height = SIZE;
        const tg = tmp.getContext('2d');
        tg.imageSmoothingEnabled = false;
        tg.drawImage(img, 0, 0, SIZE, SIZE);
        const d = tg.getImageData(0, 0, SIZE, SIZE).data;
        buf.set(d);
        draw();
        res();
      };
      img.onerror = () => res();
      img.src = url;
    });
  };

  // ---- 组装弹窗 ----
  import('./ui.js').then(({ modal, confirmBox }) => {
    const body = el(
      'div.pixel-editor',
      {},
      el('div.pixel-toolbar', {}, toolBar, el('div.spacer'), el('button.btn.small.ghost', { type: 'button', onclick: undo }, '撤销'), el('button.btn.small.ghost', { type: 'button', onclick: redo }, '重做')),
      el('div.pixel-main', {}, canvas, el('div.pixel-side', {}, el('span.mini-label', { text: '颜色' }), paletteBox, el('p.note', { text: '导出尺寸固定 16×16，与 Minecraft 贴图一致。' }))),
    );

    const m = modal({
      title: `像素画板 —— ${values.nameZh || values.id || ''}`,
      body,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '保存贴图',
          kind: 'primary',
          onClick: async () => {
            const out = document.createElement('canvas');
            out.width = SIZE;
            out.height = SIZE;
            const og = out.getContext('2d');
            const imgData = og.createImageData(SIZE, SIZE);
            imgData.data.set(buf);
            og.putImageData(imgData, 0, 0);
            await onSave(out.toDataURL('image/png'));
            return true;
          },
        },
      ],
      width: 620,
    });

    draw();
    paintPalette();
    loadFromDataUrl(initialDataUrl);
  });
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
