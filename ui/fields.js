/**
 * 字段渲染器。
 *
 * 整个编辑器的表单都由模块声明的 fields 驱动，这里没有一行是针对具体物品/方块的硬编码。
 * 想支持新的字段类型，在 RENDERERS 里加一个函数即可 —— 这也是扩展点。
 */
import { el, setChildren, debounce } from './ui.js';
import { renderTexturePicker } from './texture_picker.js';

/** 需要占满整行的字段类型 */
const FULL_WIDTH = new Set(['textarea', 'list', 'drops', 'grid9', 'texture', 'tags', 'group']);

/**
 * 渲染一组字段。
 * @param fields 字段定义数组
 * @param values 当前值
 * @param ctx    { refs: {type: [{id,name}]}, root, type, onChange(patch), options }
 */
export function renderFields(fields, values, ctx) {
  const wrap = el('div.form-grid');
  const rows = [];

  for (const f of fields) {
    const row = el(`div.field${FULL_WIDTH.has(f.type) ? '.full' : ''}`);
    const input = renderField(f, values, ctx);
    if (!input) continue;
    row.append(input.node);
    if (f.hint) row.append(el('div.field-hint', { text: f.hint }));
    row.dataset.key = f.key;
    rows.push({ field: f, row });
    wrap.append(row);
  }

  // showIf：任何值变化后重算可见性
  const refreshVisibility = () => {
    for (const { field, row } of rows) {
      row.style.display = isVisible(field, values) ? '' : 'none';
    }
  };
  refreshVisibility();

  wrap.__refresh = refreshVisibility;
  return wrap;
}

/** 条件显示判定：showIf 可以是对象（AND），也可以是数组（仍按 AND 处理） */
export function isVisible(field, values) {
  const cond = field.showIf;
  if (!cond) return true;
  const list = Array.isArray(cond) ? cond : [cond];
  return list.every((c) => {
    const v = values[c.field];
    if (c.in) return c.in.includes(v);
    if (c.equals !== undefined) return v === c.equals;
    if (c.notEquals !== undefined) return v !== c.notEquals;
    if (c.truthy !== undefined) return c.truthy ? !!v : !v;
    return true;
  });
}

// ============================================================
// 各类型渲染器
// ============================================================

function label(field) {
  return el('label.field-label', {}, field.label || field.key, field.required ? el('span.req', { text: ' *' }) : null);
}

const RENDERERS = {
  id(field, values, ctx) {
    const input = el('input.input.mono', {
      value: values[field.key] ?? '',
      placeholder: field.placeholder || 'lower_case_id',
      spellcheck: 'false',
    });
    const err = el('div.field-error');
    const commit = () => {
      const v = input.value.trim();
      const problem = validateLocalId(v);
      err.textContent = problem || '';
      input.classList.toggle('invalid', !!problem);
      if (!problem) ctx.onChange({ [field.key]: v });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
    });
    // 自动把空格和大写转成下划线小写，减少用户报错
    input.addEventListener('input', () => {
      const fixed = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (fixed !== input.value) input.value = fixed;
    });
    return { node: el('div', {}, label(field), input, err) };
  },

  text(field, values, ctx) {
    const input = el('input.input', { value: values[field.key] ?? '', placeholder: field.placeholder || '' });
    bindText(input, field, ctx);
    return { node: el('div', {}, label(field), input) };
  },

  textarea(field, values, ctx) {
    const input = el('textarea.input', { rows: field.rows || 4, placeholder: field.placeholder || '' });
    input.value = values[field.key] ?? '';
    bindText(input, field, ctx);
    return { node: el('div', {}, label(field), input) };
  },

  number(field, values, ctx) {
    const input = el('input.input', {
      type: 'number',
      value: values[field.key] ?? field.default ?? '',
      min: field.min,
      max: field.max,
      step: field.step || 1,
    });
    const commit = () => {
      const raw = input.value.trim();
      if (raw === '') return ctx.onChange({ [field.key]: '' });
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      input.value = n;
      ctx.onChange({ [field.key]: n });
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    return { node: el('div', {}, label(field), input) };
  },

  select(field, values, ctx) {
    const sel = el('select.input');
    for (const o of field.options || []) {
      sel.append(el('option', { value: o.value, selected: String(values[field.key]) === String(o.value) }, o.label));
    }
    if (values[field.key] === undefined && field.default !== undefined) sel.value = String(field.default);
    sel.addEventListener('change', () => ctx.onChange({ [field.key]: sel.value }));
    return { node: el('div', {}, label(field), sel) };
  },

  checkbox(field, values, ctx) {
    // 条目里没这个键时听 default 的 —— 否则「默认开启」的开关会显示成关着，
    // 用户一保存就把 true 覆盖成 false，行为悄悄翻转。
    const input = el('input', {
      type: 'checkbox',
      checked: values[field.key] === undefined ? !!field.default : !!values[field.key],
    });
    input.addEventListener('change', () => ctx.onChange({ [field.key]: input.checked }));
    return {
      node: el(
        'div.check-row',
        {},
        el('label.switch', {}, input, el('span.track'), el('span.thumb')),
        el('span.check-label', { text: field.label || field.key }),
      ),
    };
  },

  list(field, values, ctx) {
    const cur = Array.isArray(values[field.key]) ? values[field.key] : splitLines(values[field.key]);
    const ta = el('textarea.input', { rows: Math.max(3, Math.min(10, cur.length + 1)), placeholder: '每行一条' });
    ta.value = cur.join('\n');
    const commit = () => ctx.onChange({ [field.key]: ta.value.split('\n').map((s) => s.trim()).filter(Boolean) });
    ta.addEventListener('blur', commit);
    ta.addEventListener('change', commit);
    return { node: el('div', {}, label(field), ta) };
  },

  ref(field, values, ctx) {
    const options = ctx.refs?.[field.refType] || [];
    const sel = el('select.input');
    sel.append(el('option', { value: '' }, options.length ? '— 请选择 —' : `— 还没有${field.label}，去「材质」页新建 —`));
    for (const o of options) sel.append(el('option', { value: o.id, selected: values[field.key] === o.id }, o.name));
    sel.addEventListener('change', () => ctx.onChange({ [field.key]: sel.value }));
    const node = el('div', {}, label(field), sel);
    if (field.refType && !options.length) {
      node.append(el('div.field-hint.warn', { text: `没有可用的${field.label}。先到左侧「进阶」里建一个。` }));
    }
    return { node };
  },

  /** 3×3 合成网格 */
  grid9(field, values, ctx) {
    const grid = Array.isArray(values[field.key]) ? [...values[field.key]] : new Array(9).fill('');
    while (grid.length < 9) grid.push('');
    const host = el('div.grid9');
    const cells = [];
    const refresh = () => {
      for (let i = 0; i < 9; i++) {
        const v = grid[i];
        cells[i].classList.toggle('filled', !!v);
        cells[i].textContent = v ? shortName(v) : '';
        cells[i].title = v || '空';
      }
    };
    for (let i = 0; i < 9; i++) {
      const cell = el('button.grid9-cell', {
        type: 'button',
        onclick: async () => {
          const v = await pickItem(ctx, grid[i], '选择这个格子的材料');
          if (v === null) return;
          grid[i] = v;
          refresh();
          ctx.onChange({ [field.key]: grid });
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          grid[i] = '';
          refresh();
          ctx.onChange({ [field.key]: grid });
        },
      });
      cells.push(cell);
      host.append(cell);
    }
    refresh();
    return {
      node: el('div', {}, label(field), host, el('div.field-hint', { text: '左键选材料，右键清空' })),
    };
  },

  /** 掉落物表格 */
  drops(field, values, ctx) {
    const list = Array.isArray(values[field.key]) ? values[field.key].map((d) => ({ ...d })) : [];
    const host = el('div.drops');
    const paint = () => {
      setChildren(host);
      if (!list.length) host.append(el('div.drops-empty', { text: '还没有掉落物 —— 不填的话，挖掉方块会掉它自己' }));
      list.forEach((d, i) => {
        host.append(
          el(
            'div.drop-row',
            {},
            el('button.drop-item', {
              type: 'button',
              onclick: async () => {
                const v = await pickItem(ctx, d.item, '选择掉落物');
                if (v === null) return;
                d.item = v;
                paint();
                commit();
              },
            }, d.item ? shortName(d.item) : '选择物品'),
            el('input.input.mini', {
              type: 'number', min: 1, max: 64, value: d.min ?? 1,
              onchange: (e) => { d.min = Number(e.target.value) || 1; commit(); },
            }),
            el('span.dash', { text: '~' }),
            el('input.input.mini', {
              type: 'number', min: 1, max: 64, value: d.max ?? 1,
              onchange: (e) => { d.max = Number(e.target.value) || 1; commit(); },
            }),
            el('label.chip', {}, el('input', {
              type: 'checkbox', checked: d.fortune !== false,
              onchange: (e) => { d.fortune = e.target.checked; commit(); },
            }), '时运'),
            el('button.icon-btn.danger', {
              type: 'button', title: '删除',
              onclick: () => { list.splice(i, 1); paint(); commit(); },
            }, '✕'),
          ),
        );
      });
      host.append(
        el('button.btn.ghost.small', {
          type: 'button',
          onclick: () => { list.push({ item: '', min: 1, max: 1, fortune: true }); paint(); },
        }, '+ 添加掉落物'),
      );
    };
    const commit = () => ctx.onChange({ [field.key]: list.filter((d) => d.item) });
    paint();
    return { node: el('div', {}, label(field), host) };
  },

  /** 标签列表（物品 id） */
  tags(field, values, ctx) {
    const list = Array.isArray(values[field.key]) ? [...values[field.key]] : [];
    const host = el('div.tags');
    const painter = () => {
      setChildren(host);
      list.forEach((t, i) => {
        host.append(el('span.tag-pill', {}, t, el('button.icon-btn.tiny', {
          type: 'button', onclick: () => { list.splice(i, 1); painter(); ctx.onChange({ [field.key]: list }); },
        }, '✕')));
      });
      host.append(el('button.btn.ghost.small', {
        type: 'button', onclick: async () => {
          const v = await pickItem(ctx, '', '添加物品');
          if (!v) return;
          list.push(v);
          painter();
          ctx.onChange({ [field.key]: list });
        },
      }, '+ 添加'));
    };
    painter();
    return { node: el('div', {}, label(field), host) };
  },

  /** 贴图选择器（独立组件） */
  texture(field, values, ctx) {
    const node = el('div');
    renderTexturePicker(node, values, field, ctx);
    return { node: el('div', {}, label(field), node) };
  },
};

function renderField(field, values, ctx) {
  const fn = RENDERERS[field.type] || RENDERERS.text;
  return fn(field, values, ctx);
}

// ---------------- 辅助 ----------------

function bindText(input, field, ctx) {
  const commit = () => ctx.onChange({ [field.key]: input.value });
  input.addEventListener('blur', commit);
  input.addEventListener('change', commit);
  // 输入人名这种短文本时即时保存，切条目不会丢
  if (field.key === 'nameZh' || field.key === 'nameEn') {
    input.addEventListener('input', debounce(commit, 600));
  }
}

function splitLines(s) {
  if (!s) return [];
  return String(s).split(/[\n,，、;；]+/).map((x) => x.trim()).filter(Boolean);
}

function validateLocalId(v) {
  if (!v) return '不能为空';
  if (!/^[a-z]/.test(v)) return '必须以小写字母开头';
  if (!/^[a-z0-9_]+$/.test(v)) return '只允许小写字母、数字、下划线';
  if (v.length < 2) return '至少 2 个字符';
  return '';
}

function shortName(v) {
  const s = String(v);
  return s.includes(':') ? s.split(':')[1] : s;
}

/** 物品选择弹窗：输入 id 或从当前工程的条目里挑 */
export async function pickItem(ctx, current, title = '选择物品') {
  const { modal, toast } = await import('./ui.js');
  return new Promise((resolve) => {
    const items = [
      ...(ctx.refs?.item || []).map((x) => ({ id: x.id, name: x.name, group: '本模组物品' })),
      ...(ctx.refs?.block || []).map((x) => ({ id: x.id, name: x.name, group: '本模组方块' })),
    ];
    const input = el('input.input', { value: current || '', placeholder: '输入 id，如 minecraft:stick 或 ruby' });
    const results = el('div.picker-results');
    const recent = el('div.picker-quick');
    const all = [...items, ...COMMON_ITEMS.map((i) => ({ id: i, name: i, group: '常用原版' }))];

    const paint = () => {
      const q = input.value.trim().toLowerCase();
      setChildren(results);
      const matched = all
        .filter((x) => !q || x.id.toLowerCase().includes(q) || String(x.name).includes(q))
        .slice(0, 60);
      for (const m of matched) {
        results.append(
          el('button.picker-item', {
            type: 'button',
            onclick: () => {
              resolve(m.id.includes(':') && !m.id.startsWith('minecraft:') ? m.id : m.id);
              m_modal.close();
            },
          }, el('code', { text: m.id }), el('span', { text: m.name })),
        );
      }
      if (!matched.length) results.append(el('div.empty', { text: '没有匹配项。直接按确定用你输入的 id' }));
    };

    input.addEventListener('input', paint);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        resolve(input.value.trim());
        m_modal.close();
      }
    });
    paint();

    const m_modal = modal({
      title,
      body: el('div', {}, input, recent, results),
      actions: [
        { label: '清空', kind: 'ghost', onClick: () => resolve('') },
        { label: '取消', kind: 'ghost', onClick: () => resolve(null) },
        { label: '用这个 id', kind: 'primary', onClick: () => resolve(input.value.trim()) },
      ],
      width: 560,
    });
    setTimeout(() => input.focus(), 40);
  });
}

/** 原版常用材料，方便不用记命名空间 */
export const COMMON_ITEMS = [
  'minecraft:stick', 'minecraft:iron_ingot', 'minecraft:gold_ingot', 'minecraft:diamond',
  'minecraft:emerald', 'minecraft:netherite_ingot', 'minecraft:copper_ingot', 'minecraft:coal',
  'minecraft:redstone', 'minecraft:lapis_lazuli', 'minecraft:quartz', 'minecraft:amethyst_shard',
  'minecraft:ender_pearl', 'minecraft:blaze_rod', 'minecraft:bone', 'minecraft:string',
  'minecraft:leather', 'minecraft:paper', 'minecraft:flint', 'minecraft:clay_ball',
  'minecraft:stone', 'minecraft:cobblestone', 'minecraft:deepslate', 'minecraft:obsidian',
  'minecraft:netherrack', 'minecraft:end_stone', 'minecraft:glass', 'minecraft:sand',
  'minecraft:oak_planks', 'minecraft:nether_star', 'minecraft:totem_of_undying', 'minecraft:arrow',
];
