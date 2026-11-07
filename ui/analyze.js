/**
 * 分析界面 —— 把一个现成的 mod 拆开看，把能用的部分留下来。
 *
 * 流程刻意分成三段，因为这三段的「确定性」完全不同：
 *   1. 元数据 / 内容  → 从 jar 的资源文件读出来，是事实
 *   2. 代码能力       → 从 class 常量池推断，是证据
 *   3. 效果模板       → 我们能给的等价实现，是建议
 * 界面上也按这个顺序排，不把猜测和事实混在一起说。
 */
import { api } from './api.js';
import { el, setChildren, setContent, fill, toast, modal } from './ui.js';
import { openInspect } from './inspect.js';

const A = {
  ctx: null,
  path: '',
  report: null,
  effects: [],
  sel: {}, // type -> Set(id)
  effectIds: new Set(),
  busy: false,
  uploading: false,
  host: null,
};

const TYPE_LABEL = {
  item: '物品',
  block: '方块',
  recipe: '配方',
  worldgen: '矿物生成',
  advancement: '进度',
  armorMaterial: '盔甲材质',
  tier: '工具材质',
};

// 分类按「玩家会怎么想」排，不是按 Unicode 码位。
// 不排的话中文分类会变成 技术/界面/属性 这种看着随机的顺序。
const CAT_ORDER = ['战斗', '属性', '移动', '物品', '方块', '交互', '世界', '界面', '数据', '技术'];
const catRank = (c) => {
  const i = CAT_ORDER.indexOf(c);
  return i < 0 ? 99 : i;
};

export function renderAnalyzePanel(ctx) {
  A.ctx = ctx;
  A.host = el('div.full-panel.analyze-panel');

  fill(A.host, 
    el('div.panel-bar', {},
      el('button.btn.ghost.small', { onclick: ctx.onBack }, '← 返回编辑'),
      el('h2.panel-title', { text: '分析外部 mod' }),
      el('div.spacer'),
      el('button.btn.ghost.small', { onclick: () => openBrowser() }, '浏览文件…'),
      el('button.btn.ghost.small', { onclick: () => openDecompiledSource() }, '反编译看源码'),
    ),
  );

  const sourceBox = el('div.analyze-source');
  const pathInput = el('input.path-input', {
    placeholder: 'jar 路径，或者解压后的目录，例如 C:\\Users\\你\\Desktop\\somebody-mod.jar',
    value: A.path,
    oninput: (e) => {
      A.path = e.target.value.trim();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') runAnalyze(pathInput.value.trim());
    },
  });
  const runBtn = el('button.btn.primary', {
    onclick: () => runAnalyze(pathInput.value.trim()),
  }, '分析');

  // ---------- 直接导入：拖进来就分析，不用先找服务端路径 ----------
  // fileInput 故意放在 dropBox 外面：它若是子元素，fileInput.click() 会冒泡
  // 回 dropBox 再触发一次 click，文件选择框会弹两次。
  const fileInput = el('input.imp-hidden', {
    type: 'file',
    accept: '.jar,.zip',
    onchange: (e) => {
      const f = e.target.files?.[0];
      if (f) uploadAndAnalyze(f);
      e.target.value = ''; // 同一个文件再拖一次也要触发 change
    },
  });
  const dropStatus = el('div.import-status.muted.small', {
    text: '只读解析，不会运行 jar 里的代码；文件副本存在 ~/.mcstudio/imports，可随时删除。',
  });
  const dropBox = el('div.import-drop', {
    ondragover: (e) => {
      e.preventDefault();
      dropBox.classList.add('over');
    },
    ondragleave: () => dropBox.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      dropBox.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) uploadAndAnalyze(f);
    },
    onclick: () => {
      if (!dropBox.classList.contains('busy')) fileInput.click();
    },
  },
    el('span.import-icon', { text: '📦' }),
    el('div.import-drop-main', {},
      el('div.import-drop-title', {}, '把别人的 mod jar 拖到这里，或 ', el('span.import-link', { text: '选择文件' })),
      dropStatus,
    ),
  );

  fill(sourceBox,
    fileInput,
    dropBox,
    el('div.source-row', {}, pathInput, runBtn),
    el('div.recent-row', {}, el('span.muted.small', { text: '最近的 jar：' })),
    el('div.import-manage-row', {},
      el('button.btn.ghost.small', { text: '管理已导入…', onclick: () => openImportManager() }),
    ),
  );
  fill(A.host, sourceBox);

  const body = el('div.analyze-body', {}, el('div.empty', { text: '把 jar 拖到上面的框里，或者直接分析一个解压目录。' }));
  fill(A.host, body);

  loadRecent();
  if (A.report) paintReport(body);

  return A.host;

  // 上传后要刷新「最近的 jar」，所以这里必须清空再填，不能用 fill 追加。
  async function loadRecent() {
    const row = sourceBox.querySelector('.recent-row');
    const label = el('span.muted.small', { text: '最近的 jar：' });
    try {
      const { jars } = await api.recentJars(ctx.root);
      if (!jars.length) {
        setContent(row, label, el('span.muted.small', { text: '（没找到，把 jar 拖进上面的框，或手动填路径）' }));
        return;
      }
      setContent(row, label, ...jars.slice(0, 8).map((j) =>
        el('button.chip-btn', {
          title: j.path,
          onclick: () => {
            pathInput.value = j.path;
            A.path = j.path;
            runAnalyze(j.path);
          },
        }, el('span', { text: j.name || j.path.split(/[\\/]/).pop() }), el('span.muted.small', { text: ` ${j.label}` })),
      ));
    } catch {
      setContent(row, label, el('span.muted.small', { text: '（读取失败）' }));
    }
  }

  // 必须是函数声明：面板重开时若已有报告，paintReport 会在这里还没执行到
  // 的位置调用 packagingSection，const/let 会踩 TDZ。
  function fmtSize(n) {
    return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  function setImportStatus(text, pct) {
    setContent(dropStatus,
      el('span', { text }),
      pct === null || pct === undefined ? null : el('span.import-bar', {}, el('i', { style: { width: `${Math.round(pct * 100)}%` } })),
    );
  }

  /**
   * 拖入 / 选中的文件：上传 → 拿到服务端路径 → 直接走既有分析链路。
   * 状态放 A 上，不能在这里用 let：函数体在 return A.host 之后的代码不会执行，
   * 局部 let 会一直留在 TDZ，用户一拖 jar 就 ReferenceError。
   */
  async function uploadAndAnalyze(file) {
    if (A.uploading) return;
    if (!/\.(jar|zip)$/i.test(file.name)) {
      toast('只收 .jar / .zip 文件', 'warn');
      return;
    }
    A.uploading = true;
    dropBox.classList.add('busy');
    try {
      setImportStatus(`上传 ${file.name}…`, 0);
      const saved = await api.uploadJar(file, (p) => setImportStatus(`上传 ${file.name}… ${Math.round(p * 100)}%`, p));
      setImportStatus(`${saved.name} 已导入，正在分析…`, null);
      pathInput.value = saved.path;
      A.path = saved.path;
      loadRecent();
      await runAnalyze(saved.path);
      setImportStatus(`已导入 ${saved.name}（${fmtSize(saved.size)}${saved.reused ? ' · 内容相同，复用已有缓存' : ''}）`, null);
    } catch (e) {
      setImportStatus(`导入失败：${e.message}`, null);
      toast(e.message, 'error', 6000);
    } finally {
      A.uploading = false;
      dropBox.classList.remove('busy');
    }
  }

  /** 导入缓存管理：只列/删自己上传的副本，不碰原文件 */
  async function openImportManager() {
    const listHost = el('div.import-list', {}, el('div.empty.small', { text: '加载中…' }));
    const m = modal({
      title: '已导入的 jar',
      width: 640,
      body: el('div', {},
        el('div.field-hint', { text: '这些是从浏览器上传的副本，存在 ~/.mcstudio/imports。删除只删副本，不会动你原来的文件。' }),
        listHost,
      ),
      actions: [{ label: '关闭', kind: 'ghost' }],
    });

    async function refresh() {
      const { jars } = await api.listUploads();
      if (!jars.length) {
        setChildren(listHost, el('div.empty.small', { text: '还没有导入过 jar' }));
        return;
      }
      setChildren(listHost, ...jars.map((j) =>
        el('div.import-row', {},
          el('span.mono', { text: j.name }),
          el('span.muted.small', { text: ` ${fmtSize(j.size)}` }),
          el('div.spacer'),
          el('button.btn.ghost.small', {
            text: '分析',
            onclick: () => {
              m.close();
              pathInput.value = j.path;
              A.path = j.path;
              runAnalyze(j.path);
            },
          }),
          el('button.btn.ghost.small', {
            text: '拆解',
            title: '打开拆解台：逐项查看、改数值、导出为可复用包',
            onclick: () => {
              m.close();
              openInspect(j.path);
            },
          }),
          el('button.btn.ghost.small', {
            text: '删除',
            onclick: async () => {
              try {
                await api.removeUpload(j.path);
                await refresh();
                loadRecent();
              } catch (e) {
                toast(e.message, 'error');
              }
            },
          }),
        ),
      ));
    }
    await refresh();
  }

  /** sources jar：直接读 .java 正文。文本走 textContent，不拼 HTML */
  async function openSourceFile(entry) {
    try {
      const { text } = await api.readJarSource(A.path, entry);
      modal({
        title: entry,
        width: 860,
        body: el('pre.code-body.source-view', { text }),
        actions: [{ label: '关闭', kind: 'ghost' }],
      });
    } catch (e) {
      toast(e.message, 'error', 6000);
    }
  }

  /**
   * 反编译整个 jar，按类看「原本代码」+ 引用。
   *
   * 发布版 jar 只有 .class，直接读 .java 是读不到的（除非是 sources jar）；
   * 这里用 ForgeFlower 真反编译，产出的是 Java 源码而不是常量池证据。
   */
  async function openDecompiledSource() {
    if (!A.path) {
      toast('先选一个 jar', 'warn');
      return;
    }
    let info;
    try {
      info = await api.decompileInfo();
    } catch {
      info = { available: false };
    }
    if (!info.available) {
      toast(
        '没找到反编译器（ForgeFlower）。把 forgeflower*.jar 放到 tools/forgeflower.jar，'
        + '或设置环境变量 MCSTUDIO_DECOMPILER 指向它。',
        'error',
        9000,
      );
      return;
    }

    let res;
    try {
      toast('反编译中…大 jar 可能要几分钟');
      res = await api.decompileJar(A.path);
    } catch (e) {
      toast(`反编译失败：${e.message}`, 'error', 9000);
      return;
    }
    if (!res.classes.length) {
      toast('反编译完成，但没有找到类', 'warn');
      return;
    }

    const all = res.classes;
    const known = new Set(all.map((c) => c.fqcn)); // 只有包里的类能点进去看
    let cur = '';

    const search = el('input.input.decompile-search', {
      placeholder: '搜类名 / 包名…', type: 'search', spellcheck: 'false',
    });
    const list = el('div.decompile-list');
    const head = el('div.decompile-head', { text: '选一个类' });
    const source = el('pre.code-body.source-view', { text: '左侧选一个类，看它原本是怎么写的' });
    const refBox = el('div.ref-box');
    // 引用列表默认展开；读长源码时可以收起来换高度
    const refToggle = el('button.btn.ghost.small', { title: '展开 / 收起引用列表' }, '引用');

    const paintList = () => {
      const q = search.value.trim().toLowerCase();
      const hit = q ? all.filter((c) => c.fqcn.toLowerCase().includes(q)) : all;
      const shown = hit.slice(0, 400);
      setChildren(list, ...shown.map((c) => el(
        `button.decompile-item${c.fqcn === cur ? '.active' : ''}`,
        { title: c.rel, onclick: () => select(c.fqcn) },
        el('span.decompile-item-name', { text: c.className }),
        el('span.decompile-item-pkg', { text: c.pkg || '(默认包)' }),
      )));
      if (!hit.length) setChildren(list, el('div.decompile-empty', { text: '没有匹配的类' }));
      else if (hit.length > shown.length) {
        list.append(el('div.decompile-empty', { text: `还有 ${hit.length - shown.length} 个，缩小关键词` }));
      }
    };

    // 引用标签：包里的类可点，外部依赖（gson、原版类）只展示
    const chip = (r) => (known.has(r)
      ? el('button.ref-chip.inner', { text: r, title: '看这个类的源码', onclick: () => select(r) })
      : el('span.ref-chip', { text: r, title: '外部依赖，不在此 jar 内' }));

    const paintRefs = (c) => {
      const cut = (arr) => (arr.length > 80
        ? [...arr.slice(0, 80).map(chip), el('span.ref-chip.more', { text: `…还有 ${arr.length - 80} 个` })]
        : arr.map(chip));
      setChildren(
        refBox,
        el('div.ref-title', { text: `用到了（${c.refs.length}）` }),
        el('div.ref-list', {}, ...cut(c.refs)),
        el('div.ref-title', { text: `被谁用（${c.referencedBy.length}）` }),
        el('div.ref-list', {}, ...cut(c.referencedBy)),
      );
      refToggle.textContent = `引用 ${c.refs.length + c.referencedBy.length}`;
    };

    async function select(fqcn) {
      cur = fqcn;
      paintList();
      head.textContent = fqcn;
      source.textContent = '读取源码…';
      try {
        const c = await api.classSource(A.path, fqcn);
        if (cur !== fqcn) return; // 连点好几个类时只认最后一个
        source.textContent = c.source;
        source.scrollTop = 0;
        paintRefs(c);
      } catch (e) {
        source.textContent = `读取失败：${e.message}`;
      }
    }

    search.addEventListener('input', paintList);

    const copyBtn = el('button.btn.ghost.small', {
      title: '复制当前源码',
      onclick: async () => {
        if (!cur) return;
        if (!navigator.clipboard) { toast('浏览器不允许访问剪贴板', 'warn'); return; }
        try {
          await navigator.clipboard.writeText(source.textContent || '');
          toast('源码已复制');
        } catch {
          toast('复制失败，请手动选中', 'warn');
        }
      },
    }, '复制');

    const view = el('div.decompile-view', {},
      el('div.decompile-side', {}, search, list),
      el('div.decompile-main', {},
        el('div.decompile-headbar', {}, head, el('div.spacer'), refToggle, copyBtn),
        source,
        refBox,
      ),
    );
    refToggle.onclick = () => {
      view.classList.toggle('refs-off');
      refToggle.classList.toggle('on', view.classList.contains('refs-off'));
    };

    modal({
      title: `原始实现 · ${res.cached ? '缓存命中' : '已反编译'} · ${all.length} 个类`,
      width: 1040,
      body: view,
      actions: [{ label: '关闭', kind: 'ghost' }],
    });

    paintList();
    // 默认打开一个「有肉」的类：优先主类（类名不含 $ 的最短 FQN），
    // 否则第一个 —— 免得一进来正对着一个内部类发呆。
    const top = all
      .filter((c) => !c.className.includes('$'))
      .sort((x, y) => x.fqcn.length - y.fqcn.length)[0] || all[0];
    await select(top.fqcn);
  }

  /** 内嵌 jar 拆出来变成一个普通导入文件，就能用同一套界面分析 */
  async function extractAndAnalyze(entry) {
    try {
      toast('正在拆出内嵌 jar…');
      const saved = await api.extractInner({ path: A.path, entry });
      pathInput.value = saved.path;
      A.path = saved.path;
      loadRecent();
      await runAnalyze(saved.path);
    } catch (e) {
      toast(e.message, 'error', 6000);
    }
  }

  async function runAnalyze(path) {
    if (!path) {
      toast('先给个路径', 'warn');
      return;
    }
    if (A.busy) return;
    A.busy = true;
    runBtn.textContent = '分析中…';
    runBtn.disabled = true;
    setChildren(body, el('div.empty', { text: '正在读 jar、解析 class…' }));
    try {
      const { report } = await api.analyze(path);
      A.report = report;
      A.path = path;
      A.sel = {};
      A.effectIds = new Set();
      for (const [type, list] of Object.entries(report.contents || {})) {
        // 默认全选，用户可以取消不想要的
        A.sel[type] = new Set(list.map((e) => e.id));
      }
      await loadEffects();
      paintReport(body);
    } catch (e) {
      setChildren(body, el('div.error-text', { text: `分析失败：${e.message}` }));
    } finally {
      A.busy = false;
      runBtn.textContent = '分析';
      runBtn.disabled = false;
    }
  }

  async function loadEffects() {
    if (A.effects.length) return;
    try {
      const r = await api.effects();
      A.effects = r.effects;
    } catch {
      A.effects = [];
    }
  }

  function paintReport(host) {
    const r = A.report;
    if (!r) return;
    const frag = [];
    const m = r.meta || {};

    // ---------- 它是什么 ----------
    frag.push(
      el('section.an-section', {},
        el('div.an-meta', {},
          el('h3.an-name', { text: m.name || r.source.name }),
          el('div.an-meta-row', {},
            el('span.pill', { text: m.loader || '未知加载器' }),
            m.mcVersion ? el('span.pill', { text: `MC ${m.mcVersion}` }) : null,
            m.id ? el('span.pill.mono', { text: m.id }) : null,
            m.version ? el('span.pill', { text: `v${m.version}` }) : null,
          ),
          m.description ? el('p.an-desc', { text: m.description }) : null,
          el('div.muted.small', { text: r.source.path }),
        ),
      ),
    );

    // ---------- 体检数字 ----------
    // 0 的不显示 —— 一排 "0 贴图" 只会让人以为分析漏了东西
    const counts = Object.entries(r.counts || {}).filter(([, n]) => n);
    const stats = counts.map(([k, n]) => [TYPE_LABEL[k] || k, n]);
    if (r.assets?.textures) stats.push(['贴图', r.assets.textures]);
    if (r.code?.stats?.classFiles) stats.push(['class', r.code.stats.classFiles]);
    if (r.code?.abilities?.length) stats.push(['识别出的能力', r.code.abilities.length]);
    frag.push(
      el('section.an-section', {},
        el('div.stat-row', {},
          ...stats.map(([label, n]) => el('div.stat', {}, el('div.stat-num', { text: String(n) }), el('div.stat-label', { text: label }))),
        ),
      ),
    );

    // ---------- 包的特征：说明「为什么只能看到这些」 ----------
    frag.push(packagingSection(r));

    // ---------- 内容（可勾选）----------
    for (const [type, list] of Object.entries(r.contents || {})) {
      if (!list.length) continue;
      frag.push(contentSection(type, list));
    }

    // ---------- 代码能力 ----------
    const abilities = r.code?.abilities || [];
    if (abilities.length) {
      const byCat = new Map();
      for (const a of abilities) {
        if (!byCat.has(a.category)) byCat.set(a.category, []);
        byCat.get(a.category).push(a);
      }
      const box = el('details.an-section', { open: true },
        el('summary', {}, el('span', { text: `代码能力（${abilities.length}）` }), el('span.muted.small', { text: '  从 class 常量池推断' })),
      );
      for (const [cat, list] of [...byCat.entries()].sort((a, b) => catRank(a[0]) - catRank(b[0]))) {
        fill(box, el('div.an-cat-label', { text: cat }));
        for (const a of list) {
          const templates = A.effects.filter((e) => (e.abilities || []).includes(a.id));
          const usable = a.packable && templates.length;
          const row = el('div.ability-row', {});
          if (usable) {
            fill(row, el('input', {
              type: 'checkbox',
              checked: A.effectIds.has(templates[0].id),
              onchange: (e) => {
                if (e.target.checked) A.effectIds.add(templates[0].id);
                else A.effectIds.delete(templates[0].id);
              },
            }));
          } else {
            fill(row, el('span.checkbox-space'));
          }
          fill(row, 
            el('div.ability-main', {},
              el('div.ability-name', {},
                el('span', { text: a.name }),
                a.confidence === 'high' ? el('span.conf-badge.high', { text: '强证据' }) : el('span.conf-badge', { text: '有证据' }),
                a.packable ? null : el('span.pill.tiny', { text: '仅识别' }),
              ),
              el('div.ability-desc', { text: a.desc }),
              el('div.ability-evidence.mono', { text: a.evidence.join('  ') }),
              usable ? el('div.ability-template', { text: `☑ 勾选 = 附带「${templates[0].name}」的可编译实现` }) : null,
            ),
          );
          fill(box, row);
        }
      }
      frag.push(box);
    }

    // ---------- mixin ----------
    const mixins = r.code?.mixins || [];
    if (mixins.length) {
      const box = el('details.an-section', {},
        el('summary', {}, el('span', { text: `Mixin 注入（${mixins.reduce((n, x) => n + x.count, 0)} 个类）` })),
      );
      for (const mx of mixins) {
        fill(box, el('div.mixin-file', { text: mx.file }));
        for (const d of mx.details || []) {
          fill(box, el('div.mixin-row', {},
            el('span.mono', { text: d.name }),
            el('span.muted', { text: ' → ' }),
            el('span.mono.small', { text: d.targets.map((t) => t.split('/').pop()).join(', ') || '（未识别）' }),
          ));
        }
      }
      frag.push(box);
    }

    // ---------- 警告 ----------
    if (r.warnings?.length) {
      const box = el('details.an-section.warn-section', {},
        el('summary', {}, el('span', { text: `注意（${r.warnings.length}）` })),
      );
      for (const w of r.warnings) fill(box, el('div.warn-line', { text: `· ${w}` }));
      frag.push(box);
    }

    // ---------- 底部操作 ----------
    frag.push(el('div.an-actions', {},
      el('div.muted.small', { text: '勾选的内容会打包成「效果包」，之后可以装进任何工程。' }),
      el('div.spacer'),
      el('button.btn.ghost', {
        title: '把这次分析写进学习记录，下次能搜到、AI 也能引用',
        onclick: (e) => saveAsNote(e.currentTarget),
      }, '存成笔记'),
      el('button.btn.primary', { onclick: () => openPackDialog() }, '打包选中的内容'),
    ));

    setChildren(host, ...frag);
  }

  // ---------- 沉淀成知识笔记 ----------
  //
  // 分析是一次性的：看完关掉就没了。但「这个 mod 怎么做的吸血」这种结论
  // 下次还想翻。落到学习记录里，搜索能搜到、AI 也能引用。
  async function saveAsNote(btn) {
    const path = A.path;
    if (!path) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '写入中…';
    try {
      const r = await api.knowledgeLearn(path);
      btn.textContent = '已存';
      toast(`已存成笔记：${r.title}（学习中心里能找到）`);
      setTimeout(() => {
        btn.textContent = old;
        btn.disabled = false;
      }, 1600);
    } catch (e) {
      btn.textContent = old;
      btn.disabled = false;
      toast(`存不了：${e.message}`, 'error');
    }
  }

  /** 第三方发布包的物理特征：签名、重映射、源码、内嵌 jar */
  function packagingSection(r) {
    const p = r.packaging || {};
    const nested = p.nestedJars || [];
    const badges = [];
    if (p.signed) badges.push(el('span.pill.tiny', { text: '带签名 · 发布包' }));
    if (p.obfuscation?.intermediary) badges.push(el('span.pill.tiny', { text: 'intermediary 重映射' }));
    if (p.obfuscation?.srg) badges.push(el('span.pill.tiny', { text: 'SRG 名' }));
    if (p.javaSources) badges.push(el('span.pill.tiny', { text: `带 ${p.javaSources} 个 .java 源码` }));
    if (p.embeddedMods?.length) badges.push(el('span.pill.tiny', { text: `多 mod 描述 ${p.embeddedMods.length}` }));
    if (!badges.length && !nested.length) return null;

    const box = el('details.an-section', { open: true },
      el('summary', {}, el('span', { text: '这个包的特征' }), el('span.muted.small', { text: '  决定能看到什么' })),
    );
    if (badges.length) fill(box, el('div.an-badges', {}, ...badges));
    if (p.javaSources) {
      fill(box, el('div.field-hint', { text: `这是源码包，jar 里带 ${p.javaSources} 个 .java 文件：能直接打开看，不需要反编译。` }));
      for (const f of (p.javaSample || []).slice(0, 8)) {
        fill(box, el('div.nested-row', {},
          el('span.mono.small', { text: f }),
          el('div.spacer'),
          el('button.btn.ghost.small', { text: '查看源码', onclick: () => openSourceFile(f) }),
        ));
      }
    } else if (p.signed || p.releaseLike) {
      fill(box, el('div.field-hint', { text: '发布版 / 整合包通常只有 .class：能认出内容、能力、注册 id，但拿不到原作者的 Java 源码。要复用逻辑请用下面的「效果模板」——那是可编译的等价实现，编辑器不会假装能把字节码还原成源码。' }));
    }
    if (p.embeddedMods?.length) {
      for (const m of p.embeddedMods.slice(0, 8)) {
        fill(box, el('div.nested-row', {},
          el('span.mono.small', { text: `${m.id || m.name}（${m.from}）` }),
        ));
      }
    }
    for (const j of nested) {
      fill(box, el('div.nested-row', {},
        el('span.mono.small', { text: j.name }),
        el('span.muted.small', { text: ` ${fmtSize(j.size)}` }),
        el('div.spacer'),
        el('button.btn.ghost.small', { text: '单独分析', onclick: () => extractAndAnalyze(j.name) }),
      ));
    }
    return box;
  }

  function contentSection(type, list) {
    const set = A.sel[type] || new Set();
    const box = el('details.an-section', { open: list.length <= 12 },
      el('summary', {},
        el('span', { text: `${TYPE_LABEL[type] || type}（${list.length}）` }),
        el('span.muted.small', { text: `  已选 ${set.size}` }),
      ),
    );

    const toolbar = el('div.capture-toolbar', {},
      el('button.btn.ghost.small', {
        onclick: () => {
          for (const e of list) A.sel[type].add(e.id);
          paintReport(A.host.querySelector('.analyze-body'));
        },
      }, '全选'),
      el('button.btn.ghost.small', {
        onclick: () => {
          A.sel[type].clear();
          paintReport(A.host.querySelector('.analyze-body'));
        },
      }, '清空'),
    );
    fill(box, toolbar);

    const grid = el('div.chip-grid');
    for (const e of list) {
      const on = set.has(e.id);
      fill(grid, 
        el(`button.chip${on ? '.on' : ''}`, {
          title: describeEntry(type, e),
          onclick: () => {
            if (A.sel[type].has(e.id)) A.sel[type].delete(e.id);
            else A.sel[type].add(e.id);
            paintReport(A.host.querySelector('.analyze-body'));
          },
        },
          el('span', { text: e.nameZh || e.id }),
          e.nameEn && e.nameZh ? el('span.chip-en', { text: e.nameEn }) : null,
        ),
      );
    }
    fill(box, grid);
    return box;
  }

  function describeEntry(type, e) {
    if (type === 'item') return `${e.id}${e.kind ? ` · ${e.kind}` : ''}${e.toolType ? `/${e.toolType}` : ''}`;
    if (type === 'block') return `${e.id}${e.kind ? ` · ${e.kind}` : ''}`;
    if (type === 'recipe') return `${e.id} · ${e.mode} → ${e.result}`;
    if (type === 'worldgen') return `${e.id} · ${e.dimension} · size ${e.size}`;
    if (type === 'armorMaterial') return `${e.id} · 防御 ${e.defHelmet}/${e.defChest}/${e.defLegs}/${e.defBoots} · 耐久 ${e.durability}`;
    if (type === 'tier') return `${e.id} · 耐久 ${e.durability} · 速度 ${e.speed} · 伤害 +${e.attackDamageBonus}`;
    return e.id;
  }

  // ---------- 打包 ----------
  function openPackDialog() {
    const contents = {};
    let total = 0;
    for (const [type, set] of Object.entries(A.sel)) {
      if (set.size) {
        contents[type] = [...set];
        total += set.size;
      }
    }
    if (!total && !A.effectIds.size) {
      toast('什么都没选', 'warn');
      return;
    }

    const nameInput = el('input', { value: `${A.report.meta.name || A.report.source.name} 的内容` });
    const scopeSel = el('select.mini-select', {},
      el('option', { value: 'project' }, '存到本工程'),
      el('option', { value: 'user' }, '存到我的库（所有工程可用）'),
    );
    const alsoInstall = el('input', { type: 'checkbox', checked: true });

    const m = modal({
      title: '打包',
      width: 520,
      body: el('div', {},
        el('div', { text: `将打包 ${total} 项内容${A.effectIds.size ? ` + ${A.effectIds.size} 个可编译效果` : ''}` }),
        A.effectIds.size
          ? el('div.field-hint', { text: '效果是可编译的等价实现，不是原 mod 的代码 —— 原代码依赖它自己的类，搬过来编译不过。' })
          : null,
        el('div.field-row', {}, el('span.field-label', { text: '名称' }), nameInput),
        el('div.field-row', {}, el('span.field-label', { text: '存到' }), scopeSel),
        el('label.field-row', {}, alsoInstall, el('span', { text: ' 存完直接装进当前工程' })),
      ),
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '打包',
          kind: 'primary',
          onClick: async () => {
            try {
              const { pack } = await api.analyzeToPack({
                path: A.path,
                selection: { contents, withTextures: true },
                effectIds: [...A.effectIds],
                name: nameInput.value.trim() || undefined,
              });
              const saved = await api.savePack({ root: A.ctx.root, pack, scope: scopeSel.value });
              if (alsoInstall.checked) {
                const r = await api.applyPack({ root: A.ctx.root, id: saved.pack.id });
                const n = Object.values(r.report.added).reduce((a, l) => a + l.length, 0);
                toast(`已打包并装入 ${n} 项内容`, 'ok');
                A.ctx.onChanged?.();
              } else {
                toast(`已存进库：${saved.pack.name}`, 'ok');
              }
              m.close();
            } catch (e) {
              toast(e.message, 'error', 6000);
              return false;
            }
          },
        },
      ],
    });
  }

  // ---------- 文件浏览 ----------
  function openBrowser() {
    const listHost = el('div.browse-list', {}, el('div.empty', { text: '加载中…' }));
    const pathLabel = el('div.browse-path.mono.small', { text: '' });

    async function go(dir) {
      try {
        const r = await api.browse(dir);
        pathLabel.textContent = r.dir || '（选择磁盘）';
        const items = [];
        if (r.parent !== null && r.parent !== undefined && r.dir) {
          items.push(el('div.browse-item.dir', { onclick: () => go(r.parent) }, el('span', { text: '⬑ 上一级' })));
        }
        for (const d of r.dirs) {
          items.push(el('div.browse-item.dir', { onclick: () => go(d.path) }, el('span', { text: `📁 ${d.name}` })));
        }
        for (const j of r.jars) {
          items.push(
            el('div.browse-item.jar', {
              onclick: () => {
                pathInput.value = j.path;
                A.path = j.path;
                m.close();
                runAnalyze(j.path);
              },
            }, el('span', { text: `📦 ${j.name}` }), el('span.muted.small', { text: ` ${Math.round(j.size / 1024)} KB` })),
          );
        }
        setChildren(listHost, ...items);
      } catch (e) {
        setChildren(listHost, el('div.error-text', { text: e.message }));
      }
    }

    const m = modal({
      title: '找 jar 文件',
      width: 680,
      body: el('div', {}, pathLabel, listHost),
      actions: [{ label: '关闭', kind: 'ghost' }],
    });
    go('');
  }
}
