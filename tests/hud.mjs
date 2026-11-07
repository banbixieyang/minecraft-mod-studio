/**
 * 自定义 HUD 面板：验证双目标都生成了可编译的 ModHud.java、配置文件模板，
 * 以及 Fabric 的 fabric.mod.json 在存在 HUD 条目时注册了 client.ModHud 入口。
 *
 * 跑法：node tests/hud.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { createProject, loadProject } from '../core/project.mjs';
import { collect } from '../core/generator/pipeline.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
};

const ROOT = path.resolve('.');

const HUDS = [
  { id: 'status', title: '我的状态', anchor: 'top_left', vars: ['health', 'pos_x', 'pos_z'], toggleKey: 'KEY_H', visible: true, bgColor: '#000000AA', textColor: '#FFFFFFFF' },
  { id: 'debug', title: '调试', anchor: 'bottom_right', vars: ['game_mode', 'pos_y'], toggleKey: 'KEY_B', visible: false, bgColor: '#00000080', textColor: '#FFFFFFEE' },
];

for (const target of [
  { id: 'hudfab263', dir: 'hudfab263', target: 'fabric-26.3', pkg: 'com.test.hudfab' },
  { id: 'hudfor1201', dir: 'hudfor1201', target: 'forge-1.20.1', pkg: 'com.test.hudfor' },
]) {
  const root = path.join(ROOT, 'projects', target.dir);
  fs.rmSync(root, { recursive: true, force: true });
  createProject(root, {
    id: target.id, name: 'HUD 测试', pkg: target.pkg, version: '0.1.0', target: target.target,
  });
  const p = loadProject(root);
  p.entries = { hud: HUDS.map((h) => ({ ...h })) };

  let files;
  try {
    files = await collect(p, {});
  } catch (e) {
    console.log(`\n[${target.dir}] collect 抛错：${e.message}`);
    fail++; continue;
  }
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  const find = (sub) => Object.entries(byPath).find(([k]) => k.includes(sub));

  console.log(`\n[${target.dir}]`);

  const java = find('client/ModHud.java');
  ok(!!java, '生成了 client/ModHud.java');
  if (!java) continue;
  const src = java[1];

  if (target.target === 'fabric-26.3') {
    ok(src.includes('HudRenderCallback') && src.includes('implements ClientModInitializer'), 'Fabric 用 HudRenderCallback 挂客户端初始化');
    ok(src.includes('status') && src.includes('debug'), '两个面板都进了一个 ModHud 类');
    ok(src.includes('getHealth()') && src.includes('player.getX()'), '读取了生命值 / 坐标变量');
    ok(src.includes('InputConstants.KEY_H') && src.includes('InputConstants.KEY_B'), '两个切换键常量都生成了');
  } else {
    ok(src.includes('RenderGuiEvent') && src.includes('@Mod.EventBusSubscriber'), 'Forge 用 RenderGuiEvent + 事件总线订阅');
    ok(src.includes('RegisterKeyMappingsEvent'), 'Forge 在 MOD 总线注册键位');
    ok(src.includes('status') && src.includes('debug'), '两个面板都进了一个 ModHud 类');
    ok(src.includes('player.gameMode.getName()'), '读取了游戏模式变量（客户端写法）');
    ok(src.includes('GLFW.GLFW_KEY_H') && src.includes('GLFW.GLFW_KEY_B'), '两个切换键常量都生成了');
  }

  // 配置文件模板
  const cfg = find(`hud/status.properties`);
  ok(!!cfg, '生成了 config/<ns>/hud/status.properties 模板');
  if (cfg) {
    ok(cfg[1].includes('vars=health,pos_x,pos_z'), '配置文件含选中的变量列表');
    ok(cfg[1].includes('visible=true'), '配置文件含 visible 默认值');
  }

  // Fabric 入口注册
  if (target.target === 'fabric-26.3') {
    const modjson = find('fabric.mod.json');
    ok(!!modjson, '生成了 fabric.mod.json');
    if (modjson) {
      const mj = JSON.parse(modjson[1]);
      ok(Array.isArray(mj.entrypoints?.client) && mj.entrypoints.client.includes(`${target.pkg}.client.ModHud`),
        'fabric.mod.json 注册了 client.ModHud 入口');
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 通过，${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
