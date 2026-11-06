/**
 * 核对积木要用到的 Minecraft API 签名。
 *
 * 为什么要这个脚本：26.3 的包结构大改
 * （Identifier 从 util 挪到 resources、ServerPlayer 从 server.network 挪到 server.level、
 *   PlayerEntity 改名 Player、Text 类被 Component 取代、GameMode 不存在），
 * 凭记忆写积木模板必然编译不过。
 *
 * 跑法：
 *   node tools/check-mc-api.mjs fabric-26.3
 *   node tools/check-mc-api.mjs forge-1.20.1
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TARGET = process.argv[2] || 'fabric-26.3';

/** 找 javap。Windows 上必须带 .exe，否则 Node 找不到。 */
function findJavap() {
  const raw = [
    path.join(process.env.JAVA_HOME || '', 'bin', 'javap'),
    'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot/bin/javap',
  ];
  for (const c of raw) {
    if (!c) continue;
    for (const p of [c, `${c}.exe`]) {
      if (fs.existsSync(p)) return p;
    }
  }
  try {
    const w = execFileSync('which', ['javap'], { encoding: 'utf8' }).trim();
    if (w && fs.existsSync(w)) return w;
    if (w && fs.existsSync(`${w}.exe`)) return `${w}.exe`;
  } catch { /* 下面报错 */ }
  return null;
}

/** 找目标版本的 jar */
function findJar() {
  const home = os.homedir();
  const cands = TARGET.startsWith('forge')
    ? [
      path.join(home, '.gradle/caches/forge_gradle/minecraft_repo/versions/1.20.1/client.jar'),
      path.join(home, '.gradle/caches/forge_gradle/minecraft_user_repo/versions/1.20.1/client-extra.jar'),
    ]
    : [
      path.join(home, '.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/26.3/minecraft-merged-deobf-26.3.jar'),
      path.join(home, '.gradle/caches/fabric-loom/26.3/minecraft-merged.jar'),
    ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/** javap 是 Windows 原生程序，只认 Windows 格式路径 */
function toWinPath(p) {
  if (process.platform !== 'win32') return p;
  if (/^[A-Za-z]:[\\/]/.test(p)) return p.replace(/\//g, '\\');
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  return p;
}

/**
 * 要核对的 API。
 * cls 给的是**候选类名**（多个），第一个存在的就用；
 * methods 里带 '/' 表示「继承来的方法也算」（用 javap 不带 -p 查不到继承成员，
 * 所以改成查父类）。
 */
const CHECKS = [
  { name: 'ServerPlayer', cls: ['net.minecraft.server.level.ServerPlayer', 'net.minecraft.server.network.ServerPlayer'], methods: ['sendMessage', 'heal', 'changeGameMode', 'teleportTo', 'getInventory', 'getGameMode'] },
  { name: 'Player', cls: ['net.minecraft.world.entity.player.Player', 'net.minecraft.world.entity.player.PlayerEntity'], methods: ['getHealth', 'getMaxHealth', 'getX', 'getY', 'getZ', 'heal', 'level'] },
  { name: 'ServerLevel', cls: ['net.minecraft.server.level.ServerLevel', 'net.minecraft.world.level.ServerLevel'], methods: ['setBlockState', 'getBlockState', 'setTimeOfDay', 'setWeather', 'setThunder'] },
  { name: 'LivingEntity', cls: ['net.minecraft.world.entity.LivingEntity'], methods: ['heal', 'getHealth', 'hurt', 'damageSources'] },
  { name: 'Entity', cls: ['net.minecraft.world.entity.Entity'], methods: ['getX', 'getY', 'getZ'] },
  { name: 'ItemStack', cls: ['net.minecraft.world.item.ItemStack'], methods: ['setCount', 'getCount'] },
  { name: 'BlockPos', cls: ['net.minecraft.core.BlockPos'], methods: ['<init>'] },
  { name: 'GameType', cls: ['net.minecraft.world.level.GameType', 'net.minecraft.world.GameMode'], methods: ['values'] },
  { name: 'Component', cls: ['net.minecraft.network.chat.Component', 'net.minecraft.network.chat.MutableComponent'], methods: ['literal'] },
  { name: 'Text', cls: ['net.minecraft.text.Text'], methods: ['literal'] },
  { name: 'Identifier', cls: ['net.minecraft.resources.Identifier', 'net.minecraft.util.Identifier'], methods: ['of', 'parse', 'tryParse'] },
  { name: 'ResourceLocation', cls: ['net.minecraft.resources.ResourceLocation', 'net.minecraft.resources.Identifier'], methods: ['parse', 'of'] },
  { name: 'Registries', cls: ['net.minecraft.core.registries.Registries', 'net.minecraft.registry.Registries'], methods: ['ITEM', 'BLOCK'] },
  { name: 'DamageSource', cls: ['net.minecraft.world.damagesource.DamageSource'], methods: ['<init>'] },
  { name: 'DamageTypes', cls: ['net.minecraft.world.damagesource.DamageTypes'], methods: ['GENERIC', 'PLAYER_ATTACK'] },
];

const javap = findJavap();
const jarRaw = findJar();
if (!javap) { console.error('找不到 javap'); process.exit(1); }
if (!jarRaw) { console.error(`找不到 ${TARGET} 的 jar`); process.exit(1); }
const jar = toWinPath(jarRaw);

console.log(`目标：${TARGET}`);
console.log(`jar：${jar}`);
console.log('');

const javapOf = (cls) => {
  try {
    return execFileSync(javap, ['-cp', jar, cls], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

let problems = 0;
const resolved = {};

for (const chk of CHECKS) {
  let real = null;
  let out = null;
  for (const c of chk.cls) {
    const o = javapOf(c);
    if (o) { real = c; out = o; break; }
  }
  if (!real) {
    console.log(`✗ 找不到类：${chk.name}（试过 ${chk.cls.join(' / ')}）`);
    problems++;
    continue;
  }
  resolved[chk.name] = real;
  const lines = out.split('\n');
  const found = [];
  const notFound = [];
  for (const m of chk.methods) {
    const hit = lines.find((l) => l.includes(`${m}(`));
    if (hit) found.push(hit.trim());
    else notFound.push(m);
  }
  console.log(`【${chk.name}】→ ${real}`);
  for (const f of found) console.log(`  ✓ ${f}`);
  for (const nf of notFound) {
    console.log(`  ✗ 无此方法：${nf}`);
    problems++;
  }
  console.log('');
}

console.log(problems ? `有 ${problems} 处对不上，需要改积木模板` : '全部对得上');
console.log('');
console.log('解析出的类名（可直接抄进积木模板）：');
for (const [k, v] of Object.entries(resolved)) {
  console.log(`  ${k} = ${v}`);
}

// 以前这里只打印 problems，接进 CI 时「对不上」也会以 0 退出，等于没检查。
process.exit(problems ? 1 : 0);
