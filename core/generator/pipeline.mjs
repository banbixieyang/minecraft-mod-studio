/**
 * 生成管线 —— 把工程数据变成磁盘上的真实工程。
 *
 * 管线本身不懂任何平台细节，它只做四件事：
 *   1. 向适配器与模块收集「要写哪些文件」
 *   2. 冲突检测（用户手改过生成文件就停下来问，不静默覆盖）
 *   3. 写盘并记录指纹
 *   4. 清理孤儿文件（条目删了，对应的 json/java 也要删）
 *
 * 扩展点都通过钩子暴露，见 core/hooks/hooks.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getTargetFor } from '../target/registry.mjs';
import { loadProject, recordGenerated, wasHandEdited, saveProject } from '../project.mjs';
import { genAssets, genData } from './resources.mjs';
import { genTextures } from './textures.mjs';
import { listContentTypes, loadGenerator } from '../modules/registry.mjs';
import { applyJavaHooks, runJsHooks } from '../hooks/hooks.mjs';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** 读取工程内某个文件（相对路径） */
function readIfExists(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 收集全部产出。
 * 返回 [{ path, content, binary?, createOnly?, mode? }]
 */
export async function collect(p, opts = {}) {
  const adapter = getTargetFor(p);
  const files = [];

  const push = (list) => {
    for (const f of list || []) files.push(f);
  };

  // 1. 工程骨架（构建脚本、元数据、wrapper）
  push(adapter.scaffold(p, { clientModsDir: opts.clientModsDir }));

  // 2. 平台元数据（每次刷新）
  push(adapter.metadata(p));

  // 3. Java 源码
  push(adapter.javaFiles(p));

  // 4. 资源与数据
  push(genAssets(p, adapter));
  push(genData(p, adapter));

  // 4.5 贴图（二进制；盔甲层贴图的落点也随 MC 版本变）
  const texFiles = genTextures(p, adapter);
  push(texFiles);
  for (const note of texFiles.notes || []) files.push({ __warn: note });

  // 5. 手写区（只在缺失时创建）
  push(adapter.handWritten(p));

  // 6. 模块自带的额外产出
  const langFiles = {
    zh_cn: `src/main/resources/assets/${p.meta.id}/lang/zh_cn.json`,
    en_us: `src/main/resources/assets/${p.meta.id}/lang/en_us.json`,
  };
  const ctx = {
    project: p,
    adapter,
    ns: p.meta.id,
    pkg: p.meta.pkg,
    addFile: (relPath, content, o = {}) => files.push({ path: relPath, content, ...o }),
    /** 取某类型的所有条目 */
    entriesOf: (type) => p.entries[type] || [],
    /** 把短名补全成带命名空间的 id */
    nsId: (v) => (String(v).includes(':') ? v : `${p.meta.id}:${v}`),
    /** 打印到生成日志 */
    log: (m) => console.log(`[${p.meta.id}] ${m}`),
    /**
     * 往语言文件里插一条翻译。
     * 模块只管调，不用操心那两个 json 已经由引擎生成好了。
     * addLang('advancement.foo.title', '中文', 'English')
     */
    addLang: (key, zh, en) => {
      const apply = (locale, value) => {
        if (value === undefined || value === null || value === '') return;
        const rel = langFiles[locale];
        const f = files.find((x) => x.path === rel);
        if (!f) return;
        let obj;
        try {
          obj = JSON.parse(f.content);
        } catch {
          return; // 语言文件被外部改坏时不碰它
        }
        obj[key] = String(value);
        f.content = JSON.stringify(obj, null, 2) + '\n';
      };
      apply('zh_cn', zh);
      apply('en_us', en === undefined ? zh : en);
    },
  };
  for (const ct of listContentTypes(opts.projectRoot)) {
    if (!ct.generate) continue;
    if (!(p.entries[ct.id] || []).length) continue;
    try {
      const gen = await loadGenerator(ct);
      if (gen?.emit) await gen.emit(ctx, ct);
    } catch (e) {
      files.push({ __error: `模块 ${ct.moduleId} 生成失败：${e.message}` });
    }
  }

  // 7. JS 钩子（第二层扩展）
  await runJsHooks(p, 'beforeWrite', ctx);

  // 8. Java 片段注入（第二层扩展）
  return applyJavaHooks(p, files);
}

/**
 * 把收集到的文件写盘。
 * @returns 报告对象
 */
export async function write(root, p, files, opts = {}) {
  const report = {
    written: [],
    unchanged: [],
    skipped: [],
    conflicts: [],
    removed: [],
    errors: [],
    warnings: [],
    generatedAt: Date.now(),
  };
  const seen = new Set();
  const force = !!opts.force;

  for (const f of files) {
    if (f.__error) {
      report.errors.push(f.__error);
      continue;
    }
    if (f.__warn) {
      report.warnings.push(f.__warn);
      continue;
    }
    const rel = f.path.replace(/\\/g, '/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(root, rel);
    const isText = !f.binary && Buffer.isBuffer(f.content) === false;

    // 手写区只创建不覆盖
    if (f.createOnly) {
      if (fs.existsSync(abs)) {
        report.skipped.push({ path: rel, reason: '手写区文件已存在，保持原样' });
        continue;
      }
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, f.content, 'utf8');
      report.written.push({ path: rel, reason: '新建手写区' });
      continue;
    }

    const prev = isText ? readIfExists(root, rel) : null;

    // 内容没变 → 不写，避免 mtime 抖动
    if (prev !== null && prev === f.content) {
      recordGenerated(p, rel, f.content);
      report.unchanged.push({ path: rel });
      continue;
    }

    // 用户手改过生成文件 → 除非 force，否则跳过并报警
    if (prev !== null && !force && wasHandEdited(p, rel, prev)) {
      report.conflicts.push({
        path: rel,
        reason: '这个生成文件被手动修改过。选择「覆盖」会丢失手改内容，或先把它移进 custom/ 手写区。',
      });
      continue;
    }

    ensureDir(path.dirname(abs));
    if (isText) {
      fs.writeFileSync(abs, f.content, 'utf8');
      recordGenerated(p, rel, f.content);
    } else {
      fs.writeFileSync(abs, f.content);
      if (f.mode !== undefined) {
        try {
          fs.chmodSync(abs, f.mode);
        } catch {
          /* Windows 上 chmod 无效，忽略 */
        }
      }
    }
    report.written.push({ path: rel });
  }

  // 清理孤儿：以前生成过、这次没生成的，说明条目被删了
  const known = Object.keys(p.files || {});
  for (const rel of known) {
    if (seen.has(rel)) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      delete p.files[rel];
      continue;
    }
    // 只删我们生成过的，且没被手改过的
    const cur = fs.readFileSync(abs, 'utf8');
    if (wasHandEdited(p, rel, cur) && !force) {
      report.skipped.push({ path: rel, reason: '条目已删除，但文件被手改过，保留' });
      continue;
    }
    try {
      fs.unlinkSync(abs);
      delete p.files[rel];
      report.removed.push({ path: rel });
    } catch (e) {
      report.errors.push(`删除 ${rel} 失败：${e.message}`);
    }
  }

  saveProject(root, p);
  return report;
}

/**
 * 一步到位：载入工程 → 收集 → 写盘。
 * 界面上的「生成」按钮走这个。
 */
export async function generate(root, opts = {}) {
  const p = loadProject(root);
  const files = await collect(p, { ...opts, projectRoot: root });
  const report = await write(root, p, files, opts);
  report.files = files.length;
  return report;
}

/**
 * 预演：只返回文件清单与内容，不写盘。
 * 界面的「代码预览」走这个。
 */
export async function preview(root, opts = {}) {
  const p = loadProject(root);
  const files = await collect(p, { ...opts, projectRoot: root });
  return files
    .filter((f) => !f.__error)
    .map((f) => ({
      path: f.path.replace(/\\/g, '/'),
      content: f.buffer ? '<二进制文件>' : String(f.content ?? ''),
      size: f.buffer ? f.content.length : Buffer.byteLength(String(f.content ?? ''), 'utf8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 生成前校验：把所有会阻断生成的问题一次性报出来 */
export async function preflight(root) {
  const p = loadProject(root);
  const types = listContentTypes(root);
  const errors = [];
  const warnings = [];

  const known = new Set(types.map((t) => t.id));
  for (const key of Object.keys(p.entries || {})) {
    if (!known.has(key)) warnings.push(`工程里有未知内容类型 "${key}"（对应模块可能已被移除）`);
  }

  // 条目必填校验
  for (const ct of types) {
    const list = p.entries[ct.id] || [];
    for (const e of list) {
      for (const f of ct.fields || []) {
        if (!f.required) continue;
        const v = e[f.key];
        if (v === undefined || v === null || String(v).trim() === '') {
          errors.push(`${ct.label}「${e.id}」缺少必填项：${f.label}`);
        }
      }
    }
  }

  // 引用完整性
  const items = new Set((p.entries.item || []).map((e) => e.id));
  const blocks = new Set((p.entries.block || []).map((e) => e.id));
  const armors = new Set((p.entries.armorMaterial || []).map((e) => e.id));
  const tiers = new Set((p.entries.tier || []).map((e) => e.id));

  for (const it of p.entries.item || []) {
    if (it.kind === 'armor' && !armors.has(it.armorMaterial)) {
      errors.push(`物品「${it.id}」是盔甲，但没有选择有效的盔甲材质`);
    }
    if (it.kind === 'tool' && it.materialMode === 'custom' && !tiers.has(it.tier)) {
      errors.push(`物品「${it.id}」要使用自定义材质，但没有选择有效材质`);
    }
  }

  for (const w of p.entries.worldgen || []) {
    if (!blocks.has(w.block || '') && !w.overworldBlock && !w.deepslateBlock) {
      errors.push(`矿物「${w.id}」没有指定要生成哪个方块`);
    }
    if (/^26\./.test(String(p.target?.mcVersion || '')) && Number(w.size) < 4) {
      errors.push(`矿物「${w.id}」的 size 必须 ≥ 4，否则 26.x 引擎一个方块都不会生成`);
    }
  }

  // 配方材料引用
  for (const r of p.entries.recipe || []) {
    if (!r.result) errors.push(`配方「${r.id}」没有设置产出物`);
  }

  return { errors, warnings, ok: errors.length === 0 };
}
