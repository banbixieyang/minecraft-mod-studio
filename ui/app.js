/**
 * MC Studio 主应用。
 *
 * 结构：顶栏 / 侧栏（类型 + 条目）/ 编辑区 / 右侧预览。
 * 全部由模块声明驱动 —— 加一种内容类型，这里一行都不用改。
 */
import { api } from './api.js';
import { el, $, setChildren, toast, modal, confirmBox, promptBox, debounce, fmtSize, fmtTime } from './ui.js';
import { renderFields, isVisible, pickItem } from './fields.js';
import { openCodeModal } from './code.js';
import { renderLibraryPanel } from './library.js';
import { renderAnalyzePanel } from './analyze.js';
import { renderInspectPanel } from './inspect.js';
import { renderKnowledgePanel, openKnowledgeDoc } from './knowledge.js';
import { renderAiPanel, setAiDraft } from './ai.js';
import { renderVisualPanel, openVisualGuide } from './visual.js';
import { renderConvertPanel } from './convert.js';
import { openHookInstall } from './hookinstall.js';

const LS_KEY = 'mcstudio.lastProject';

const state = {
  health: null,
  projects: [],
  targets: [],
  root: null,
  project: null,
  types: [],
  typeMap: {},
  refs: {},
  presets: {},
  vanilla: null,
  activeType: null,
  activeId: null,
  /** 积木面板的作用域：null = 工程全局；{ type:'item'|'block', id } = 某个条目的专属程序 */
  visualScope: null,
  buildPoll: null,
  // 'edit' | 'library' | 'analyze'
  view: 'edit',
};

const app = $('#app');

/**
 * 首页的三张「上手卡」。
 *
 * 每张卡直接跳到知识库对应的那篇教程 —— 用的是文档的真实 id
 * （builtin/guides/00-使用手册 这种），不是猜的。
 *
 * 文档 id 是从文件名推出来的，指南改了名就会失效。所以点的时候
 * 拿真实目录对一遍：先按完整 id 找，再按后缀找，最后按标题关键词找。
 * 三种都认不出来就退回「学习」面板 —— 不做死链，也不弹一个看不懂的报错。
 */
let guideListCache = null;

async function resolveGuideId(rel, keywords = []) {
  if (!guideListCache) {
    try {
      const r = await api.knowledgeList();
      guideListCache = r.docs || [];
    } catch {
      guideListCache = [];
    }
  }
  const docs = guideListCache;
  const hit =
    docs.find((d) => d.id === `builtin/guides/${rel}`) ||
    docs.find((d) => d.id.endsWith(`/${rel}`)) ||
    docs.find((d) => d.category === '指南' && keywords.some((k) => (d.title || '').includes(k)));
  return hit?.id || null;
}

/**
 * 欢迎页的上手卡。
 *
 * 默认跳到知识库对应的教程章节；传了 onClick 就走自己的动作
 * （积木那张卡想让人直接进编辑器，而不是先读一篇文档）。
 */
function startCard(title, sub, linkText, docRel, keywords = [], onClick = null) {
  return el('button.start-card', {
    onclick: async () => {
      if (onClick) { onClick(); return; }
      const docId = await resolveGuideId(docRel, keywords);
      if (docId) openKnowledgeDoc(docId);
      state.view = 'knowledge';
      renderWorkspace();
      if (!docId) toast('没找到对应的教程，先看看学习中心目录吧', 'warn');
    },
  },
    el('div.start-card-title', { text: title }),
    el('div.start-card-sub', { text: sub }),
    el('div.start-card-link', { text: `📖 ${linkText} →` }),
  );
}

/** 顶栏「手册」：直达使用手册那一篇 */
function openManual() {
  resolveGuideId('00-使用手册', ['使用手册']).then((id) => {
    if (id) openKnowledgeDoc(id);
    state.view = 'knowledge';
    renderWorkspace();
  });
}

// ============================================================
// 启动
// ============================================================
async function boot() {
  try {
    state.health = await api.health();
  } catch (e) {
    $('#boot').innerHTML = `<div class="boot-inner"><h2>引擎没连上</h2><p>${e.message}</p><p class="muted">确认 node studio.mjs start 还在运行</p></div>`;
    return;
  }

  const last = localStorage.getItem(LS_KEY);
  const [res, targets] = await Promise.all([api.listProjects(), api.targets().catch(() => ({ targets: [] }))]);
  state.projects = res.projects;
  state.targets = targets.targets || [];

  $('#boot').classList.add('hidden');
  app.classList.remove('hidden');

  if (last && state.projects.some((p) => p.root === last)) {
    await openProject(last);
  } else if (state.projects.length === 1) {
    await openProject(state.projects[0].root);
  } else {
    renderWelcome();
  }
}

async function openProject(root) {
  const r = await api.openProject(root);
  state.root = r.root;
  state.project = r.project;
  state.types = r.types;
  state.typeMap = Object.fromEntries(r.types.map((t) => [t.id, t]));
  localStorage.setItem(LS_KEY, r.root);

  await refreshRefs();
  await ensureVanilla();

  const firstType = state.types.find((t) => (state.project.entries[t.id] || []).length) || state.types[0];
  state.activeType = firstType?.id || null;
  state.activeId = state.project.entries[state.activeType]?.[0]?.id || null;

  renderWorkspace();
}

async function refreshRefs() {
  const refs = {};
  for (const t of state.types) {
    refs[t.id] = (state.project.entries[t.id] || []).map((e) => ({
      id: e.id,
      name: e.nameZh || e.nameEn || e.id,
    }));
  }
  state.refs = refs;
}

async function ensureVanilla() {
  if (state.vanilla) return state.vanilla;
  const r = await api.vanilla();
  state.vanilla = r.vanilla;
  state.presets = r.presets;
  return state.vanilla;
}

// ============================================================
// 欢迎页
// ============================================================
function renderWelcome() {
  const nameIn = el('input.input', { placeholder: '陨落', value: '' });
  const idIn = el('input.input.mono', { placeholder: 'fallen', value: '' });
  const pkgIn = el('input.input.mono', { placeholder: 'com.example.fallen', value: '' });
  const authorIn = el('input.input', { placeholder: '你的名字（可留空）' });
  const targetIn = el('select.input');
  if (!state.targets.length) {
    targetIn.append(el('option', { value: 'fabric-26.3', text: 'Fabric 26.3' }));
  } else {
    for (const t of state.targets) {
      targetIn.append(el('option', { value: t.id, text: `${t.label} · JDK ${t.javaVersion}` }));
    }
  }

  let touched = false;
  nameIn.addEventListener('input', () => {
    if (touched) return;
    const slug = nameIn.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!idIn.value) idIn.placeholder = slug || 'mymod';
  });
  idIn.addEventListener('input', () => {
    touched = true;
    if (!pkgIn.value) pkgIn.placeholder = `com.example.${idIn.value || 'mymod'}`;
  });

  const create = async () => {
    const name = nameIn.value.trim() || '我的模组';
    const id = (idIn.value.trim() || idIn.placeholder || 'mymod').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const pkg = (pkgIn.value.trim() || `com.example.${id}`).toLowerCase();
    try {
      const r = await api.createProject({ name, id, pkg, authors: authorIn.value.trim(), target: targetIn.value || 'fabric-26.3' });
      toast('工程已创建，正在生成骨架…', 'ok');
      await openProject(r.root);
      const rep = r.report;
      if (rep) toast(`已生成 ${rep.written.length} 个文件`, 'ok');
    } catch (e) {
      toast(e.message, 'error', 5000);
    }
  };

  const list = el('div.project-list');
  if (!state.projects.length) {
    list.append(el('div.empty', { text: '还没有工程' }));
  }
  for (const p of state.projects) {
    list.append(
      el(
        'button.project-card',
        { onclick: () => openProject(p.root) },
        el('div.project-name', { text: p.name }),
        el('div.project-meta', { text: `${p.id} · ${p.target.mcVersion} · v${p.version}` }),
      ),
    );
  }

  setChildren(
    app,
    el(
      'div.welcome',
      {},
      el(
        'div.welcome-card',
        {},
        el('div.welcome-brand', {}, el('div.brand-mark', { text: 'MC' }), el('div', {}, el('h1', { text: 'MC Studio' }), el('p.sub', { text: '可视化 Minecraft 模组工坊' }))),
        el('div.two-panel', {}, el(
          'section.panel',
          {},
          el('h2', { text: '新建工程' }),
          el('label.field-label', {}, '模组名称', nameIn),
          el('label.field-label', {}, '模组 id（游戏内命名空间）', idIn),
          el('label.field-label', {}, 'Java 包名', pkgIn),
          el('label.field-label', {}, '作者', authorIn),
          el('label.field-label', {}, '目标版本', targetIn),
          el('button.btn.primary.wide', { onclick: create }, '创建并生成骨架'),
          el('p.note', { text: `可选目标：${state.targets.map((t) => t.label).join(' / ') || 'Fabric 26.3'}。工程会建在 mcstudio/projects 下；不同目标需要各自的 JDK，创建后立刻可构建。` }),
        ), el(
          'section.panel',
          {},
          el('h2', { text: '打开已有工程' }),
          list,
          el('p.note', {}, `工程目录：${state.health.projectsDir}`),
        )),
        // 上手引导：第一次用的人最需要的就是「我该点哪里」。
        // 四张卡对应四条主路，每张都直接跳到对应的教程章节。
        el('div.start-here', {},
          el('h2.start-here-title', { text: '第一次来？先看这几条路' }),
          el('div.start-here-grid', {},
            // 积木那张放第一位 —— 它是最不需要会编程的那条路。
            // 直接进编辑器并打开入门向导，而不是先让人读一篇文档。
            startCard('① 我想用积木搭', '拖积木写逻辑，生成真 Java', '积木编程入门 →', '07-积木编程', ['积木'], () => {
              state.view = 'visual';
              renderWorkspace();
              openVisualGuide();
            }),
            startCard('② 我要做自己的模组', '填表单 → 生成 → 构建 jar', '从零到出 jar', '01-从零到出jar', ['从零到出']),
            startCard('③ 我想拆别人的模组', '导入 jar → 逐项研究 → 改数值', '拆解别人的 mod', '06-拆解别人的mod', ['拆解别人的']),
            startCard('④ 我想要一份完整手册', '六个区域、每个功能怎么走', '使用手册', '00-使用手册', ['使用手册']),
          ),
        ),
        el('div.welcome-foot', {}, el('span', { text: `引擎 v${state.health.version} · Node ${state.health.node} · ${state.health.java.ok ? 'JDK ' + state.health.java.version : '未检测到 JDK'}` })),
      ),
    ),
  );
}

// ============================================================
// 工作区
// ============================================================
function renderWorkspace() {
  // 没打开工程时「编辑」视图无从谈起 —— 回欢迎页。
  if (!state.project && state.view === 'edit') {
    renderWelcome();
    return;
  }

  const header = renderHeader();

  // 库、分析、学习、AI、积木 是整屏面板，占掉侧栏+编辑+检查器三栏的位置
  if (['library', 'analyze', 'knowledge', 'ai', 'inspect', 'visual', 'convert'].includes(state.view)) {
    const go = (v) => {
      state.view = v;
      renderWorkspace();
    };
    const ctx = {
      root: state.root,
      project: state.project,
      types: state.types,
      visualScope: state.visualScope,
      onBack: () => {
        state.view = 'edit';
        state.visualScope = null;
        // 没工程可回就回首页，别把用户扔到一个空的编辑区里。
        if (!state.project) {
          renderWelcome();
          return;
        }
        // 重新拉一次工程：把刚才在积木面板里保存的条目程序数同步进来，
        // 但保留当前选中的类型/条目，别把用户弹回第一个条目。
        api.openProject(state.root).then((r) => {
          state.project = r.project;
          state.types = r.types;
          state.typeMap = Object.fromEntries(r.types.map((t) => [t.id, t]));
          refreshRefs();
          renderWorkspace();
        }).catch(() => renderWorkspace());
      },
      onChanged: () => openProject(state.root),
      /** 从任何地方把问题甩给 AI */
      onAskAI: (q) => {
        setAiDraft(q);
        go('ai');
      },
      /** AI 引用来源点回来 */
      onOpenDoc: (id, heading) => {
        openKnowledgeDoc(id, heading);
        go('knowledge');
      },
      /** 任何 Java 代码块都可以「预览 → 确认」后装成当前工程的钩子 */
      onInstallHook: (code, source) => openHookInstall({ code, ctx, source }),
    };
    const panel =
      state.view === 'library'
        ? renderLibraryPanel(ctx)
        : state.view === 'analyze'
          ? renderAnalyzePanel(ctx)
          : state.view === 'inspect'
            ? renderInspectPanel(ctx)
              : state.view === 'visual'
                ? renderVisualPanel(ctx)
                : state.view === 'convert'
                  ? renderConvertPanel(ctx)
                  : state.view === 'knowledge'
                    ? renderKnowledgePanel(ctx)
                    : renderAiPanel(ctx);
    setChildren(app, el('div.workspace-root', {}, header, el('div.workspace-body.single', {}, panel)));
    return;
  }

  const sidebar = renderSidebar();
  const editor = el('section.editor');
  const inspector = el('aside.inspector');

  setChildren(app, el('div.workspace-root', {}, header, el('div.workspace-body', {}, sidebar, editor, inspector)));
  renderEditor(editor, inspector);
}

function goView(view) {
  // 从顶栏进积木面板是「工程全局」模式；条目级要从条目编辑器里点进去
  // （那个入口会自己设置 state.visualScope），所以这里一律清掉作用域。
  if (view === 'visual') state.visualScope = null;
  state.view = view;
  renderWorkspace();
}

// 拆解台从 analyze 入口切换视图用，避免 inspect.js 反向依赖 app.js 造成循环引用。
window.addEventListener('mc-nav', (e) => {
  if (e.detail?.view) goView(e.detail.view);
});

function renderHeader() {
  const p = state.project;

  // 还没打开工程（从欢迎页直接进学习中心 / AI）时，顶栏不能假设工程存在 ——
  // 之前这里直接读 p.meta，页面上一个未捕获异常就把整个面板打没了。
  if (!p) {
    return el(
      'header.app-bar',
      {},
      el('div.brand', {}, el('div.brand-mark.small', { text: 'MC' }), el('span', { text: 'Studio' })),
      el('span.muted.small', { text: '未打开工程' }),
    el('div.spacer'),
    el('button.btn.ghost', { title: '像搭积木一样写代码，生成真 Java', onclick: () => goView('visual') }, '积木'),
    el('button.btn.ghost', { title: '内置教程、26.3 速查、任务卡', onclick: () => goView('knowledge') }, '学习'),
      el('button.btn.ghost', { title: '完整使用手册：六个区域、每条路怎么走', onclick: () => openManual() }, '手册'),
      el('button.btn.ghost', {
        title: '回到首页',
        onclick: () => {
          state.view = 'edit';
          renderWelcome();
        },
      }, '← 首页'),
    );
  }

  const counts = state.types.map((t) => (p.entries[t.id] || []).length).reduce((a, b) => a + b, 0);

  return el(
    'header.app-bar',
    {},
    el('div.brand', {}, el('div.brand-mark.small', { text: 'MC' }), el('span', { text: 'Studio' })),
    el('div.proj-chip', {
      title: '切换工程',
      onclick: () => {
        localStorage.removeItem(LS_KEY);
        renderWelcome();
      },
    }, el('strong', { text: p.meta.name }), el('span.muted', { text: ` ${p.meta.id}` })),
    el('span.target-pill', { text: `${p.target.platform} ${p.target.mcVersion}` }),
    el('span.muted.small', { text: `${counts} 个内容` }),
    el('div.spacer'),
    el('button.btn.ghost', { title: '积木库、拆解台、分析外部 mod', onclick: () => goView('library') }, '库'),
    el('button.btn.ghost', { title: '像搭积木一样写代码，生成真 Java', onclick: () => goView('visual') }, '积木'),
    el('button.btn.ghost', { title: '把功能 / 效果搬到另一个版本或加载器', onclick: () => goView('convert') }, '转换'),
    el('button.btn.ghost', { title: '拆开一个现成的 mod，把能用的留下来', onclick: () => goView('analyze') }, '分析'),
    el('button.btn.ghost', { title: '内置教程、26.3 速查、任务卡', onclick: () => goView('knowledge') }, '学习'),
    el('button.btn.ghost', { title: '完整使用手册：六个区域、每条路怎么走', onclick: () => openManual() }, '手册'),
    el('button.btn.ghost', { title: '让 AI 帮你写，它会查知识库', onclick: () => goView('ai') }, 'AI'),
    el('button.btn.ghost', { onclick: () => runPreflight() }, '校验'),
    el('button.btn.ghost', { onclick: () => openCodeBrowser() }, '代码'),
    el('button.btn', { onclick: () => doGenerate() }, '生成'),
    el('button.btn.primary', { onclick: () => doBuild() }, '构建 jar'),
    el('button.icon-btn', { title: '更多', onclick: (e) => openMoreMenu(e.currentTarget) }, '⋯'),
  );
}

function renderSidebar() {
  const groups = new Map();
  for (const t of state.types) {
    const g = t.group || '内容';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  // 「模块管理」不是内容类型，但要挂在「扩展」组里。
  // 模块自己也可能往「扩展」组里放类型，所以这里只建组不重复画标题。
  if (!groups.has('扩展')) groups.set('扩展', []);

  const nav = el('nav.type-nav');
  const moduleEntry = () =>
    el('button.nav-item', { onclick: () => openModuleManager() },
      el('span.nav-icon', { text: '⚙' }),
      el('span.nav-text', { text: '模块管理' }));

  for (const [g, list] of groups) {
    nav.append(el('div.nav-group-label', { text: g }));
    for (const t of list) {
      const n = (state.project.entries[t.id] || []).length;
      nav.append(
        el(`button.nav-item${state.activeType === t.id ? '.active' : ''}`, {
          onclick: () => {
            state.activeType = t.id;
            state.activeId = state.project.entries[t.id]?.[0]?.id || null;
            renderWorkspace();
          },
        }, el('span.nav-icon', { text: t.icon || '◆' }), el('span.nav-text', { text: t.label }), el('span.nav-count', { text: n || '' })),
      );
    }
    if (g === '扩展') nav.append(moduleEntry());
  }

  return el('aside.sidebar', {}, nav, renderEntryList());
}

function renderEntryList() {
  const type = state.typeMap[state.activeType];
  const list = el('div.entry-panel');
  if (!type) {
    list.append(el('div.empty', { text: '选一个类型' }));
    return list;
  }
  const entries = state.project.entries[type.id] || [];

  const head = el(
    'div.entry-head',
    {},
    el('span', { text: type.label }),
    el('div.spacer'),
    el('button.icon-btn', { title: `新建${type.singular || type.label}`, onclick: () => addEntry(type) }, '+'),
  );

  const body = el('div.entry-list');
  if (!entries.length) {
    body.append(el('div.empty', { text: `还没有${type.label}` }));
    body.append(el('button.btn.ghost.wide', { onclick: () => addEntry(type) }, `+ 新建第一个${type.singular || type.label}`));
  }
  for (const e of entries) {
    body.append(
      el(
        `button.entry-item${e.id === state.activeId ? '.active' : ''}`,
        {
          onclick: () => {
            state.activeId = e.id;
            document.querySelectorAll('.entry-item').forEach((n) => n.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
            renderWorkspace();
          },
        },
        el('span.entry-name', { text: e.nameZh || e.nameEn || e.id }),
        el('code.entry-id', { text: e.id }),
      ),
    );
  }

  list.append(head, body);
  return list;
}

// ============================================================
// 编辑区
// ============================================================
function renderEditor(editorHost, inspector) {
  const type = state.typeMap[state.activeType];
  setChildren(editorHost);
  setChildren(inspector);

  if (!type) {
    editorHost.append(el('div.empty.big', { text: '从左边选一个类型开始' }));
    return;
  }
  const entry = (state.project.entries[type.id] || []).find((e) => e.id === state.activeId);
  if (!entry) {
    editorHost.append(
      el('div.empty.big', {}, el('p', { text: `这个类型下还没有${type.label}` }), el('button.btn.primary', { onclick: () => addEntry(type) }, `新建${type.singular || type.label}`)),
    );
    return;
  }

  // ---- 顶部操作条 ----
  const toolbar = el(
    'div.editor-bar',
    {},
    el('div', {}, el('h2', { text: entry.nameZh || entry.nameEn || entry.id }), el('code.muted', { text: `${state.project.meta.id}:${entry.id}` })),
    el('div.spacer'),
    el('button.btn.small.ghost', { onclick: () => duplicateEntry(type, entry) }, '复制'),
    el('button.btn.small.ghost', { onclick: () => moveEntry(type, entry, -1) }, '↑'),
    el('button.btn.small.ghost', { onclick: () => moveEntry(type, entry, 1) }, '↓'),
    el('button.btn.small.danger', { onclick: () => deleteEntry(type, entry) }, '删除'),
  );

  // ---- 表单 ----
  const saveQueue = new Map();
  const flush = debounce(async () => {
    if (!saveQueue.size) return;
    const patch = Object.fromEntries(saveQueue);
    saveQueue.clear();
    try {
      const r = await api.updateEntry(state.root, type.id, entry.id, patch);
      Object.assign(entry, r.entry);
      await refreshRefs();
      updatePreview();
    } catch (e) {
      toast(e.message, 'error', 4000);
    }
  }, 350);

  const values = { ...entry };
  const form = renderFields(type.fields || [], values, {
    root: state.root,
    type: type.id,
    ns: state.project.meta.id,
    refs: state.refs,
    presets: state.presets,
    onChange: (patch) => {
      Object.assign(values, patch);
      for (const [k, v] of Object.entries(patch)) saveQueue.set(k, v);
      form.__refresh?.();
      flush();
    },
  });

  editorHost.append(toolbar, el('div.editor-scroll', {}, form));

  // 物品 / 方块可以各挂一套专属积木程序（per-entry 绑定）：
  // 事件只对该条目触发，编译期还会按条目类型校验事件是否合法。
  if (type.id === 'item' || type.id === 'block') {
    editorHost.append(renderEntryVisualSection(type, entry));
  }

  // ---- 右侧预览 ----
  renderInspector(inspector, type, entry, values);
}

/**
 * 条目编辑器里的「积木效果」区块（仅 item/block）。
 * 点按钮进积木面板，作用域锁定到当前条目；标签上顺带显示已挂了几段程序。
 */
function renderEntryVisualSection(type, entry) {
  const noun = type.label || '条目';
  const count = entry.visualPrograms?.length || 0;
  const sec = el('div.entry-visual-section',
    {},
    el('div.section-head', {},
      el('h3', { text: '积木效果' }),
      el('span.muted.small', { text: '用积木给本条目写专属逻辑，事件只对该条目触发' }),
    ),
    el('button.btn.small', {
      onclick: () => {
        state.visualScope = { type: type.id, id: entry.id };
        state.view = 'visual';
        renderWorkspace();
      },
    }, count ? `编辑本${noun}的积木程序（${count}）` : `用积木写本${noun}的效果`),
  );
  return sec;
}

async function updatePreview() {
  const inspector = $('.inspector');
  if (!inspector) return;
  const type = state.typeMap[state.activeType];
  const entry = (state.project.entries[type.id] || []).find((e) => e.id === state.activeId);
  if (entry) renderInspector(inspector, type, entry, entry);
}

function renderInspector(host, type, entry, values) {
  if (type.id === 'hud') { renderHudInspector(host, type, entry, values); return; }
  const img = el('img.inspector-icon', { alt: '预览' });
  const meta = el('div.inspector-meta');

  const refresh = async () => {
    try {
      const r = await api.texturePreview(state.root, type.id, values);
      if (r.dataUrl) img.src = r.dataUrl;
      else img.removeAttribute('src');
    } catch {
      /* 预览失败不打断编辑 */
    }
  };

  meta.append(
    el('div.kv', {}, el('span.k', { text: '标识符' }), el('code', { text: entry.id })),
    el('div.kv', {}, el('span.k', { text: '类型' }), el('span', { text: type.label })),
  );

  const actions = el(
    'div.inspector-actions',
    {},
    el('button.btn.small.ghost', { onclick: () => refresh() }, '刷新预览'),
    el('button.btn.small.ghost', {
      onclick: async () => {
        try {
          const r = await api.bbOpen(state.root, type.id, entry.id, '');
          toast(r.launched ? '已在 Blockbench 打开' : r.reason || '已导出 .bbmodel', r.launched ? 'ok' : 'warn', 4000);
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    }, 'Blockbench'),
    el('button.btn.small.ghost', { onclick: () => showGeneratedFiles(type, entry) }, '产出文件'),
  );

  setChildren(host, el('div.inspector-inner', {}, el('div.inspector-preview', {}, img), meta, actions));
  refresh();
}

/**
 * HUD 面板的编辑器内预览：画一块「游戏画面」，把面板按配置停靠到角落，
 * 列出选中的变量（值用「—」占位，真值进游戏才会变）。让用户不进游戏也能看版式。
 */
function renderHudInspector(host, type, entry, values) {
  const vfield = (type.fields || []).find((f) => f.key === 'vars');
  const labelOf = (v) => (vfield?.options || []).find((o) => (o.value || o) === v)?.label || v;
  const vars = Array.isArray(values.vars) ? values.vars : [];
  const title = values.title || '(未命名面板)';
  const anchor = values.anchor || 'top_left';

  const pos = [];
  if (anchor.includes('right')) pos.push('right:8px;'); else pos.push('left:8px;');
  if (anchor.includes('bottom')) pos.push('bottom:8px;'); else pos.push('top:8px;');
  const panel = el('div', {
    style: `position:absolute;${pos.join('')}min-width:150px;background:rgba(0,0,0,0.62);color:#fff;padding:6px 8px;font:12px/1.5 ui-monospace,monospace;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.4);`,
  },
    el('div', { style: 'font-weight:bold;margin-bottom:2px;', text: title }),
    ...(vars.length
      ? vars.map((v) => el('div', { text: `${labelOf(v)}：—` }))
      : [el('div', { style: 'opacity:.6', text: '（未选择要显示的变量）' })]),
  );
  const screen = el('div', {
    style: 'position:relative;height:184px;background:linear-gradient(#7ec0ee,#bfe6ff);border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;',
  },
    panel,
    el('div', { style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#235;opacity:.45;font:11px sans-serif', text: '（游戏画面示意）' }),
  );

  const meta = el('div.inspector-meta',
    {},
    el('div.kv', {}, el('span.k', { text: '标识符' }), el('code', { text: entry.id })),
    el('div.kv', {}, el('span.k', { text: '类型' }), el('span', { text: type.label })),
    el('div.kv', {}, el('span.k', { text: '切换键' }), el('span', { text: values.toggleKey || 'KEY_H' })),
    el('div.kv', {}, el('span.k', { text: '配置文件' }), el('code', { text: `config/${state.project.meta.id}/hud/${entry.id}.properties` })),
  );

  setChildren(host, el('div.inspector-inner', {}, el('div.inspector-preview', {}, screen), meta,
    el('div.inspector-actions', {}, el('button.btn.small.ghost', { onclick: () => renderHudInspector(host, type, entry, values) }, '刷新预览'))));
}

// ============================================================
// 条目操作
// ============================================================
async function addEntry(type) {
  try {
    const r = await api.addEntry(state.root, type.id, null);
    state.project.entries[type.id] = [...(state.project.entries[type.id] || []), r.entry];
    state.activeId = r.entry.id;
    await refreshRefs();
    renderWorkspace();
    toast(`已新建${type.singular || type.label} ${r.entry.id}`, 'ok', 2000);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function duplicateEntry(type, entry) {
  try {
    const r = await api.duplicateEntry(state.root, type.id, entry.id);
    state.project.entries[type.id].push(r.entry);
    state.activeId = r.entry.id;
    await refreshRefs();
    renderWorkspace();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteEntry(type, entry) {
  const ok = await confirmBox(`删除${type.singular || type.label}「${entry.nameZh || entry.id}」？下次生成时对应的文件会一起清掉。`, { danger: true });
  if (!ok) return;
  await api.deleteEntry(state.root, type.id, entry.id);
  state.project.entries[type.id] = state.project.entries[type.id].filter((e) => e.id !== entry.id);
  state.activeId = state.project.entries[type.id][0]?.id || null;
  await refreshRefs();
  renderWorkspace();
}

async function moveEntry(type, entry, delta) {
  await api.moveEntry(state.root, type.id, entry.id, delta);
  const list = state.project.entries[type.id];
  const i = list.findIndex((e) => e.id === entry.id);
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  const [x] = list.splice(i, 1);
  list.splice(j, 0, x);
  renderWorkspace();
}

// ============================================================
// 生成 / 构建
// ============================================================
async function runPreflight() {
  const r = await api.preflight(state.root);
  const body = el('div');
  if (!r.errors.length && !r.warnings.length) body.append(el('p.ok-text', { text: '没有发现问题，可以生成。' }));
  if (r.errors.length) {
    body.append(el('h4', { text: `必须修的问题（${r.errors.length}）` }));
    const ul = el('ul.issue-list');
    for (const e of r.errors) ul.append(el('li.issue.error', { text: e }));
    body.append(ul);
  }
  if (r.warnings.length) {
    body.append(el('h4', { text: `提醒（${r.warnings.length}）` }));
    const ul = el('ul.issue-list');
    for (const w of r.warnings) ul.append(el('li.issue.warn', { text: w }));
    body.append(ul);
  }
  modal({ title: '工程校验', body, actions: [{ label: '知道了', kind: 'primary' }], width: 620 });
}

async function doGenerate(force = false) {
  const t = toast('正在生成…', 'info', 60000);
  try {
    const r = await api.generate(state.root, force);
    t.remove();
    const rep = r.report;
    const lines = [
      `写入 ${rep.written.length} 个文件`,
      rep.unchanged.length ? `未变化 ${rep.unchanged.length}` : null,
      rep.removed.length ? `清理 ${rep.removed.length}` : null,
      rep.conflicts.length ? `冲突 ${rep.conflicts.length}` : null,
    ].filter(Boolean);

    if (rep.conflicts.length && !force) {
      const ok = await confirmBox(`${rep.conflicts.length} 个生成文件被手动改过。覆盖会丢失这些修改，继续？`, { danger: true });
      if (ok) return doGenerate(true);
    }
    if (rep.errors.length) {
      toast(`生成有 ${rep.errors.length} 个错误`, 'error', 5000);
      showReport('生成报告', rep);
    } else {
      toast(lines.join(' · '), 'ok');
      if (rep.warnings.length) showReport('生成报告', rep);
    }
  } catch (e) {
    t.remove();
    toast(e.message, 'error', 5000);
  }
}

function showReport(title, rep) {
  const body = el('div');
  const sec = (label, arr, cls, fmt) => {
    if (!arr.length) return;
    body.append(el('h4', { text: `${label}（${arr.length}）` }));
    const ul = el('ul.issue-list');
    for (const x of arr.slice(0, 60)) ul.append(el(`li.issue.${cls}`, { text: fmt(x) }));
    body.append(ul);
  };
  sec('错误', rep.errors, 'error', (x) => x);
  sec('警告', rep.warnings || [], 'warn', (x) => x);
  sec('冲突（手改过的生成文件）', rep.conflicts, 'warn', (x) => `${x.path} — ${x.reason}`);
  sec('已写入', rep.written, 'ok', (x) => x.path);
  sec('已清理', rep.removed, 'ok', (x) => x.path);
  modal({ title, body, actions: [{ label: '关闭', kind: 'primary' }], width: 720 });
}

async function doBuild() {
  try {
    await api.build(state.root, 'build');
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  openLogDrawer();
  pollBuild(0);
}

function openLogDrawer() {
  let drawer = $('.log-drawer');
  if (drawer) drawer.remove();
  const out = el('pre.log-output');
  const status = el('span.log-status', { text: '构建中…' });
  drawer = el(
    'div.log-drawer',
    {},
    el('div.log-head', {}, el('strong', { text: '构建日志' }), status, el('div.spacer'), el('button.icon-btn', { onclick: () => drawer.remove() }, '✕')),
    out,
  );
  document.body.append(drawer);
  drawer.__output = out;
  drawer.__status = status;
}

async function pollBuild(since) {
  const drawer = $('.log-drawer');
  if (!drawer) return;
  let t = since;
  const tick = async () => {
    try {
      const r = await api.buildTail(state.root, t);
      const job = r.job;
      if (!job) return;
      if (job.lines.length) {
        drawer.__output.textContent += job.lines.join('\n') + '\n';
        drawer.__output.scrollTop = drawer.__output.scrollHeight;
      }
      t = job.next;
      if (job.running) {
        drawer.__status.textContent = `构建中… ${fmtTime(job.elapsedMs)}`;
        setTimeout(tick, 700);
      } else {
        clearTimeout(state.buildPoll);
        if (job.exitCode === 0) {
          drawer.__status.textContent = `构建成功（${fmtTime(job.elapsedMs)}）`;
          drawer.__status.className = 'log-status ok';
          const a = await api.artifacts(state.root);
          if (a.artifacts.length) {
            const first = a.artifacts[0];
            toast(`构建成功：${first.name}（${fmtSize(first.size)}）`, 'ok', 6000);
            drawer.querySelector('.log-head').append(
              el('button.btn.small.ok', {
                onclick: () => downloadArtifact(first.name),
              }, `下载 ${first.name}`),
            );
          } else {
            toast('构建成功，但没找到 jar', 'warn');
          }
        } else {
          drawer.__status.textContent = `构建失败（退出码 ${job.exitCode}）`;
          drawer.__status.className = 'log-status error';
          const a = await api.artifacts(state.root);
          if (a.errors.length) {
            toast(`构建失败：${a.errors[0].slice(0, 90)}`, 'error', 8000);
          }
        }
      }
    } catch (e) {
      drawer.__status.textContent = `日志读取失败：${e.message}`;
      drawer.__status.className = 'log-status error';
    }
  };
  tick();
}

function downloadArtifact(name) {
  // 通过静态服务拿不到 build/libs，用接口读文件再触发下载
  api.readFile(state.root, `build/libs/${name}`).then((r) => {
    if (r.binary === false) {
      toast('这个文件无法直接下载', 'warn');
      return;
    }
    window.open(`/api/file?root=${encodeURIComponent(state.root)}&path=${encodeURIComponent('build/libs/' + name)}`, '_blank');
  });
}

// ============================================================
// 代码浏览
// ============================================================
async function openCodeBrowser() {
  const tree = await api.tree(state.root, 'src/main/java');
  const generated = new Set(Object.keys(state.project.files || {}));
  const list = el('div.file-tree');

  const walk = (nodes, depth = 0) => {
    for (const n of nodes) {
      if (n.type === 'dir') {
        list.append(el('div.tree-dir', { style: { paddingLeft: `${depth * 14 + 8}px` } }, `▸ ${n.name}`));
        walk(n.children, depth + 1);
      } else {
        const isGen = generated.has(n.path);
        list.append(
          el('button.tree-file', {
            style: { paddingLeft: `${depth * 14 + 8}px` },
            onclick: () => openFile(n.path),
          }, el('span', { text: n.name }), isGen ? el('span.badge.gen', { text: '生成' }) : el('span.badge.hand', { text: '手写' })),
        );
      }
    }
  };
  if (!tree.tree.length) list.append(el('div.empty', { text: '还没有 Java 文件' }));
  walk(tree.tree);

  modal({
    title: '代码浏览',
    body: el('div', {}, el('p.note', { text: '「生成」文件的改动会在下次生成时提示冲突；手写区（custom/）永远不会被覆盖。' }), list),
    actions: [{ label: '关闭', kind: 'ghost' }],
    width: 640,
  });
}

async function openFile(path) {
  const r = await api.readFile(state.root, path);
  if (r.binary) {
    toast('二进制文件不支持编辑', 'warn');
    return;
  }
  await openCodeModal({
    path,
    value: r.content,
    readOnly: false,
    onSave: async (v) => {
      await api.writeFile(state.root, path, v);
      state.project.files[path] && (state.project.files[path].hash = 'changed');
    },
  });
}

// ============================================================
// 模块管理
// ============================================================
async function openModuleManager() {
  const r = await api.modules(state.root);
  const list = el('div.module-list');
  for (const m of r.modules) {
    list.append(
      el(
        'div.module-row',
        {},
        el('div.module-name', { text: m.name }),
        el('code.badge', { text: m.id }),
        el('span.badge.' + (m.scope === 'builtin' ? 'gen' : 'hand'), { text: m.scope === 'builtin' ? '内置' : '工程私有' }),
        el('div.module-types', { text: m.types.map((t) => r.types.find((x) => x.id === t)?.label || t).join(' · ') }),
        el('div.module-desc', { text: m.description || '' }),
      ),
    );
  }

  const body = el(
    'div',
    {},
    el('p.note', { text: '每个模块是一个 modules/<名字>/ 目录，里面一份 module.json 声明字段、一个 generate.mjs 负责额外产出。加一种内容类型不用改引擎。' }),
    list,
    el('div.row-actions', {}, el('button.btn', { onclick: () => scaffoldModule() }, '+ 新建模块')),
  );

  modal({ title: '模块管理', body, actions: [{ label: '关闭', kind: 'ghost' }], width: 720 });
}

async function scaffoldModule() {
  const id = await promptBox('模块目录名（小写英文）', '', { title: '新建模块' });
  if (!id) return;
  const name = await promptBox('模块显示名', id, { title: '新建模块' });
  if (name === null) return;
  try {
    const r = await api.scaffoldModule({ id, name });
    toast(`模块已创建：${r.dir}`, 'ok', 5000);
    const mods = await api.modules(state.root);
    state.types = mods.types;
    state.typeMap = Object.fromEntries(mods.types.map((t) => [t.id, t]));
    renderWorkspace();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ============================================================
// 更多菜单
// ============================================================
function openMoreMenu(anchor) {
  const items = [
    { label: '工程设置', fn: openProjectSettings },
    { label: '查看生成产物', fn: () => showGeneratedFiles(null, null) },
    { label: '打开工程目录', fn: () => toast(`工程目录：${state.root}`, 'info', 6000) },
    { label: '删除这个工程', fn: deleteProject, danger: true },
  ];
  let menu = $('.more-menu');
  if (menu) {
    menu.remove();
    return;
  }
  menu = el('div.more-menu');
  for (const it of items) {
    menu.append(el(`button.menu-item${it.danger ? '.danger' : ''}`, { onclick: () => { menu.remove(); it.fn(); } }, it.label));
  }
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  document.body.append(menu);
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', off);
    }
  }), 0);
}

function openProjectSettings() {
  const m = state.project.meta;
  const nameIn = el('input.input', { value: m.name });
  const verIn = el('input.input', { value: m.version });
  const authorIn = el('input.input', { value: m.authors || '' });
  const descIn = el('textarea.input', { rows: 3 });
  descIn.value = m.description || '';

  modal({
    title: '工程设置',
    body: el(
      'div',
      {},
      el('label.field-label', {}, '模组名称', nameIn),
      el('label.field-label', {}, '版本号', verIn),
      el('label.field-label', {}, '作者', authorIn),
      el('label.field-label', {}, '描述', descIn),
      el('p.note', { text: '模组 id 和包名创建后不建议改（会影响所有注册名与文件路径）。' }),
    ),
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '保存',
        kind: 'primary',
        onClick: async () => {
          try {
            await api.updateMeta(state.root, { name: nameIn.value, version: verIn.value, authors: authorIn.value, description: descIn.value });
            state.project.meta = { ...m, name: nameIn.value, version: verIn.value, authors: authorIn.value, description: descIn.value };
            renderWorkspace();
            toast('已保存', 'ok');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
    ],
    width: 520,
  });
}

async function deleteProject() {
  const ok = await confirmBox(`删除工程「${state.project.meta.name}」？整个目录会被移除，无法恢复。`, { danger: true, title: '删除工程' });
  if (!ok) return;
  await api.deleteProject(state.root);
  localStorage.removeItem(LS_KEY);
  state.root = null;
  state.project = null;
  const res = await api.listProjects();
  state.projects = res.projects;
  renderWelcome();
}

async function showGeneratedFiles(type, entry) {
  const r = await api.preview(state.root);
  const files = r.files;
  const filtered = type && entry ? files.filter((f) => f.path.includes(`/${entry.id}.`) || f.path.includes(`/${entry.id}/`)) : files;
  const list = el('div.file-tree');
  for (const f of filtered) {
    list.append(el('button.tree-file', { onclick: () => openGenerated(f.path) }, el('span', { text: f.path }), el('span.muted', { text: fmtSize(f.size) })));
  }
  modal({
    title: type && entry ? `${entry.id} 的产出文件` : `全部产出（${files.length} 个文件）`,
    body: el('div', {}, el('p.note', { text: '这些是下次「生成」会写出的内容，点开可以看生成结果。' }), list),
    actions: [{ label: '关闭', kind: 'ghost' }],
    width: 720,
  });
}

async function openGenerated(path) {
  const r = await api.preview(state.root, path);
  if (!r.file) {
    toast('文件不存在', 'warn');
    return;
  }
  await openCodeModal({ path, value: r.file.content, readOnly: true });
}

// ============================================================
// 启动
// ============================================================
boot().catch((e) => {
  $('#boot').innerHTML = `<div class="boot-inner"><h2>启动失败</h2><p>${e.message}</p></div>`;
});
