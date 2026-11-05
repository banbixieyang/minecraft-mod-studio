/**
 * Goety Delight 扩展测试。
 *
 * 跑法：node tests/goety-delight.mjs
 *
 * 验证：
 *   1. 数值配置 / 状态效果 / 附魔 / 自定义配方都进来了
 *   2. 数值带默认值与范围、配置文件与 TOML 路径
 *   3. 自定义配方带灵魂消耗、持续时间这些关键数值
 *   4. 改数值能生成 toml 覆写 + Java 覆写代码
 *   5. 生成的 Java 真能编译通过
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyze, closeReport, reportToPack } from '../core/analyze/report.mjs';
import { validatePack } from '../core/library/pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const HOME = process.env.HOME || process.env.USERPROFILE;
const IMPORTS = path.join(HOME, '.mcstudio', 'imports');

let passed = 0, failed = 0;
const t = async (name, fn) => {
  try {
    const r = await fn();
    if (r === false) throw new Error('断言不成立');
    passed++;
    console.log(`  ✓ ${name}${typeof r === 'string' ? '  ' + r : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}  ${e.message}`);
  }
};

const jarName = fs.readdirSync(IMPORTS).find((f) => f.startsWith('goetydelight') && f.endsWith('.jar'));
if (!jarName) {
  console.log('导入缓存里没有 goetydelight，跳过');
  process.exit(0);
}
const jarPath = path.join(IMPORTS, jarName);
console.log(`源：${jarName}\n`);

const report = analyze(jarPath);
const C = report.contents;

console.log('Goety Delight 扩展');
await t('数值配置 >= 25 条', () => {
  if ((C.delightConfig || []).length < 25) throw new Error(`只有 ${(C.delightConfig || []).length} 条`);
  return `${C.delightConfig.length} 条`;
});
await t('状态效果 >= 12 条', () => {
  if ((C.delightEffect || []).length < 12) throw new Error(`只有 ${(C.delightEffect || []).length} 条`);
  return `${C.delightEffect.length} 条`;
});
await t('附魔 >= 4 条', () => {
  if ((C.delightEnchant || []).length < 4) throw new Error(`只有 ${(C.delightEnchant || []).length} 条`);
  return `${C.delightEnchant.length} 条`;
});
await t('自定义配方 >= 100 条', () => {
  if ((C.delightRecipe || []).length < 100) throw new Error(`只有 ${(C.delightRecipe || []).length} 条`);
  return `${C.delightRecipe.length} 条`;
});
await t('数值带默认值、范围与 TOML 路径', () => {
  const e = C.delightConfig.find((x) => x.id === 'config_cakeeffectradius');
  if (!e) throw new Error('没找到 cakeEffectRadius');
  if (e.value !== 32) throw new Error(`默认值 ${e.value} 不是 32`);
  if (e.min !== 1 || e.max !== 256) throw new Error(`范围 ${e.min}~${e.max} 不是 1~256`);
  if (!e.configFile) throw new Error('没有配置文件名');
  if (!e.tomlPath) throw new Error('没有 TOML 路径');
  return `${e.value}（${e.min}~${e.max}）${e.configFile} ▸ ${e.tomlPath}`;
});
await t('效果有中文名与注册表 id', () => {
  const e = C.delightEffect.find((x) => x.id === 'goetydelight_hunting_denial');
  if (!e) throw new Error('没找到 hunting_denial');
  if (!e.nameZh) throw new Error('没有中文名');
  if (!e.registryId) throw new Error('没有注册表 id');
  return `${e.nameZh}（${e.registryId}）`;
});
await t('附魔带最大等级', () => {
  const e = C.delightEnchant.find((x) => x.id === 'goetydelight_soul_affix');
  if (!e) throw new Error('没找到 soul_affix');
  if (!(e.maxLevel >= 1)) throw new Error(`最大等级 ${e.maxLevel}`);
  return `灵魂附加 最大 ${e.maxLevel} 级`;
});
await t('仪式配方带灵魂消耗与材料', () => {
  const e = C.delightRecipe.find((x) => x.category === 'ritual');
  if (!e) throw new Error('没找到仪式配方');
  if (typeof e.soulCost !== 'number') throw new Error('没有灵魂消耗');
  if (!Array.isArray(e.ingredients) || !e.ingredients.length) throw new Error('没有材料列表');
  return `灵魂 ${e.soulCost}，材料 ${e.ingredients.length} 种`;
});
await t('酿造配方带效果与持续时间', () => {
  const e = C.delightRecipe.find((x) => x.category === 'brewing');
  if (!e) throw new Error('没找到酿造配方');
  if (!e.effect) throw new Error('没有效果 id');
  if (typeof e.duration !== 'number') throw new Error('没有持续时间');
  return `${e.effect} 持续 ${e.duration} tick`;
});
await t('核心引擎的配方数含子目录（>30）', () => {
  if ((C.recipe || []).length < 30) throw new Error(`核心只解析出 ${(C.recipe || []).length} 条`);
  return `${C.recipe.length} 条`;
});
await t('警告里没有大批「已跳过」噪音', () => {
  const noisy = report.warnings.filter((w) => /暂不支持，已跳过/.test(w));
  if (noisy.length) throw new Error(`${noisy.length} 条跳过警告`);
  return `${report.warnings.length} 条警告`;
});

// ---- 改数值 → 生成覆写产物 ----
console.log('\n数值回写');
const target = C.delightConfig.find((e) => e.id === 'config_cakeeffectradius');
const sel = { contents: { delightConfig: [target.id] } };
const pack = await reportToPack(report, sel, {
  overrides: { delightConfig: { [target.id]: { value: 48 } } },
});

await t('导出包里有 toml 覆写文件', () => {
  const f = (pack.content.files || []).find((x) => x.path.endsWith('.toml'));
  if (!f) throw new Error('没有 toml 文件');
  if (!/cakeEffectRadius\s*=\s*48/.test(f.content)) throw new Error(`toml 里没有新值 48：\n${f.content.slice(0, 300)}`);
  return f.path;
});
await t('toml 的分组层级正确', () => {
  const f = (pack.content.files || []).find((x) => x.path.endsWith('.toml'));
  if (!/\[food\.cake\]/.test(f.content)) throw new Error(`没有 [food.cake] 分组：\n${f.content.slice(0, 300)}`);
  return '[food.cake]';
});
await t('导出包里有 Java 覆写代码', () => {
  const f = (pack.content.files || []).find((x) => x.path.endsWith('.java'));
  if (!f) throw new Error('没有 java 文件');
  if (!/GoetyDelightConfigOverrides/.test(f.content)) throw new Error('类名不对');
  if (!/net\.v_black_cat\.goetydelight\.config\.Config/.test(f.content)) throw new Error('配置类全名不对');
  if (!/48/.test(f.content)) throw new Error('java 里没有新值 48');
  return f.path;
});
await t('导出包里有说明文档', () => {
  const f = (pack.content.files || []).find((x) => x.path.endsWith('README.md'));
  if (!f) throw new Error('没有 README');
  return f.path;
});
await t('包整体校验通过', () => {
  const errs = validatePack(pack);
  if (errs.length) throw new Error(errs.join('；'));
  return 'ok';
});

// ---- 真编译：生成的 Java 是给用户直接放进工程用的 ----
// 「看起来对」不等于「能编过」—— 用户粘到工程里编译失败，自己很难排查。
if (process.argv.includes('--build')) {
  console.log('\n真编译验证');
  const PROJECT = path.join(ROOT, 'projects', 'forgetest');
  await t('生成的 Java 能真编译通过', async () => {
    const javaF = (pack.content.files || []).find((x) => x.path.endsWith('.java'));
    if (!javaF) throw new Error('没有 java 文件');
    const srcDir = path.join(PROJECT, 'src', 'main', 'java', 'com', 'example', 'forgetest', 'config');
    fs.mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'GoetyDelightConfigOverrides.java');
    const code = javaF.content
      .replace('package com.example.mod.config;', 'package com.example.forgetest.config;')
      .replace('modid = "examplemod"', 'modid = "forgetest"');
    fs.writeFileSync(target, code, 'utf8');

    // 加 goetydelight 的 compileOnly 依赖（用本地那份 jar，不去猜 curse maven 的 file id）
    const gradlePath = path.join(PROJECT, 'build.gradle');
    const g = fs.readFileSync(gradlePath, 'utf8');
    if (!g.includes('goetydelight')) {
      const jarWin = jarPath.replace(/\\/g, '\\\\');
      fs.writeFileSync(gradlePath, g.replace(
        'dependencies {',
        `dependencies {
    compileOnly files('${jarWin}')`
      ), 'utf8');
    }

    try {
      const cmd = 'gradlew.bat compileJava --console=plain 2>&1';
      const out = execFileSync('cmd.exe', ['/c', cmd], {
        cwd: PROJECT,
        encoding: 'utf8',
        timeout: 600000,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (!/BUILD SUCCESSFUL/i.test(out)) {
        throw new Error(out.split('\n').filter((l) => l.trim()).slice(-30).join('\n'));
      }
    } catch (e) {
      if (/BUILD SUCCESSFUL/i.test(String(e.stdout || ''))) return;
      const out = `${e.stdout || ''}\n${e.stderr || ''}`.trim();
      const tail = out.split('\n').filter((l) => l.trim()).slice(-30).join('\n');
      throw new Error(`编译失败：\n${tail || '(无输出)'}`);
    }
  });
}

closeReport(report);
console.log(`\n通过 ${passed}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
