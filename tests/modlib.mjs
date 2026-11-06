/**
 * mod → 积木库 的单元测试。
 *
 * 跑法：node tests/modlib.mjs
 *
 * 这里不用真的 mod jar（那要几百 MB 且依赖外部文件），
 * 而是用「假报告」喂给同一个入口 —— 走的是生产代码路径，
 * 只是数据是造出来的。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryFromReport, scanApiBlocks, parseMethodDesc,
  targetOfMod, detectTargetByApi, KNOWN_TARGETS,
} from '../core/visual/modlib.mjs';
import { registerBlocks, clearBlocks, getBlock } from '../core/visual/blocks.mjs';
import { validateLibrary, installLibrary } from '../core/visual/library.mjs';
import { compileProgram, compileProject } from '../core/visual/compile.mjs';
import { ensureBuiltin } from '../core/visual/registry.mjs';
import { block, value } from '../core/visual/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

/** 造一个假的分析报告 */
function fakeReport(over = {}) {
  return {
    meta: {
      loader: 'forge',
      id: 'mymod',
      name: '我的模组',
      version: '1.0.0',
      mcVersion: '1.20.1',
      loaderVersion: '[47,)',
    },
    mainNs: 'mymod',
    contents: {
      item: [
        { id: 'core', ns: 'mymod', nameZh: '核心' },
        { id: 'dust', ns: 'mymod', nameZh: '粉尘' },
      ],
      block: [
        { id: 'machine', ns: 'mymod', nameZh: '机器' },
      ],
      statusEffect: [
        { id: 'bless', registryId: 'mymod:bless', nameZh: '祝福' },
      ],
    },
    effects: ['regen'],
    ...over,
  };
}

console.log('\n[1] 方法描述符解析');
{
  const d = parseMethodDesc('(Lnet/minecraft/world/entity/Entity;DFI)Ljava/lang/String;');
  ok(d.params.length === 4, '参数个数对', d.params.join(' | '));
  ok(d.params[0] === 'Lnet/minecraft/world/entity/Entity;', '对象参数保留完整描述符');
  ok(d.params[1] === 'D' && d.params[2] === 'F' && d.params[3] === 'I', '基本类型参数');
  ok(d.ret === 'Ljava/lang/String;', '返回值对', d.ret);
  const e = parseMethodDesc('()V');
  ok(e.params.length === 0 && e.ret === 'V', '无参无返回值');
}

console.log('\n[2] 认出目标');
{
  const t = targetOfMod({ loader: 'forge', mcVersion: '1.20.1' });
  ok(t && t.id === 'forge-1.20.1', 'Forge + 1.20.1 → forge-1.20.1', t?.id);
  // mods.toml 里 ${minecraft_version_range} 没被替换的情况
  const t2 = targetOfMod({ loader: 'forge', mcVersion: '', loaderVersion: '[47,)' });
  ok(t2 && t2.id === 'forge-1.20.1', '靠 loaderVersion 也能认出', `${t2?.id}（${t2?.how}）`);
  const t3 = targetOfMod({ loader: 'fabric', mcVersion: '26.3' });
  ok(t3 && t3.id === 'fabric-26.3', 'Fabric + 26.3 → fabric-26.3', t3?.id);
  ok(!targetOfMod({ loader: 'quilt', mcVersion: '1.16.5' }), '认不出的目标返回 null');
}

console.log('\n[3] 报告 → 积木库');
{
  const { library, warnings, target } = libraryFromReport(fakeReport());
  ok(target === 'forge-1.20.1', '目标识别正确', target);
  ok(library.format === 'mcblocks', '格式标识对');
  ok(library.blocks.length >= 3, '出了数据型积木（物品/方块/效果各一条）', `${library.blocks.length} 条`);
  const give = library.blocks.find((b) => b.id === 'mymod.item.give');
  ok(!!give, '有「给物品」积木');
  ok(give.java['forge-1.20.1'].includes('BuiltInRegistries.ITEM.get('), '用原版注册表取物品');
  ok(give.java['forge-1.20.1'].includes('ResourceLocation.parse(%item)'), 'Forge 用 ResourceLocation.parse');
  ok(!give.java['forge-1.20.1'].includes('Identifier'), 'Forge 不用 26.3 的 Identifier');
  const setb = library.blocks.find((b) => b.id === 'mymod.block.set');
  ok(!!setb && setb.java['forge-1.20.1'].includes('BuiltInRegistries.BLOCK.get('), '有「设方块」积木');
  const eff = library.blocks.find((b) => b.id === 'mymod.effect.apply');
  ok(!!eff && eff.java['forge-1.20.1'].includes('MobEffectInstance'), '有「加效果」积木');
  ok(eff.java['forge-1.20.1'].includes('BuiltInRegistries.MOB_EFFECT'), '效果也走注册表');
  // 菜单项要带中文显示名
  const opt = give.fields[0].options[0];
  ok(opt && typeof opt === 'object' && opt.label === '核心', '菜单项带中文名', JSON.stringify(opt));
  ok(Array.isArray(warnings), '有提示信息', warnings.length);
}

console.log('\n[4] 26.3 目标的模板不一样');
{
  const rep = fakeReport({ meta: { loader: 'fabric', id: 'mymod', name: '我的模组', mcVersion: '26.3' } });
  const { library } = libraryFromReport(rep);
  const give = library.blocks.find((b) => b.id === 'mymod.item.give');
  ok(give.java['fabric-26.3'].includes('Identifier.parse'), '26.3 用 Identifier.parse');
  ok(give.java['fabric-26.3'].includes('getValue('), '26.3 用 Registry.getValue');
  const eff = library.blocks.find((b) => b.id === 'mymod.effect.apply');
  ok(eff.java['fabric-26.3'].includes('Holder<net.minecraft.world.effect.MobEffect>'), '26.3 的 MobEffectInstance 收 Holder');
}

console.log('\n[5] 生成的库能装、能编译');
{
  clearBlocks();
  ensureBuiltin();
  const { library } = libraryFromReport(fakeReport());
  const v = validateLibrary(library);
  ok(v.ok, '库校验通过', v.errors.join('；'));
  const inst = installLibrary(library);
  ok(inst.ok, '装库成功', inst.errors.join('；'));
  ok(getBlock('mymod.item.give') != null, '积木已注册');

  const prog = block('event.player_rightclick_block', {
    next: block('mymod.item.give', {
      inputs: { count: value('number', 3) },
      fields: { item: 'mymod:core' },
    }),
  });
  const r = compileProgram(prog, { targetId: 'forge-1.20.1' });
  ok(r.ok, '积木能编译', r.errors.join('；'));
  ok(r.code.includes('"mymod:core"'), '菜单值被填进 Java', r.code.match(/ResourceLocation\.parse\(.*/)?.[0]);
  ok(r.code.includes('player.getInventory().add(give)'), '给了玩家');
}

console.log('\n[6] 菜单选项支持 {value,label}');
{
  clearBlocks();
  ensureBuiltin();
  const { library } = libraryFromReport(fakeReport());
  registerBlocks(library.blocks, { source: 'test', overwrite: true });
  const prog = block('event.player_rightclick_block', {
    next: block('mymod.block.set', {
      inputs: { x: value('number', 1), y: value('number', 2), z: value('number', 3) },
      // 直接喂对象选项（界面上就是这么存的）
      fields: { block: { value: 'mymod:machine', label: '机器' } },
    }),
  });
  const r = compileProgram(prog, { targetId: 'forge-1.20.1' });
  ok(r.ok, '编译成功', r.errors.join('；'));
  ok(r.code.includes('"mymod:machine"'), '用的是 value 而不是 label', r.code.match(/ResourceLocation\.parse\(.*/)?.[0]);
}

console.log('\n[7] 认不出的目标不乱给模板');
{
  const rep = fakeReport({ meta: { loader: 'quilt', id: 'mymod', name: 'X', mcVersion: '1.16.5' } });
  const { library, warnings } = libraryFromReport(rep);
  ok(library.blocks.length === 0, '没生成积木', `${library.blocks.length} 条`);
  ok(warnings.some((w) => w.includes('没认出')), '给了提示');
}

console.log('\n[8] 行为型积木（扫 public static 方法）');
{
  // 用真的 class 文件做夹具（tests/fixtures/classes）
  const classPath = path.join(HERE, 'fixtures', 'classes', 'com', 'example', 'util', 'Tool.class');
  ok(fs.existsSync(classPath), '夹具 class 存在');
  const bytes = fs.readFileSync(classPath);
  const fakeSrc = {
    allNames: ['com/example/util/Tool.class'],
    read: () => bytes,
  };
  const r = scanApiBlocks(fakeSrc, { ns: 'demo', targetId: 'forge-1.20.1', modName: '演示' });
  ok(r.blocks.length > 0, '扫出了方法', `${r.blocks.length} 条`);
  const ids = r.blocks.map((b) => b.id);
  ok(ids.includes('demo.api.Tool.damage'), '有 damage 方法', ids.join(', '));
  ok(ids.includes('demo.api.Tool.reset'), '有 reset 方法');
  ok(!ids.some((i) => /protectedOne|notStatic|hidden/.test(i)),
    'protected / 非 static / 无参方法被过滤', ids.join(', '));
  const damage = r.blocks.find((b) => b.id === 'demo.api.Tool.damage');
  ok(damage.shape === 'reporter', '有返回值的做成 reporter', damage.shape);
  ok(damage.inputs.length === 1, '实体参数不吃掉槽位，只留数字参数', JSON.stringify(damage.inputs));
  ok(damage.java['forge-1.20.1'].includes('com.example.util.Tool.damage(player, %num1)'),
    '实体参数映射成 player', damage.java['forge-1.20.1']);
  ok(damage.unverified === true, '标了 unverified');
}

console.log('\n[9] Goety 专属积木包');
{
  // 造一个「像 Goety」的报告：mod id 是 goety，物品里有聚晶和法杖
  const goetyReport = fakeReport({
    meta: { loader: 'forge', id: 'goety', name: 'Goety', version: '2.5.55.4', mcVersion: '', loaderVersion: '[47,)' },
    mainNs: 'goety',
    contents: {
      item: [
        { id: 'arrow_rain_focus', ns: 'goety', nameZh: '箭雨聚晶' },
        { id: 'bulwark_focus', ns: 'goety', nameZh: '壁垒聚晶' },
        { id: 'dark_wand', ns: 'goety', nameZh: '黑暗魔杖' },
      ],
      block: [],
      statusEffect: [],
      spell: [
        { id: 'arrow_rain', nameZh: '箭雨聚晶' },
        { id: 'bulwark', nameZh: '壁垒聚晶' },
      ],
    },
  });

  const { library, warnings, target } = libraryFromReport(goetyReport, { withApi: false });
  ok(target === 'forge-1.20.1', '目标识别正确', target);
  const pack = library.blocks.filter((b) => /^goety\.(spell|soul|focus|wand)\./.test(b.id));
  ok(pack.length >= 8, '专属积木已生成', `${pack.length} 条`);
  ok(pack.every((b) => b.requiresMod === 'goety'), '都标了 requiresMod=goety');
  ok(pack.every((b) => b.java['forge-1.20.1']), '都有 Forge 1.20.1 的实现');
  ok(pack.every((b) => !b.java['fabric-26.3']), '不给 Fabric 目标乱写模板');
  ok(warnings.some((w) => w.includes('Goety 专属积木')), '给了提示', warnings.join(' | '));

  // 聚晶菜单应该带中文名
  const focus = pack.find((b) => b.id === 'goety.focus.give');
  ok(!!focus, '有「给聚晶」积木');
  const fopt = focus.fields.find((f) => f.name === 'focus');
  ok(fopt.options.length === 2, '两个聚晶都在菜单里', `${fopt.options.length} 个`);
  ok(fopt.options[0].label === '箭雨聚晶', '菜单显示中文名', JSON.stringify(fopt.options[0]));
  ok(fopt.options[0].value === 'goety:arrow_rain_focus', '菜单值是注册表 id', JSON.stringify(fopt.options[0]));

  // 法杖菜单同理
  const wand = pack.find((b) => b.id === 'goety.wand.give');
  ok(!!wand, '有「给法杖」积木');
  ok(wand.fields[0].options[0].value === 'goety:dark_wand', '法杖菜单值是注册表 id');

  // 装库 + 编译：生成的 Java 要引用 Goety 的类
  clearBlocks();
  ensureBuiltin();
  const inst = installLibrary(library);
  ok(inst.ok, '装库成功', inst.errors.join('；'));
  const prog = block('event.item_use', {
    next: block('goety.spell.cast'),
  });
  const r = compileProgram(prog, { targetId: 'forge-1.20.1' });
  ok(r.ok, 'Goety 积木能编译', r.errors.join('；'));
  ok(r.code.includes('com.Polarice3.Goety.utils.WandUtil.getSpell(player)'), '调用了 Goety 的 API');
  ok(r.code.includes('useSpell('), '调用了施法接口');
  ok(!r.code.includes('%'), '没有未替换的占位符');
}

console.log('\n[10] 非 Goety 的 mod 不会拿到专属包');
{
  const { library } = libraryFromReport(fakeReport(), { withApi: false });
  ok(!library.blocks.some((b) => b.id.startsWith('goety.')), '没有 Goety 积木');
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
