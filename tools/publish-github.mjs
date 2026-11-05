/**
 * 把当前仓库发布到 GitHub。
 *
 * 流程：
 *   1. 用 PAT 调 /user 反查 GitHub 用户名（省得再问一次）
 *   2. 建仓库（已存在就复用）
 *   3. 设 remote 并推送
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node tools/publish-github.mjs [仓库名] [public|private]
 *
 * token 只在内存里用，不写盘、不进 remote URL（用 header 方式传）。
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_NAME = process.argv[2] || 'minecraft-mod-studio';
const VISIBILITY = process.argv[3] || 'public';
const TOKEN = process.env.GITHUB_TOKEN || '';

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量。');
  process.exit(1);
}

const API = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'mcstudio-publish',
};

async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json, text };
}

// 1. 反查用户名
const me = await api('GET', '/user');
if (me.status !== 200) {
  console.error('token 校验失败：', me.json?.message || me.text.slice(0, 200));
  process.exit(1);
}
const login = me.json.login;
console.log(`✓ token 有效，GitHub 用户：${login}`);

// 2. 建仓库（已存在则复用）
const created = await api('POST', '/user/repos', {
  name: REPO_NAME,
  description: '可视化 Minecraft 模组编辑器：表单生成内容，一键出 jar。目标 Fabric 26.3 / Forge 1.20.1，附 mod 拆解分析器。',
  private: VISIBILITY === 'private',
  auto_init: false,
  has_issues: true,
  has_wiki: false,
});

let repoUrl;
if (created.status === 201) {
  repoUrl = created.json.clone_url;
  console.log(`✓ 已创建仓库 ${login}/${REPO_NAME}（${VISIBILITY}）`);
} else if (created.status === 422) {
  // 已存在
  const exist = await api('GET', `/repos/${login}/${REPO_NAME}`);
  if (exist.status !== 200) {
    console.error('仓库已存在但读取失败：', exist.json?.message || exist.text.slice(0, 200));
    process.exit(1);
  }
  repoUrl = exist.json.clone_url;
  console.log(`· 仓库 ${login}/${REPO_NAME} 已存在，复用`);
} else {
  console.error('建仓失败：', created.json?.message || created.text.slice(0, 300));
  process.exit(1);
}

// 3. 设 remote
const remoteUrl = repoUrl.replace(/^https:\/\//, 'https://');
run('git', ['remote', 'remove', 'origin'], { allowFail: true });
run('git', ['remote', 'add', 'origin', remoteUrl]);
console.log(`✓ remote → ${remoteUrl}`);

// 4. 推送（用 header 传 token，不写进 URL）
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
console.log(`→ 推送分支 ${branch} …`);

const push = run('git', [
  '-c', `http.extraHeader=Authorization: Basic ${Buffer.from('x-access-token:' + TOKEN).toString('base64')}`,
  'push', '-u', 'origin', branch,
], { allowFail: true });

if (push.status !== 0) {
  console.error('推送失败：\n' + push.out);
  process.exit(1);
}
console.log('✓ 推送完成');

// 5. 设为默认分支 + 补默认分支保护（不强制）
run('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { allowFail: true });

const page = await api('GET', `/repos/${login}/${REPO_NAME}`);
if (page.status === 200) {
  console.log(`\n仓库地址：${page.json.html_url}`);
  console.log(`可见性：${page.json.private ? '私有' : '公开'} · 默认分支：${page.json.default_branch}`);
}

// 顺手把 README 首屏展示需要的 topics 补上
const topics = await api('PUT', `/repos/${login}/${REPO_NAME}/topics`, {
  names: ['minecraft', 'mod', 'modding', 'fabric', 'forge', 'minecraft-mod', 'visual-editor', 'game-dev', 'tool'],
});
console.log(topics.status === 200 ? '✓ 已设置 topics' : `· topics 跳过（${topics.status}）`);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n命令失败（${cmd} ${args.join(' ')}）：\n${out}`);
    process.exit(1);
  }
  return { status: r.status, out };
}
