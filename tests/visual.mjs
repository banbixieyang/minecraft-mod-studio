/**
 * 积木引擎单元测试。
 *
 * 跑法：node tests/visual.mjs
 */
import { block, value, validate, countBlocks, cloneBlocks } from '../core/visual/model.mjs';
import { registerBlocks, clearBlocks, getBlock, allBlocks, templateFor } from '../core/visual/blocks.mjs';
import { compileProgram, compileProject, compileValue, javaStr, checkOwnerEvent, OWNER_EVENT_RULES } from '../core/visual/compile.mjs';
import { ensureBuiltin, createUserBlock, blockCatalog, exportUserBlocks } from '../core/visual/registry.mjs';
import { decompile, RAW_JAVA_BLOCK } from '../core/visual/decompile.mjs';
import { validateLibrary, installLibrary, exportLibrary, LIB_FORMAT } from '../core/visual/library.mjs';
import * as fabricVisual from '../core/target/fabric-26.3/visual.mjs';
import * as forgeVisual from '../core/target/forge-1.20.1/visual.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

console.log('\n[1] 模型');
{
  const b = block('a', { inputs: { x: value('number', 1) }, body: [block('b')], next: block('c') });
  ok(countBlocks(b) === 3, '统计积木数量', `${countBlocks(b)}`);
  const c = cloneBlocks(b);
  ok(c.op === 'a' && c.body.length === 1 && c.next.op === 'c', '深拷贝保持结构');
  ok(c.body[0] !== b.body[0], '深拷贝不共享引用');
}

console.log('\n[2] 内置积木注册');
ensureBuiltin();
{
  const all = allBlocks();
  ok(all.length > 30, '内置积木已注册', `${all.length} 条`);
  ok(getBlock('player.message') != null, '能找到「对玩家说」');
  ok(getBlock('flow.repeat') != null, '能找到「重复」');
  ok(getBlock('event.player_rightclick_block') != null, '能找到事件帽形');
  ok(templateFor('player.message', 'fabric-26.3') != null, 'Fabric 26.3 有实现');
  ok(templateFor('player.message', 'forge-1.20.1') != null, 'Forge 1.20.1 有实现');
}

console.log('\n[3] 编译：单条积木');
{
  const prog = block('event.player_rightclick_block', {
    next: block('player.message', { inputs: { text: value('text', '你好') } }),
  });
  const r = compileProgram(prog, { targetId: 'fabric-26.3', pkg: 'com.example.test' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('sendSystemMessage'), '用对了 26.3 的 sendSystemMessage');
  ok(!r.code.includes('sendMessage('), '没有用错 sendMessage');
  ok(r.code.includes('"你好"'), '文本参数已转成 Java 字面量');
  ok(r.code.includes('Component.literal'), '用了 Component.literal（26.3 没有 Text 类）');
}

console.log('\n[4] 编译：嵌套积木');
{
  // 重复 10 次：给玩家 5 点生命
  const inner = block('player.heal', { inputs: { amount: value('number', 5) } });
  const prog = block('event.player_tick', {
    next: block('flow.repeat', {
      inputs: { times: value('number', 10) },
      body: [inner],
    }),
  });
  const r = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('for (int i = 0; i < 10; i++)'), '重复循环正确');
  ok(r.code.includes('player.heal(5);'), '嵌套语句正确');
  // 缩进：heal 应该在 for 里面
  const healLine = r.code.split('\n').find((l) => l.includes('player.heal'));
  ok(/^\s{8,}player\.heal/.test(healLine), '嵌套语句有正确缩进', JSON.stringify(healLine?.slice(0, 20)));
}

console.log('\n[5] 编译：值表达式嵌套');
{
  // 给玩家 (1+2) 点生命 —— 数学积木嵌在参数槽里
  const sum = block('math.add', {
    inputs: { a: value('number', 1), b: value('number', 2) },
  });
  const prog = block('event.player_tick', {
    next: block('player.heal', { inputs: { amount: sum } }),
  });
  const r = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('player.heal((1 + 2));'), '嵌套值表达式正确', r.code.match(/player\.heal.*/)?.[0]);
}

console.log('\n[6] 编译：条件积木');
{
  const cond = block('math.compare', {
    inputs: { a: value('number', 10), b: value('number', 5) },
    fields: { op: '<' },
  });
  const prog = block('event.player_tick', {
    next: block('flow.if', {
      inputs: { cond },
      body: [block('player.heal', { inputs: { amount: value('number', 1) } })],
    }),
  });
  const r = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('if ((10 < 5))'), '条件表达式正确', r.code.match(/if \(.*/)?.[0]);
}

console.log('\n[7] 编译：if/else 双 body');
{
  const cond = block('logic.not', { inputs: { cond: value('boolean', false) } });
  const prog = block('event.player_tick', {
    next: block('flow.if_else', {
      inputs: { cond },
      body: [block('player.heal', { inputs: { amount: value('number', 1) } })],
      elseBody: [block('player.heal', { inputs: { amount: value('number', 2) } })],
    }),
  });
  const r = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('} else {'), 'else 分支存在');
  ok(r.code.includes('player.heal(2.0F);') || r.code.includes('player.heal(2);'), 'else 分支内容正确');
}

console.log('\n[8] 编译：Forge 目标用不同 API');
{
  const prog = block('event.player_rightclick_block', {
    next: block('player.message', { inputs: { text: value('text', 'hi') } }),
  });
  const r = compileProgram(prog, { targetId: 'forge-1.20.1' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('displayClientMessage'), 'Forge 用 displayClientMessage');
  ok(!r.code.includes('sendSystemMessage'), 'Forge 不用 Fabric 的方法');
  ok(r.code.includes('Component.literal'), 'Forge 也用 Component.literal');
}

console.log('\n[9] 编译：方块设置（两个目标签名不同）');
{
  const prog = block('event.player_rightclick_block', {
    next: block('block.set', {
      inputs: {
        x: value('number', 1), y: value('number', 64), z: value('number', 2),
        block: value('blockRef', 'minecraft:stone'),
      },
    }),
  });
  const f = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(f.ok && f.code.includes('Identifier.parse'), '26.3 用 Identifier.parse', f.errors.join('；'));
  ok(f.code.includes('BuiltInRegistries.BLOCK'), '26.3 用 BuiltInRegistries 取方块', '');
  const g = compileProgram(prog, { targetId: 'forge-1.20.1' });
  ok(g.ok && g.code.includes('ResourceLocation.parse'), 'Forge 用 ResourceLocation.parse', g.errors.join('；'));
  ok(!f.code.includes('setBlockState'), '不用旧的 setBlockState');
  ok(!f.code.includes('Registries.BLOCK.get('), '不把 ResourceKey 当 Registry 用');
}

console.log('\n[10] 编译：未知积木不崩');
{
  const prog = block('event.player_tick', { next: block('nonexistent.block') });
  const r = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(!r.ok || r.warnings.length > 0, '未知积木产生警告而不是崩溃');
  ok(typeof r.code === 'string', '仍然返回了代码字符串');
}

console.log('\n[11] 编译：非帽形开头要报错');
{
  const r = compileProgram(block('player.heal'), { targetId: 'fabric-26.3' });
  ok(!r.ok, '拒绝了非帽形开头的程序', r.errors.join('；'));
}

console.log('\n[12] 校验：找出问题');
{
  const problems = validate(
    block('event.player_tick', { next: block('nonexistent.x') }),
    (id) => getBlock(id),
  );
  ok(problems.some((p) => p.msg.includes('未知积木')), '报出未知积木');
  const missing = validate(
    block('event.player_tick', { next: block('flow.if', { inputs: {} }) }),
    (id) => getBlock(id),
  );
  ok(missing.some((p) => p.msg.includes('缺少必填参数')), '报出缺少必填参数');
}

console.log('\n[13] 工程级编译');
{
  const project = {
    meta: { pkg: 'com.example.demo' },
    target: { id: 'fabric-26.3' },
    visual: {
      programs: [
        {
          op: 'event.player_rightclick_block',
          methodName: 'on_rightclick',
          next: block('player.message', { inputs: { text: value('text', 'A') } }),
        },
        {
          op: 'event.player_tick',
          methodName: 'on_tick',
          next: block('player.heal', { inputs: { amount: value('number', 1) } }),
        },
      ],
    },
  };
  const r = compileProject(project, { targetId: 'fabric-26.3' });
  ok(r.ok, '工程编译成功', r.errors.join('；'));
  ok(r.files.length === 1, '产出一个文件');
  ok(r.files[0].path.includes('ModLogic.java'), '文件名正确', r.files[0].path);
  ok(r.files[0].content.includes('on_rightclick'), '方法名正确');
  ok(r.files[0].content.includes('on_tick'), '第二个方法也在');
  ok(r.files[0].content.includes('package com.example.demo.custom;'), '包名正确');
}

console.log('\n[14] 反编译：能认出来的');
{
  const code = [
    'player.heal(5.0F);',
    'player.sendSystemMessage(net.minecraft.network.chat.Component.literal("你好"), false);',
  ].join('\n');
  const r = decompile(code, { targetId: 'fabric-26.3' });
  ok(r.ok, '反编译没报错');
  ok(r.matched >= 1, '至少认出一条', `匹配 ${r.matched}，未匹配 ${r.unmatched}`);
  ok(r.program.next != null, '生成了程序');
}

console.log('\n[15] 反编译：认不出来的必须兜住');
{
  const code = 'someVeryWeirdCustomCall(1, 2, 3);';
  const r = decompile(code, { targetId: 'fabric-26.3' });
  ok(r.ok, '反编译没报错');
  ok(r.unmatched === 1, '标记为未匹配');
  ok(r.program.next.op === 'raw.java', '用「原始代码」积木兜住');
  ok(r.program.next.inputs.code.value.includes('someVeryWeirdCustomCall'), '原代码一字不丢');
}

console.log('\n[16] 从代码反向造积木');
{
  const r = createUserBlock({
    id: 'my.custom.greet',
    name: '打招呼 %who',
    code: 'player.sendSystemMessage(net.minecraft.network.chat.Component.literal("你好 " + %who), false);',
    params: [{ name: 'who', kind: 'text', default: '世界' }],
    targetId: 'fabric-26.3',
  });
  ok(r.ok, '创建成功', r.error || '');
  const def = getBlock('my.custom.greet');
  ok(def != null, '积木已注册');
  ok(def.userDef != null, '标记为自定义积木');
  // 编译它
  const prog = block('event.player_tick', {
    next: block('my.custom.greet', { inputs: { who: value('text', '小明') } }),
  });
  const c = compileProgram(prog, { targetId: 'fabric-26.3' });
  ok(c.ok, '自定义积木能编译', c.errors.join('；'));
  ok(c.code.includes('"你好 " + "小明"'), '参数填对了', c.code.match(/sendSystemMessage.*/)?.[0]);
}

console.log('\n[17] 自定义积木的参数校验');
{
  // 代码里用了没声明的占位符 → 拒绝
  const r1 = createUserBlock({ id: 'x.y', name: 'x', code: 'foo(%missing);' });
  ok(!r1.ok && r1.error.includes('没有对应的参数'), '未声明的占位符被拒绝');
  // 声明了但代码里没用到 → 拒绝
  const r2 = createUserBlock({
    id: 'x.y', name: 'x', code: 'foo(%a);',
    params: [{ name: 'a' }, { name: 'unused' }],
  });
  ok(!r2.ok && r2.error.includes('没有用到参数'), '声明了但没用到的参数被拒绝', r2.error);
  // 参数名重复 → 拒绝
  const r3 = createUserBlock({
    id: 'x.y', name: 'x', code: 'foo(%a, %a);',
    params: [{ name: 'a' }, { name: 'a' }],
  });
  ok(!r3.ok, '重复的参数名被拒绝', r3.error);
  const r4 = createUserBlock({ id: '123bad', name: 'x', code: 'foo();' });
  ok(!r4.ok, '非法 id 被拒绝');
}

console.log('\n[18] 积木库格式');
{
  const lib = {
    format: LIB_FORMAT,
    version: 1,
    id: 'test-lib',
    name: '测试库',
    blocks: [{
      id: 'test.hello',
      category: 'test',
      shape: 'stack',
      label: '测试',
      inputs: [],
      fields: [],
      java: { 'fabric-26.3': 'doSomething();' },
    }],
  };
  const v = validateLibrary(lib);
  ok(v.ok, '库校验通过', v.errors.join('；'));
  const inst = installLibrary(lib);
  ok(inst.ok, '装库成功');
  ok(getBlock('test.hello') != null, '库里的积木已注册');
  // 重复装应该更新而不是报冲突
  const inst2 = installLibrary(lib);
  ok(inst2.ok, '重复装库不报错');
  // 不合法的库要报错
  const bad = validateLibrary({ format: 'wrong', blocks: 'notarray' });
  ok(!bad.ok, '不合法库被拒绝');
}

console.log('\n[19] 积木清单');
{
  const cats = blockCatalog('fabric-26.3');
  ok(cats.length >= 5, '分类够多', `${cats.length} 类`);
  const playerCat = cats.find((c) => c.id === 'player');
  ok(playerCat && playerCat.blocks.length > 5, '玩家分类有积木');
  const allSupported = cats.flatMap((c) => c.blocks).every((b) => b.supported);
  ok(allSupported, '所有内置积木在当前目标下都有实现');
}

console.log('\n[20] 导出自定义积木为库');
{
  const lib = exportUserBlocks(['my.custom.greet']);
  ok(lib.blocks.length === 1, '导出了自定义积木');
  ok(lib.blocks[0].id === 'my.custom.greet', '积木 id 正确');
  ok(lib.format === LIB_FORMAT, '格式标识正确');
}

console.log('\n[21] 编译：条件无限嵌套 + 逻辑组合');
{
  ensureBuiltin();
  const val = (v) => ({ type: 'value', kind: 'number', value: v });
  const cmp = (a, op, b) => ({ op: 'math.compare', inputs: { a: val(a), b: val(b) }, fields: { op } });
  // 三层 if 嵌套；条件里嵌 与/非 和数值比较
  const program = {
    op: 'event.player_tick', inputs: {}, fields: {}, next: {
      op: 'flow.if', fields: {}, inputs: {
        cond: { op: 'logic.and', fields: {}, inputs: {
          a: cmp(5, '>', 3),
          b: { op: 'logic.not', fields: {}, inputs: { cond: cmp(1, '<', 2) } },
        } },
      },
      body: [{
        op: 'flow.if', fields: {}, inputs: { cond: cmp(9, '>=', 2) },
        body: [{ op: 'player.heal', fields: {}, inputs: { amount: val(2) } }],
        next: { op: 'player.message', fields: { mode: '聊天栏' }, inputs: { text: { type: 'value', kind: 'text', value: '嵌套成功' } } },
      }],
      next: { op: 'player.message', fields: { mode: '聊天栏' }, inputs: { text: { type: 'value', kind: 'text', value: '外层' } } },
    },
  };
  const r = compileProject({ visual: { programs: [program] }, target: { id: 'fabric-26.3' }, meta: { pkg: 'com.example.demo' } }, { targetId: 'fabric-26.3', pkg: 'com.example.demo' });
  ok(r.errors.length === 0, '编译无错误', r.errors.join('；'));
  const code = r.files?.[0]?.content || '';
  let bal = 0, bad = false;
  for (const c of code) { if (c === '{') bal++; else if (c === '}') { bal--; if (bal < 0) bad = true; } }
  ok(!bad && bal === 0, '花括号平衡（含嵌套）', `bal=${bal}`);
  ok((code.match(/if\s*\(/g) || []).length >= 3, '至少有 3 层 if', `${code.match(/if\s*\(/g)?.length} 层`);
  ok(code.includes('heal') && code.includes('嵌套成功'), '嵌套内层逻辑已编译');
}

console.log('\n[22] 编译器：per-entry 程序收集与作用域命名');
{
  const project = {
    meta: { pkg: 'com.example.demo' },
    target: { id: 'fabric-26.3' },
    entries: {
      item: [{ id: 'iron_sword', nameZh: '铁剑' }],
      block: [{ id: 'magic_block', nameZh: '魔法方块' }],
    },
    visual: {
      programs: [
        { op: 'event.player_tick', methodName: 'on_tick', next: block('player.heal', { inputs: { amount: value('number', 1) } }) },
      ],
    },
  };
  project.entries.item[0].visualPrograms = [
    { op: 'event.item_use', methodName: 'should_be_ignored', next: block('player.heal', { inputs: { amount: value('number', 2) } }) },
  ];
  project.entries.block[0].visualPrograms = [
    { op: 'event.block_break', next: block('player.message', { inputs: { text: value('text', 'boom') } }) },
  ];

  const r = compileProject(project, { targetId: 'fabric-26.3' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.compiled.length === 3, '收集到 3 个程序（1 全局 + 2 per-entry）', `${r.compiled.length}`);
  const itemProg = r.compiled.find((c) => c.owner && c.owner.type === 'item' && c.owner.id === 'iron_sword');
  ok(!!itemProg, '铁剑的 per-entry 程序被收集');
  ok(itemProg.methodName === 'on_item_use_item_iron_sword', '方法名带 owner 作用域', itemProg.methodName);
  ok(!itemProg.methodName.includes('should_be_ignored'), 'per-entry 忽略 methodName，强制作用域命名');
  const file = r.files[0].content;
  ok(file.includes('on_item_use_item_iron_sword'), '文件含 per-entry 方法');
  ok(file.includes('on_tick'), '全局方法仍在');
  // 同一个 item 写两段不同事件也不能撞名（item_use + rightclick_block）
  const sword = project.entries.item[0];
  sword.visualPrograms.push({ op: 'event.player_rightclick_block', next: block('player.heal', { inputs: { amount: value('number', 1) } }) });
  const r2 = compileProject(project, { targetId: 'fabric-26.3' });
  ok(r2.ok, '同条目多事件编译成功', r2.errors.join('；'));
  ok(r2.files[0].content.includes('on_player_rightclick_block_item_iron_sword'), '第二段程序也带了作用域命名');
}

console.log('\n[23] 编译器守卫：非法 条目/事件 组合必须报错');
{
  ok(checkOwnerEvent('item', 'event.server_tick') !== null, 'item 不能拥有 server_tick');
  ok(checkOwnerEvent('item', 'event.item_use') === null, 'item 能拥有 item_use');
  ok(checkOwnerEvent('block', 'event.item_use') !== null, 'block 不能拥有 item_use');
  ok(checkOwnerEvent('block', 'event.block_break') === null, 'block 能拥有 block_break');
  ok(checkOwnerEvent('unknown', 'event.item_use') !== null, '未知条目类型报错');

  const bad = {
    meta: { pkg: 'com.example.demo' },
    target: { id: 'fabric-26.3' },
    entries: { item: [{ id: 'x', visualPrograms: [{ op: 'event.server_tick' }] }] },
    visual: { programs: [] },
  };
  const rb = compileProject(bad, { targetId: 'fabric-26.3' });
  ok(!rb.ok, '非法组合整体编译失败', rb.errors.join('；'));
  ok(rb.errors.some((e) => e.includes('不能拥有事件')), '报出 owner 守卫错误');
  ok(rb.compiled.length === 0, '非法程序不进 compiled（不会生成废方法）');
}

console.log('\n[24] 接线：per-entry 按 owner 过滤（Fabric + Forge）');
{
  const p = { meta: { pkg: 'com.example.demo' }, target: { id: 'fabric-26.3' } };
  const fw = fabricVisual.visualWiring(p, {
    compiled: [
      { op: 'event.item_use', methodName: 'on_item_use_item_iron_sword', owner: { type: 'item', id: 'iron_sword' } },
      { op: 'event.player_tick', methodName: 'on_tick', owner: null },
    ],
  });
  ok(fw.includes('ModItems.IRON_SWORD'), 'Fabric 接线含 owner 引用');
  ok(fw.includes('getItemInHand(hand).getItem() == ModItems.IRON_SWORD'), 'item_use 按物品过滤');
  ok(fw.includes('import com.example.demo.registry.ModItems;'), '导入 ModItems');
  ok(!fw.includes('import import'), '不会出现重复 import 前缀');
  ok(!fw.includes('%method') && !fw.includes('%ref'), '占位符全部替换');

  // Fabric 的 block owner 两个事件（rightclick_block / block_break）
  const fwb = fabricVisual.visualWiring(p, {
    compiled: [
      { op: 'event.player_rightclick_block', methodName: 'on_player_rightclick_block_block_magic_block', owner: { type: 'block', id: 'magic_block' } },
      { op: 'event.block_break', methodName: 'on_block_break_block_magic_block', owner: { type: 'block', id: 'magic_block' } },
    ],
  });
  ok(fwb.includes('ModBlocks.MAGIC_BLOCK'), 'Fabric block owner 引用 ModBlocks');
  ok(fwb.includes('hit.getBlockState().getBlock() == ModBlocks.MAGIC_BLOCK'), '右键方块按方块过滤');
  ok(fwb.includes('state.getBlock() == ModBlocks.MAGIC_BLOCK'), '破坏方块按方块过滤');

  const fg = forgeVisual.visualWiring(p, {
    compiled: [
      { op: 'event.block_break', methodName: 'on_block_break_block_magic_block', owner: { type: 'block', id: 'magic_block' } },
      { op: 'event.player_tick', methodName: 'on_tick', owner: null },
    ],
  });
  ok(fg.includes('ModBlocks.MAGIC_BLOCK'), 'Forge 接线含 block owner 引用');
  ok(fg.includes('event.getState().getBlock() == ModBlocks.MAGIC_BLOCK'), 'block_break 按方块过滤');
  ok(fg.includes('import com.example.demo.registry.ModBlocks;'), 'Forge 导入 ModBlocks');
  ok(!fg.includes('import import'), 'Forge 不会出现重复 import 前缀');
  ok(!fg.includes('%handler') && !fg.includes('%ref'), 'Forge 占位符全部替换');
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
