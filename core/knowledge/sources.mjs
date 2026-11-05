/**
 * 知识库的来源发现。
 *
 * 四个来源，优先级从「随项目走」到「你自己攒的」：
 *   builtin   <mcstudio>/knowledge/          内置：指南、26.3 速查、任务卡
 *   expert    <专家包>/skills/               本机装了 MC 开发专家包就自动挂上
 *   learned   ~/.mcstudio/knowledge/learned/  分析别人 mod 沉淀下来的笔记
 *   user      ~/.mcstudio/knowledge/notes/    你自己写的
 *
 * 为什么内置之外还要挂专家包：专家包里是我（模型）对着官方文档和实编结果
 * 逐条核对过的 API 参考，比内置那点速查厚得多。但它不是本项目的一部分，
 * 别的机器上可能没有 —— 所以是「探测到了就挂」，探测不到不影响任何功能。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontMatter } from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(HERE, '..', '..');

/** 用户级数据目录 */
export function mcstudioHome() {
  return process.env.MCSTUDIO_HOME || path.join(os.homedir(), '.mcstudio');
}

export function builtinKnowledgeDir() {
  return path.join(STUDIO_ROOT, 'knowledge');
}

export function learnedDir() {
  return path.join(mcstudioHome(), 'knowledge', 'learned');
}

export function notesDir() {
  return path.join(mcstudioHome(), 'knowledge', 'notes');
}

/** 内置知识库里，目录名 → 默认分类 */
const FOLDER_CATEGORY = {
  guides: '指南',
  reference: '速查',
  cookbook: '任务卡',
};

/**
 * 专家包里的目录名 → 平台。
 * 为什么需要：专家包是全平台的（Paper/Spigot/Forge/NeoForge 都有），
 * 而编辑器现在只做 Fabric。不区分平台，问「怎么注册物品」会命中 Spigot 的写法。
 * 空字符串表示平台中立（构建、提问矩阵、附属开发这些）。
 */
const SKILL_PLATFORM = {
  'minecraft-fabric-mod': 'fabric',
  'minecraft-forge-mod': 'forge',
  'minecraft-neoforge-mod': 'neoforge',
  'minecraft-paper-plugin': 'paper',
  'minecraft-spigot-legacy': 'spigot',
};

/**
 * 探测本机的 MC 开发专家包。
 *
 * 装法有好几种（marketplace / cache / 手动），所以不写死路径，扫一遍找；
 * 找到就缓存，找不到返回 null。深度限死，避免在 plugins 目录里越走越深。
 */
let expertCache;
export function detectExpertSkillsDir() {
  if (expertCache !== undefined) return expertCache;

  const explicit = process.env.MCSTUDIO_EXPERT_SKILLS;
  if (explicit && fs.existsSync(explicit)) {
    expertCache = explicit;
    return expertCache;
  }

  const root = path.join(os.homedir(), '.workbuddy', 'plugins');
  if (!fs.existsSync(root)) {
    expertCache = null;
    return expertCache;
  }

  // 广度优先，深度上限 6。找到第一个「叫 minecraft-dev 且里面有 skills」的目录就收工。
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 6) continue;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const full = path.join(dir, it.name);
      if (it.name === 'minecraft-dev') {
        const skills = path.join(full, 'skills');
        if (fs.existsSync(skills)) {
          expertCache = skills;
          return expertCache;
        }
      }
      queue.push({ dir: full, depth: depth + 1 });
    }
  }
  expertCache = null;
  return expertCache;
}

/** 递归列 md，深度与数量都设上限 —— 知识库是给人用的，不是爬虫 */
function listMarkdown(dir, { maxDepth = 3, limit = 600 } = {}) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= limit || depth > maxDepth) return;
    let items;
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (out.length >= limit) return;
      if (it.name.startsWith('.') || it.name === 'node_modules') continue;
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full, depth + 1);
      else if (/\.md$/i.test(it.name)) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * 只为了拿 front matter 里的 platform，读文件头 2KB 就够，不必整篇解析。
 * 内置库以前是按目录一刀切标 fabric；多目标之后，同一份「速查」目录里
 * 既有 26.3 也有 1.20.1，不读这个字段，Forge 文档会被当成异平台资料压到 0.45 分。
 */
function frontPlatform(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return String(splitFrontMatter(buf.subarray(0, n).toString('utf8')).meta.platform || '').trim();
  } catch {
    return '';
  }
}

function relId(dir, file) {
  return path
    .relative(dir, file)
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    // 中文必须留着。文件名就是标题，「26.3-注册签名」和「26.3-踩坑清单」一旦
    // 都变成 "26.3-"，两篇共用一个 id，点哪篇都打开同一份。
    .replace(/[^a-zA-Z0-9._/\u4e00-\u9fff-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

/**
 * 全部来源。readonly 的来源界面不给编辑按钮。
 * writable 的判断放在这里而不是界面，是为了「点开就能写」这件事只有一个出处。
 */
export function knowledgeSources() {
  const list = [
    {
      kind: 'builtin',
      label: '内置',
      desc: '随编辑器一起走的指南与速查',
      dir: builtinKnowledgeDir(),
      writable: false,
    },
    {
      kind: 'learned',
      label: '学习记录',
      desc: '分析别的 mod 沉淀下来的笔记',
      dir: learnedDir(),
      writable: true,
    },
    {
      kind: 'user',
      label: '我的笔记',
      desc: '你自己写的心得',
      dir: notesDir(),
      writable: true,
    },
  ];

  const expert = detectExpertSkillsDir();
  if (expert) {
    list.splice(1, 0, {
      kind: 'expert',
      label: '专家知识库',
      desc: '本机安装的 MC 开发专家包里的 API 参考',
      dir: expert,
      writable: false,
    });
  }
  return list.filter((s) => s.dir && fs.existsSync(s.dir));
}

/**
 * 扫出全部文档的元信息（不解析内容，快）。
 * 真正解析在 getDoc 里按需做 —— 专家包有几十篇，全解析太浪费。
 */
export function scanDocs() {
  const docs = [];
  for (const src of knowledgeSources()) {
    let files;
    if (src.kind === 'expert') {
      // 专家包里只索引 API 参考和技能说明，其余是脚手架脚本，不是知识
      files = listMarkdown(src.dir, { maxDepth: 4 }).filter((f) => {
        const rel = path.relative(src.dir, f).replace(/\\/g, '/');
        return rel.endsWith('SKILL.md') || rel.includes('/references/');
      });
    } else {
      files = listMarkdown(src.dir, { maxDepth: 3 });
    }

    for (const file of files) {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      const rel = path.relative(src.dir, file).replace(/\\/g, '/');
      const parts = rel.split('/');
      let category;
      let sub = '';
      let platform = '';
      if (src.kind === 'builtin') {
        category = FOLDER_CATEGORY[parts[0]] || '其他';
        sub = parts.length > 2 ? parts[1] : '';
        // 没写 platform 的内置文档默认 fabric（老文档全是 26.3 的）；
        // 写了 forge 的才按 Forge 权重排序，问 Forge 的事不会先命中 26.3 签名。
        platform = frontPlatform(file) || 'fabric';
      } else if (src.kind === 'expert') {
        category = rel.endsWith('SKILL.md') ? '专家库 · 规则' : '专家库 · API';
        sub = parts[0] || '';
        platform = SKILL_PLATFORM[sub] || '';
      } else {
        category = src.kind === 'learned' ? '学习记录' : '我的笔记';
      }

      docs.push({
        id: `${src.kind}/${relId(src.dir, file)}`,
        name: path.basename(file, '.md'),
        path: file,
        rel,
        kind: src.kind,
        sourceLabel: src.label,
        category,
        sub,
        platform,
        size: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
  return docs;
}

export function ensureWritableDir(kind) {
  const dir = kind === 'learned' ? learnedDir() : kind === 'user' ? notesDir() : null;
  if (!dir) throw new Error(`来源 ${kind} 是只读的`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
