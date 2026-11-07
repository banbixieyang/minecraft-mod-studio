/**
 * 反编译 + 引用索引回归测试。
 *
 * 跑法：node tests/decompile.mjs
 *
 * 验证「拆解 jar 时能看到原本代码」这条链：
 *   jar（只有 .class）→ ForgeFlower 反编译 → .java 源码 → 类/方法引用索引
 *
 * 现场用 javac 编两个互相引用的类再打 jar，保证测的是真实的
 * 「A 调 B / B 被 A 引用」，而不是一个空壳夹具。
 *
 * 没装反编译器（ForgeFlower）或没有 javac/jar 时**跳过**而不是失败 ——
 * 这是可选增强，不该让没装 ForgeGradle 的开发机整条回归变红。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  findDecompiler, decompileJar, buildReferenceIndex, classSource, findClass, listJavaFiles,
  decompileCacheDir,
} from '../core/analyze/decompile.mjs';
import { handleExtras } from '../core/serve/routes_extras.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};

console.log('\n[1] 反编译器查找');
const decompiler = findDecompiler();
ok(!!decompiler, '找到反编译器（ForgeFlower）', decompiler || '未找到');
if (!decompiler) {
  console.log('\n跳过：本机没有 ForgeFlower。把 forgeflower*.jar 放到 tools/forgeflower.jar，');
  console.log('或设置 MCSTUDIO_DECOMPILER 指向它，再跑这个测试。\n');
  process.exit(0);
}

const java = spawnSync('javac', ['-version'], { encoding: 'utf8' });
const jarTool = spawnSync('jar', ['--version'], { encoding: 'utf8' });
if (java.status !== 0 || jarTool.status !== 0) {
  console.log('\n跳过：本机没有 javac / jar，无法现场造测试 jar。\n');
  process.exit(0);
}

// 缓存默认落在 ~/.mcstudio/decompile，不写进被分析包的 build/libs
const cacheDefault = decompileCacheDir();
ok(/[\\/]decompile$/.test(cacheDefault) && cacheDefault.length > 10,
  '默认缓存目录独立于被分析的 jar', cacheDefault);

console.log('\n[2] 现场造一个「A 调 B」的 jar');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstudio-decompile-'));
try {
  const srcDir = path.join(tmp, 'src', 't');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'A.java'), `package t;

public class A {
    public static int add(int a, int b) {
        return a + b;
    }
}
`, 'utf8');
  fs.writeFileSync(path.join(srcDir, 'B.java'), `package t;

public class B {
    public int use() {
        return A.add(1, 2);
    }
}
`, 'utf8');

  const classes = path.join(tmp, 'classes');
  fs.mkdirSync(classes, { recursive: true });
  // -g：保留局部变量表。很多发布版 jar 不带调试信息，反编译后参数会变成
  // var0/var1；带 -g 才能验证「方法体原样还原」而不是只验证常量折叠。
  const c = spawnSync('javac', ['-g', '-d', classes,
    path.join(srcDir, 'A.java'), path.join(srcDir, 'B.java')], { encoding: 'utf8' });
  ok(c.status === 0, 'javac 编译通过', (c.stderr || '').split('\n')[0]);

  const jarPath = path.join(tmp, 'sample.jar');
  const j = spawnSync('jar', ['--create', '--file', jarPath, '-C', classes, '.'], { encoding: 'utf8' });
  ok(j.status === 0 && fs.existsSync(jarPath), 'jar 打包成功', (j.stderr || '').split('\n')[0]);

  console.log('\n[3] 反编译 jar → 源码');
  const first = decompileJar(jarPath, { cacheDir: path.join(tmp, 'cache') });
  ok(!first.cached, '第一次是真反编译（不是缓存）');
  ok(first.files >= 2, '产出了 .java 源码', `${first.files} 个`);

  const files = listJavaFiles(first.dir);
  ok(files.length === first.files, '源码文件数与报告一致', `${files.length}`);
  ok(files.every((f) => f.endsWith('.java')), '列出的都是 .java');

  const second = decompileJar(jarPath, { cacheDir: path.join(tmp, 'cache') });
  ok(second.cached, '第二次命中缓存（不重复反编译）');
  ok(second.dir === first.dir, '缓存目录稳定');

  console.log('\n[4] 引用索引');
  const idx = buildReferenceIndex(first.dir);
  ok(idx.classes.length === files.length, '每个源码文件都进了索引', `${idx.classes.length}`);
  ok(idx.classes.every((x) => x.fqcn && x.rel), '类都有 FQN 与相对路径');

  ok(!!findClass(idx, 't.A'), '按全限定名能找到类');
  ok(!!findClass(idx, 'B'), '按简单名也能找到类');

  const a = classSource(idx, 't.A');
  ok(a.source.includes('class A'), '源码含类型声明');
  ok(a.source.includes('return a + b'), '源码保留了方法体（真反编译，不是签名）');
  ok(a.referencedBy.includes('t.B'), 'A 的「被引用」里有 B');

  const b = classSource(idx, 't.B');
  ok(b.refs.includes('t.A'), 'B 的「引用了谁」里有 A');
  ok(b.source.includes('A.add(1, 2)'), 'B 的调用点保留在源码里');

  ok(buildReferenceIndex(first.dir) === idx, '同一份源码重建索引命中缓存');

  console.log('\n[5] 错误处理');
  let threw = false;
  try {
    decompileJar(path.join(tmp, 'nope.jar'), { cacheDir: path.join(tmp, 'cache') });
  } catch {
    threw = true;
  }
  ok(threw, '不存在的 jar 明确报错');

  threw = false;
  try {
    classSource(idx, 'does.not.Exist');
  } catch {
    threw = true;
  }
  ok(threw, '查不到的类明确报错');

  // ---------- HTTP 路由（界面走的就是这三个） ----------
  console.log('\n[6] HTTP 路由');
  process.env.MCSTUDIO_HOME = path.join(tmp, 'home'); // 别往真实用户目录里写缓存
  const call = async (method, route, body) => {
    const req = new Readable({ read() {} });
    req.method = method;
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
    const out = { code: 0, data: null };
    const res = {
      writeHead(code) { out.code = code; },
      end(b) { try { out.data = JSON.parse(b); } catch { out.data = b; } },
    };
    await handleExtras(req, res, route, new URLSearchParams());
    return out;
  };

  const info = await call('GET', 'analyze/decompile-info');
  ok(info.code === 200 && info.data.available === true, 'decompile-info 报告反编译器可用');

  const dr = await call('POST', 'analyze/decompile', { path: jarPath });
  ok(dr.code === 200 && Array.isArray(dr.data.classes), 'decompile 返回类清单', `${dr.data?.classes?.length} 个`);
  ok((dr.data.classes || []).some((c) => c.fqcn === 't.A' && c.pkg === 't'), '类清单带包名，界面好分组');

  const cr = await call('POST', 'analyze/class-source', { path: jarPath, className: 't.B' });
  ok(cr.code === 200 && cr.data.source.includes('A.add(1, 2)'), 'class-source 返回真源码');
  ok((cr.data.refs || []).includes('t.A'), 'class-source 一并返回引用关系');

  const bad = await call('POST', 'analyze/class-source', { path: jarPath, className: 'no.Such' });
  ok(bad.code === 400 && bad.data.ok === false, '查不到类时路由返回 400 而不是崩');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? '全部通过' : `有 ${failed} 项失败`}\n`);
process.exit(failed ? 1 : 0);
