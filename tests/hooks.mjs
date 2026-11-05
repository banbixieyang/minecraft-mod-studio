/**
 * 「AI 代码块 → 预览 → 确认 → 装成钩子」回归。
 *
 * 重点不是「能装上」，而是三条边界：
 *   1. 预览只读，绝不改工程数据；
 *   2. 没有 confirmed:true，服务端一律拒绝写盘；
 *   3. 装完只进配置，Java 要等用户再点「生成」才变。
 * 另外守住静态检查：import / package / 外部命令这些写法必须被拦。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failed++;
};

const TMP = path.join(os.tmpdir(), `mcstudio-hooks-${Date.now()}`);
const ROOT = path.join(TMP, 'hooktest');
fs.mkdirSync(ROOT, { recursive: true });

const P = await import('../core/project.mjs');
const { generate } = await import('../core/generator/pipeline.mjs');
const { createServer } = await import('../core/serve/server.mjs');
const { inspectHookCode, findAnchorPreview, isDuplicate } = await import('../core/hooks/inspect.mjs');

const app = createServer();
await new Promise((s) => app.listen(0, '127.0.0.1', s));
const BASE = `http://127.0.0.1:${app.address().port}`;
const post = async (route, body) => {
  const r = await fetch(`${BASE}/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const get = async (route, params) => {
  const u = new URL(`${BASE}/api/${route}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  const r = await fetch(u);
  return { status: r.status, data: await r.json() };
};
const hookCount = () => (P.loadProject(ROOT).hooks?.java || []).length;

P.createProject(ROOT, { name: '钩子测试', id: 'hooktest', pkg: 'com.example.hooktest' });

const GOOD = 'System.out.println("hello from hook");\nif (true) { System.out.println("braced"); }';

console.log('\n[1] 静态检查（不经过 HTTP，直接测规则）');
{
  const clean = inspectHookCode(GOOD, { target: { platform: 'fabric' } });
  ok(clean.errors.length === 0, '正常 Java 语句通过', clean.errors.join('；'));
  ok(inspectHookCode('import net.minecraft.world.item.Item;').errors.some((x) => /import/.test(x)), 'import 被拦（钩子位置加不了 import）');
  ok(inspectHookCode('package com.foo;').errors.length > 0, 'package 声明被拦');
  ok(inspectHookCode('public class Evil {}').errors.length > 0, '类声明被拦');
  ok(inspectHookCode('Runtime.getRuntime().exec("calc");').errors.some((x) => /拒绝安装/.test(x)), '执行外部命令被硬拦');
  ok(inspectHookCode('new ProcessBuilder("cmd").start();').errors.length > 0, 'ProcessBuilder 被硬拦');
  ok(inspectHookCode('System.exit(0);').errors.length > 0, 'System.exit 被硬拦');
  ok(inspectHookCode('// @hook:init\nfoo();').errors.length > 0, '代码里再写锚点被拦');
  ok(inspectHookCode('x'.repeat(21000)).errors.length > 0, '超长代码被拦');
  const unbal = inspectHookCode('if (x) { foo();');
  ok(unbal.warnings.some((x) => /大括号/.test(x)), '括号不平衡给警告（不硬拦）');
  const mismatch = inspectHookCode('net.minecraftforge.event.TickEvent.class', { target: { platform: 'fabric' } });
  ok(mismatch.warnings.some((x) => /Forge/.test(x)), 'Forge 代码装进 Fabric 工程会警告');
  const fake = [{ path: 'src/main/java/A.java', content: 'a\nb\nc\nd\n// @hook:init\ne\nf\n' }];
  const pv = findAnchorPreview(fake, 'init', 'foo();');
  ok(pv.found && pv.lineNo === 5 && pv.injected.includes('foo();') && pv.injected.includes('// @hook:init'), '落点预览取的是真实锚点上下文');
  ok(!findAnchorPreview(fake, 'nope', 'foo();').found, '找不到锚点时如实说找不到');
}

console.log('\n[2] 预览只读');
{
  const before = hookCount();
  const r = await post('hooks/preview', { root: ROOT, code: GOOD, target: 'init' });
  ok(r.status === 200 && r.data.ok, '预览接口返回成功', JSON.stringify(r.data).slice(0, 160));
  ok(r.data.installable === true, '静态检查通过 → 可安装');
  ok(r.data.placement.found && /Hooktest\.java$/.test(r.data.placement.file), '落点是生成出来的主类', r.data.placement.file);
  ok(/@hook:init/.test(r.data.placement.injected), '预览里能看到插入后的锚点');
  ok(r.data.target.label.includes('Fabric'), '预览带目标平台', r.data.target.label);
  ok(hookCount() === before, '预览没有写进工程数据');
}

console.log('\n[3] 确认红线');
{
  const before = hookCount();
  const noConfirm = await post('hooks/add', { root: ROOT, code: GOOD, target: 'init' });
  ok(noConfirm.status === 400 && hookCount() === before, '缺 confirmed 时拒绝写盘');
  const badAnchor = await post('hooks/add', { root: ROOT, code: GOOD, target: '不存在', confirmed: true });
  ok(badAnchor.status === 400 && hookCount() === before, '非法锚点被拒');
  const badCode = await post('hooks/add', { root: ROOT, code: 'import java.util.List;', target: 'init', confirmed: true });
  ok(badCode.status === 400 && hookCount() === before, '带 import 的代码即使确认了也不写');
  const danger = await post('hooks/add', { root: ROOT, code: 'System.exit(1);', target: 'init', confirmed: true });
  ok(danger.status === 400 && hookCount() === before, '危险调用即使确认了也不写');
  const badRoot = await post('hooks/add', { root: path.join(TMP, 'nope'), code: GOOD, target: 'init', confirmed: true });
  ok(badRoot.status === 400, '非工程目录被拒');
}

console.log('\n[4] 确认后写入 → 去重 → 生成 → 清理');
{
  const added = await post('hooks/add', { root: ROOT, code: GOOD, target: 'init', name: '测试钩子', source: 'test', confirmed: true });
  ok(added.status === 200 && hookCount() === 1, '确认后钩子数 +1', added.data.error || '');
  ok(added.data.hook?.source === 'test' && added.data.hook?.target === 'init', '钩子记录带来源与锚点');
  const list = await get('hooks/list', { root: ROOT });
  ok(list.data.hooks.length === 1 && list.data.hooks[0].enabled === true, '列表接口能读到刚装的钩子');

  const dup = await post('hooks/add', { root: ROOT, code: GOOD, target: 'init', confirmed: true });
  ok(dup.status === 409 && hookCount() === 1, '同内容重复点装不会堆重复钩子');
  ok(isDuplicate(P.loadProject(ROOT), GOOD), '去重函数认得出空白差异');

  // 装完只进配置，Java 还没动
  const mainRel = 'src/main/java/com/example/hooktest/Hooktest.java';
  const mainPath = path.join(ROOT, mainRel);
  const beforeGen = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '';
  ok(!beforeGen.includes('hello from hook'), '确认装完，Java 源码还没被改（要再点生成）');

  await generate(ROOT);
  const afterGen = fs.readFileSync(mainPath, 'utf8');
  ok(afterGen.includes('hello from hook'), '点「生成」后钩子代码出现在主类里');
  ok(afterGen.includes('// @hook:init'), '锚点还在，可以继续插下一个钩子');

  const removed = await post('hooks/remove', { root: ROOT, id: added.data.hook.id });
  ok(removed.status === 200 && hookCount() === 0, '能删掉刚装的钩子，测试数据不残留');
}

app.closeAllConnections();
await new Promise((s) => app.close(s));

console.log(`\n${failed ? `✗ ${failed} 条失败` : '✓ 全部通过'}`);
process.exit(failed ? 1 : 0);
