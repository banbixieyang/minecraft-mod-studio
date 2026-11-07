/**
 * 可视化积木 → 生成产物。
 *
 * 产出两个东西：
 *   1. ModLogic.java —— 积木编译出的方法体（每次生成覆盖）
 *   2. 事件接线 —— 帽形积木对应的回调注册（写进 ModLogic 的 init 里）
 *
 * 事件接线按目标分派：Fabric 用 ServerLifecycleEvents / AttackEntityCallback，
 * Forge 用 @SubscribeEvent。两套写法不同，所以放在各自的目标适配器里。
 */
import { compileProject } from '../visual/compile.mjs';
import { ensureBuiltin, loadLibraries } from '../visual/registry.mjs';

/** 事件接线表：帽形积木 id → 目标适配器里的接线函数名 */
export const EVENT_HOOKS = {
  'event.player_rightclick_block': 'rightclickBlock',
  'event.entity_attack': 'attackEntity',
  'event.player_tick': 'playerTick',
  'event.server_tick': 'serverTick',
  'event.block_break': 'blockBreak',
  'event.item_use': 'itemUse',
  'event.key_pressed': 'keyPressed',
};

/** 工程里有没有任何积木程序（全局的 + 条目自带的） */
function hasAnyProgram(p) {
  if ((p?.visual?.programs || []).some((x) => x && x.op)) return true;
  for (const type of ['item', 'block']) {
    for (const e of p?.entries?.[type] || []) {
      if ((e?.visualPrograms || []).some((x) => x && x.op)) return true;
    }
  }
  return false;
}

/**
 * 生成积木产物。
 * @param {object} p 工程数据
 * @param {object} adapter 目标适配器
 */
export function genVisual(p, adapter) {
  const programs = p?.visual?.programs || [];
  // 条目自带程序（entry.visualPrograms）也要能触发生成 —— 否则「只有条目级程序、
  // 没有全局程序」的工程会一行代码都不生成。
  if (!hasAnyProgram(p)) return [];

  ensureBuiltin();
  loadLibraries(p.__root || null);

  const targetId = p.target?.id || adapter.id || 'fabric-26.3';
  const pkg = p.meta.pkg;
  const r = compileProject(p, { targetId, pkg });
  if (!r.files.length) return [];

  const file = r.files[0];
  // compiled 里带每个程序实际生成的方法名 —— 接线必须调到正确的名字
  const wiring = adapter.visualWiring
    ? adapter.visualWiring(p, { programs, compiled: r.compiled, EVENT_HOOKS })
    : '';

  let content = file.content;
  if (wiring) {
    // wiring 形如「init 方法 + import 块」，分开处理：
    //   init 插进 class 里，import 插到 package 之后。
    const importMatch = wiring.match(/\/\/ --- 积木接线所需的 import ---\n([\s\S]*)$/);
    let initCode = wiring;
    let importCode = '';
    if (importMatch) {
      initCode = wiring.slice(0, importMatch.index).trimEnd();
      importCode = importMatch[1].trim();
    }
    if (initCode) {
      content = content.replace(
        /(\n\s*private ModLogic\(\) \{)/,
        `\n${initCode}\n$1`,
      );
    }
    if (importCode) {
      content = content.replace(
        /^(package [^;]+;\n)/,
        `$1\n${importCode}\n`,
      );
    }
  }

  const files = [{
    path: file.path,
    content,
    reason: '可视化积木编译产物',
  }];

  // 按键事件跑在客户端：额外产出 ModClient.java（注册到游戏「按键设置」的绑定 +
  // 客户端 tick 检测）。目标适配器自己决定写法（Fabric ClientModInitializer /
  // Forge @Mod.EventBusSubscriber）。
  if (adapter.visualClientWiring) {
    const clientFile = adapter.visualClientWiring(p, { compiled: r.compiled });
    if (clientFile) {
      files.push({ path: clientFile.path, content: clientFile.content, reason: '可视化积木：客户端按键接线' });
    }
  }

  return files;
}
