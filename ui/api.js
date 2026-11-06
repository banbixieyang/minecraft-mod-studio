/**
 * API 客户端。
 * 所有后端交互都从这里走，视图层不直接碰 fetch。
 */

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`服务返回了非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * 上传 jar 走原始二进制 + XHR（fetch 拿不到上传进度）。
 * 文件名放请求头，正文就是文件本身 —— 不 base64，不额外涨 33% 体积。
 */
function uploadJar(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/analyze/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch {
        reject(new Error(`服务返回了非 JSON（HTTP ${xhr.status}）`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
      else reject(new Error(data.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('上传中断，连不上编辑器服务'));
    xhr.send(file);
  });
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

/**
 * SSE 对话。返回 { done, abort }：done 在流结束/中止/出错时 resolve，
 * abort() 让用户能中途停止。按 SSE 规范以空行分帧，多行 data 会合并。
 */
function aiChatStream(body, handlers = {}) {
  const ac = new AbortController();
  const done = (async () => {
    let res;
    try {
      res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
        signal: ac.signal,
      });
    } catch (e) {
      if (ac.signal.aborted) return { stopped: true };
      throw new Error(`连不上编辑器服务：${e.message}`);
    }
    // 头之前能判定的错误（没配 key / 空问题）仍是普通 JSON，别当 SSE 解析
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch { /* 非 JSON 就用状态码 */ }
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code;
      err.detail = data.detail;
      throw err;
    }
    if (!res.body) throw new Error('服务没有返回流');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let event = '';
    let dataLines = [];
    const dispatch = (ev, raw) => {
      if (!raw) return;
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      if (ev === 'meta') handlers.onMeta?.(data);
      else if (ev === 'delta') handlers.onDelta?.(data.text || '');
      else if (ev === 'done') handlers.onDone?.(data);
      else if (ev === 'error') {
        const e = new Error(data.error || '模型出错');
        e.code = data.code;
        e.detail = data.detail;
        handlers.onError?.(e);
      }
    };

    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (line === '') {
            dispatch(event, dataLines.join('\n'));
            event = '';
            dataLines = [];
          } else if (line.startsWith(':')) {
            // 心跳/注释
          } else if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      buf += decoder.decode();
      if (buf.trim()) {
        // 服务端没以空行收尾时也别丢最后一帧
        const line = buf.replace(/\r$/, '');
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      dispatch(event, dataLines.join('\n'));
    } catch (e) {
      if (!ac.signal.aborted) throw e;
    } finally {
      try { await reader.cancel(); } catch { /* 已结束 */ }
    }
    return { stopped: ac.signal.aborted };
  })();
  return { done, abort: () => ac.abort() };
}

export const api = {
  health: () => request('GET', '/api/health'),
  targets: () => request('GET', '/api/targets'),
  modules: (root) => request('GET', `/api/modules${qs({ root })}`),
  reloadModules: () => request('POST', '/api/reload-modules', {}),
  anchors: () => request('GET', '/api/anchors'),

  listProjects: () => request('GET', '/api/projects'),
  createProject: (body) => request('POST', '/api/projects', body),
  openProject: (root) => request('GET', `/api/project${qs({ root })}`),
  updateMeta: (root, meta) => request('PUT', '/api/project/meta', { root, meta }),
  deleteProject: (root) => request('POST', '/api/project/delete', { root }),

  entries: (root, type) => request('GET', `/api/entries${qs({ root, type })}`),
  addEntry: (root, type, entry) => request('POST', '/api/entries', { root, type, entry }),
  updateEntry: (root, type, id, patch) => request('PUT', '/api/entries', { root, type, id, patch }),
  deleteEntry: (root, type, id) => request('DELETE', `/api/entries${qs({ root, type, id })}`),
  moveEntry: (root, type, id, delta) => request('POST', '/api/entries/move', { root, type, id, delta }),
  duplicateEntry: (root, type, id) => request('POST', '/api/entries/duplicate', { root, type, id }),

  preflight: (root) => request('POST', '/api/preflight', { root }),
  generate: (root, force) => request('POST', '/api/generate', { root, force }),
  preview: (root, path) => request('GET', `/api/preview${qs({ root, path })}`),

  readFile: (root, path) => request('GET', `/api/file${qs({ root, path })}`),
  writeFile: (root, path, content) => request('PUT', '/api/file', { root, path, content }),
  tree: (root, path) => request('GET', `/api/tree${qs({ root, path })}`),

  vanilla: () => request('GET', '/api/textures/vanilla'),
  texturePreview: (root, type, entry) => request('POST', '/api/textures/preview', { root, type, entry }),
  textureFile: (root, path) => request('GET', `/api/textures/file${qs({ root, path })}`),
  saveTexture: (root, path, dataUrl) => request('PUT', '/api/textures/file', { root, path, dataUrl }),
  upscale: (root, path, factor) => request('POST', '/api/textures/upscale', { root, path, factor }),

  build: (root, task) => request('POST', '/api/build', { root, task }),
  buildTail: (root, since) => request('GET', `/api/build/tail${qs({ root, since })}`),
  artifacts: (root) => request('GET', `/api/build/artifacts${qs({ root })}`),

  bbmodel: (root, type, id, texturePath) => request('POST', '/api/blockbench/model', { root, type, id, texturePath }),
  bbOpen: (root, type, id, texturePath) => request('POST', '/api/blockbench/open', { root, type, id, texturePath }),

  scaffoldModule: (body) => request('POST', '/api/modules/scaffold', body),

  // ---------- 包库 ----------
  listPacks: (root) => request('GET', `/api/library/packs${qs({ root })}`),
  getPack: (root, id) => request('GET', `/api/library/pack${qs({ root, id })}`),
  capturePack: (body) => request('POST', '/api/library/capture', body),
  savePack: (body) => request('POST', '/api/library/save', body),
  importPack: (body) => request('POST', '/api/library/import', body),
  exportPack: (root, id) => request('GET', `/api/library/export${qs({ root, id })}`),
  deletePack: (body) => request('POST', '/api/library/delete', body),
  movePack: (body) => request('POST', '/api/library/move', body),
  previewPack: (body) => request('POST', '/api/library/preview', body),
  applyPack: (body) => request('POST', '/api/library/apply', body),
  effects: () => request('GET', '/api/library/effects'),
  effectPack: (id, overrides) => request('POST', '/api/library/effect-pack', { id, overrides }),

  // ---------- 分析 ----------
  analyze: (path) => request('POST', '/api/analyze', { path }),
  browse: (dir) => request('GET', `/api/analyze/browse${qs({ dir })}`),
  recentJars: (root) => request('GET', `/api/analyze/recent${qs({ root })}`),
  analyzeToPack: (body) => request('POST', '/api/analyze/to-pack', body),
  uploadJar,
  listUploads: () => request('GET', '/api/analyze/uploads'),
  removeUpload: (path) => request('POST', '/api/analyze/upload-remove', { path }),
  extractInner: (body) => request('POST', '/api/analyze/extract-inner', body),
  readJarSource: (path, entry) => request('POST', '/api/analyze/source', { path, entry }),

  // ---------- 知识库 ----------
  knowledgeList: () => request('GET', '/api/knowledge/list'),
  knowledgeDoc: (id) => request('GET', `/api/knowledge/doc${qs({ id })}`),
  knowledgeSearch: (q, opts) => request('GET', `/api/knowledge/search${qs({ q, category: opts?.category, source: opts?.source, limit: opts?.limit, platform: opts?.platform, root: opts?.root })}`),
  knowledgeReload: () => request('POST', '/api/knowledge/reload', {}),
  knowledgeLearn: (path) => request('POST', '/api/knowledge/learn', { path }),
  knowledgeDelete: (id) => request('POST', '/api/knowledge/delete', { id }),

  // ---------- AI ----------
  aiConfig: () => request('GET', '/api/ai/config'),
  aiSaveConfig: (body) => request('POST', '/api/ai/config', body),
  aiTest: () => request('POST', '/api/ai/test', {}),
  aiChat: (body) => request('POST', '/api/ai/chat', body),

  hooksList: (root) => request('GET', `/api/hooks/list${qs({ root })}`),
  hooksPreview: (body) => request('POST', '/api/hooks/preview', body),
  hooksAdd: (body) => request('POST', '/api/hooks/add', body),
  hooksRemove: (body) => request('POST', '/api/hooks/remove', body),
  aiChatStream,

  // ---------- 可视化积木 ----------
  /** 积木清单（按分类） */
  visualBlocks: (root, targetId) => request('GET', `/api/visual/blocks${qs({ root, targetId })}`),
  /** 已装的积木库 */
  visualLibraries: (root) => request('GET', `/api/visual/libraries${qs({ root })}`),
  visualExtensions: () => request('GET', '/api/visual/extensions'),
  /** 读工程的积木程序 */
  visualProgram: (root) => request('GET', `/api/visual/program${qs({ root })}`),
  /** 保存工程的积木程序 */
  saveVisualProgram: (root, programs) => request('PUT', '/api/visual/program', { root, programs }),
  /** 编译预览 */
  visualCompile: (body) => request('POST', '/api/visual/compile', body),
  /** Java → 积木 */
  visualDecompile: (body) => request('POST', '/api/visual/decompile', body),
  /** 代码造积木 */
  visualCustomBlock: (body) => request('POST', '/api/visual/custom-block', body),
  /** 导出自定义积木为库 */
  visualExportBlocks: (ids) => request('POST', '/api/visual/export-blocks', { ids }),
  /** 装库（写盘，必须显式确认） */
  visualInstallLibrary: (body) => request('POST', '/api/visual/install-library', body),
  /** 从 mod jar 生成积木库 */
  visualLibraryFromJar: (body) => request('POST', '/api/visual/library-from-jar', body),

  // ---------- 功能转换器 ----------
  /** 规则清单与加载诊断 */
  convertRules: () => request('GET', '/api/convert/rules'),
  /** 目标之间的能力矩阵 */
  convertMatrix: () => request('GET', '/api/convert/matrix'),
  /** 抽出功能 IR（只读） */
  convertInspect: (body) => request('POST', '/api/convert/inspect', body),
  /** 转换预览（只读，返回分级报告） */
  convertPreview: (body) => request('POST', '/api/convert/preview', body),
  /** 把转换结果落到工程（写盘，必须 confirmed:true） */
  convertApply: (body) => request('POST', '/api/convert/apply', { ...body, confirmed: true }),
};
