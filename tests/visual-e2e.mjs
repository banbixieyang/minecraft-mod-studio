/**
 * 界面搭的程序 → 真编译。
 *
 * 这个测试专门验证「界面操作的结果」能一路走到 javac：
 *   1. 用 UI 层的数据形态造程序（跟 ui/visual.js 存进工程的一模一样）
 *   2. 走工程生成管线
 *   3. 真跑 Gradle / javac
 *
 * 跟 tests/visual-build.mjs 的区别：那个用手写的程序数据，
 * 这个专门覆盖**界面特有的数据结构**（比如 body 里的条件槽是
 * {type:'value',kind:'boolean'} 而不是积木）。
 *
 * 跑法：
 *   node tests/visual-e2e.mjs                  # Fabric 26.3
 *   node tests/visual-e2e.mjs --target forge-1.20.1
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as P from '../core/project.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { ensureBuiltin } from '../core/visual/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const targetArg = args.indexOf('--target');
const TARGET = targetArg >= 0 ? args[targetArg + 1] : 'fabric-26.3';

let pass = 0;
let fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '  (' + extra + ')' : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  (' + extra + ')' : ''}`); }
}

/**
 * 界面层造的程序。
 *
 * 刻意覆盖界面上真实会出现的几种形态：
 *   · 事件帽 + next 链
 *   · 条件槽是「真/假」按钮（{type:'value',kind:'boolean'}），不是积木
 *   · body 容器里放语句
 *   · 嵌套：body 里的 if 又有 body
 *   · 下拉字段（mode）
 */
function uiPrograms() {
  return [
    {
      op: 'event.player_rightclick_block',
      methodName: 'on_player_rightclick_block',
      inputs: {},
      fields: {},
      body: [],
      next: {
        op: 'player.message',
        inputs: { text: { type: 'value', kind: 'text', value: '小朋友你好' } },
        fields: { mode: '聊天栏' },
        next: {
          op: 'flow.if',
          // 条件槽是「真/假」按钮 —— 界面上点一下就是 false
          inputs: { cond: { type: 'value', kind: 'boolean', value: false } },
          fields: {},
          body: [
            {
              op: 'player.heal',
              inputs: { amount: { type: 'value', kind: 'number', value: 5 } },
              fields: {},
            },
            {
              op: 'flow.if_else',
              inputs: { cond: { type: 'value', kind: 'boolean', value: true } },
              fields: {},
              body: [
                {
                  op: 'player.set_gamemode',
                  inputs: {},
                  fields: { mode: 'CREATIVE' },
                },
              ],
              elseBody: [
                {
                  op: 'player.teleport',
                  inputs: {
                    x: { type: 'value', kind: 'number', value: 0 },
                    y: { type: 'value', kind: 'number', value: 64 },
                    z: { type: 'value', kind: 'number', value: 0 },
                  },
                  fields: {},
                },
              ],
            },
          ],
        },
      },
    },
  ];
}

console.log(`\n=== 界面程序真编译（${TARGET}）===`);

ensureBuiltin();

const projDir = fs.mkdtempSync(path.join(os.tmpdir(), `mcstudio-vbe2e-${TARGET}-`));
const meta = {
  name: '界面积木验证',
  id: 'visualuie2e',
  pkg: 'com.example.visualuie2e',
  version: '0.1.0',
  // ⚠️ target 要给完整的目标 id —— createProject 会自动从适配器取全套
  //    defaults（javaVersion / loaderVersion 等）。
  //    少一个都会让脚手架生成出坏 build.gradle（javaVersion undefined）。
  target: TARGET,
};

// createProject 会从适配器补全 target 的全部字段
P.createProject(projDir, meta);
const data = P.loadProject(projDir);
data.visual = { programs: uiPrograms(), libraries: [] };
P.saveProject(projDir, data);

// ---------- 生成 ----------
console.log('\n[1] 生成');
const rep = await generate(projDir);
ok(rep.ok !== false, '生成成功', (rep.errors || []).join('；'));

const logicFile = path.join(
  projDir,
  'src/main/java/com/example/visualuie2e/custom/ModLogic.java',
);
ok(fs.existsSync(logicFile), '生成了 ModLogic.java');
if (fs.existsSync(logicFile)) {
  const code = fs.readFileSync(logicFile, 'utf8');
  ok(code.includes('on_player_rightclick_block'), '含事件方法');
  ok(code.includes('"小朋友你好"'), '含用户改过的文字');
  ok(/player\.heal\(5\)/.test(code), '含 body 里的治疗');
  ok(/setGameMode\(/.test(code), '含 else 分支的游戏模式设置');
  ok(/player\.teleportTo\(/.test(code), '含 elseBody 里的传送');
  ok(!/%\w+/.test(code.replace(/%[A-Z]/g, '')), '没有未替换的占位符');
}

// ---------- 真编译 ----------
console.log('\n[2] Gradle 真编译');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const cmd = fs.existsSync(path.join(projDir, gradlew))
  ? gradlew
  : (fs.existsSync(path.join(projDir, 'gradlew')) ? './gradlew' : null);

if (!cmd) {
  ok(false, '找不到 gradlew —— 脚手架没生成？');
} else {
  const r = spawnSync(cmd, ['build', '--no-daemon', '--console=plain'], {
    cwd: projDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 600000,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  ok(r.status === 0, 'Gradle 编译通过', `${(out.match(/BUILD (SUCCESSFUL|FAILED)/) || [])[0] || `退出码 ${r.status}`}`);
  if (r.status !== 0) {
    console.log('\n--- 编译输出（末尾 40 行）---');
    console.log(out.split('\n').slice(-40).join('\n'));
  }
}

fs.rmSync(projDir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '全部通过' : `有 ${fail} 项失败`}（${pass} 项通过）`);
process.exit(fail === 0 ? 0 : 1);
