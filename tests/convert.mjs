/**
 * 功能转换器回归测试。
 *
 * 跑法：
 *   node tests/convert.mjs             # 引擎 / IR / CLI / HTTP / 应用 / 生成
 *   node tests/convert.mjs --build     # 额外对转换后的 Forge 工程真跑一次 Gradle
 *
 * 覆盖的承诺：
 *   · 有证据的映射真的改了（模板 + 符号），反向也能改
 *   · 没证据的绝不假装改好（事件 / jar  → manual，缺模板 → blocked）
 *   · 规则可插拔：自动发现 / 覆盖 / 坏规则隔离
 *   · 预览只读、应用要确认，且应用完能按新目标重出资源
 *
 * ⚠️ 环境变量必须在第一次 import 引擎模块之前设好（注册表模块加载时就扫目录），
 *    所以下面全部用动态 import，跟 tests/extensible.mjs 一个道理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXAMPLE = path.resolve(ROOT, 'examples/extend/convert/demo.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-convert-'));
const ruleDir = path.join(tmp, 'rules');
fs.mkdirSync(ruleDir, { recursive: true });
fs.copyFileSync(EXAMPLE, path.join(ruleDir, 'demo.mjs'));
// 故意放一个语法坏掉的规则，验证「坏插件只跳过它、其它照常」
fs.writeFileSync(path.join(ruleDir, 'broken.mjs'), 'export const rule = { id: "broken", convert( { ;;;\n', 'utf8');
process.env.MCSTUDIO_CONVERT = ruleDir;

const IR = await import('../core/convert/ir.mjs');
const ENG = await import('../core/convert/engine.mjs');
const REG = await import('../core/convert/registry.mjs');
const CLI = await import('../core/cli/convert.mjs');
const ROUTES = await import('../core/serve/routes_convert.mjs');
const P = await import('../core/project.mjs');
const T = await import('../core/target/registry.mjs');
const EFF = await import('../core/library/effects.mjs');
const PIPE = await import('../core/generator/pipeline.mjs');

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};
const DO_BUILD = process.argv.includes('--build');

/** 造一个最小工程 */
function makeProject(name, targetId, mutate = () => {}) {
  const dir = path.join(tmp, name);
  const t = T.getTarget(targetId);
  P.createProject(dir, {
    name, id: name.replace(/[^a-z0-9]/g, '_'), pkg: `com.example.${name.replace(/[^a-z0-9]/g, '_')}`,
    version: '0.1.0', target: { ...t.defaults, id: t.id },
  });
  const p = P.loadProject(dir);
  mutate(p);
  P.saveProject(dir, p);
  return dir;
}

function fakeReq(body) {
  const r = new Readable({ read() {} });
  if (body !== undefined) r.push(JSON.stringify(body));
  r.push(null);
  return r;
}
function fakeRes() {
  const out = { code: 0, body: null };
  return { out, writeHead(c) { out.code = c; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
}
async function call(route, method, body) {
  const res = fakeRes();
  await ROUTES.handleConvert(fakeReq(body), res, route, {}, method);
  return { status: res.out.code, data: res.out.body };
}

console.log('\n[1] 规则注册表：自动发现 / 覆盖 / 坏插件隔离');
{
  const rules = REG.listRules();
  const ids = rules.map((r) => r.id);
  for (const id of ['builtin.blocks', 'builtin.symbols', 'builtin.events', 'builtin.resources', 'builtin.entries', 'builtin.programs', 'builtin.deps']) {
    ok(ids.includes(id), `内置规则 ${id} 已加载`);
  }
  const demo = rules.find((r) => r.id === 'example.myapi');
  ok(!!demo && demo.builtin === false, '外部示例规则被自动发现且标为外部');
  ok(REG.convertDiagnostics().some((d) => d.includes('broken.mjs')), '坏规则被记进诊断');
  ok(REG.convertDiagnostics().some((d) => d.includes('加载失败')), '坏规则不会被当成正常规则');
  ok(!ids.includes('broken'), '坏规则没进清单');
  const r1 = REG.registerRule({ id: 'probe.rule', label: '探针', convert: () => ({}) });
  ok(r1.ok, '代码里可直接登记规则');
  ok(REG.registerRule({ id: 'probe.rule', label: '重复', convert: () => ({}) }).ok === false, '同 id 不允许重复登记');
  ok(REG.registerRule({ id: 'probe.rule', label: '覆盖', convert: () => ({}) }, { overwrite: true }).ok, '显式 overwrite 可覆盖');
  REG.unregisterRule('probe.rule');
}

console.log('\n[2] 功能 IR：工程 / 效果 / 包 / 代码 / 文件');
{
  const f1 = IR.featureFromCode('player.heal(4);', { targetId: 'fabric-26.3', name: '回血' });
  ok(f1.format === 'mcstudio.feature' && f1.version === 1, 'IR 有格式与版本');
  ok(IR.collectParts(f1).some((p) => p.kind === 'java'), '代码抽成 java 部件');
  ok(IR.collectParts(f1).some((p) => p.kind === 'requires'), '附带适用范围部件');

  const eff = IR.featureFromEffect('attack_lifesteal');
  ok(eff.kind === 'effect' && eff.content.java.length > 0, '效果库能抽成 IR');
  ok(!eff.content.java[0].code.includes('{{ratio}}'), '{{参数}} 已用默认值填好');

  const pack = EFF.effectToPack(EFF.getEffect('attack_lifesteal'));
  const f2 = IR.featureFromPack(pack);
  ok(f2.content.java.length > 0, '分享包能抽成 IR');

  const dir = makeProject('irproj', 'fabric-26.3', (p) => {
    p.entries.item = [{ id: 'ruby', nameZh: '红宝石', nameEn: 'Ruby' }];
    p.hooks.java = [{ name: '回血', target: 'init', code: 'player.heal(4);' }];
    p.visual.programs = [{ op: 'event.player_tick', next: { op: 'player.heal', inputs: {}, fields: {} } }];
  });
  const f3 = IR.featureFromProject(dir);
  const parts = IR.collectParts(f3);
  ok(parts.some((p) => p.kind === 'entry'), '工程条目抽成 entry 部件');
  ok(parts.some((p) => p.kind === 'java'), '工程钩子抽成 java 部件');
  ok(parts.some((p) => p.kind === 'program'), '积木程序抽成 program 部件');
  ok(f3.origin.type === 'project', '标了来源类型');
  ok(IR.inferTargetId(f3) === 'fabric-26.3', '源目标可从工程推断');

  const javaFile = path.join(tmp, 'snippet.java');
  fs.writeFileSync(javaFile, 'player.heal(1);', 'utf8');
  ok(IR.readFeature(javaFile).content.java.length === 1, '能直接读 .java 文件');
  const jsonFile = path.join(tmp, 'feature.json');
  fs.writeFileSync(jsonFile, JSON.stringify(f1), 'utf8');
  ok(IR.readFeature(jsonFile).id === f1.id, '能读回 IR JSON');
}

console.log('\n[3] 有证据的转换：模板整段回填 + 符号替换');
{
  const blockCode = `if ("聊天栏".equals("动作栏")) {
    player.sendSystemMessage(net.minecraft.network.chat.Component.literal("你好"), true);
} else {
    player.sendSystemMessage(net.minecraft.network.chat.Component.literal("你好"), false);
}`;
  const f = IR.featureFromCode(blockCode, { targetId: 'fabric-26.3' });
  const r = ENG.convert(f, { targetId: 'forge-1.20.1' });
  ok(r.ok, '转换成功');
  const hit = r.items.find((i) => i.label.includes('对玩家说'));
  ok(hit?.status === 'ported' && hit.confidence === 1, '整段模板回填标为 ported');
  ok(hit?.rule === 'builtin.blocks', '报告写了是哪条规则做的');
  ok(!r.result.content.java[0].code.includes('sendSystemMessage'), 'Fabric 写法已消失');
  ok(r.result.content.java[0].code.includes('displayClientMessage'), '换成 Forge 写法');
  ok(r.result.content.java[0].code.includes('"你好"'), '参数原样带过去');

  const r2 = ENG.convert(IR.featureFromCode(r.result.content.java[0].code, { targetId: 'forge-1.20.1' }), { targetId: 'fabric-26.3' });
  ok(r2.result.content.java[0].code.includes('sendSystemMessage'), '反向也能转回来');

  const misc = 'net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(net.minecraft.resources.Identifier.parse("minecraft:stone"));\nplayer.gameMode();';
  const r3 = ENG.convert(IR.featureFromCode(misc, { targetId: 'fabric-26.3' }), { targetId: 'forge-1.20.1' });
  const code3 = r3.result.content.java[0].code;
  ok(code3.includes('ResourceLocation.parse'), 'Identifier → ResourceLocation');
  ok(code3.includes('BuiltInRegistries.ITEM.get('), 'getValue → get');
  ok(code3.includes('player.gameMode.getGameModeForPlayer()'), 'gameMode() → gameMode.getGameModeForPlayer()');
  ok(r3.items.some((i) => i.status === 'adapted'), '符号替换标 adapted 而不是 ported');
  ok(r3.result.requires.platform[0] === 'forge' && r3.result.requires.mcVersion[0] === '1.20.1', '适用范围已改成目标');
}

console.log('\n[4] 没证据的绝不假装转好');
{
  const e = IR.featureFromEffect('attack_lifesteal');
  const r = ENG.convert(e, { targetId: 'forge-1.20.1' });
  const manual = r.items.find((i) => i.status === 'manual' && i.label.includes('伤害'));
  ok(!!manual, 'Fabric 专属事件标 manual');
  ok((manual?.notes || []).join('').includes('LivingDamageEvent'), '给了目标平台的等价概念');
  ok(!!manual?.suggestion, '给了下一步做法');
  ok(r.result.content.java[0].code.includes('// TODO(转换)'), '代码里写了 TODO');
  ok(r.result.content.java[0].code.includes('ServerLivingEntityEvents'), '原代码没被硬改坏');
  ok(r.needsReview >= 1 && r.summary.manual >= 1, '报告明确算出需复核项');
  ok(r.summary.autoRate < 100, '自动率不谎报 100%');

  const blockedFeature = IR.blankFeature({ id: 'ghost', targetId: 'fabric-26.3' });
  blockedFeature.content.programs = [{ op: 'event.player_tick', next: { op: 'not.installed.block', inputs: {}, fields: {} } }];
  const rb = ENG.convert(blockedFeature, { targetId: 'forge-1.20.1' });
  ok(rb.items.some((i) => i.status === 'blocked'), '目标没有实现的积木标 blocked');

  const portableFeature = IR.blankFeature({ id: 'portable', targetId: 'fabric-26.3' });
  portableFeature.content.entries.item = [{ id: 'ruby', nameZh: '红宝石' }];
  portableFeature.content.programs = [{ op: 'event.player_tick', next: { op: 'player.heal', inputs: {}, fields: {} } }];
  const rp = ENG.convert(portableFeature, { targetId: 'forge-1.20.1' });
  ok(rp.items.some((i) => i.kind === 'entry' && i.status === 'ported'), '内容条目天生可移植');
  ok(rp.items.some((i) => i.kind === 'program' && i.status === 'ported'), '积木程序天生可移植');

  const bad = ENG.convert(IR.featureFromCode('int a=1;', { targetId: 'fabric-26.3' }), { targetId: 'not-a-target' });
  ok(bad.ok === false && bad.errors.length > 0, '未知目标明确报错，不当成功');
}

console.log('\n[5] 资源方言 / 自定义规则 / 报告契约');
{
  const f = IR.blankFeature({ id: 'assets', targetId: 'fabric-26.3' });
  f.content.files = [
    { path: 'src/main/resources/data/ns/recipe/ruby.json', content: '{"result":{"id":"ns:ruby","count":1}}' },
    { path: 'src/main/resources/data/ns/loot_table/blocks/ruby.json', content: '{"modifier":[{"type": "minecraft:explosion_decay"}]}' },
    { path: 'src/main/resources/assets/ns/items/ruby.json', content: '{}' },
  ];
  const r = ENG.convert(f, { targetId: 'forge-1.20.1' });
  const paths = r.result.content.files.map((x) => x.path).join('|');
  ok(paths.includes('/recipes/'), 'recipe → recipes');
  ok(paths.includes('/loot_tables/'), 'loot_table → loot_tables');
  ok(paths.includes('/models/item/'), 'items → models/item');
  ok(!paths.includes('/tags/models/item/'), '路径替换没有误伤其它目录');
  const loot = r.result.content.files.find((x) => x.path.includes('loot_tables'));
  ok(loot.content.includes('"functions"') && loot.content.includes('"function"'), '战利品表键名跟着换');
  const recipe = r.result.content.files.find((x) => x.path.includes('recipes'));
  ok(recipe.content.includes('"item"'), '配方结果 id → item');
  ok(r.items.some((i) => i.kind === 'file' && i.status === 'adapted'), '方言改写标 adapted');

  const demo = IR.featureFromCode('com.example.fabric.MyApi.doThing();', { targetId: 'fabric-26.3' });
  const rd = ENG.convert(demo, { targetId: 'forge-1.20.1' });
  ok(rd.result.content.java[0].code.includes('com.example.forge.MyApi'), '外部示例规则真的生效了');
  ok(rd.items.some((i) => i.rule === 'example.myapi'), '报告标出是外部规则做的');

  const allowed = ['ported', 'adapted', 'manual', 'blocked'];
  ok(rd.items.every((i) => allowed.includes(i.status)), '状态只在四档里');
  ok(rd.summary.total === rd.items.length, 'summary.total 与条目数一致');
  ok(rd.summary.coverage <= 100 && rd.summary.autoRate <= 100, '覆盖率不超过 100');
  ok(ENG.convertedJava(rd).includes('com.example.forge.MyApi'), 'CLI 输出能取到转换后的 Java');

  const m = ENG.conversionMatrix();
  ok(m.targets.length >= 2, '能力矩阵列出所有目标');
  const pair = m.pairs.find((p) => p.from === 'fabric-26.3' && p.to === 'forge-1.20.1');
  ok(pair?.verifiedTemplates >= 4 && pair?.symbolGroups >= 4, '矩阵统计出有证据的映射数');
  ok(pair?.crossLoader === true, '跨加载器被标出来');
}

console.log('\n[6] CLI：预览只读 / 应用要确认 / 写文件');
{
  const src = path.join(tmp, 'cli.java');
  fs.writeFileSync(src, 'player.sendSystemMessage(net.minecraft.network.chat.Component.literal("hi"), false);', 'utf8');
  const out = path.join(tmp, 'out.java');
  const run = await CLI.convertCommand('run', [src, '--to', 'forge-1.20.1', '--from', 'fabric-26.3', '--out', out]);
  ok(run.exitCode === 0, 'run 退出码 0');
  ok(run.data.ok, 'run 结构化结果 ok');
  ok(fs.existsSync(out) && fs.readFileSync(out, 'utf8').includes('displayClientMessage'), '--out 写出转换后的 Java');
  const jrun = await CLI.convertCommand('run', [src, '--to', 'forge-1.20.1', '--json']);
  ok(jrun.lines.length === 0 && jrun.data.summary, '--json 只给结构化结果');
  ok((await CLI.convertCommand('rules', ['--json'])).data.rules.some((r) => r.id === 'example.myapi'), 'rules 列出外部规则');
  ok((await CLI.convertCommand('matrix', ['--json'])).data.pairs.length >= 2, 'matrix 给出方向清单');

  const dir = makeProject('cliproj', 'fabric-26.3', (p) => {
    p.hooks.java = [{ name: '打招呼', target: 'init', code: 'player.sendSystemMessage(net.minecraft.network.chat.Component.literal("hi"), false);' }];
  });
  const noYes = await CLI.convertCommand('apply', [dir, '--to', 'forge-1.20.1']);
  ok(noYes.exitCode === 1, '没 --yes 一律拒绝');
  ok(P.loadProject(dir).target.id === 'fabric-26.3', '拒绝时工程没被动过');
  const applied = await CLI.convertCommand('apply', [dir, '--to', 'forge-1.20.1', '--yes']);
  ok(applied.exitCode === 0 && applied.data.ok, '带 --yes 应用成功');
  const after = P.loadProject(dir);
  ok(after.target.id === 'forge-1.20.1' && after.target.javaVersion === 17, '目标整体切到 Forge（含 JDK 默认值）');
  ok(after.hooks.java[0].code.includes('displayClientMessage'), '钩子写回转换后的 Java');
  ok(after.state.convert?.from === 'fabric-26.3', '工程里留了转换记录');
}

console.log('\n[7] HTTP 路由：只读预览 / 显式确认才写盘');
{
  let r = await call('convert/rules', 'GET');
  ok(r.status === 200 && r.data.rules.length >= 7, 'convert/rules 返回规则');
  r = await call('convert/matrix', 'GET');
  ok(r.status === 200 && r.data.matrix.pairs.length >= 2, 'convert/matrix 返回矩阵');
  r = await call('convert/inspect', 'POST', { source: { type: 'effect', id: 'attack_lifesteal' } });
  ok(r.status === 200 && r.data.summary.byKind.java >= 1, 'convert/inspect 抽出 IR');
  r = await call('convert/preview', 'POST', { source: { type: 'code', code: 'player.gameMode();', from: 'fabric-26.3' }, to: 'forge-1.20.1' });
  ok(r.status === 200 && r.data.report.ok, 'convert/preview 返回报告');
  ok(r.data.java.includes('gameMode.getGameModeForPlayer()'), '预览附带转换后 Java');
  r = await call('convert/preview', 'POST', { source: { type: 'code', code: 'int a=1;', from: 'fabric-26.3' }, to: 'nope' });
  ok(r.status === 400 && r.data.error, '未知目标返回 400');

  const dir = makeProject('httpproj', 'fabric-26.3', (p) => {
    p.hooks.java = [{ name: '打招呼', target: 'init', code: 'player.gameMode();' }];
  });
  r = await call('convert/apply', 'POST', { root: dir, to: 'forge-1.20.1' });
  ok(r.status === 400 && P.loadProject(dir).target.id === 'fabric-26.3', '没确认不写盘');
  r = await call('convert/apply', 'POST', { root: dir, to: 'forge-1.20.1', confirmed: true });
  ok(r.status === 200 && r.data.applied.ok, '确认后应用成功');
  ok(P.loadProject(dir).hooks.java[0].code.includes('getGameModeForPlayer'), '确认后钩子被改写');

  // 非工程来源：往现有工程里加一段，而不是把已有钩子清掉
  const dir2 = makeProject('httpproj2', 'fabric-26.3', (p) => {
    p.hooks.java = [{ name: '已有钩子', target: 'init', code: 'player.heal(1);' }];
  });
  r = await call('convert/apply', 'POST', {
    root: dir2, to: 'forge-1.20.1', confirmed: true,
    source: { type: 'code', code: 'player.gameMode();', from: 'fabric-26.3' },
  });
  ok(r.status === 200, '外部来源也能应用');
  const p2 = P.loadProject(dir2);
  ok(p2.hooks.java.length === 2 && p2.hooks.java.some((h) => h.code.includes('player.heal')), '原有钩子没被覆盖');
}

console.log('\n[8] 应用后能按新目标重出资源');
{
  // 钩子插在 init 方法体里，没有 player / level 这种局部变量，
  // 所以夹具用「静态调用」写法；同时它正好覆盖一组真实的跨加载器符号映射。
  const SRC_HOOK = 'net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(net.minecraft.resources.Identifier.parse("minecraft:stone"));';
  const dir = makeProject('genproj', 'fabric-26.3', (p) => {
    p.hooks.java = [{ name: '按 id 取物品', target: 'init', code: SRC_HOOK }];
  });
  const report = ENG.convert(IR.featureFromProject(dir), { targetId: 'forge-1.20.1' });
  ok(report.items.some((i) => i.status === 'adapted'), '这段钩子确实被自动改写过');
  ENG.applyConversion(dir, report, { confirmed: true });
  let threw = null;
  let files = [];
  try { files = await PIPE.preview(dir); } catch (e) { threw = e; }
  ok(!threw, 'Forge 目标能跑生成预览', threw?.message);
  const paths = files.map((f) => f.path || f.rel || '').join('|');
  ok(paths.includes('META-INF/mods.toml'), '生成的是 Forge 元数据');
  ok(!paths.includes('fabric.mod.json'), '不再生成 Fabric 元数据');
  const allJava = files.map((f) => String(f.content || '')).join('\n');
  ok(allJava.includes('ResourceLocation.parse') && allJava.includes('BuiltInRegistries.ITEM.get('), '转换后的代码进了生成的 Java');
  ok(!allJava.includes('Identifier.parse'), '生成结果里没有残留 Fabric 写法');

  if (DO_BUILD) {
    const reportGen = await PIPE.generate(dir);
    ok(reportGen.errors.length === 0, '生成没有报错', reportGen.errors.join('；'));
    const wrapper = process.platform === 'win32' ? path.join(dir, 'gradlew.bat') : './gradlew';
    const r = spawnSync(wrapper, ['build', '--no-daemon', '--console=plain'], {
      cwd: dir, encoding: 'utf8', timeout: 10 * 60 * 1000, shell: process.platform === 'win32',
    });
    const errs = (r.stdout || '').split('\n').filter((l) => /error:|错误:|cannot find symbol/.test(l)).slice(0, 6);
    ok(r.status === 0, '转换后的 Forge 工程 Gradle 真编译通过', errs.join(' | ') || (r.stdout || '').slice(-300));
  } else {
    console.log('  · 跳过真编译（加 --build 才会跑 Gradle）');
  }
}

console.log('\n[9] 收尾');
{
  ok(REG.convertDiagnostics().filter((d) => !d.includes('broken.mjs')).length === 0, '除故意的坏规则外无其它加载问题');
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(!fs.existsSync(tmp), '临时目录已清理');
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
