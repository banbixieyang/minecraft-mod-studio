/**
 * 走 GitHub REST API 推送（绕开 git:// 传输）。
 *
 * ## 为什么需要这个
 *
 * 某些网络环境下 `github.com` 会被 SNI 层面拦截或代理返回 502，
 * 但 `api.github.com` 是通的。于是 `git push` 用不了，
 * 只能改用 **Git Data API** 自己搭 commit：
 *
 *   1. POST /git/blobs   逐个上传改动文件的 blob
 *   2. POST /git/trees   以远端当前 tree 为 base，拼出新 tree
 *   3. POST /git/commits 以远端当前 commit 为 parent，建新 commit
 *   4. PATCH /git/refs   把 main 指到新 commit
 *
 * ## 用法
 *
 *   GH_TOKEN=ghp_xxx node tools/git-push-via-api.mjs [--repo owner/name] [--ref main] [--message "..."]
 *
 * token 只从环境变量读，**绝不写进文件**。
 *
 * ## 提交信息保真
 *
 * 本地 commit 的 author / committer（含时区偏移）会原样传给 API，
 * 这样新 commit 的 sha 跟本地 HEAD 一致，推完不需要 reset。
 * 万一 GitHub 侧把时区归一化了导致 sha 不同，脚本会打印两边的 sha，
 * 手动 `git fetch origin && git reset --hard origin/main` 即可（内容一样）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argOf = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const TOKEN = process.env.GH_TOKEN || '';
const REPO = argOf('repo', 'banbixieyang/minecraft-mod-studio');
const REF = argOf('ref', 'main');
const CONCURRENCY = Number(argOf('concurrency', 8));
const API = 'https://api.github.com';

if (!TOKEN) {
  console.error('缺少 GH_TOKEN 环境变量');
  process.exit(1);
}

// git 的包装：最后一个参数如果是对象，当作 execFileSync 的 options
const git = (...args) => {
  const opts = (args.length && typeof args[args.length - 1] === 'object') ? args.pop() : {};
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
};
const gitRaw = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

async function api(pathname, method = 'GET', body = undefined) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mcstudio-push',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  if (!res.ok) {
    const msg = json?.message || text?.slice(0, 200) || res.status;
    throw new Error(`${method} ${pathname} → ${res.status} ${msg}`);
  }
  return json;
}

// ---------------------------------------------------------------- 远端状态
const ref = await api(`/repos/${REPO}/git/ref/heads/${REF}`);
// --base 可以指定以哪个 commit 为父 —— 用于「先回退远端、再重推」的场合，
// 否则每次重跑都会在远端当前提交上再叠一个。
const BASE = argOf('base', '');
const remoteCommitSha = BASE || ref.object.sha;
const remoteCommit = await api(`/repos/${REPO}/git/commits/${remoteCommitSha}`);
const remoteTreeSha = remoteCommit.tree.sha;
console.log(`远端 ${REF} = ${ref.object.sha.slice(0, 10)}  本次基于 ${remoteCommitSha.slice(0, 10)}  tree=${remoteTreeSha.slice(0, 10)}`);

/**
 * 把本地 HEAD 的时区归一化到 UTC。
 *
 * GitHub 的 Git Data API 会把 author/committer 的时间统一归一化成 +0000。
 * 本地 git 用的是本机时区（这里是 +0800），于是同一个内容在两边算出不同的 sha，
 * 远端那个 commit 对象本地又没有 → 下次 push 直接被拒。
 *
 * 所以推之前先把本地这个 commit 改成 UTC 时区，
 * 两边 sha 就一致了，推完也不需要 reset。
 */
function normalizeTimezone() {
  // ⚠️ git 没有「单独取时区」的格式符（%aZ / %cZ 是不存在的东西，
  //    写上去只会原样打印出来）。时区得从 commit 对象原文里解析。
  const raw = gitRaw('cat-file', 'commit', 'HEAD').toString('utf8');
  const pick = (role) => {
    const m = raw.match(new RegExp(`^${role} .* (\\+\\d{4})$`, 'm'));
    return m ? m[1] : '+0000';
  };
  const authorTz = pick('author');
  const committerTz = pick('committer');
  if (authorTz === '+0000' && committerTz === '+0000') return false;
  const at = git('show', '-s', '--format=%at', 'HEAD');
  const ct = git('show', '-s', '--format=%ct', 'HEAD');
  git('commit', '--amend', '--no-edit', '--reset-author', '-q', {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: `@${at} +0000`,
      GIT_COMMITTER_DATE: `@${ct} +0000`,
    },
  });
  console.log(`时区已归一化到 UTC（原来是 ${authorTz} / ${committerTz}），本地 HEAD = ${git('rev-parse', 'HEAD').slice(0, 10)}`);
  return true;
}
normalizeTimezone();

// 本地 HEAD 是否已经就是远端那一个
const localHead = git('rev-parse', 'HEAD');
if (localHead === remoteCommitSha) {
  console.log('已经是最新，无需推送');
  process.exit(0);
}

// ---------------------------------------------------------------- 改动清单
// 逐个文件取本地 blob 的 sha + mode，交给 tree API。
// tree API 会校验 blob 存在，所以新增/修改的文件要先 POST blob。
// 基准是「本地 HEAD 相对 base commit 的改动」——base 默认 origin/main，
// 用 --base 指定时就是那个 sha（它得是本地已有的对象，所以先 fetch 过）。
const base = BASE || 'origin/main';
const changed = git('diff', '--name-status', `${base}..HEAD`)
  .split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status: status[0], path: rest[rest.length - 1] };
  });

// 本地 HEAD 相对 origin/main 的完整树（用于拿 mode 和 blob sha）
const lsTree = new Map();
for (const line of git('ls-tree', '-r', 'HEAD').split('\n').filter(Boolean)) {
  const m = line.match(/^(\d+) blob ([0-9a-f]{40})\t(.+)$/);
  if (m) lsTree.set(m[3], { mode: m[1], sha: m[2] });
}

const toUpload = [];
const entries = [];
for (const c of changed) {
  if (c.status === 'D') {
    entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
    continue;
  }
  const info = lsTree.get(c.path);
  if (!info) {
    console.error(`本地树里找不到 ${c.path}`);
    process.exit(1);
  }
  toUpload.push({ path: c.path, mode: info.mode, sha: info.sha });
  entries.push({ path: c.path, mode: info.mode, type: 'blob', sha: info.sha });
}

console.log(`改动 ${changed.length} 个文件，其中 ${toUpload.length} 个需要上传 blob`);

// ---------------------------------------------------------------- 上传 blob
// ⚠️ 内容必须从 **git 对象库** 取，不能直接读磁盘！
//    git 在提交时会按 core.autocrlf / .gitattributes 做行尾转换，
//    磁盘上可能是 CRLF、对象库里是 LF。直接读磁盘会导致 blob sha 跟本地对不上，
//    推上去的文件行尾也就跟仓库里其它文件不一致了（这个坑踩过，6 个文件中招）。
//    `git cat-file blob <sha>` 取出来的就是对象库里的原始字节，一定一致。
let done = 0;
const uploaded = new Map();
async function uploadBlob(item) {
  // git cat-file 走 stdout，必须按二进制拿，不能让 Node 按 utf8 转字符串
  const content = execFileSync('git', ['cat-file', 'blob', item.sha], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  });
  const r = await api(`/repos/${REPO}/git/blobs`, 'POST', {
    content: content.toString('base64'),
    encoding: 'base64',
  });
  if (r.sha !== item.sha) {
    console.warn(`  ! ${item.path} 的 blob sha 与本地不一致（本地 ${item.sha.slice(0, 10)} / 远端 ${r.sha.slice(0, 10)}）`);
  }
  uploaded.set(item.path, r.sha);
  done += 1;
  if (done % 10 === 0 || done === toUpload.length) {
    console.log(`  blob ${done}/${toUpload.length}`);
  }
}

// 并发上传，别把 API 打出速率限制
const queue = [...toUpload];
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
  while (queue.length) {
    const item = queue.shift();
    if (!item) break;
    // 失败重试三次
    for (let attempt = 1; ; attempt++) {
      try { await uploadBlob(item); break; }
      catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
});
await Promise.all(workers);

// 把 tree entries 里的 sha 换成 GitHub 实际存的
for (const e of entries) {
  if (e.sha && uploaded.has(e.path)) e.sha = uploaded.get(e.path);
}

// ---------------------------------------------------------------- 建 tree
const newTree = await api(`/repos/${REPO}/git/trees`, 'POST', {
  base_tree: remoteTreeSha,
  tree: entries,
});
console.log(`新 tree = ${newTree.sha.slice(0, 10)}`);

// ---------------------------------------------------------------- 建 commit
// ⚠️ 两个必须跟本地一致的细节，否则 sha 对不上（踩过）：
//
//   1. **message 末尾的换行** —— GitHub API 原样存储 message，不补也不删。
//      本地 commit 对象的 message 以 \n 结尾，所以这里必须原样取，
//      之前用 .trim() 把它削了，sha 就对不上了。
//   2. **时区** —— GitHub 会把 date 归一化成 UTC（+0000）。
//      所以本地 commit 也得是 +0000 时区，否则 sha 永远不等。
//      下面先把本地 HEAD 归一化，再传归一化后的时间。
//
// author / committer 的 name/email 原样带过去，尽量让 sha 与本地一致。
const rawCommit = gitRaw('cat-file', 'commit', 'HEAD').toString('utf8');
const sepIdx = rawCommit.indexOf('\n\n');
const message = rawCommit.slice(sepIdx + 2);   // 保留末尾换行

const meta = git('show', '-s', '--format=%an%n%ae%n%cn%n%ce', 'HEAD').split('\n');
const author = { name: meta[0], email: meta[1] };
const committer = { name: meta[2], email: meta[3] };

// date 要带 Z（UTC）。GitHub 会按这个值写 commit 对象。
author.date = new Date(Number(git('show', '-s', '--format=%at', 'HEAD')) * 1000).toISOString();
committer.date = new Date(Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000).toISOString();

const newCommit = await api(`/repos/${REPO}/git/commits`, 'POST', {
  message,
  tree: newTree.sha,
  parents: [remoteCommitSha],
  author,
  committer,
});
console.log(`新 commit = ${newCommit.sha.slice(0, 10)}`);

// ---------------------------------------------------------------- 更新 ref
await api(`/repos/${REPO}/git/refs/heads/${REF}`, 'PATCH', { sha: newCommit.sha, force: false });
console.log(`\n✓ 已推送 ${REF} → ${newCommit.sha}`);

if (newCommit.sha !== localHead) {
  console.log(`\n⚠️ 远端 commit sha 与本地 HEAD 不同（本地 ${localHead.slice(0, 10)}）。`);
  console.log('   内容一致，只是 sha 不同（通常是时区/作者字段被 GitHub 归一化）。');
  console.log(`   对齐命令：git fetch origin && git reset --hard origin/${REF}`);
}
