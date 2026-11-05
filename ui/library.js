/**
 * 包库界面 —— 攒下来的东西都在这儿。
 *
 * 两块：
 *   左：列表（搜索 / 作用域筛选）
 *   右：详情（装进工程 / 导出 / 删除 / 换作用域）
 *
 * 「捕获」是从当前工程往回捞：勾一批条目，它自动把被引用的东西一起带走。
 */
import { api } from './api.js';
import { el, setChildren, fill, toast, modal, confirmBox } from './ui.js';

const KIND_LABEL = { content: '内容', effect: '效果', mixed: '内容+代码' };
const KIND_CLASS = { content: 'k-content', effect: 'k-effect', mixed: 'k-mixed' };
const SCOPE_LABEL = { builtin: '内置', user: '我的库', project: '本工程' };

const L = {
  packs: [],
  dirs: [],
  selected: null,
  search: '',
  scope: 'all',
  kind: 'all',
  ctx: null,
  host: null,
};

/** 入口 */
export function renderLibraryPanel(ctx) {
  L.ctx = ctx;
  const root = el('div.full-panel.library-panel');

  const left = el('div.lib-list');
  const right = el('div.lib-detail', {}, el('div.empty', { text: '选一个包看详情' }));

  fill(root, 
    el('div.panel-bar', {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回编辑'),
      el('h2.panel-title', { text: '效果库' }),
      el('div.spacer'),
      el('input.search', {
        placeholder: '搜索名称 / 标签 / 来源',
        oninput: (e) => {
          L.search = e.target.value.trim().toLowerCase();
          paintList(left, right);
        },
      }),
      el('select.mini-select', {
        onchange: (e) => {
          L.scope = e.target.value;
          paintList(left, right);
        },
      }, el('option', { value: 'all' }, '全部来源'), el('option', { value: 'project' }, '本工程'), el('option', { value: 'user' }, '我的库'), el('option', { value: 'builtin' }, '内置')),
      el('button.btn', { onclick: () => openCaptureDialog() }, '从工程捕获'),
      el('button.btn.ghost', { onclick: () => openImportDialog() }, '导入'),
    ),
    el('div.panel-body.two-col', {}, left, right),
  );

  L.host = root;
  load();
  return root;

  async function load() {
    try {
      const r = await api.listPacks(ctx.root);
      L.packs = r.packs;
      L.dirs = r.dirs || [];
    } catch (e) {
      toast(`读取库失败：${e.message}`, 'error');
      L.packs = [];
    }
    paintList(left, right);
  }

  function paintList(leftHost, rightHost) {
    const kw = L.search;
    const list = L.packs.filter((p) => {
      if (L.scope !== 'all' && p.scope !== L.scope) return false;
      if (L.kind !== 'all' && p.kind !== L.kind) return false;
      if (!kw) return true;
      const hay = [p.name, p.desc, (p.tags || []).join(' '), p.origin?.ns, p.origin?.file].join(' ').toLowerCase();
      return hay.includes(kw);
    });

    if (!list.length) {
      setChildren(leftHost, el('div.empty', { text: L.packs.length ? '没有匹配的包' : '库还是空的 —— 点右上「从工程捕获」攒第一个' }));
      return;
    }

    setChildren(leftHost, ...list.map((p) => card(p, rightHost)));
  }

  function card(p, rightHost) {
    const s = p.summary || {};
    const bits = [];
    if (s.entries) bits.push(`${s.entries} 项内容`);
    if (s.java) bits.push(`${s.java} 段 Java`);
    if (s.js) bits.push(`${s.js} 段 JS`);
    if (s.textures) bits.push(`${s.textures} 张贴图`);

    return el(`div.lib-card${L.selected === p.id ? '.active' : ''}`, {
      'data-id': p.id,
      onclick: () => {
        L.selected = p.id;
        for (const n of leftHostOf(rightHost).children) {
          n.classList.toggle('active', n.getAttribute('data-id') === p.id);
        }
        showDetail(p, rightHost);
      },
    },
      el('div.lib-card-head', {},
        el('span.lib-name', { text: p.name }),
        el(`span.kind-badge.${KIND_CLASS[p.kind] || 'k-content'}`, { text: KIND_LABEL[p.kind] || p.kind }),
        el('span.scope-badge', { text: SCOPE_LABEL[p.scope] || p.scope }),
      ),
      el('div.lib-card-sub', { text: bits.join(' · ') || '空包' }),
      p.origin?.file || p.origin?.ns ? el('div.lib-card-origin', { text: `来自 ${p.origin.file || p.origin.ns}` }) : null,
      p.error ? el('div.lib-card-error', { text: `⚠ ${p.error}` }) : null,
    );
  }

  function leftHostOf(rightHost) {
    return rightHost.parentElement.querySelector('.lib-list');
  }

  async function showDetail(summary, rightHost) {
    setChildren(rightHost, el('div.empty', { text: '加载中…' }));
    let pack;
    try {
      ({ pack } = await api.getPack(ctx.root, summary.id));
    } catch (e) {
      setChildren(rightHost, el('div.empty', { text: `读取失败：${e.message}` }));
      return;
    }

    const s = summary.summary || {};
    const body = el('div.lib-detail-inner');

    fill(body, 
      el('div.detail-head', {},
        el('h3', { text: pack.name }),
        el(`span.kind-badge.${KIND_CLASS[pack.kind] || 'k-content'}`, { text: KIND_LABEL[pack.kind] || pack.kind }),
      ),
      pack.desc ? el('p.detail-desc', { text: pack.desc }) : null,
      pack.tags?.length ? el('div.tag-row', {}, ...pack.tags.map((t) => el('span.tag', { text: t }))) : null,
      pack.origin ? el('div.detail-meta', { text: describeOrigin(pack.origin) }) : null,
      el('div.detail-meta', { text: `来源：${SCOPE_LABEL[pack.scope] || pack.scope}${pack.requires?.mcVersion?.length ? ` · 适用 MC ${pack.requires.mcVersion.join('/')}` : ''}` }),
    );

    // 内容明细
    const entriesBox = el('div.detail-section');
    fill(entriesBox, el('div.section-label', { text: '内容' }));
    const byType = pack.content?.entries || {};
    if (!Object.keys(byType).length) {
      fill(entriesBox, el('div.muted.small', { text: '（无内容条目，只有代码）' }));
    } else {
      for (const [type, list] of Object.entries(byType)) {
        const typeDef = ctx.types.find((t) => t.id === type);
        fill(entriesBox, 
          el('div.entry-group', {},
            el('span.entry-group-name', { text: `${typeDef?.label || type}（${list.length}）` }),
            el('span.entry-group-ids', { text: list.map((x) => x.id).join(', ') }),
          ),
        );
      }
    }
    fill(body, entriesBox);

    // 代码
    if (pack.content?.java?.length || pack.content?.js?.length) {
      const codeBox = el('div.detail-section');
      fill(codeBox, el('div.section-label', { text: '代码' }));
      for (const j of pack.content.java || []) {
        fill(codeBox, el('div.code-line', {},
          el('span.code-tag', { text: `@hook:${j.target || 'init'}` }),
          el('span', { text: j.name || '（未命名）' }),
        ));
      }
      for (const j of pack.content.js || []) {
        fill(codeBox, el('div.code-line', {}, el('span.code-tag', { text: 'JS' }), el('span', { text: j.path })));
      }
      fill(body, codeBox);
    }

    // 参数
    if (pack.params?.length) {
      const pbox = el('div.detail-section');
      fill(pbox, el('div.section-label', { text: `可调参数（${pack.params.length}）` }));
      for (const pr of pack.params) {
        fill(pbox, el('div.param-chip', {}, el('strong', { text: pr.label || pr.key }), el('span.muted', { text: `默认 ${pr.default}` })));
      }
      fill(body, pbox);
    }

    // 贴图
    if (pack.content?.textures?.length) {
      const tbox = el('div.detail-section');
      fill(tbox, el('div.section-label', { text: `贴图（${pack.content.textures.length}）` }));
      const strip = el('div.tex-strip');
      for (const t of pack.content.textures.slice(0, 24)) {
        fill(strip, el('img.tex-mini', { src: t.dataUrl, title: t.path }));
      }
      fill(tbox, strip);
      fill(body, tbox);
    }

    // 操作
    const actions = el('div.detail-actions');
    fill(actions, 
      el('button.btn.primary', { onclick: () => openInstallDialog(pack) }, '装进当前工程'),
      el('button.btn.ghost', { onclick: () => doExport(pack) }, '导出'),
      pack.writable
        ? el('button.btn.ghost', {
          onclick: async () => {
            const to = pack.scope === 'project' ? 'user' : 'project';
            try {
              await api.movePack({ root: ctx.root, id: pack.id, to });
              toast(`已移到${SCOPE_LABEL[to]}`, 'ok');
              await load();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, pack.scope === 'project' ? '存到我的库' : '移到本工程')
        : null,
      pack.writable
        ? el('button.btn.ghost.danger-text', {
          onclick: async () => {
            if (!(await confirmBox(`删除「${pack.name}」？只删库里的文件，不影响已装进工程的内容。`, { danger: true }))) return;
            try {
              await api.deletePack({ root: ctx.root, id: pack.id, scope: pack.scope });
              toast('已删除', 'ok');
              L.selected = null;
              setChildren(rightHost, el('div.empty', { text: '选一个包看详情' }));
              await load();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, '删除')
        : null,
    );
    fill(body, actions);

    setChildren(rightHost, body);
  }
}

function describeOrigin(o) {
  if (!o) return '';
  if (o.kind === 'capture') return `从工程 ${o.name || ''}（${o.ns}）捕获`;
  if (o.kind === 'analyze') return `从 ${o.file || '外部 jar'} 提取（${o.modName || o.modId || o.ns}）`;
  if (o.kind === 'template') return '内置效果模板';
  return '';
}

// ============================================================
// 安装
// ============================================================

async function openInstallDialog(pack) {
  const ctx = L.ctx;
  const values = {};
  for (const p of pack.params || []) values[p.key] = p.default;

  const previewHost = el('div.install-preview', {}, el('div.muted.small', { text: '正在试算…' }));

  async function refreshPreview() {
    try {
      const { preview } = await api.previewPack({ root: ctx.root, id: pack.id, params: values });
      setChildren(previewHost, ...renderPreview(preview));
    } catch (e) {
      setChildren(previewHost, el('div.error-text', { text: e.message }));
    }
  }

  const paramBox = el('div.param-form');
  if (pack.params?.length) {
    fill(paramBox, el('div.section-label', { text: '参数' }));
    for (const p of pack.params) {
      const input =
        p.type === 'select'
          ? el('select.mini-select', {
            onchange: (e) => {
              values[p.key] = e.target.value;
              refreshPreview();
            },
          }, ...(p.options || []).map((o) => el('option', { value: o, selected: String(o) === String(p.default) }, String(o))))
          : el('input', {
            type: p.type === 'number' ? 'number' : 'text',
            value: p.default ?? '',
            step: p.step,
            min: p.min,
            max: p.max,
            oninput: (e) => {
              values[p.key] = p.type === 'number' ? Number(e.target.value) : e.target.value;
              refreshPreview();
            },
          });
      fill(paramBox, el('label.field-row', {}, el('span.field-label', { text: p.label || p.key }), input));
      if (p.hint) fill(paramBox, el('div.field-hint', { text: p.hint }));
    }
  }

  const body = el('div', {}, paramBox, el('div.section-label', { text: '装进去会发生什么' }), previewHost);
  const m = modal({
    title: `装进工程：${pack.name}`,
    body,
    width: 620,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '装进去',
        kind: 'primary',
        onClick: async () => {
          try {
            const r = await api.applyPack({ root: ctx.root, id: pack.id, params: values });
            const n = Object.values(r.report.added).reduce((a, l) => a + l.length, 0);
            toast(`已装入 ${n} 项内容${r.report.java ? ` + ${r.report.java} 段代码` : ''}`, 'ok');
            if (r.report.renames.length) {
              toast(`有 ${r.report.renames.length} 个 id 撞名，已自动改名`, 'info', 5000);
            }
            m.close();
            ctx.onChanged?.();
          } catch (e) {
            toast(e.message, 'error', 6000);
            return false;
          }
        },
      },
    ],
  });

  await refreshPreview();
}

function renderPreview(pv) {
  const out = [];
  const counts = Object.entries(pv.counts || {}).filter(([, n]) => n > 0);
  const total = counts.reduce((n, [, v]) => n + v, 0);

  out.push(el('div.preview-line', {},
    el('strong', { text: total ? `加入 ${total} 项内容` : '没有内容条目' }),
    total ? el('span.muted', { text: counts.map(([k, v]) => `${k} ${v}`).join(' · ') }) : null,
  ));
  if (pv.java) out.push(el('div.preview-line', { text: `+ ${pv.java} 段 Java 代码（插到钩子锚点）` }));
  if (pv.js) out.push(el('div.preview-line', { text: `+ ${pv.js} 段 JS 钩子` }));
  if (pv.textures) out.push(el('div.preview-line', { text: `+ ${pv.textures} 张贴图` }));

  if (pv.renames?.length) {
    const box = el('div.preview-warn');
    fill(box, el('div', { text: `有 ${pv.renames.length} 个 id 和现有内容撞了，会自动改名（引用同步跟着改）：` }));
    fill(box, el('div.mono.small', { text: pv.renames.map((r) => `${r.from} → ${r.to}`).join('，') }));
    out.push(box);
  }
  if (pv.externalRefs?.length) {
    out.push(el('div.preview-warn', { text: `包里引用了没带走的内容：${pv.externalRefs.slice(0, 6).join('、')} —— 装完可能显示为缺失` }));
  }
  if (pv.missingParams?.length) {
    out.push(el('div.preview-warn', { text: `缺少参数：${pv.missingParams.join('、')}` }));
  }
  if (!out.length) out.push(el('div.muted.small', { text: '空包' }));
  return out;
}

// ============================================================
// 捕获
// ============================================================

function openCaptureDialog() {
  const ctx = L.ctx;
  const selected = new Map(); // type -> Set(id)
  let activeType = ctx.types[0]?.id;

  const listHost = el('div.capture-list');
  const nameInput = el('input', { placeholder: '给这套东西起个名字', value: '' });
  const scopeSel = el('select.mini-select', {}, el('option', { value: 'project' }, '存到本工程'), el('option', { value: 'user' }, '存到我的库（所有工程可用）'));
  const closureSel = el('select.mini-select', {},
    el('option', { value: 'full' }, '带上被引用的内容（推荐）'),
    el('option', { value: 'strong' }, '只带强依赖（材质等）'),
    el('option', { value: 'none' }, '只带我勾的'),
  );
  const typeSel = el('select.mini-select', {
    onchange: (e) => {
      activeType = e.target.value;
      paint();
    },
  }, ...ctx.types.map((t) => el('option', { value: t.id }, `${t.label}（${(ctx.project?.entries?.[t.id] || []).length}）`)));

  function paint() {
    const entries = ctx.project?.entries?.[activeType] || [];
    const set = selected.get(activeType) || new Set();
    if (!entries.length) {
      setChildren(listHost, el('div.empty', { text: '这个类型下还没有内容' }));
      return;
    }
    setChildren(listHost,
      el('div.capture-toolbar', {},
        el('button.btn.ghost.small', {
          onclick: () => {
            for (const e of entries) set.add(e.id);
            selected.set(activeType, set);
            paint();
          },
        }, '全选'),
        el('button.btn.ghost.small', {
          onclick: () => {
            set.clear();
            selected.set(activeType, set);
            paint();
          },
        }, '清空'),
        el('span.muted.small', { text: `已选 ${set.size} / ${entries.length}` }),
      ),
      el('div.capture-items', {},
        ...entries.map((e) => el('label.capture-item', {},
          el('input', {
            type: 'checkbox',
            checked: set.has(e.id),
            onchange: (ev) => {
              if (ev.target.checked) set.add(e.id);
              else set.delete(e.id);
              selected.set(activeType, set);
            },
          }),
          el('span', { text: e.nameZh || e.id }),
          el('span.muted.mono.small', { text: e.id }),
        )),
      ),
    );
  }
  paint();

  const m = modal({
    title: '把内容存成可复用的包',
    width: 640,
    body: el('div', {},
      el('div.section-label', { text: '要带走哪些' }),
      el('div.inline-row', {}, typeSel),
      listHost,
      el('div.section-label', { text: '怎么带' }),
      el('div.inline-row', {}, closureSel),
      el('div.field-hint', { text: '「带上被引用的内容」会把材质、被引用的物品、配方材料一起打包，换工程才不会缺东西。' }),
      el('div.section-label', { text: '存到哪' }),
      el('div.inline-row', {}, scopeSel),
      el('div.field-row', {}, el('span.field-label', { text: '名称' }), nameInput),
    ),
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '存进库',
        kind: 'primary',
        onClick: async () => {
          const types = {};
          for (const [t, set] of selected) if (set.size) types[t] = [...set];
          if (!Object.keys(types).length) {
            toast('至少勾一个条目', 'warn');
            return false;
          }
          try {
            const { pack, missing } = await api.capturePack({
              root: ctx.root,
              types,
              closure: closureSel.value,
              name: nameInput.value.trim() || undefined,
            });
            if (missing?.length) toast(`${missing.length} 条引用不在工程里，已跳过`, 'warn', 4000);
            const saved = await api.savePack({ root: ctx.root, pack, scope: scopeSel.value });
            toast(`已存进库：${saved.pack.name}`, 'ok');
            m.close();
            reloadPanel();
          } catch (e) {
            toast(e.message, 'error', 6000);
            return false;
          }
        },
      },
    ],
  });
}

// ============================================================
// 导入 / 导出
// ============================================================

function openImportDialog() {
  const ctx = L.ctx;
  const ta = el('textarea.code-area', { rows: 14, placeholder: '把 .mcpkg.json 的内容粘贴到这里（或直接把文件拖进来）' });
  const scopeSel = el('select.mini-select', {}, el('option', { value: 'project' }, '存到本工程'), el('option', { value: 'user' }, '存到我的库'));

  ta.addEventListener('dragover', (e) => e.preventDefault());
  ta.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) ta.value = await f.text();
  });

  const m = modal({
    title: '导入包',
    width: 620,
    body: el('div', {},
      ta,
      el('div.inline-row', {}, scopeSel),
      el('div.field-hint', { text: '可以直接把 .mcpkg.json 文件拖到上面的框里。' }),
    ),
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '导入',
        kind: 'primary',
        onClick: async () => {
          const text = ta.value.trim();
          if (!text) {
            toast('还没内容', 'warn');
            return false;
          }
          try {
            const r = await api.importPack({ root: ctx.root, text, scope: scopeSel.value });
            toast(`已导入：${r.pack.name}`, 'ok');
            m.close();
            reloadPanel();
          } catch (e) {
            toast(e.message, 'error', 7000);
            return false;
          }
        },
      },
    ],
  });
}

async function doExport(pack) {
  try {
    const { filename, text } = await api.exportPack(L.ctx.root, pack.id);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    fill(document.body, a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`已导出 ${filename}`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function reloadPanel() {
  // 简单粗暴：重画整个面板（列表和详情都要跟着新数据走）
  const ctx = L.ctx;
  const app = document.querySelector('#app');
  const old = app.querySelector('.full-panel.library-panel');
  if (!old) return;
  const fresh = renderLibraryPanel(ctx);
  old.replaceWith(fresh);
}
