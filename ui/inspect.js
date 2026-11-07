/**
 * 拆解台 —— 把一个导入的 mod 当成「一个个可单独研究的东西」。
 *
 * 分析引擎已经把 mod 拆成了物品 / 方块 / 配方 / 工具材质 / 盔甲材质 / 矿物生成 /
 * 进度 / 代码能力 / 源码这些独立条目。这里把它们组织成可点的卡片：
 *   - 每条都能展开看细节；
 *   - 数值型字段（耐久、硬度、堆叠数、矿物大小…）直接就地改；
 *   - 勾选要保留的，连同改动一起导出成可复用包，存进包库，并可应用当前工程。
 *
 * 设计：编辑状态全在客户端（I.edits / I.sel / I.effectIds），导出时才把
 * overrides 交给后端 reportToPack，按 id 合并进条目。后端不出新格式。
 */
import { api } from './api.js';
import { el, setChildren, setContent, fill, toast, modal, promptBox } from './ui.js';

const I = {
  ctx: null,
  path: '',
  report: null,
  sel: {}, // type -> Set(id)
  edits: {}, // type -> id -> { field: value }
  effectIds: new Set(),
  effectParams: {}, // effectId -> { key: value }
  activeType: 'item',
  filter: '',      // 当前分组的搜索词
  limit: 200,      // 大分组的分页条数
  host: null,
  loading: false,
  error: null,
};

/**
 * 每种内容的「可编辑数值」字段表。
 * kind: text / int / num / bool
 * 只列真正能从资源反推、又值得改的数值；没有编码进 class 常量的值（比如真实修复值）
 * 不在这里假装能改。
 */
const FIELDS = {
  item: [
    { key: 'nameZh', label: '显示名', kind: 'text' },
    { key: 'stacksTo', label: '堆叠数', kind: 'int', min: 1, max: 99 },
  ],
  block: [
    { key: 'nameZh', label: '显示名', kind: 'text' },
    { key: 'requiresTool', label: '需工具挖掘', kind: 'bool' },
  ],
  recipe: [
    { key: 'count', label: '产物数量', kind: 'int', min: 1, max: 64 },
  ],
  tier: [
    { key: 'durability', label: '耐久', kind: 'int', min: 1 },
    { key: 'speed', label: '挖掘速度', kind: 'num', step: 0.1 },
    { key: 'attackDamageBonus', label: '攻击加成', kind: 'num', step: 0.1 },
    { key: 'enchantmentValue', label: '附魔值', kind: 'int', min: 0 },
  ],
  armorMaterial: [
    { key: 'durability', label: '耐久', kind: 'int', min: 1 },
    { key: 'defHelmet', label: '头盔防御', kind: 'int', min: 0, max: 20 },
    { key: 'defChest', label: '胸甲防御', kind: 'int', min: 0, max: 20 },
    { key: 'defLegs', label: '护腿防御', kind: 'int', min: 0, max: 20 },
    { key: 'defBoots', label: '靴子防御', kind: 'int', min: 0, max: 20 },
    { key: 'toughness', label: '韧性', kind: 'num', step: 0.5, min: 0 },
    { key: 'knockbackResistance', label: '击退抗性', kind: 'num', step: 0.05, min: 0, max: 1 },
    { key: 'enchantmentValue', label: '附魔值', kind: 'int', min: 0 },
  ],
  worldgen: [
    { key: 'size', label: '矿脉大小', kind: 'int', min: 1 },
    { key: 'count', label: '每区块数量', kind: 'int', min: 1 },
    { key: 'rarity', label: '稀有度', kind: 'int', min: 1 },
    { key: 'minY', label: '最低 Y', kind: 'int' },
    { key: 'maxY', label: '最高 Y', kind: 'int' },
  ],
  advancement: [
    { key: 'titleZh', label: '标题', kind: 'text' },
  ],
};

/** 左侧分组：顺序即展示顺序 */
const GROUPS = [
  { type: 'item', label: '物品', kind: 'contents' },
  { type: 'block', label: '方块', kind: 'contents' },
  { type: 'recipe', label: '配方', kind: 'contents' },
  { type: 'tier', label: '工具材质', kind: 'contents' },
  { type: 'armorMaterial', label: '盔甲材质', kind: 'contents' },
  { type: 'worldgen', label: '矿物生成', kind: 'contents' },
  { type: 'advancement', label: '进度', kind: 'contents' },
  { type: 'ability', label: '代码能力', kind: 'ability' },
  { type: 'source', label: '源码', kind: 'source' },
];

/**
 * 基础分组 + 当前报告里扩展注册的动态分组。
 * 扩展（如 Goety 的「聚晶 / 套装词条 / 仪式配方」）只在其内容真正存在时才出现，
 * 所以「别的包不一定有」也不会凭空多出空分组。
 */
function groups() {
  const ext = [];
  const types = I.report?.extensionTypes || {};
  const contents = I.report?.contents || {};
  for (const [t, def] of Object.entries(types)) {
    if ((contents[t] || []).length) ext.push({ type: t, label: def.label || t, kind: 'contents', icon: def.icon });
  }
  return [...GROUPS, ...ext];
}

/** 扩展可能为本内容类型注册了可编辑字段；没有就退回内置 FIELDS */
function fieldsFor(type) {
  const ext = I.report?.extensionFields?.[type];
  if (ext && ext.length) return ext;
  return FIELDS[type] || [];
}

let effectsCache = null;

/** 从任何地方进入拆解台：设置路径，再让 app.js 切视图 */
export function openInspect(path) {
  I.path = path;
  window.dispatchEvent(new CustomEvent('mc-nav', { detail: { view: 'inspect' } }));
}

export function renderInspectPanel(ctx) {
  I.ctx = ctx;
  I.host = el('div.full-panel.inspect-panel');

  fill(I.host,
    el('div.panel-bar', {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回'),
      el('h2.panel-title', { text: '拆解台' }),
      el('div.spacer'),
      el('span.inspect-path', { title: I.path, text: I.path }),
    ),
  );

  const body = el('div.inspect-body');
  I.host.append(body);

  if (!I.path) {
    setContent(body, el('div.empty-hint', { text: '先从「分析外部 mod」里挑一个已导入的包，点「拆解」。' }));
    return I.host;
  }

  loadReport(body);
  return I.host;
}

async function loadReport(body) {
  setContent(body, el('div.loading', { text: '分析中…' }));
  try {
    const { report } = await api.analyze(I.path);
    I.report = report;
    // 默认全选，导出即可拿到完整内容
    I.sel = {};
    for (const g of groups()) {
      if (g.kind !== 'contents') continue;
      const list = report.contents?.[g.type] || [];
      I.sel[g.type] = new Set(list.map((e) => e.id));
    }
    I.edits = {};
    renderBody(body);
  } catch (e) {
    setContent(body, el('div.empty-hint', { text: `分析失败：${e.message || e}` }));
  }
}

function renderBody(body) {
  const nav = el('div.inspect-nav');
  const main = el('div.inspect-main');
  setChildren(body, nav, main);
  renderNav(nav);
  renderMain(main);
}

function groupEntries(type, kind) {
  if (kind === 'contents') return I.report.contents?.[type] || [];
  if (kind === 'ability') return I.report.code?.abilities || [];
  if (kind === 'source') return I.report.sourceFiles || [];
  return [];
}

function groupCount(g) {
  const n = groupEntries(g.type, g.kind).length;
  if (g.kind === 'ability') {
    const used = I.report.code?.abilities?.filter((a) => hasEffectFor(a.id)).length || 0;
    return used ? `${n}（已选 ${used}）` : `${n}`;
  }
  if (g.kind === 'source') return `${n}`;
  const sel = I.sel[g.type]?.size || 0;
  return sel ? `${n}（选 ${sel}）` : `${n}`;
}

function renderNav(nav) {
  const items = [];
  for (const g of groups()) {
    const n = groupEntries(g.type, g.kind).length;
    if (!n) continue;
    const active = I.activeType === g.type;
    items.push(
      el(`button.nav-item${active ? '.active' : ''}`, {
        onclick: () => {
          I.activeType = g.type;
          I.filter = '';
          I.limit = 200;
          renderBody(nav.parentElement);
        },
      },
        el('span.nav-text', { text: g.label }),
        el('span.nav-count', { text: groupCount(g) }),
      ),
    );
  }
  const allSel = totalSelected();
  setContent(nav,
    el('div.inspect-nav-head', { text: '内容分组' }),
    ...items,
    el('div.inspect-nav-actions', {},
      el('button.btn.ghost.tiny', {
        onclick: () => { selectAll(true); renderBody(nav.parentElement); },
      }, '全选'),
      el('button.btn.ghost.tiny', {
        onclick: () => { selectAll(false); renderBody(nav.parentElement); },
      }, '清空'),
      el('div.nav-count.total', { text: `已选 ${allSel}` }),
    ),
  );
}

function totalSelected() {
  let n = 0;
  for (const g of groups()) if (g.kind === 'contents') n += I.sel[g.type]?.size || 0;
  n += I.effectIds.size;
  return n;
}

function selectAll(on) {
  for (const g of groups()) {
    if (g.kind !== 'contents') continue;
    const list = groupEntries(g.type, g.kind);
    I.sel[g.type] = new Set(on ? list.map((e) => e.id) : []);
  }
}

function renderMain(main) {
  const g = groups().find((x) => x.type === I.activeType);
  if (!g) { setContent(main, el('div.empty-hint', { text: '该分组没有内容' })); return; }

  const list = groupEntries(g.type, g.kind);

  if (g.kind === 'ability') {
    renderAbilityList(main, list);
    return;
  }
  if (g.kind === 'source') {
    renderSourceList(main, list);
    return;
  }

  const toolbar = el('div.inspect-group-bar', {},
    el('h3', { text: `${g.label}（${list.length}）` }),
    el('button.btn.primary.small', { onclick: () => doExport(false) }, '导出为包（存库）'),
    I.ctx?.root
      ? el('button.btn.accent.small', { onclick: () => doExport(true) }, '存库并应用')
      : null,
    // 数值配置这类改动，光看条目不知道「改了到底生效在哪」——
    // 让用户先看见会生成哪些文件，再决定要不要导出。
    // 凡是 Forge 配置类的分组都要（spellConfig / delightConfig …）。
    (g.type === 'spellConfig' || g.type === 'delightConfig')
      ? el('button.btn.small', { onclick: () => previewOverride(g) }, '预览生效产物')
      : null,
    el('span.muted.small', { text: '勾选要保留的条目，改完数值后导出' }),
  );

  // 大分组（Goety 的数值配置有上千条）要能搜、能翻页，否则一次性渲染会卡
  const listHost = el('div.card-list');
  if (list.length > 60) {
    toolbar.appendChild(el('input.input.sm.inspect-search', {
      type: 'search',
      placeholder: `搜索 ${g.label}…`,
      value: I.filter || '',
      oninput: (ev) => {
        I.filter = ev.target.value;
        I.limit = PAGE_SIZE;
        paintCards(listHost, g, list);
      },
    }));
  }
  setContent(main, toolbar, listHost);
  paintCards(listHost, g, list);
}

const PAGE_SIZE = 200;

/** 按关键词过滤：id / 名称 / 说明 / 备注都能搜 */
function matchesFilter(e, q) {
  const hay = [e.id, e.nameZh, e.nameEn, e.descriptionZh, e.descriptionEn, e.comment, e.group, e.class, e.schoolZh]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function paintCards(host, g, list) {
  const q = (I.filter || '').trim().toLowerCase();
  const filtered = q ? list.filter((e) => matchesFilter(e, q)) : list;
  const shown = filtered.slice(0, I.limit);
  const cards = shown.map((e) => renderContentCard(g.type, e));
  const more = filtered.length > shown.length
    ? el('div.inspect-more', {},
      el('button.btn.ghost.small', {
        onclick: () => { I.limit += PAGE_SIZE; paintCards(host, g, list); },
      }, `显示更多（还有 ${filtered.length - shown.length} 条）`))
    : null;
  setContent(host, ...cards, more);
}

function renderContentCard(type, e) {
  const fields = fieldsFor(type);
  const checked = I.sel[type]?.has(e.id);
  const id = e.id;

  const chk = el('input', {
    type: 'checkbox',
    checked: !!checked,
    onchange: (ev) => {
      if (ev.target.checked) I.sel[type].add(id);
      else I.sel[type].delete(id);
      // 只更新计数，不动卡片，避免输入框失焦
      refreshCounts();
    },
  });

  const rows = fields.map((f) => fieldRow(type, id, e, f));
  const preview = fieldPreview(type, e);

  // 注意：el 的第二个参数是「属性对象」，子节点必须从第三个参数开始传。
  // 这里以前写成 el('div.card', el('div.card-head', …)) —— 卡片头被当成属性，
  // 结果整块头（含勾选框和条目 id）根本没渲染出来，界面上既看不到条目名也选不了。
  const card = el('div.card', {},
    el('div.card-head', {},
      chk,
      el('span.card-id', { text: id }),
      el('span.card-name', { text: e.nameZh || e.nameEn || '' }),
    ),
    preview ? el('div.card-preview', { text: preview }) : null,
    rows.length ? el('div.card-fields', {}, ...rows) : null,
  );
  return card;
}

/** 给卡片加一行「这东西大概是什么」的速览，帮助研究时快速辨认 */
function fieldPreview(type, e) {
  switch (type) {
    case 'item': return e.kind ? `类型：${e.kind}${e.toolType ? ' / ' + e.toolType : ''}${e.armorSlot ? ' / ' + e.armorSlot : ''}` : '';
    case 'block': return `类型：${e.kind || 'plain'}`;
    case 'recipe': return recipeSummary(e);
    case 'tier': return `默认耐久 ${e.durability} · 速度 ${e.speed}`;
    case 'armorMaterial': return `默认耐久 ${e.durability} · 韧性 ${e.toughness}`;
    case 'worldgen': return `${e.dimension} · 主世界方块 ${e.overworldBlock || e.block || '?'} · Y ${e.minY}~${e.maxY}`;
    case 'advancement': return e.descriptionZh || '';
    case 'delightEffect':
    case 'delightEnchant': {
      // 上游 mod 作者漏写语言条目时，我们用类名推了一个名字 —— 要标明，
      // 免得用户以为那就是官方中文译名。
      const bits = [];
      if (e.nameDerived) bits.push('名称由类名推导（上游未提供本地化文本）');
      if (e.descriptionZh) bits.push(e.descriptionZh);
      if (e.attributes?.length) bits.push(`属性：${e.attributes.join('/')}`);
      if (e.maxLevel != null) bits.push(`最大等级 ${e.maxLevel}`);
      return bits.join(' · ');
    }
    case 'goetyRecipe': return e.coreHandled ? `原版类型：${e.type}` : `Goety 自定义：${e.type}${e.result ? ' → ' + e.result : ''}`;
    case 'focus': return `元素：${e.element} · 等级 ${e.level}`;
    case 'setBonus': return `关联材质 ${e.id} · 档位 ${e.bonusLevel}`;
    case 'statusEffect': {
      const bits = [];
      if (e.descriptionZh) bits.push(e.descriptionZh);
      if (e.attributes?.length) bits.push(`属性：${e.attributes.join('/')}`);
      return bits.join(' · ');
    }
    case 'spell': {
      const bits = [];
      if (e.schoolZh) bits.push(`学派：${e.schoolZh}`);
      const nums = [];
      if (e.soulCost != null) nums.push(`耗蓝 ${e.soulCost}`);
      if (e.castDuration != null) nums.push(`吟唱 ${e.castDuration}`);
      if (e.cooldown != null) nums.push(`冷却 ${e.cooldown}`);
      if (e.damage != null) nums.push(`伤害 ${e.damage}`);
      if (nums.length) bits.push(nums.join(' · '));
      if (e.descriptionZh) bits.push(e.descriptionZh);
      return bits.join(' · ');
    }
    case 'spellConfig':
    case 'delightConfig': {
      // 凡是 Forge 配置类都走这一套：
      // 改值要落到哪个文件的哪个分组 —— 这是「改了到底生效在哪」的关键信息
      const bits = [];
      if (e.configFile) {
        const sec = e.sections?.length ? e.sections.join('.') : '';
        bits.push(`${e.configFile}${sec ? ' ▸ ' + sec : ''}`);
      } else if (e.group) {
        bits.push(`分组 ${e.group}`);
      }
      if (e.min != null || e.max != null) bits.push(`范围 ${e.min ?? '−∞'} ~ ${e.max ?? '∞'}`);
      if (e.comment) bits.push(e.comment);
      return bits.join(' · ');
    }
    case 'delightEffect': {
      const bits = [];
      if (e.registryId) bits.push(e.registryId);
      if (e.class) bits.push(e.class);
      if (e.descriptionZh) bits.push(e.descriptionZh);
      return bits.join(' · ');
    }
    case 'delightEnchant': {
      const bits = [];
      if (e.registryId) bits.push(e.registryId);
      if (e.maxLevel > 1) bits.push(`最大 ${e.maxLevel} 级`);
      if (e.descriptionZh) bits.push(e.descriptionZh);
      return bits.join(' · ');
    }
    case 'delightRecipe': {
      const bits = [];
      if (e.type) bits.push(e.type);
      if (e.result) bits.push(`产物 ${e.result}`);
      if (e.soulCost != null) bits.push(`灵魂 ${e.soulCost}`);
      if (e.duration != null) bits.push(`持续 ${e.duration} tick`);
      if (e.effect) bits.push(e.effect);
      return bits.join(' · ');
    }
    case 'brewEffect': return e.numbers?.length ? `内置数值：${e.numbers.slice(0, 6).join(', ')}` : '';
    case 'enchantment': return e.descriptionZh || '';
    case 'hud': {
      const vs = Array.isArray(e.vars) ? e.vars : [];
      const vfield = (fieldsFor(type) || []).find((f) => f.key === 'vars');
      const labelOf = (v) => (vfield?.options || []).find((o) => (o.value || o) === v)?.label || v;
      const names = vs.map(labelOf).join('、');
      return `显示：${names || '（未选）'} · 锚点 ${e.anchor || 'top_left'} · 切换键 ${e.toggleKey || 'KEY_H'}`;
    }
    default: return '';
  }
}

function recipeSummary(e) {
  if (e.mode === 'shaped') return `合成（${e.grid.filter(Boolean).length} 格）`;
  if (e.mode === 'shapeless') return `无序合成（${e.ingredients?.length || 0} 材料）`;
  if (e.mode === 'stonecutting') return `切石机（${e.ingredient}）`;
  if (['smelting', 'blasting', 'smoking', 'campfire'].includes(e.mode)) return `熔炼类（${e.ingredient}）`;
  return e.mode || '';
}

function fieldRow(type, id, e, f) {
  const stored = I.edits[type]?.[id]?.[f.key];
  const value = stored !== undefined ? stored : e[f.key];

  let input;
  if (f.kind === 'bool') {
    input = el('input', {
      type: 'checkbox',
      checked: !!value,
      onchange: (ev) => setEdit(type, id, f.key, ev.target.checked),
    });
  } else if (f.kind === 'int' || f.kind === 'num') {
    const attrs = { type: 'number', value: value ?? '', step: f.step || 1 };
    if (f.min !== undefined) attrs.min = f.min;
    if (f.max !== undefined) attrs.max = f.max;
    input = el('input.input.sm', {
      ...attrs,
      oninput: (ev) => {
        const v = ev.target.value === '' ? '' : Number(ev.target.value);
        setEdit(type, id, f.key, v);
      },
    });
  } else {
    input = el('input.input.sm', {
      type: 'text',
      value: value ?? '',
      oninput: (ev) => setEdit(type, id, f.key, ev.target.value),
    });
  }

  return el('label.field', {}, el('span.field-l', { text: f.label }), input);
}

function setEdit(type, id, key, value) {
  I.edits[type] = I.edits[type] || {};
  I.edits[type][id] = I.edits[type][id] || {};
  I.edits[type][id][key] = value;
}

function refreshCounts() {
  // 只刷新导航计数，避免重建卡片导致输入框失焦
  const nav = I.host.querySelector('.inspect-nav');
  if (nav) renderNav(nav);
}

// ---------------- 能力（代码识别） ----------------

async function ensureEffects() {
  if (!effectsCache) effectsCache = (await api.effects())?.effects || [];
  return effectsCache;
}

function hasEffectFor(abilityId) {
  return (effectsCache || []).some((e) => (e.abilities || []).includes(abilityId));
}

function renderAbilityList(main, list) {
  const cards = list.map((a) => {
    const chosen = [...I.effectIds].map((id) => effectsCache?.find((e) => e.id === id)).filter(Boolean)
      .filter((e) => (e.abilities || []).includes(a.id));
    const card = el('div.card.ability-card',
      el('div.card-head', {},
        el('span.cat-chip', { text: a.category }),
        el('span.card-name', { text: a.name }),
        el('span.conf-chip', { text: a.confidence === 'high' ? '高置信' : '中置信' }),
      ),
      el('div.card-desc', { text: a.desc }),
      el('div.card-evidence', {}, '证据：', ...(a.evidence || []).map((x) => el('code', { text: x }))),
      el('div.card-actions', {},
        el('button.btn.ghost.small', { onclick: () => openEffectPicker(a) }, chosen.length ? '改用效果模板…' : '用效果模板实现'),
        chosen.length
          ? el('span.tag-ok', { text: `已选用：${chosen.map((c) => c.name).join('、')}` })
          : null,
      ),
    );
    return card;
  });
  setContent(main,
    el('div.inspect-group-bar', {},
      el('h3', { text: `代码能力（${list.length}）` }),
      el('span.muted.small', { text: '这些是常量池推断出的能力，可一键换成我们内置的可编译效果模板' }),
    ),
    el('div.card-list', {}, ...cards),
  );
}

async function openEffectPicker(ability) {
  const effects = await ensureEffects();
  const cands = effects.filter((e) => (e.abilities || []).includes(ability.id));
  if (!cands.length) {
    toast('暂无可实现「' + ability.name + '」的内置效果模板', 'info');
    return;
  }
  const body = el('div.effect-picker');
  const m = modal({ title: `实现「${ability.name}」`, body, width: 560 });

  const list = el('div.effect-cand-list');
  setContent(body, el('p.muted', { text: '选一个效果模板，会作为能力被加进导出的包（带可编译代码）。' }), list);
  for (const eff of cands) {
    list.append(
      el('div.effect-cand', {},
        el('div.effect-cand-name', { text: eff.name }),
        el('div.effect-cand-desc', { text: eff.desc }),
        el('button.btn.primary.small', {
          onclick: () => {
            if (eff.params && eff.params.length) showEffectParams(eff, ability, m, body, list);
            else { addEffect(eff, {}); m.close(); }
          },
        }, '选用'),
      ),
    );
  }
}

function showEffectParams(eff, ability, m, body, list) {
  const inputs = {};
  const form = el('div.effect-params', {}, ...eff.params.map((p) => {
    const inp = el('input.input.sm', { type: p.type === 'number' ? 'number' : 'text', value: p.default ?? '', step: p.step });
    inputs[p.key] = inp;
    return el('label.field', {}, el('span.field-l', { text: p.label }), inp, p.hint ? el('span.field-h', { text: p.hint }) : null);
  }));
  setContent(body,
    el('button.link-back', {
      onclick: () => { setContent(body, list); },
    }, '← 返回模板列表'),
    el('h4', { text: `${eff.name} 参数` }),
    form,
    el('div.modal-foot', {},
      el('button.btn.ghost', { onclick: () => m.close() }, '取消'),
      el('button.btn.primary', {
        onclick: () => {
          const vals = {};
          for (const p of eff.params) vals[p.key] = p.type === 'number' ? Number(inputs[p.key].value) : inputs[p.key].value;
          addEffect(eff, vals);
          m.close();
        },
      }, '确定'),
    ),
  );
}

function addEffect(eff, vals) {
  I.effectIds.add(eff.id);
  if (Object.keys(vals).length) I.effectParams[eff.id] = vals;
  toast(`已加入效果：${eff.name}`, 'ok');
  refreshCounts();
  // 刷新能力列表里的「已选用」标记
  const main = I.host.querySelector('.inspect-main');
  if (main && I.activeType === 'ability') renderAbilityList(main, I.report.code?.abilities || []);
}

// ---------------- 源码 ----------------

function renderSourceList(main, list) {
  const rows = list.map((name) => el('div.source-row', {
    onclick: () => viewSource(name),
  }, el('span', { text: name })));
  setContent(main,
    el('div.inspect-group-bar', {},
      el('h3', { text: `源码（${list.length}）` }),
      el('span.muted.small', { text: '只有自带 .java 的 sources jar 才能读，发布版看不到' }),
    ),
    el('div.source-list', {}, ...rows),
  );
}

async function viewSource(entry) {
  try {
    const { text } = await api.readJarSource(I.path, entry);
    const pre = el('pre.source-code', { text: text });
    modal({
      title: entry.split('/').pop(),
      body: el('div.source-view', {}, pre),
      width: 760,
    });
  } catch (e) {
    toast(`读取失败：${e.message || e}`, 'error');
  }
}

// ---------------- 导出 ----------------

/**
 * 预览「这些改动会生成什么」。
 *
 * 为什么要单独一个预览：Goety 的数值在 Forge 配置里，
 * 改完「数值」这一栏，用户看不到「到底改到哪个文件的哪个分组」——
 * 导出后才发现不对就晚了。这里直接跑一遍导出，把生成的文件摊开给他看。
 */
async function previewOverride(g) {
  const ids = [...(I.sel[g.type] || [])];
  const edits = I.edits[g.type] || {};
  // 没勾选但改了值也算 —— 用户可能只改了值没勾选
  const changedIds = Object.keys(edits);
  const useIds = [...new Set([...ids, ...changedIds])];
  if (!useIds.length) {
    toast('还没有改动任何数值', 'info');
    return;
  }

  try {
    const { pack } = await api.analyzeToPack({
      path: I.path,
      selection: { contents: { [g.type]: useIds } },
      overrides: I.edits,
      name: '预览',
      desc: '预览',
    });

    const files = pack?.content?.files || [];
    if (!files.length) {
      toast('这次改动不会生成额外文件（数值只在包条目里）', 'info');
      return;
    }

    const body = el('div.override-preview');
    for (const f of files) {
      body.appendChild(el('div.override-file', {},
        el('div.override-file-path', { text: f.path }),
        el('pre.override-file-content', { text: f.content }),
      ));
    }
    modal({
      title: `会生成 ${files.length} 个文件`,
      body,
      width: 780,
    });
  } catch (e) {
    toast(`预览失败：${e.message || e}`, 'error');
  }
}

async function doExport(applyToo) {
  const selection = { contents: {} };
  let any = false;
  for (const g of groups()) {
    if (g.kind !== 'contents') continue;
    const ids = [...(I.sel[g.type] || [])];
    if (ids.length) { selection.contents[g.type] = ids; any = true; }
  }
  if (!any && I.effectIds.size === 0) {
    toast('没有勾选任何内容', 'info');
    return;
  }

  const modName = I.report.meta?.name || I.report.source?.name || 'mod';
  const name = await promptBox('给导出的包起个名字', `${modName} 拆解包`, { title: '导出为可复用包' });
  if (name === null) return;

  try {
    const { pack } = await api.analyzeToPack({
      path: I.path,
      selection,
      effectIds: [...I.effectIds],
      effectParams: I.effectParams,
      overrides: I.edits,
      name,
      desc: `从 ${I.path.split(/[\\/]/).pop()} 拆解导出`,
    });
    const saved = await api.savePack({ root: I.ctx?.root, pack, scope: 'user' });
    toast('已存进包库', 'ok');
    if (applyToo && I.ctx?.root) {
      const r = await api.applyPack({ root: I.ctx.root, id: saved.pack.id });
      if (r?.error) toast(`应用失败：${r.error}`, 'error');
      else toast('已应用到当前工程', 'ok');
    }
  } catch (e) {
    toast(`导出失败：${e.message || e}`, 'error');
  }
}
