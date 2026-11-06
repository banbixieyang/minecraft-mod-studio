/**
 * 只生成不编译 —— 用来快速肉眼检查生成的 Java 对不对。
 * 用法：node tools/preview-visual.mjs [targetId]
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../core/project.mjs';
import { generate } from '../core/generator/pipeline.mjs';
import { block, value } from '../core/visual/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = process.argv[2] || 'fabric-26.3';

const programs = [
  {
    op: 'event.player_rightclick_block',
    methodName: 'on_rightclick_block',
    next: block('player.message', {
      inputs: { text: value('text', '你好，这是积木生成的消息') },
    }),
  },
  {
    op: 'event.player_tick',
    methodName: 'on_player_tick',
    next: block('flow.if', {
      inputs: {
        cond: block('math.compare', {
          inputs: { a: value('number', 10), b: value('number', 5) },
          fields: { op: '<' },
        }),
      },
      body: [
        block('player.heal', { inputs: { amount: value('number', 5) } }),
        block('player.message', { inputs: { text: value('text', '血量低') } }),
      ],
    }),
  },
  {
    op: 'event.block_break',
    methodName: 'on_block_break',
    next: block('block.set', {
      inputs: {
        x: value('number', 1), y: value('number', 64), z: value('number', 2),
        block: value('blockRef', 'minecraft:stone'),
      },
    }),
  },
  {
    op: 'event.entity_attack',
    methodName: 'on_attack',
    next: block('player.give', {
      inputs: { item: value('item', 'minecraft:apple'), count: value('number', 3) },
    }),
  },
  {
    op: 'event.item_use',
    methodName: 'on_item_use',
    next: block('player.set_gamemode', { fields: { mode: 'CREATIVE' } }),
  },
  {
    op: 'event.server_tick',
    methodName: 'on_server_tick',
    next: block('world.rain', { inputs: { level: value('number', 1) } }),
  },
];

const projDir = path.join(ROOT, 'projects', 'visualpreview');
fs.rmSync(projDir, { recursive: true, force: true });
P.createProject(projDir, {
  name: '积木预览', id: 'visualpreview',
  pkg: 'com.example.visualpreview', version: '0.1.0', target: TARGET,
});
const p = P.loadProject(projDir);
p.visual = { programs, libraries: [] };
P.saveProject(projDir, p);

await generate(projDir);

const f = path.join(projDir, 'src/main/java/com/example/visualpreview/custom/ModLogic.java');
console.log(`\n===== ${TARGET} : ModLogic.java =====\n`);
console.log((await import('node:fs')).readFileSync(f, 'utf8'));
