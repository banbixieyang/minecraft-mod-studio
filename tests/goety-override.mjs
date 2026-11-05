/**
 * Goety 数值覆写产物的编译验证。
 *
 * 为什么必须真编译：这段代码是给用户直接放进自己工程里的。
 * 「看起来对」不等于「能编过」—— 一个 import 写错、一个泛型用错，
 * 用户粘到工程里就是一片红，而他自己很难排查。
 *
 * 做法：把生成的 GoetyConfigOverrides.java 放进一个真的 Forge 1.20.1 工程，
 * 加 Goety 的 compileOnly 依赖，用 gradlew 真编一次。
 *
 * 跑法：node tests/goety-override.mjs [--build]
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, reportToPack } from '../core/analyze/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JAR = path.join(process.env.HOME || '', '.mcstudio', 'imports', 'goety-2.5.55.4-6cb70c62f48c.jar');
const PROJECT = path.join(ROOT, 'projects', 'forgetest');

let pass = 0;
const fails = [];
async function t(name, fn) {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '→', e.message); fails.push(name); }
}

if (!fs.existsSync(JAR)) {
  console.log('跳过：找不到 Goety 基础库 jar');
  process.exit(0);
}

console.log('\n=== 生成覆写产物 ===');
const report = analyze(JAR);
const cfg = report.contents.spellConfig || [];

// 挑几项有代表性的：整数、浮点、不同配置类
const pick = (pred) => cfg.find(pred);
const targets = [
  pick((e) => e.path === 'vexCost' && e.group === 'SpellConfig'),
  pick((e) => e.path === 'spellDamageMultiplier' && e.group === 'SpellConfig'),
  pick((e) => e.path === 'malghastHealth' && e.group === 'AttributesConfig'),
  pick((e) => e.path === 'malghastDamage' && e.group === 'AttributesConfig'),
].filter(Boolean);

await t('能挑到测试用的配置项', async () => {
  assert.ok(targets.length >= 3, `只挑到 ${targets.length} 项`);
  console.log(`    选中 ${targets.length} 项：${targets.map((e) => e.path).join(', ')}`);
});

const overrides = {};
for (const e of targets) {
  const nv = typeof e.value === 'number' ? (Number.isInteger(e.value) ? e.value + 1 : e.value + 0.5) : e.value;
  overrides[e.id] = { value: nv };
}

const pack = await reportToPack(report, { contents: { spellConfig: targets.map((e) => e.id) } }, {
  overrides: { spellConfig: overrides },
});

const tomlFiles = (pack.content.files || []).filter((f) => f.path.endsWith('.toml'));
const javaFiles = (pack.content.files || []).filter((f) => f.path.endsWith('.java'));
const readmeFiles = (pack.content.files || []).filter((f) => f.path.endsWith('.md'));

await t('生成了 toml 覆写文件', async () => {
  assert.ok(tomlFiles.length >= 1, '没有生成 toml');
  console.log(`    ${tomlFiles.map((f) => f.path).join(', ')}`);
});

await t('toml 里写的是新值', async () => {
  for (const e of targets) {
    const want = overrides[e.id].value;
    const file = tomlFiles.find((f) => f.path.endsWith(e.configFile));
    assert.ok(file, `没找到 ${e.configFile}`);
    const re = new RegExp(`^${e.path}\\s*=\\s*(-?[\\d.]+)`, 'm');
    const m = re.exec(file.content);
    assert.ok(m, `toml 里没有 ${e.path}`);
    assert.strictEqual(Number(m[1]), want, `${e.path}: 期望 ${want}，实际 ${m[1]}`);
  }
  console.log(`    ${targets.length} 项新值都写进了 toml`);
});

await t('toml 的分组层级正确（不重复、不丢）', async () => {
  // TOML 规范：段名含空格或特殊字符时必须加引号 —— 生成器会加，
  // 所以断言时要按同样的规则还原。
  const tomlSection = (sections) => sections.map((s) => (
    /^[A-Za-z0-9_-]+$/.test(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  )).join('.');
  for (const e of targets) {
    const file = tomlFiles.find((f) => f.path.endsWith(e.configFile));
    const want = `[${tomlSection(e.sections)}]`;
    assert.ok(file.content.includes(want), `toml 里没有分组 ${want}`);
  }
  console.log('    分组层级与字节码一致');
});

await t('生成了 Java 覆写代码', async () => {
  assert.strictEqual(javaFiles.length, 1, `java 文件数 ${javaFiles.length}`);
  console.log(`    ${javaFiles[0].path}`);
});

await t('Java 代码按类型选了对的 setter', async () => {
  const code = javaFiles[0].content;
  for (const e of targets) {
    const want = Number.isInteger(overrides[e.id].value) ? 'setInt' : 'setDouble';
    assert.ok(code.includes(`${want}(cfg, "${e.field}"`), `${e.path} 应该用 ${want}`);
  }
  assert.ok(code.includes('getMethod("set", t)'), '没按运行时类型选 set 重载');
  console.log('    整数走 setInt，浮点走 setDouble');
});

await t('生成了改动说明', async () => {
  assert.strictEqual(readmeFiles.length, 1, '没有生成说明');
  assert.ok(readmeFiles[0].content.includes('vexCost'), '说明里没有具体条目');
});

if (!process.argv.includes('--build')) {
  console.log('\n（加 --build 可真跑一次 gradlew 编译）');
} else {
  await t('生成的 Java 能真编译通过', async () => {
    // 放进真的 Forge 工程
    const srcDir = path.join(PROJECT, 'src', 'main', 'java', 'com', 'example', 'forgetest', 'config');
    fs.mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'GoetyConfigOverrides.java');
    // 包名改成工程自己的
    const code = javaFiles[0].content
      .replace('package com.example.mod.config;', 'package com.example.forgetest.config;')
      .replace('modid = "examplemod"', 'modid = "forgetest"');
    fs.writeFileSync(target, code, 'utf8');

    // 加 Goety 的 compileOnly 依赖。
    // 用本地那份 jar（导入缓存里就有），不去猜 curse maven 的 file id ——
    // 猜错了 gradle 只会报「Could not find」，看不出是哪儿错了。
    const gradlePath = path.join(PROJECT, 'build.gradle');
    const g = fs.readFileSync(gradlePath, 'utf8');
    if (!g.includes('goety-2.5.55.4')) {
      const jarWin = JAR.replace(/\\/g, '\\\\');
      fs.writeFileSync(gradlePath, g.replace(
        'dependencies {',
        `dependencies {
    compileOnly files('${jarWin}')`
      ), 'utf8');
    }

    try {
      // 用 cmd 跑 gradlew.bat：直接 execFileSync 调 .bat 在 Windows 上
      // 捕获不到输出，失败时只能看到一句空消息，等于没测。
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
      if (/BUILD SUCCESSFUL/i.test(String(e.stdout || ''))) {
        console.log('    gradlew compileJava 通过');
        return;
      }
      const out = `${e.stdout || ''}\n${e.stderr || ''}`.trim();
      const lines = out.split('\n').filter((l) => l.trim());
      const tail = lines.slice(-30).join('\n');
      throw new Error(`编译失败：\n${tail || '(无输出)'}`);
    }
    console.log('    gradlew compileJava 通过');
  });
}

console.log(`\n通过 ${pass}，失败 ${fails.length}${fails.length ? '：' + fails.join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
