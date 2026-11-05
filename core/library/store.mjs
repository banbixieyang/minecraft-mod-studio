/**
 * 包库 —— Pack 的存放与检索。
 *
 * 两级作用域：
 *   用户级  ~/.mcstudio/packs/      —— 跨工程复用，你攒下来的「家底」
 *   工程级  <工程>/.studio/packs/    —— 只服务这一个工程，跟着工程走
 *
 * 工程级同名会盖住用户级，这样「这个工程要特殊改一版」不用另起名字。
 * 内置示例包在 core/library/builtin/，只读，不参与覆盖。
 *
 * 没有任何数据库：一个包一个 json 文件，索引就是扫目录。
 * 好处是用户可以直接拿文件管理器增删、发给别人、扔进 git。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_EXT, makePack, packFileName, parsePack, serializePack, summarizePack, validatePack, PackError } from './pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 用户级库目录（可用环境变量覆盖，便于测试和便携部署） */
export function userLibraryDir() {
  return process.env.MCSTUDIO_HOME
    ? path.join(process.env.MCSTUDIO_HOME, 'packs')
    : path.join(os.homedir(), '.mcstudio', 'packs');
}

/** 工程级库目录 */
export function projectLibraryDir(root) {
  return path.join(path.resolve(root), '.studio', 'packs');
}

/** 内置示例目录 */
export function builtinLibraryDir() {
  return path.join(HERE, 'builtin');
}

/** 全部作用域，后面的优先级高 */
export function libraryScopes(root) {
  const scopes = [{ scope: 'builtin', dir: builtinLibraryDir(), writable: false }];
  scopes.push({ scope: 'user', dir: userLibraryDir(), writable: true });
  if (root) scopes.push({ scope: 'project', dir: projectLibraryDir(root), writable: true });
  return scopes;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readDirSafe(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(PACK_EXT));
  } catch {
    return [];
  }
}

/** 读一个包文件；坏了不抛，返回带 error 的占位，免得一个坏文件毁掉整个列表 */
function readPackFile(file, scope) {
  try {
    const pack = parsePack(fs.readFileSync(file, 'utf8'));
    return { ...pack, scope, file, summary: summarizePack(pack) };
  } catch (e) {
    return {
      id: path.basename(file, PACK_EXT),
      name: path.basename(file, PACK_EXT),
      kind: 'broken',
      desc: '',
      tags: [],
      scope,
      file,
      error: e.message,
      summary: summarizePack(makePack({})),
    };
  }
}

/**
 * 列出所有可见的包。同名时优先级高的胜出，被覆盖的那份记在 shadowed 里。
 */
export function listPacks(root) {
  const byId = new Map();
  const shadowed = [];
  for (const s of libraryScopes(root)) {
    for (const f of readDirSafe(s.dir)) {
      const pack = readPackFile(path.join(s.dir, f), s.scope);
      if (byId.has(pack.id)) {
        shadowed.push({ id: pack.id, scope: pack.scope, by: byId.get(pack.id).scope });
      }
      byId.set(pack.id, { ...pack, writable: s.writable });
    }
  }
  const list = [...byId.values()].sort((a, b) => {
    // 工程内的排前面，然后按最近修改
    if (a.scope !== b.scope) return a.scope === 'project' ? -1 : b.scope === 'project' ? 1 : 0;
    return String(b.createdAt || 0).localeCompare(String(a.createdAt || 0));
  });
  return { packs: list, shadowed };
}

/** 取一个包（按 id，返回优先级最高的） */
export function getPack(root, id) {
  const { packs } = listPacks(root);
  return packs.find((p) => p.id === id) || null;
}

function uniquePackId(id, taken) {
  if (!taken.has(id)) return id;
  for (let i = 2; i < 1000; i++) {
    const cand = `${id}_${i}`;
    if (!taken.has(cand)) return cand;
  }
  return `${id}_${Date.now()}`;
}

/**
 * 存包。id 撞了自动加后缀，避免互相覆盖。
 * 返回实际存下来的 pack（id 可能被改过）。
 */
export function savePack(root, pack, scope = root ? 'project' : 'user') {
  const dir = scope === 'project' ? projectLibraryDir(root) : userLibraryDir();
  ensureDir(dir);

  const errs = validatePack(pack);
  if (errs.length) throw new PackError(`包校验失败：${errs.join('；')}`);

  const taken = new Set(readDirSafe(dir).map((f) => path.basename(f, PACK_EXT)));
  const finalId = uniquePackId(pack.id, taken);
  const out = { ...pack, id: finalId, createdAt: pack.createdAt || Date.now() };

  fs.writeFileSync(path.join(dir, packFileName(out)), serializePack(out), 'utf8');
  return out;
}

/** 覆盖写入（用于「更新已有包」），不重命名 */
export function overwritePack(root, pack, scope = 'project') {
  const dir = scope === 'project' ? projectLibraryDir(root) : userLibraryDir();
  ensureDir(dir);
  const errs = validatePack(pack);
  if (errs.length) throw new PackError(`包校验失败：${errs.join('；')}`);
  fs.writeFileSync(path.join(dir, packFileName(pack)), serializePack(pack), 'utf8');
  return pack;
}

/** 删除。只允许删可写作用域（内置包不能删）。 */
export function deletePack(root, id, scope) {
  const target = getPack(root, id);
  if (!target) throw new PackError(`找不到包 ${id}`);
  if (!target.writable) throw new PackError(`内置示例包不能删除`);
  const useScope = scope || target.scope;
  const dir = useScope === 'project' ? projectLibraryDir(root) : userLibraryDir();
  const file = path.join(dir, `${id}${PACK_EXT}`);
  if (!fs.existsSync(file)) throw new PackError(`文件不存在：${file}`);
  fs.unlinkSync(file);
  return true;
}

/** 把一个包从工程级挪到用户级（或反过来）——「这套东西我以后都要用」 */
export function movePack(root, id, toScope) {
  const pack = getPack(root, id);
  if (!pack) throw new PackError(`找不到包 ${id}`);
  if (!pack.writable) throw new PackError('内置示例包不能移动');
  const plain = JSON.parse(serializePack(pack));
  const saved = savePack(root, plain, toScope);
  if (pack.scope !== toScope) {
    const fromDir = pack.scope === 'project' ? projectLibraryDir(root) : userLibraryDir();
    const f = path.join(fromDir, `${id}${PACK_EXT}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  return saved;
}

/** 导出成文本（发给别人 / 存进 git） */
export function exportPack(root, id) {
  const pack = getPack(root, id);
  if (!pack) throw new PackError(`找不到包 ${id}`);
  return { filename: packFileName(pack), text: serializePack(pack) };
}

/** 从文本导入：校验 + 存盘，返回新包 */
export function importPack(root, text, scope = 'project') {
  const pack = parsePack(text);
  return savePack(root, pack, scope);
}
