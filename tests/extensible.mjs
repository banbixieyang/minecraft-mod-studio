/**
 * 可扩展性 + 工具包回归测试。
 *
 * 跑法：node tests/extensible.mjs
 *
 * ⚠️ 环境变量必须在**第一次 import 引擎模块之前**设好 ——
 *    target/registry.mjs 和 modpacks/registry.mjs 都是模块加载时自动扫目录，
 *    静态 import 会被提升、抢在赋值前执行，所以这里全用动态 import。
 *
 * 夹具就是 examples/extend/ 里的样板：测试跟用户照抄的是同一份文件，
 * 不会「测试里能跑、照着做却不行」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.resolve(HERE, '../examples/extend');
process.env.MCSTUDIO_TARGETS = path.join(EX, 'targets');
process.env.MCSTUDIO_MODPACKS = path.join(EX, 'modpacks');

const T = await import('../core/target/registry.mjs');
const P = await import('../core/visual/modpacks/registry.mjs');
const M = await import('../core/visual/modlib.mjs');
const R = await import('../core/visual/registry.mjs');
const L = await import('../core/visual/lint.mjs');
const C = await import('../core/visual/compile.mjs');
const CLI = await import('../core/cli/blocks.mjs');
const TOOLS = await import('../core/cli/tools.mjs');

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-ext-'));

console.log('\n[1] 目标适配器：内置不动 + 外部自动发现');
{
  const targets = T.listTargets();
  const ids = targets.map((t) => t.id);
  ok(ids.includes('fabric-26.3') && ids.includes('forge-1.20.1'), '两个内置目标仍在');
  ok(ids.includes('fabric-26.3-demo'), '外部目标被自动发现');
  ok(targets.find((t) => t.id === 'fabric-26.3-demo')?.builtin === false, '外部目标标为外部');
  ok(T.getTarget('fabric-26.3-demo').label.includes('外部示例'), '外部目标能正常解析');
  ok(T.targetDiagnostics().length === 0, '加载过程没有诊断错误', T.targetDiagnostics().join(' | '));
  ok(M.KNOWN_TARGETS.some((t) => t.id === 'fabric-26.3-demo'), 'KNOWN_TARGETS 自动跟着变（不再双份维护）');
  ok(M.targetOfMod({ loader: 'fabric', mcVersion: '26.3' })?.id === 'fabric-26.3', 'mod 目标识别仍正确');
  const bad = T.registerTarget({ id: '' }, {});
  ok(bad.ok === false, '缺字段的适配器会被拒绝');
  ok(T.unregisterTarget('fabric-26.3') === false, '内置目标不允许误删');
}

console.log('\n[2] mod 专属积木包：自动发现 / 命中 / 合并');
{
  const packs = P.listPacks();
  ok(packs.some((p) => p.id === 'goety' && p.builtin), '内置 Goety 包仍在');
  ok(packs.some((p) => p.id === 'example-pack' && !p.builtin), '外部示例包被自动发现');
  ok(P.packDiagnostics().length === 0, '包加载无诊断错误', P.packDiagnostics().join(' | '));
  ok(P.matchingPacks({ meta: { id: 'examplemod' }, mainNs: 'examplemod' }).some((p) => p.id === 'example-pack'), '按 mod id 命中');
  ok(P.matchingPacks({ meta: { id: 'other' }, mainNs: 'other' }).length === 0, '不相干的 mod 不误命中');
  const report = {
    meta: { id: 'examplemod', loader: 'forge', mcVersion: '1.20.1' },
    mainNs: 'examplemod', items: [], blocks: [], effects: [],
  };
  const r = M.libraryFromReport(report, { targetId: 'forge-1.20.1', withApi: false });
  ok(r.library.blocks.some((b) => b.id === 'demo.say'), '外部包的积木真的合并进生成的库');
  ok((r.warnings || []).some((w) => w.includes('示例 mod')), '生成日志里能看到是哪个包贡献的');
  const goety = M.libraryFromReport({
    meta: { id: 'goety', loader: 'forge', mcVersion: '1.20.1' },
    mainNs: 'goety', items: [], blocks: [], effects: [],
  }, { targetId: 'forge-1.20.1', withApi: false });
  ok(goety.library.blocks.length > 0, 'Goety 包改走注册表后仍能出积木');
  ok(!goety.library.blocks.some((b) => b.id === 'demo.say'), '外部包不会串到不相干的 mod 上');
}

console.log('\n[3] 坏包隔离：一个包写崩不影响其它包');
{
  const dir = path.join(tmp, 'badpacks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broken.mjs'), 'export const pack = { id: "broken", build( { \n');
  fs.writeFileSync(path.join(dir, 'good.mjs'), `
    export const pack = {
      id: 'test-good-pack', label: '好包', modIds: ['isolatedmod'],
      build() { return { blocks: [{ id: 'iso.hi', category: 'iso', shape: 'stack', label: 'hi', inputs: [], fields: [], java: { 'fabric-26.3': 'System.out.println(1);' } }], categories: [], notes: [] }; },
    };
  `);
  P.loadPacks([dir]);
  ok(P.listPacks().some((p) => p.id === 'test-good-pack'), '同目录里的好包仍被登记');
  ok(P.packDiagnostics().some((d) => d.includes('broken.mjs')), '坏包被记进诊断而不是静默吞掉');
  const r = P.runPacks({ targetId: 'fabric-26.3', report: { meta: { id: 'isolatedmod' } } });
  ok(r.blocks.some((b) => b.id === 'iso.hi'), '好包仍能正常产出积木');
}

console.log('\n[4] 自定义积木：默认全目标，换工程不再消失');
{
  R.ensureBuiltin();
  const all = R.createUserBlock({
    id: 'test.ext_all', name: '全目标测试',
    code: 'player.heal(%v);', params: [{ name: 'v', kind: 'number', default: 3 }],
  });
  ok(all.ok, '造积木成功', all.error);
  const targets = all.block.userDef?.targets || [];
  ok(targets.length >= 2, '默认覆盖全部目标', targets.join(', '));
  ok(Object.keys(all.block.java).length === targets.length, '每个目标都有 Java 模板');
  for (const tid of targets) {
    const c = C.compileProgram({
      op: 'event.player_tick', methodName: 'on_tick', inputs: {}, fields: {},
      next: { op: 'test.ext_all', inputs: { v: { type: 'value', kind: 'number', value: 7 } }, fields: {} },
    }, { targetId: tid });
    ok(c.ok && c.code.includes('player.heal(7)'), `目标 ${tid} 真能编译出代码`, c.errors?.join('；'));
  }
  const one = R.createUserBlock({
    id: 'test.ext_one', name: '单目标', code: 'player.heal(%v);',
    params: [{ name: 'v', kind: 'number' }], targetId: 'forge-1.20.1',
  });
  ok(one.ok && one.block.userDef.targets.length === 1, '显式 targetId 仍只造一个目标（向后兼容）');
  const star = R.createUserBlock({ id: 'test.ext_star', name: '星号', code: 'System.out.println(1);', targetId: '*' });
  ok(star.ok && star.block.userDef.targets.length >= 2, "targetId='*' 等价于全目标");
  const unknown = R.createUserBlock({ id: 'test.ext_bad', name: '坏目标', code: 'x();', targets: ['nope'] });
  ok(!unknown.ok && unknown.error.includes('未知目标'), '未知目标被明确拒绝');
}

console.log('\n[5] 库体检器：好库通过、坏库报错');
{
  const good = {
    format: 'mcblocks', version: 1, id: 'good-lib', name: '好库',
    categories: [{ id: 'c', label: '测试分类' }],
    blocks: [{
      id: 'a.heal', category: 'c', shape: 'stack', label: '治疗 %x',
      inputs: [{ name: 'x', kind: 'number', default: 1 }], fields: [],
      java: { 'fabric-26.3': 'player.heal(%x);', 'forge-1.20.1': 'player.heal(%x);' },
    }],
  };
  const gr = L.lintLibrary(good, { knownTargets: ['fabric-26.3', 'forge-1.20.1'] });
  ok(gr.ok, '好库体检通过', gr.errors.join('；'));
  ok(gr.coverage['fabric-26.3'].percent === 100 && gr.coverage['forge-1.20.1'].percent === 100, '覆盖率矩阵正确');

  const bad = {
    format: 'mcblocks', version: 1, id: 'bad-lib', name: '坏库',
    categories: [{ id: 'other', label: '别的分类' }],
    blocks: [
      {
        id: 'b.one', category: 'missing-cat', shape: 'stack', label: 'x',
        inputs: [{ name: 'a', kind: 'text' }], fields: [],
        bodySlots: ['body'],
        java: { 'fabric-26.3': 'foo(%a, %undeclared);' },
      },
      { id: 'b.one', category: 'c', shape: 'stack', label: 'dup', inputs: [], fields: [], java: {} },
    ],
  };
  const br = L.lintLibrary(bad, { knownTargets: ['fabric-26.3', 'forge-1.20.1'] });
  ok(!br.ok, '坏库被判不通过');
  ok(br.errors.some((e) => e.includes('%undeclared')), '报出未声明的占位符');
  ok(br.errors.some((e) => e.includes('%body')), '报出容器槽没有对应标记');
  ok(br.errors.some((e) => e.includes('重复')), '报出重复 id');
  ok(br.warnings.some((w) => w.includes('没在 categories 里登记')), '报出分类没登记');
  ok([...L.placeholdersOf('int r = a % b;')].length === 0, '取模运算不会被误当占位符');
  ok([...L.placeholdersOf('%x', new Set(['x']))].includes('x'), '声明过的单字母参数不会被格式符白名单吃掉');
}

console.log('\n[6] CLI：每个子命令都返回结果与正确退出码');
{
  const rt = await CLI.blocksCommand('targets', []);
  ok(rt.exitCode === 0 && rt.data.targets.length >= 3, 'targets 返回结构化数据');
  const rp = await CLI.blocksCommand('packs', ['--mod', 'examplemod']);
  ok(rp.exitCode === 0 && rp.data.matching.includes('example-pack'), 'packs 能查命中');
  const rl = await CLI.blocksCommand('list', ['--target', 'forge-1.20.1']);
  ok(rl.exitCode === 0 && rl.data.blocks.length > 100, 'list 列出积木', String(rl.data.blocks.length));
  const rbad = await CLI.blocksCommand('list', ['--target', 'nope']);
  ok(rbad.exitCode === 1 && rbad.data.error.includes('未知目标'), '错目标返回非零退出码');
  const rhelp = await CLI.blocksCommand('help', []);
  ok(rhelp.lines.some((l) => l.includes('blocks validate')), 'help 有用法说明');
  const rmiss = await CLI.blocksCommand('compile', []);
  ok(rmiss.exitCode === 1, 'compile 缺工程目录会报错');

  const libFile = path.join(tmp, 'ok.mcblocks.json');
  fs.writeFileSync(libFile, JSON.stringify({
    format: 'mcblocks', version: 1, id: 'v-lib', name: '体检用', categories: [{ id: 'c', label: 'C' }],
    blocks: [{ id: 'v.a', category: 'c', shape: 'stack', label: 'a', inputs: [], fields: [], java: { 'fabric-26.3': 'x();' } }],
  }));
  const rv = await CLI.blocksCommand('validate', [libFile]);
  ok(rv.exitCode === 0 && rv.data.ok, 'validate 好库退出码 0');

  const brokenFile = path.join(tmp, 'broken.mcblocks.json');
  fs.writeFileSync(brokenFile, JSON.stringify({
    format: 'mcblocks', version: 1, id: 'v-bad', name: '坏', categories: [],
    blocks: [{ id: 'v.b', category: 'c', shape: 'stack', label: 'b', inputs: [], fields: [], java: { 'fabric-26.3': 'x(%nope);' } }],
  }));
  const rvb = await CLI.blocksCommand('validate', [brokenFile]);
  ok(rvb.exitCode === 1 && !rvb.data.ok, 'validate 坏库退出码 1（CI 能拦住）');

  const outFile = path.join(tmp, 'new-block.json');
  const rn = await CLI.blocksCommand('new', [
    '--name', 'CLI 造的', '--id', 'test.cli_made', '--code', 'player.heal(%v);',
    '--param', 'v:number', '--param', 'w:text', '--out', outFile,
  ]);
  // 第二个参数 w 没在代码里用到，createUserBlock 必须拒绝（参数一致性校验真生效）
  ok(rn.exitCode === 1 && String(rn.data?.error || '').includes('%w'), 'new 会拒绝没用到的参数声明', rn.data?.error);
  const rn2 = await CLI.blocksCommand('new', [
    '--name', 'CLI 造的', '--id', 'test.cli_made2', '--code', 'player.heal(%v);',
    '--param', 'v:number', '--out', outFile,
  ]);
  ok(rn2.exitCode === 0 && fs.existsSync(outFile), 'new 导出成库文件');
  ok(rn2.data.targets.length >= 2, 'new 默认全目标', rn2.data.targets.join(', '));
  const rj = await CLI.blocksCommand('targets', ['--json']);
  ok(rj.data && rj.lines.length === 0, '--json 模式不掺人话');
}

console.log('\n[7] 工具索引');
{
  const r = TOOLS.toolsCommand([]);
  ok(r.exitCode === 0 && r.data.tools.length >= 8, '能列出 tools/ 里的脚本', String(r.data.tools.length));
  ok(r.data.tools.some((t) => t.name === 'sync-docs.mjs'), '包含正式工具');
  ok(r.data.probes.length >= 1, '探针脚本单列');
  const rj = TOOLS.toolsCommand(['--json']);
  ok(rj.lines.length === 0 && rj.data.tools, '--json 模式可用');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
