/**
 * 一次性 API 核对工具（临时用，跑完可以删）。
 * 用法：node tools/jp.mjs <jar> <class...>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const JAVAP = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot/bin/javap.exe';

const HOME = process.env.USERPROFILE || process.env.HOME;
const JARS = {
  mc26: path.join(HOME, '.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/26.3/minecraft-merged-deobf-26.3.jar'),
  mc1201: path.join(HOME, '.gradle/caches/forge_gradle/minecraft_user_repo/net/minecraftforge/forge/1.20.1-47.4.0_mapped_official_1.20.1/forge-1.20.1-47.4.0_mapped_official_1.20.1.jar'),
};

const jarKey = process.argv[2];
const jar = JARS[jarKey];
if (!jar || !fs.existsSync(jar)) {
  console.error('jar 不存在:', jar);
  process.exit(1);
}
// 把所有 class 都加进 classpath
const classes = process.argv.slice(3);
const cp = jar;

for (const c of classes) {
  console.log(`\n===== ${c} =====`);
  try {
    const out = execFileSync(JAVAP, ['-cp', cp, c], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    console.log(out.trim());
  } catch (e) {
    const so = (e.stdout || '') + (e.stderr || '');
    console.log(so.trim().split('\n').slice(0, 3).join('\n') || 'NOT FOUND');
  }
}
