/**
 * 运行时契约回归。
 *
 * 跑法：node tests/runtime.mjs
 *
 * 钉死的坑：引擎三处注册表用 require(esm) 同步加载插件，以前在低版本 Node 上
 * 会被 catch 静默吞掉 —— 规则全没了还报 ok:true，建 forge 工程悄悄写成 fabric 参数。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRuntime, runtimeInfo, requireEsmSupported, isRequireEsmError } from '../core/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

console.log('\n[1] 正常运行时');
ok(requireEsmSupported() === true, '当前 Node 能同步 require ESM');
ok(assertRuntime().ok === true, '入口自检通过');
ok(runtimeInfo().node === process.versions.node, '运行时摘要带真实版本号');
ok(runtimeInfo().requireEsm === true, '运行时摘要带能力位');
ok(isRequireEsmError({ code: 'ERR_REQUIRE_ESM' }) === true, '识别 ERR_REQUIRE_ESM');
ok(isRequireEsmError({ message: 'require() of ES Module x not supported.' }) === true, '识别低版本报错文本');
ok(isRequireEsmError(new Error('插件语法写错了')) === false, '普通插件错误不被当成运行时故障');

console.log('\n[2] 模拟低版本 Node（--no-experimental-require-module）');
const cli = spawnSync(process.execPath, [
  '--no-experimental-require-module', path.join(ROOT, 'studio.mjs'), 'convert', 'rules',
], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
const cliOut = `${cli.stdout || ''}${cli.stderr || ''}`;
ok(cli.status !== 0, 'CLI 非零退出，不再假装能用', `exit=${cli.status}`);
ok(/需要支持 require\(esm\) 的 Node\.js/.test(cliOut), '给出明确的升级提示');
ok(!/已登记 7 条转换规则/.test(cliOut), '不再输出「规则已正常加载」');

const probe = `
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import * as P from "./core/project.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcstudio-rt-test-"));
try {
  P.createProject(dir, { name: "xxdemo", id: "xxdemo", pkg: "com.example.xxdemo", version: "0.1.0", target: { id: "forge-1.20.1" } });
  console.log("SILENT:" + JSON.stringify(P.loadProject(dir).target.platform));
} catch (e) {
  console.log("REJECTED:" + e.message.slice(0, 40));
}
`;
const mk = spawnSync(process.execPath, [
  '--no-experimental-require-module', '--input-type=module', '-e', probe,
], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
const mkOut = `${mk.stdout || ''}${mk.stderr || ''}`;
ok(/REJECTED:/.test(mkOut), '低版本下建 forge 工程被明确拒绝');
ok(!/SILENT:/.test(mkOut), '不再静默回落成 fabric 参数');

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
