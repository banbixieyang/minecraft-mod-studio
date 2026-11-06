/**
 * 本地服务边界回归。
 *
 * 跑法：node tests/security.mjs
 *
 * 服务只监听 127.0.0.1，但浏览器里任意网页都能向它发简单 POST。
 * 这里用真实 HTTP 请求钉死：跨站 Origin、非 JSON 简单请求、任意 Gradle 任务、
 * 删除边界、任意目录写文件，都必须被拒绝；本机正常请求与 jar 上传不能被误伤。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../core/serve/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

const app = createServer();
await new Promise((s) => app.listen(0, '127.0.0.1', s));
const port = app.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function call(route, { method = 'POST', headers = {}, body = '{}' } = {}) {
  const res = await fetch(`${BASE}/api/${route}`, { method, headers, body });
  let data = {};
  try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, data, error: String(data.error || '') };
}

console.log('\n[1] 写请求的跨站防线');
let r = await call('reload-modules', { headers: JSON_HEADERS });
ok(r.status === 200, '本机 JSON 写请求正常放行', `status=${r.status}`);
r = await call('reload-modules', { headers: { ...JSON_HEADERS, Origin: 'http://evil.example' } });
ok(r.status === 403 && /跨站请求被拒绝/.test(r.error), '跨站 Origin 被拒绝');
r = await call('reload-modules', { headers: { 'Content-Type': 'text/plain' } });
ok(r.status === 403 && /只接受 application\/json/.test(r.error), '非 JSON 简单请求被拒绝');
r = await call('reload-modules', { headers: { ...JSON_HEADERS, Origin: `http://localhost:${port}` } });
ok(r.status === 200, '本机 localhost 同源放行');
r = await call('reload-modules', { headers: { ...JSON_HEADERS, Origin: `http://127.0.0.1:${port}` } });
ok(r.status === 200, '本机回环地址同源放行');

console.log('\n[2] 危险路由的边界');
r = await call('project/delete', {
  headers: JSON_HEADERS,
  body: JSON.stringify({ root: `${PROJECTS_DIR}-evil` }),
});
ok(r.status === 400 && /只能删除/.test(r.error), '前缀绕过被挡住（path.relative 判定）');
r = await call('project/delete', { headers: JSON_HEADERS, body: JSON.stringify({ root: PROJECTS_DIR }) });
ok(r.status === 400, 'projects 目录本身不允许删除');

const notAProject = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-security-'));
r = await call('build', {
  headers: JSON_HEADERS,
  body: JSON.stringify({ root: notAProject, task: 'evilTask --init-script evil.gradle' }),
});
ok(r.status === 400 && /不允许的 Gradle 任务/.test(r.error), 'Gradle 任务名走白名单');
r = await call('build', { headers: JSON_HEADERS, body: JSON.stringify({ root: notAProject, task: 'build' }) });
ok(r.status === 400 && /不是 MC Studio 工程目录/.test(r.error), '非工程目录不能跑构建');
r = await call('file', {
  method: 'PUT', headers: JSON_HEADERS,
  body: JSON.stringify({ root: notAProject, path: 'evil.txt', content: 'x' }),
});
ok(r.status === 400 && /不是 MC Studio 工程目录/.test(r.error), '非工程目录不能写文件');
ok(!fs.existsSync(path.join(notAProject, 'evil.txt')), '越界文件确实没被写出来');

console.log('\n[3] 二进制上传不被误伤');
r = await call('analyze/upload', { headers: { 'X-File-Name': 'broken.jar' }, body: 'this is not a jar' });
ok(r.status === 400, '无 JSON Content-Type 的上传仍由上传链路自己校验', `status=${r.status}`);
r = await call('analyze/upload', {
  headers: { 'X-File-Name': 'broken.jar', Origin: 'http://evil.example' }, body: 'this is not a jar',
});
ok(r.status === 403, '上传同样拒绝跨站 Origin');

await new Promise((s) => app.close(s));
fs.rmSync(notAProject, { recursive: true, force: true });
console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
