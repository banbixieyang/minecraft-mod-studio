/**
 * 可视化积木的 HTTP 路由测试。
 *
 * 跑法：node tests/visual-routes.mjs
 *
 * 用假的 req/res 直接调 handleVisual —— 不起真服务器，快且不占端口。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { handleVisual } from '../core/serve/routes_visual.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

/** 造一个假的 req（带 JSON body） */
function fakeReq(body) {
  const r = new Readable({ read() {} });
  if (body !== undefined) {
    r.push(JSON.stringify(body));
  }
  r.push(null);
  return r;
}

/** 造一个假的 res，收集状态码与响应体 */
function fakeRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out,
    writeHead(code, headers) { out.code = code; out.headers = headers; },
    end(body) { out.body = body ? JSON.parse(body) : null; },
  };
}

/** 调一次路由，返回 { status, data } */
async function call(route, method, body, query = {}) {
  const req = fakeReq(body);
  const res = fakeRes();
  // ⚠️ q 必须是**普通对象** —— server.mjs 传的是 Object.fromEntries(searchParams)，
  //    不是 URLSearchParams。测试这里必须跟真实调用一致，
  //    否则会测出一个「q.get 是函数」的假象（之前就踩过）。
  const q = { ...query };
  await handleVisual(req, res, route, q, method);
  return { status: res.out.code, data: res.out.body };
}

console.log('\n[1] 积木清单');
{
  const { status, data } = await call('visual/blocks', 'GET', undefined, { targetId: 'fabric-26.3' });
  ok(status === 200, '返回 200', String(status));
  ok(Array.isArray(data.categories), '有分类');
  ok(data.categories.length > 0, '分类非空', `${data.categories.length} 个`);
  const first = data.categories[0].blocks[0];
  ok(!!first.id && !!first.shape, '积木有 id 和 shape');
}

console.log('\n[2] 编译预览');
{
  const program = {
    op: 'event.player_rightclick_block',
    next: { op: 'player.message', inputs: { text: { type: 'value', kind: 'text', value: 'hi' } }, fields: {} },
  };
  const { status, data } = await call('visual/compile', 'POST', { program, targetId: 'forge-1.20.1' });
  ok(status === 200, '返回 200', String(status));
  ok(data.ok === true, '编译成功', (data.errors || []).join('；'));
  ok(data.code.includes('displayClientMessage'), 'Forge 用 displayClientMessage');
  ok(!data.code.includes('%'), '没有未替换的占位符');
}

console.log('\n[3] 装库必须显式确认');
{
  const lib = {
    format: 'mcblocks', version: 1, id: 'test-lib', name: '测试库',
    categories: [], blocks: [{ id: 'x.y', category: 'x', shape: 'stack', label: 'Y', inputs: [], fields: [], java: { 'fabric-26.3': 'player.heal(1);' } }],
  };
  const r1 = await call('visual/install-library', 'POST', { library: lib });
  ok(r1.status === 400, '没确认就拒绝', String(r1.status));
  ok(/confirmed/.test(r1.data.error || ''), '提示要确认', r1.data.error);

  // 装到工程库目录（临时目录，不污染用户目录）
  const projRoot = path.join(os.tmpdir(), `mcstudio-route-test-${Date.now().toString(36)}`);
  const r2 = await call('visual/install-library', 'POST', {
    library: lib, confirmed: true, scope: 'project', projectRoot: projRoot,
  });
  ok(r2.status === 200, '确认后能装', String(r2.status));
  ok(fs.existsSync(r2.data.file), '库文件已写到工程目录');
  ok(r2.data.blocks === 1, '装了一条积木');
}

console.log('\n[4] 从 jar 生成积木库');
{
  // 缺参数
  const r1 = await call('visual/library-from-jar', 'POST', {});
  ok(r1.status === 400, '缺 jar 被拒', String(r1.status));

  // 文件不存在
  const r2 = await call('visual/library-from-jar', 'POST', { jar: 'C:/不存在的文件.jar' });
  ok(r2.status === 400, '找不到 jar 被拒', String(r2.status));

  // 不是 jar
  const notJar = path.join(os.tmpdir(), 'not-a-jar.txt');
  fs.writeFileSync(notJar, 'hello', 'utf8');
  const r3 = await call('visual/library-from-jar', 'POST', { jar: notJar });
  ok(r3.status === 400, '非 jar 文件被拒', String(r3.status));

  // 真 jar：Goety（本地有才测）
  const goety = [
    'C:/Users/Lenovo/Downloads/goety-2.5.55.4.jar',
    path.join(os.homedir(), 'Downloads/goety-2.5.55.4.jar'),
  ].find((p) => fs.existsSync(p));
  if (!goety) {
    console.log('  · 跳过真 jar 段（本地没有 Goety jar）');
  } else {
    // 不确认 → 只预览不写盘
    const r4 = await call('visual/library-from-jar', 'POST', { jar: goety, withApi: false });
    ok(r4.status === 200, '返回 200', String(r4.status));
    ok(r4.data.written === false, '没确认就不写盘');
    ok(r4.data.target === 'forge-1.20.1', '认出目标', r4.data.target);
    ok(r4.data.library.blocks.length > 0, '生成了积木', `${r4.data.library.blocks.length} 条`);
    ok(/原版注册表|对应 mod/.test(r4.data.hint || ''), '给了提示', r4.data.hint);
    const pack = r4.data.library.blocks.filter((b) => /^goety\.(spell|soul|focus|wand)\./.test(b.id));
    ok(pack.length >= 8, '含 Goety 专属积木', `${pack.length} 条`);
    ok(pack.every((b) => b.requiresMod === 'goety'), '专属积木标了 requiresMod');
  }
}

console.log('\n[5] 未知路由');
{
  const r = await call('visual/不存在的路由', 'GET', {});
  ok(r.status === 404, '返回 404', String(r.status));
}

console.log('\n[6] 代码造积木 → 导出 → 装回（G5 完整闭环）');
{
  // 造一条自定义积木
  const r6 = await call('visual/custom-block', 'POST', {
    id: 'testmod.give_diamond',
    name: '给玩家三颗钻石',
    code: 'player.give(net.minecraft.world.item.ItemStack.DIAMOND, 3);',
    params: [],
    targetId: 'fabric-26.3',
  });
  ok(r6.status === 200, '造积木成功', r6.data?.error || String(r6.status));
  ok(r6.data?.block?.id === 'testmod.give_diamond', '积木 id 正确');

  // 造一条带参数的
  const r6b = await call('visual/custom-block', 'POST', {
    id: 'testmod.give_item',
    name: '给玩家 %count 个 %item',
    code: 'player.give(new net.minecraft.world.item.ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.Identifier.parse(%item)), %count));',
    params: [
      { name: 'item', kind: 'text', default: 'minecraft:apple' },
      { name: 'count', kind: 'number', default: 1 },
    ],
    targetId: 'fabric-26.3',
  });
  ok(r6b.status === 200, '造带参数的积木成功', r6b.data?.error || String(r6b.status));
  ok(r6b.data?.block?.inputs?.length === 2, '两个参数', String(r6b.data?.block?.inputs?.length));

  // 参数没在代码里用 → 要报错
  const r6c = await call('visual/custom-block', 'POST', {
    id: 'testmod.bad',
    name: '坏的',
    code: 'player.give(%item);',
    params: [{ name: 'other', kind: 'text' }],
    targetId: 'fabric-26.3',
  });
  ok(r6c.status === 400, '参数对不上要拒绝', r6c.data?.error);

  // 积木出现在清单里
  const r6d = await call('visual/blocks', 'GET', {}, { targetId: 'fabric-26.3' });
  const all = (r6d.data?.categories || []).flatMap((c) => c.blocks);
  const mine = all.find((b) => b.id === 'testmod.give_item');
  ok(!!mine, '自定义积木在清单里');
  ok(mine?.supported === true, '自定义积木算「已实现」');
  ok(mine?.userDef != null, '带 userDef 标记');

  // 导出成库
  const r6e = await call('visual/export-blocks', 'POST', { ids: ['testmod.give_item', 'testmod.give_diamond'] });
  ok(r6e.status === 200, '导出成功', String(r6e.status));
  ok(r6e.data?.library?.blocks?.length === 2, '导出了两条', String(r6e.data?.library?.blocks?.length));
  ok(r6e.data?.library?.format === 'mcblocks', '格式正确');

  // 装回去（写到工程目录）
  const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-vbr-'));
  const r6f = await call('visual/install-library', 'POST', {
    library: r6e.data.library,
    confirmed: true,
    scope: 'project',
    projectRoot: projRoot,
  });
  ok(r6f.status === 200, '装库成功', r6f.data?.error || String(r6f.status));
  ok(fs.existsSync(r6f.data?.file || ''), '库文件写盘了', r6f.data?.file);

  // 装完清单里能看到
  const r6g = await call('visual/blocks', 'GET', {}, { root: projRoot, targetId: 'fabric-26.3' });
  const all2 = (r6g.data?.categories || []).flatMap((c) => c.blocks);
  ok(all2.some((b) => b.id === 'testmod.give_item'), '装完清单里能看到');

  fs.rmSync(projRoot, { recursive: true, force: true });
}

console.log('\n[7] 积木程序存取');
{
  const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-vbp-'));
  // 造一个最小工程
  fs.mkdirSync(path.join(projRoot, '.studio'), { recursive: true });
  fs.writeFileSync(path.join(projRoot, '.studio', 'project.json'), JSON.stringify({
    meta: { name: 'T', id: 't', pkg: 'com.t' },
    target: { platform: 'fabric', mcVersion: '26.3', id: 'fabric-26.3' },
    entries: {}, files: {}, state: {}, hooks: { java: [], js: [] },
  }), 'utf8');

  const programs = [{
    op: 'event.player_tick',
    methodName: 'on_player_tick',
    inputs: {}, fields: {}, body: [],
    next: {
      op: 'player.message',
      inputs: { text: { type: 'value', kind: 'text', value: '你好' } },
      fields: { mode: '聊天栏' },
      next: null,
    },
  }];

  const r7 = await call('visual/program', 'PUT', { root: projRoot, programs });
  ok(r7.status === 200, '保存成功', r7.data?.error || String(r7.status));
  ok(r7.data?.saved === 1, '存了 1 段');

  const r7b = await call('visual/program', 'GET', {}, { root: projRoot });
  ok(r7b.status === 200, '读取成功');
  ok(r7b.data?.programs?.length === 1, '读回 1 段');
  ok(r7b.data?.programs?.[0]?.next?.op === 'player.message', '内容对得上');

  // 编译这段程序
  const r7c = await call('visual/compile', 'POST', { targetId: 'fabric-26.3', programs });
  ok(r7c.status === 200, '编译返回 200');
  ok(r7c.data?.ok === true, '编译成功', (r7c.data?.errors || []).join('；'));
  ok(String(r7c.data?.code || '').includes('"你好"'), '代码里有用户填的字');

  fs.rmSync(projRoot, { recursive: true, force: true });
}

console.log('\n[8] 扩展状态（界面要能看见自动发现了什么）');
{
  const { status, data } = await call('visual/extensions', 'GET');
  ok(status === 200, '返回 200', String(status));
  ok(Array.isArray(data.targets) && data.targets.length >= 2, '有目标清单');
  ok(data.targets.every((t) => t.id && t.platform), '目标带 id 与 platform');
  ok(Array.isArray(data.packs) && data.packs.some((p) => p.id === 'goety'), '有内置 Goety 包');
  ok(Array.isArray(data.diagnostics), '带诊断数组');
}

console.log('\n[9] 条目级积木程序（per-entry 绑定）');
{
  const projRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-vbe-'));
  fs.mkdirSync(path.join(projRoot, '.studio'), { recursive: true });
  fs.writeFileSync(path.join(projRoot, '.studio', 'project.json'), JSON.stringify({
    meta: { name: 'T', id: 't', pkg: 'com.t' },
    target: { platform: 'fabric', mcVersion: '26.3', id: 'fabric-26.3' },
    entries: {
      item: [{ id: 'ruby', nameZh: '红宝石' }],
      block: [{ id: 'alt', nameZh: '替代方块' }],
    },
    files: {}, state: {}, hooks: { java: [], js: [] },
    visual: { programs: [], libraries: [] },
  }), 'utf8');

  // 空程序能读
  const r9 = await call('visual/entry-program', 'GET', {}, { root: projRoot, type: 'item', id: 'ruby' });
  ok(r9.status === 200, '读条目程序返回 200', String(r9.status));
  ok(Array.isArray(r9.data?.programs) && r9.data.programs.length === 0, '初始为空');

  // 写一段合法的组合（item + item_use）
  const prog = {
    op: 'event.item_use', inputs: {}, fields: {},
    next: { op: 'player.message', inputs: { text: { type: 'value', kind: 'text', value: '来自红宝石' } }, fields: {}, next: null },
  };
  const r9b = await call('visual/entry-program', 'PUT', { root: projRoot, type: 'item', id: 'ruby', programs: [prog] });
  ok(r9b.status === 200, '保存条目程序成功', r9b.data?.error || String(r9b.status));
  ok(r9b.data?.saved === 1, '存了 1 段');

  // 读回并确认落到磁盘（重新 loadProject）
  const r9c = await call('visual/entry-program', 'GET', {}, { root: projRoot, type: 'item', id: 'ruby' });
  ok(r9c.data?.programs?.length === 1, '读回 1 段');
  ok(r9c.data?.programs?.[0]?.op === 'event.item_use', '内容对得上');

  // 参数校验：type 非法
  const r9d = await call('visual/entry-program', 'PUT', { root: projRoot, type: 'entity', id: 'x', programs: [] });
  ok(r9d.status === 400, 'type 非法被拒', String(r9d.status));
  // 缺 id
  const r9e = await call('visual/entry-program', 'GET', {}, { root: projRoot, type: 'item' });
  ok(r9e.status === 400, '缺 id 被拒', String(r9e.status));
  // 条目不存在
  const r9f = await call('visual/entry-program', 'GET', {}, { root: projRoot, type: 'item', id: 'nope' });
  ok(r9f.status === 404, '条目不存在被拒', String(r9f.status));

  // 编译预览带 owner：合法组合应过
  const r9g = await call('visual/compile', 'POST', { targetId: 'fabric-26.3', owner: { type: 'item', id: 'ruby' }, programs: [prog] });
  ok(r9g.status === 200, '带 owner 编译返回 200', String(r9g.status));
  ok(r9g.data?.ok === true, 'item+item_use 编译成功', (r9g.data?.errors || []).join('；'));

  // 编译预览带 owner：非法组合（block + item_use）应被守卫拦下
  const bad = { op: 'event.item_use', inputs: {}, fields: {}, next: null };
  const r9h = await call('visual/compile', 'POST', { targetId: 'fabric-26.3', owner: { type: 'block', id: 'alt' }, programs: [bad] });
  ok(r9h.status === 200, '非法组合编译也返回 200（错误在 body）', String(r9h.status));
  ok(Array.isArray(r9h.data?.errors) && r9h.data.errors.length > 0, '守卫报出错误');
  ok(/方块不能拥有/.test((r9h.data?.errors || []).join('')), '错误提到「方块不能拥有」', (r9h.data?.errors || []).join('；'));

  fs.rmSync(projRoot, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
