/**
 * 「装成钩子」确认框。
 *
 * 边界很明确：这里只把代码写进工程的钩子**配置**，不改任何 Java 文件。
 * 用户看完真实落点、静态检查结果，点「确认装进去」才会发那个写盘请求；
 * 之后还要自己点「生成」，代码才进源码 —— 两步都有人把关。
 */
import { el, setContent, modal, toast } from './ui.js';
import { api } from './api.js';

/**
 * @param {{code: string, ctx: object, source?: string}} args
 */
export async function openHookInstall({ code, ctx, source = 'ai' }) {
  const root = ctx?.root;
  if (!root) {
    toast('先打开一个工程，才能把代码装成钩子', 'warn');
    return;
  }

  const S = { anchor: 'init', data: null, loading: true, error: '', installing: false };

  const metaHost = el('div.hook-meta');
  const anchorSelect = el('select.input', {
    onchange: (e) => {
      S.anchor = e.target.value;
      refresh();
    },
  });
  const issuesHost = el('div.hook-issues');
  const targetHost = el('div.hook-target');
  const codeHost = el('pre.hook-code.hook-injected');
  const footNote = el('p.hook-note', {
    text: '确认后只写入工程配置（.studio/project.json），不会立刻改 Java。还需要点「生成」把钩子插进源码，再「构建 jar」才会生效。',
  });

  const body = el(
    'div.hook-install',
    {},
    metaHost,
    el('div.field', {}, el('label.field-label', { text: '插到哪个锚点' }), anchorSelect, el('div.field-hint', { text: '锚点是生成文件里的 // @hook:<名字> 标记；换锚点会重新计算落点' })),
    issuesHost,
    targetHost,
    el('div.hook-preview', {}, el('div.hook-preview-title', { text: '插入之后长这样（取自真实生成结果）' }), codeHost),
    footNote,
  );

  const m = modal({
    title: '装成钩子 · 先确认',
    body,
    width: 760,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '确认装进去',
        kind: 'primary',
        onClick: async () => {
          if (S.installing) return false;
          if (!S.data?.installable) return false;
          S.installing = true;
          try {
            const r = await api.hooksAdd({
              root,
              code,
              target: S.anchor,
              name: `AI 建议 · ${S.anchor}`,
              source,
              confirmed: true,
            });
            toast(`钩子已加入工程（共 ${r.totalHooks} 个）。点「生成」后生效`, 'ok');
            ctx.onChanged?.();
            return true;
          } catch (e) {
            toast(`没装成：${e.message}`, 'error');
            return false;
          } finally {
            S.installing = false;
          }
        },
      },
    ],
  });
  // modal() 的 kind 只接受单个类名，这里按它在按钮栏里的位置取
  const confirmBtn = m.box.querySelector('.modal-foot button.btn.primary');

  async function refresh() {
    S.loading = true;
    S.error = '';
    if (confirmBtn) confirmBtn.disabled = true;
    setContent(issuesHost, el('div.hook-issue.info', { text: '正在预演生成结果…' }));
    try {
      const data = await api.hooksPreview({ root, code, target: S.anchor });
      S.data = data;
      S.loading = false;
      paint(data);
    } catch (e) {
      S.loading = false;
      S.error = e.message;
      setContent(issuesHost, el('div.hook-issue.err', { text: `预览失败：${e.message}` }));
      if (confirmBtn) confirmBtn.disabled = true;
    }
  }

  function paint(data) {
    const t = data.target || {};
    setContent(
      metaHost,
      el('span.pill', { text: data.project?.name || '当前工程' }),
      el('span.pill', { text: t.label || '未知目标' }),
      el('span.hook-count', { text: `已有 ${data.existingHooks} 个钩子` }),
    );

    if (anchorSelect.options.length !== (data.anchors || []).length) {
      setContent(
        anchorSelect,
        ...(data.anchors || []).map((a) => el('option', { value: a.id, text: a.label })),
      );
    }
    anchorSelect.value = S.anchor;

    const issues = [];
    for (const x of data.inspection?.errors || []) issues.push(el('div.hook-issue.err', { text: `✕ ${x}` }));
    for (const x of data.inspection?.warnings || []) issues.push(el('div.hook-issue.warn', { text: `! ${x}` }));
    if (data.duplicate) issues.push(el('div.hook-issue.warn', { text: '! 这段钩子已经装过了，确认按钮已禁用' }));
    if (!data.placement?.found) {
      issues.push(el('div.hook-issue.warn', { text: `! 这次生成的文件里没找到锚点 // @hook:${S.anchor}，装进去也不会被插入` }));
    }
    if (!issues.length) issues.push(el('div.hook-issue.ok', { text: '✓ 静态检查没发现问题。语法与版本 API 是否对得上，仍要以「构建 jar」为准。' }));
    setContent(issuesHost, ...issues);

    const p = data.placement || {};
    setContent(
      targetHost,
      p.found
        ? el('span.mono', { text: `${p.file} : ${p.lineNo} 行` })
        : el('span.hook-issue.warn', { text: '未找到落点' }),
      el('span.hook-count', { text: `${data.inspection?.lines || 0} 行 / ${data.inspection?.chars || 0} 字符` }),
    );
    codeHost.textContent = p.injected || '（没有可预览的内容）';

    if (confirmBtn) confirmBtn.disabled = !data.installable || S.loading || !!S.error;
  }

  await refresh();
  return m;
}
