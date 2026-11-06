/**
 * 功能转换器面板。
 *
 * 这个面板刻意把「能不能自动转」摆在比代码更显眼的位置：
 * 跨加载器搬运最容易骗人的地方，就是看起来改好了、一编译全是错。
 * 所以每一项都带四档状态 + 证据/做法提示，需人工的项目不会藏着。
 */
import { api } from './api.js';
import { el, fill, setContent, toast, modal, confirmBox } from './ui.js';

const C = {
  ctx: null, host: null, out: null,
  targets: [], rules: [], diagnostics: [], effects: [], matrix: null,
  source: 'project', from: '', to: '', effectId: '', code: '', filePath: '',
  report: null, java: '', busy: false,
};

const STATUS = {
  ported: { label: '自动完成', hint: '有证据的等价改写', color: '#3f9e6d' },
  adapted: { label: '已改写', hint: '建议编译确认', color: '#3d8bd4' },
  manual: { label: '需人工', hint: '原样保留 + TODO', color: '#e8a33d' },
  blocked: { label: '做不到', hint: '目标没有对应能力', color: '#c25f3d' },
};

function targetOptions(select, current, targets, placeholder) {
  fill(select,
    ...(placeholder ? [el('option', { value: '', text: placeholder })] : []),
    ...targets.map((t) => el('option', {
      value: t.id, text: `${t.label} · ${t.platform} ${t.mcVersion}`,
      selected: t.id === current,
    })),
  );
}

function currentTargetId() {
  const p = C.ctx?.project;
  if (!p?.target) return 'fabric-26.3';
  return p.target.id || `${p.target.platform}-${p.target.mcVersion}`;
}

function sourcePayload() {
  const from = C.from || currentTargetId();
  switch (C.source) {
    case 'project': return { type: 'project', root: C.ctx?.root || '', from };
    case 'code': return { type: 'code', code: C.code, name: '粘贴的 Java', from };
    case 'effect': return { type: 'effect', id: C.effectId, from };
    case 'file': return { type: 'file', path: C.filePath, from };
    default: return { type: 'project', root: C.ctx?.root || '', from };
  }
}

async function loadMeta() {
  try {
    const [r, m, e] = await Promise.all([api.convertRules(), api.convertMatrix(), api.effects()]);
    C.rules = r.rules || [];
    C.diagnostics = r.diagnostics || [];
    C.targets = r.targets || [];
    C.matrix = m.matrix || null;
    C.effects = e.effects || [];
    if (!C.from) C.from = currentTargetId();
    if (!C.to) C.to = C.targets.find((t) => t.id !== C.from)?.id || C.targets[1]?.id || '';
    if (!C.effectId) C.effectId = C.effects[0]?.id || '';
  } catch (err) {
    toast(`读转换规则失败：${err.message}`, 'error');
  }
}

async function doPreview() {
  if (C.busy) return;
  if (!C.to) { toast('先选目标平台', 'error'); return; }
  if (C.source === 'code' && !C.code.trim()) { toast('先贴一段 Java 代码', 'error'); return; }
  if (C.source === 'file' && !C.filePath.trim()) { toast('先填文件路径', 'error'); return; }
  if ((C.source === 'project' || C.source === 'file') && !C.ctx?.root && C.source === 'project') {
    toast('先打开一个工程', 'error'); return;
  }
  C.busy = true;
  render();
  try {
    const r = await api.convertPreview({ source: sourcePayload(), to: C.to, from: C.from, root: C.ctx?.root || '' });
    C.report = r.report;
    C.java = r.java || '';
  } catch (err) {
    C.report = null; C.java = '';
    toast(`转换失败：${err.message}`, 'error');
  } finally {
    C.busy = false;
    render();
  }
}

async function doApply() {
  if (!C.report || !C.ctx?.root) return;
  const s = C.report.summary;
  const ok = await confirmBox(
    `会把当前工程切到 ${C.report.to.label}，并写入转换后的 ${C.report.patch.changedParts.length} 个部件。\n` +
    `另有 ${s.manual + s.blocked} 项需要人工复核（代码里已写 TODO）。\n` +
    `原有工程数据会被改动，建议先备份。`,
    { title: '应用转换结果', danger: true },
  );
  if (!ok) return;
  try {
    const r = await api.convertApply({ root: C.ctx.root, source: sourcePayload(), to: C.to, from: C.from });
    toast(`已切到 ${r.applied.to}，${r.applied.hooks} 段 Java。接着点「生成」。`, 'ok');
    C.ctx.onChanged?.();
  } catch (err) {
    toast(`应用失败：${err.message}`, 'error');
  }
}

function openRules() {
  const body = el('div.convert-rules');
  fill(body,
    el('div.section-label', { text: `已登记 ${C.rules.length} 条规则` }),
    ...C.rules.map((r) => el('div.card', {},
      el('div.card-head', {}, el('strong', { text: r.label }), el('span.muted.small', { text: ` ${r.id} · 优先级 ${r.priority} · ${r.builtin ? '内置' : '外部'}` })),
      el('div.muted.small', { text: r.description || '' }),
    )),
    el('div.section-label', { text: '自定义规则放哪' }),
    el('pre.code-block', { text: '~/.mcstudio/convert/<名字>.mjs\n<工程>/.studio/convert/<名字>.mjs\nMCSTUDIO_CONVERT=/path/to/rules' }),
    ...(C.diagnostics.length ? [el('div.section-label', { text: '加载诊断' }), ...C.diagnostics.map((d) => el('div.warn-line', { text: d }))] : []),
  );
  modal({ title: '转换规则与诊断', body, width: 640, actions: [{ label: '知道了' }] });
}

function summaryCard() {
  const r = C.report;
  if (!r) return el('div.card.empty', {}, '选好来源和目标，点「预览转换」看结果。');
  const s = r.summary;
  return el('div.card.convert-summary', {},
    el('div.card-head', {},
      el('strong', { text: `${r.from.label} → ${r.to.label}` }),
      el('span.muted.small', { text: ` ${r.from.platform} ${r.from.mcVersion} → ${r.to.platform} ${r.to.mcVersion}` }),
    ),
    el('div.convert-badges', {}, ...['ported', 'adapted', 'manual', 'blocked'].map((k) =>
      el('span.convert-badge', { style: { borderColor: STATUS[k].color } },
        el('b', { text: String(s[k]) }), el('span', { text: STATUS[k].label })),
    )),
    el('div.convert-bar', {}, el('div.convert-bar-fill', { style: { width: `${s.autoRate}%` } })),
    el('div.muted.small', { text: `自动率 ${s.autoRate}% · 综合覆盖 ${s.coverage}% · 需复核 ${r.needsReview} 项` }),
    ...(r.needsReview ? [el('div.warn-line', { text: `有 ${r.needsReview} 项没敢自动改，代码里已标 // TODO(转换)，编译前请按提示处理。` })] : []),
    el('div.row-actions', {},
      el('button.btn.small.primary', { onclick: doApply, disabled: !C.ctx?.root }, '应用到当前工程'),
      el('button.btn.small.ghost', {
        onclick: () => {
          if (!navigator.clipboard) { toast('浏览器不允许访问剪贴板，请手动选中代码复制', 'warn'); return; }
          navigator.clipboard.writeText(C.java)
            .then(() => toast('已复制转换后的 Java', 'ok'))
            .catch((e) => toast(`复制失败：${e.message}`, 'error'));
        },
      }, '复制结果'),
    ),
  );
}

function itemCard(i) {
  const st = STATUS[i.status] || STATUS.manual;
  return el('div.card.convert-item', { style: { borderLeftColor: st.color } },
    el('div.card-head', {},
      el('span.convert-status', { style: { background: st.color } , text: st.label }),
      el('strong', { text: i.label }),
      el('span.muted.small', { text: ` ${i.kind} · ${i.rule}` }),
    ),
    ...(i.notes || []).map((n) => el('div.small', { text: `· ${n}` })),
    ...(i.suggestion ? [el('div.field-hint', { text: `→ ${i.suggestion}` })] : []),
    ...(i.before && i.after && i.before !== i.after ? [
      el('div.convert-diff', {},
        el('pre.code-block', { text: `− ${String(i.before).slice(0, 400)}` }),
        el('pre.code-block', { text: `+ ${String(i.after).slice(0, 400)}` }),
      ),
    ] : []),
  );
}

function reportArea() {
  const r = C.report;
  return el('div.convert-report', {},
    summaryCard(),
    ...(r ? [
      el('div.section-label', { text: '逐项结论' }),
      ...r.items.map(itemCard),
      el('div.section-label', { text: '转换后的 Java' }),
      el('pre.code-block.convert-code', { text: C.java || '（这段功能没有 Java 代码）' }),
      ...(r.rules?.length ? [el('div.muted.small', { text: `参与规则：${r.rules.map((x) => `${x.label}(${x.hits})`).join('、')}` })] : []),
    ] : []),
  );
}

function sourceFields() {
  const fromSel = el('select.input');
  targetOptions(fromSel, C.from, C.targets, '');
  fromSel.addEventListener('change', () => { C.from = fromSel.value; });
  const toSel = el('select.input');
  targetOptions(toSel, C.to, C.targets, '');
  toSel.addEventListener('change', () => { C.to = toSel.value; });

  const srcSel = el('select.input');
  fill(srcSel,
    el('option', { value: 'project', text: '当前工程', selected: C.source === 'project' }),
    el('option', { value: 'code', text: '贴一段 Java 代码', selected: C.source === 'code' }),
    el('option', { value: 'effect', text: '内置效果库里的效果', selected: C.source === 'effect' }),
    el('option', { value: 'file', text: '分享包 / 库文件路径', selected: C.source === 'file' }),
  );
  srcSel.addEventListener('change', () => { C.source = srcSel.value; C.report = null; render(); });

  const extra = [];
  if (C.source === 'code') {
    const ta = el('textarea.input.convert-code-input', { placeholder: '把一段 Java 钩子代码贴进来（全限定名，不要 package/import）' });
    ta.value = C.code;
    ta.addEventListener('input', () => { C.code = ta.value; });
    extra.push(el('div.field', {}, el('div.field-label', { text: 'Java 代码' }), ta));
  }
  if (C.source === 'effect') {
    const sel = el('select.input');
    fill(sel, ...C.effects.map((e) => el('option', { value: e.id, text: `${e.name}（${e.category}）`, selected: e.id === C.effectId })));
    sel.addEventListener('change', () => { C.effectId = sel.value; });
    extra.push(el('div.field', {}, el('div.field-label', { text: '效果' }), sel,
      el('div.field-hint', { text: '内置效果是 Fabric 26.3 写的；转到 Forge 时事件部分会明确标「需人工」。' })));
  }
  if (C.source === 'file') {
    const inp = el('input.input', { value: C.filePath, placeholder: '绝对路径，例如 C:\\...\\mypack.mcpkg.json' });
    inp.addEventListener('input', () => { C.filePath = inp.value; });
    extra.push(el('div.field', {}, el('div.field-label', { text: '文件路径' }), inp));
  }

  const matrix = C.matrix?.pairs?.find((p) => p.from === C.from && p.to === C.to);
  return el('div.card', {},
    el('div.card-head', {}, el('strong', { text: '转换什么' })),
    el('div.field', {}, el('div.field-label', { text: '来源' }), srcSel),
    ...extra,
    el('div.field-row', {},
      el('div.field', {}, el('div.field-label', { text: '源目标' }), fromSel),
      el('div.field', {}, el('div.field-label', { text: '转到' }), toSel),
    ),
    ...(matrix ? [el('div.field-hint', { text: `这对目标有 ${matrix.verifiedTemplates} 组证据模板、${matrix.symbolGroups} 组低风险符号映射。${matrix.crossLoader ? '跨加载器：事件与 jar 依赖一定会标需人工。' : ''}` })] : []),
    el('div.row-actions', {},
      el('button.btn.primary', { onclick: doPreview, disabled: C.busy }, C.busy ? '转换中…' : '预览转换'),
      el('button.btn.ghost', { onclick: openRules }, '规则 / 诊断'),
    ),
    el('div.field-hint', { text: '预览只读，不会动工程；确认后才「应用」。' }),
  );
}

function render() {
  if (!C.out) return;
  setContent(C.out,
    el('div.convert-side', {}, sourceFields(),
      el('div.card', {},
        el('div.card-head', {}, el('strong', { text: '这个转换器怎么判断' })),
        el('div.small', { text: '· 自动完成：积木库里同一个功能有两份真编译过的模板，整段换。' }),
        el('div.small', { text: '· 已改写：类名 / 方法名一一对应，建议再编译确认。' }),
        el('div.small', { text: '· 需人工：加载器事件、注册入口、jar 依赖 —— 原样保留并写 TODO。' }),
        el('div.small', { text: '· 做不到：目标没有对应实现（例如积木缺模板），要补实现。' }),
        el('div.field-hint', { text: '内容条目和积木程序本身是平台无关的，生成器会按新目标重出 Java 与资源。' }),
      ),
    ),
    reportArea(),
  );
}

export function renderConvertPanel(ctx) {
  C.ctx = ctx;
  C.host = el('div.full-panel.convert-panel');
  C.report = null; C.java = '';
  fill(C.host,
    el('div.panel-bar', {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回'),
      el('h2.panel-title', { text: '功能转换器' }),
      el('span.muted.small', { text: '把功能 / 效果尽量搬到另一个版本或加载器' }),
      el('div.spacer'),
      el('button.btn.ghost.small', { onclick: () => ctx.onOpenDoc?.('builtin/guides/10-转换器插件') }, '怎么用'),
    ),
  );
  C.out = el('div.convert-body');
  C.host.append(C.out);
  render();
  loadMeta().then(render);
  return C.host;
}
