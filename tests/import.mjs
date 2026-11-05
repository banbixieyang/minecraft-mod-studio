/**
 * 「直接解析别人的 jar」回归测试。
 *
 * 自己构建出来的 jar 太规整了，测不出问题。这里手工拼 ZIP 字节，
 * 造出第三方发布包里真实存在的怪癖：
 *   - 自解压前缀（本地头偏移相对 zip 起点，直接读会全错）
 *   - GBK 中文文件名（没有 UTF-8 标志）
 *   - ZIP64 结束记录（文件数 > 65535 的包）
 *   - data descriptor（本地头里大小是 0）
 *   - Forge mods.toml 多 [[mods]] / 单引号 / 三引号 / 多行数组 / ${} 变量
 *   - 签名文件、内嵌 jar、sources jar、Quilt / 老 Forge / 无元数据
 *
 * 再走一遍真实的 HTTP 上传 → 分析 → 展开内嵌 → 删除 链路。
 * 全程用临时 MCSTUDIO_HOME，不碰用户目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `mcstudio-import-${process.pid}-`));
process.env.MCSTUDIO_HOME = path.join(TMP, 'home');

const { openZip, looksLikeZip } = await import('../core/analyze/zip.mjs');
const { analyze, reportToPack, reportSummary } = await import('../core/analyze/report.mjs');
const { importsDir, saveJarBytes, listImportedJars, removeImportedJar, isNestedJarEntry } = await import('../core/analyze/imports.mjs');
const { createServer } = await import('../core/serve/server.mjs');

let failed = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? `  （${extra}）` : ''}`);
  if (!cond) failed++;
};
const section = (s) => console.log(`\n[${s}]`);

// ---------------- 最小 ZIP 构造器 ----------------
// 只发 store(0)，CRC 填 0（读端不校验）。够用来验证目录/偏移/编码逻辑。
function buildZip(files, opts = {}) {
  const prefix = opts.prefix || Buffer.alloc(0);
  const descriptor = !!opts.descriptor;
  const zip64 = !!opts.zip64;
  const locals = [];
  const cens = [];
  let offset = 0; // 相对 zip 起点，不含 prefix
  for (const f of files) {
    const nameBuf = Buffer.isBuffer(f.name) ? f.name : Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data ?? '', 'utf8');
    const flags = f.utf8Flag === false ? 0 : 0x800;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(flags, 6);
    loc.writeUInt32LE(0, 14); // crc
    loc.writeUInt32LE(descriptor ? 0 : data.length, 18);
    loc.writeUInt32LE(data.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    const dd = Buffer.alloc(16);
    if (descriptor) {
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(data.length, 8);
      dd.writeUInt32LE(data.length, 12);
    }
    const local = Buffer.concat([loc, nameBuf, data, descriptor ? dd : Buffer.alloc(0)]);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(flags, 8);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    cens.push(Buffer.concat([cen, nameBuf]));
    locals.push(local);
    offset += local.length;
  }

  const cd = Buffer.concat(cens);
  const parts = [prefix, ...locals, cd];
  let tail = [];
  if (zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(files.length), 24);
    z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cd.length), 40);
    z.writeBigUInt64LE(BigInt(offset), 48);
    const l = Buffer.alloc(20);
    l.writeUInt32LE(0x07064b50, 0);
    l.writeBigUInt64LE(BigInt(offset + cd.length), 8);
    l.writeUInt32LE(1, 16);
    tail = [z, l];
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(zip64 ? 0xffff : files.length, 8);
  e.writeUInt16LE(zip64 ? 0xffff : files.length, 10);
  e.writeUInt32LE(zip64 ? 0xffffffff : cd.length, 12);
  e.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...parts, ...tail, e]);
}

const GBK_NAME = Buffer.concat([
  Buffer.from('assets/othermod/textures/', 'ascii'),
  Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), // 「中文」的 GBK
  Buffer.from('.png', 'ascii'),
]);

// ---------------- 1. ZIP 怪癖 ----------------
section('1. ZIP 读取兼容性');
{
  const files = [
    { name: 'fabric.mod.json', data: '{"id":"demo","name":"Demo","version":"1.0","depends":{"minecraft":"1.20.1"}}' },
    { name: GBK_NAME, utf8Flag: false, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];
  const normal = buildZip(files);
  ok(looksLikeZip(normal), '普通 zip 能识别');
  let z = openZip(normal);
  ok(z.count === 2, '普通 zip 条目数', z.count);
  ok(z.read('fabric.mod.json').toString().includes('"demo"'), '普通 zip 能读出内容');

  const prefixed = buildZip(files, { prefix: Buffer.from('MZ-fake-stub-header-1234567890') });
  z = openZip(prefixed);
  ok(z.read('fabric.mod.json').toString().includes('"demo"'), '自解压前缀：本地头偏移自动修正');

  const gbkName = z.names.find((n) => n.includes('.png'));
  ok(gbkName && gbkName.includes('中文'), '没有 UTF-8 标志时按 GBK 解出中文名', gbkName);
  ok(z.read(gbkName).length === 4, 'GBK 名条目仍能读出数据');

  const dd = buildZip([{ name: 'a.txt', data: 'hello descriptor' }], { descriptor: true });
  ok(openZip(dd).read('a.txt').toString() === 'hello descriptor', 'data descriptor：以中央目录大小为准');

  const z64 = buildZip([{ name: 'a.txt', data: 'zip64 ok' }], { zip64: true });
  ok(openZip(z64).read('a.txt').toString() === 'zip64 ok', 'ZIP64 结束记录能定位中央目录');

  const truncated = normal.subarray(0, normal.length - 60);
  let threw = false;
  try { openZip(truncated); } catch { threw = true; }
  ok(threw, '截断的 jar 报明确错误，而不是 RangeError 崩溃');

  let bad = false;
  try { openZip(Buffer.from('not a jar at all, really not')); } catch { bad = true; }
  ok(bad, '非 zip 内容被拒绝');
}

// ---------------- 2. 导入缓存 ----------------
section('2. 导入缓存与安全');
{
  const jar = buildZip([
    { name: 'fabric.mod.json', data: '{"id":"demo","name":"Demo","version":"1.0"}' },
  ], { prefix: Buffer.from('') });
  ok(saveJarBytes(jar, 'C:\\evil\\..\\别人的 mod.jar').path.startsWith(importsDir()), '文件名里的路径被剥掉，落在导入缓存');
  const a = saveJarBytes(jar, '别人的 mod.jar');
  const b = saveJarBytes(jar, '别人的 mod.jar');
  ok(a.path === b.path && b.reused, '同一份内容重复上传复用缓存，不堆副本');
  ok(listImportedJars().some((x) => x.path === a.path), '上传后能列出来');

  let rejected = false;
  try { saveJarBytes(Buffer.from('garbage'), 'x.jar'); } catch { rejected = true; }
  ok(rejected, '非 zip 字节被拒绝');

  let outside = false;
  try { removeImportedJar(path.join(TMP, 'outside.jar')); } catch { outside = true; }
  ok(outside, '删除接口拒绝删缓存目录之外的文件');
  ok(removeImportedJar(a.path).removed, '删除缓存里的 jar');
  ok(!fs.existsSync(a.path), '文件确实被删掉');

  ok(isNestedJarEntry('META-INF/jars/dep.jar'), 'Fabric 内嵌 jar 路径合法');
  ok(isNestedJarEntry('META-INF/jarjar/dep.jar'), 'Forge jarjar 路径合法');
  ok(!isNestedJarEntry('../../evil.jar'), '目录穿越的内嵌路径被拒绝');
}

// ---------------- 3. 第三方元数据 ----------------
section('3. 第三方 mod 元数据');
const FORGE_TOML = `
# 这是别人发布的 mods.toml，格式比 MDK 模板花得多
modLoader="javafml"
loaderVersion="[47,)"
license='ARR'

[[mods]]
modId="othermod"
version="2.3.1"
displayName='别人的模组'
authors=["Alice", 'Bob']
description='''
一个多行描述，
里面还有 # 号不能当注释切掉。
'''
# 单引号、数组、占位符变量都要能读

[[mods]]
modId="bundled_addon"
displayName="打包进来的附属"

[[dependencies.othermod]]
    modId="forge"
    mandatory=true
    versionRange="[47,)"

[[dependencies.othermod]]
    modId="minecraft"
    mandatory=true
    versionRange="[1.20.1,1.21)"
`;

function thirdPartyJar() {
  const inner = buildZip([
    { name: 'fabric.mod.json', data: '{"id":"dep","name":"Dep","version":"0.1"}' },
  ]);
  return buildZip([
    { name: 'META-INF/mods.toml', data: FORGE_TOML },
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\nImplementation-Title: Other Mod\n' },
    { name: 'META-INF/TEST.SF', data: 'Signature-Version: 1.0\n' },
    { name: 'META-INF/TEST.RSA', data: 'binary' },
    { name: 'META-INF/jars/dep.jar', data: inner },
    { name: 'assets/othermod/lang/zh_cn.json', data: '{"item.othermod.thing":"东西"}' },
    { name: 'data/othermod/recipes/thing.json', data: '{"type":"minecraft:crafting_shaped","result":{"item":"othermod:thing","count":1}}' },
    { name: 'com/example/OtherMod.java', data: 'package com.example; public class OtherMod {}' },
  ], { prefix: Buffer.from('stub-') });
}

let FORGE_JAR = '';
{
  FORGE_JAR = path.join(TMP, 'others-mod.jar');
  fs.writeFileSync(FORGE_JAR, thirdPartyJar());
  const r = analyze(FORGE_JAR);
  const m = r.meta;
  console.log(`    ${m.loader} | ${m.id} | ${m.name} | v${m.version} | MC ${m.mcVersion} | ${JSON.stringify(m.authors)}`);
  ok(m.loader === 'forge', '识别为 Forge');
  ok(m.id === 'othermod', 'modId 正确');
  ok(m.name === '别人的模组', '单引号 displayName 读出来了');
  ok(m.version === '2.3.1', '版本号正确');
  ok(Array.isArray(m.authors) && m.authors.join(',') === 'Alice,Bob', '数组 authors 归一为字符串数组');
  ok(m.mcVersion === '1.20.1', '从 versionRange 里取出 MC 版本');
  ok(!m.description.includes("'''") && m.description.includes('多行描述'), '三引号多行描述没被 # 注释切断');
  ok(r.packaging.signed, '识别到签名文件');
  ok(r.packaging.nestedJars.length === 1, '识别到内嵌 jar', `${r.packaging.nestedJars.length} 个`);
  ok(r.packaging.javaSources === 1, '识别到 .java 源码');
  ok(r.packaging.embeddedMods.some((x) => x.id === 'bundled_addon'), '第二个 [[mods]] 被列为附带 mod');
  ok(r.warnings.some((w) => w.includes('内嵌')), '警告里提示内嵌 jar 要单独展开');

  const pack = await reportToPack(r, { contents: {}, withTextures: false }, {});
  ok(!!pack && pack.author === 'Alice, Bob', '打包不再被字符串 authors 的 .join 炸掉', `author=${pack.author}`);
  ok(JSON.stringify(reportSummary(r)).length > 100, '报告能序列化给界面');
}
{
  // Quilt
  const q = buildZip([
    { name: 'quilt.mod.json', data: JSON.stringify({ quilt_loader: { id: 'qmod', version: '1.2', metadata: { name: 'Quilt Mod', authors: ['C'] }, depends: [{ id: 'minecraft', versions: '>=1.20.1' }] } }) },
  ]);
  const p = path.join(TMP, 'quilt.jar');
  fs.writeFileSync(p, q);
  const r = analyze(p);
  ok(r.meta.loader === 'quilt' && r.meta.id === 'qmod' && r.meta.mcVersion === '1.20.1', 'Quilt 元数据');
  const pk = await reportToPack(r, { contents: {}, withTextures: false }, {});
  ok(pk.requires.platform.includes('fabric'), 'Quilt 打包时归到 fabric 平台');
}
{
  // ${} 占位符没被 Gradle 展开的发布包：不能把一串 ${} 直接显示给用户
  const VAR_TOML = [
    'mod_id="realmod"',
    '[[mods]]',
    'modId="${mod_id}"',
    'displayName="${mod_id} Display"',
    'version="1.0"',
  ].join('\n');
  const p = path.join(TMP, 'vars.jar');
  fs.writeFileSync(p, buildZip([{ name: 'META-INF/mods.toml', data: VAR_TOML }]));
  const r = analyze(p);
  ok(r.meta.id === 'realmod' && !r.meta.name.includes('${'), '占位符 ${mod_id} 展开成真实 id', `${r.meta.id} / ${r.meta.name}`);
}
{
  // 老 Forge mcmod.info
  const q = buildZip([{ name: 'mcmod.info', data: JSON.stringify([{ modid: 'oldmod', name: 'Old Mod', version: '1.0', mcversion: '1.12.2', authors: ['D'] }]) }]);
  const p = path.join(TMP, 'legacy.jar');
  fs.writeFileSync(p, q);
  const r = analyze(p);
  ok(r.meta.loader === 'forge' && r.meta.id === 'oldmod' && r.meta.mcVersion === '1.12.2', '老 Forge mcmod.info');
}
{
  // 没有 mod 描述文件也要给一份能看的报告，不能抛异常
  const q = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\nImplementation-Title: Plain Lib\nImplementation-Version: 3.0\nImplementation-Vendor: Someone\n' },
    { name: 'assets/plain/textures/x.png', data: 'x' },
  ]);
  const p = path.join(TMP, 'plain.jar');
  fs.writeFileSync(p, q);
  const r = analyze(p);
  ok(r.meta.loader === 'unknown' && r.meta.name === 'Plain Lib', '无 mod 描述时用 MANIFEST 兜底');
  ok(r.warnings.some((w) => w.includes('可能不是 mod')), '明确提示读不出加载器');
  const pk = await reportToPack(r, { contents: {}, withTextures: false }, {});
  ok(pk.requires.platform.length === 0, 'unknown 加载器不会写进包的目标平台要求');
}

// ---------------- 4. HTTP 上传链路 ----------------
section('4. HTTP：上传 → 分析 → 展开 → 删除');
{
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (route, init) => {
    const res = await fetch(`${base}/api/${route}`, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`非 JSON：${text.slice(0, 120)}`); }
    return { status: res.status, data };
  };

  const bytes = fs.readFileSync(FORGE_JAR);
  const up = await call('analyze/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('别人的模组.jar') },
    body: bytes,
  });
  ok(up.status === 200 && up.data.ok, '二进制上传成功', up.data.error || '');
  const uploaded = up.data.path;
  ok(uploaded && uploaded.startsWith(importsDir()), '返回的是导入缓存内的本地路径');
  ok(up.data.name === '别人的模组.jar', '中文文件名保留');

  const an = await call('analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: uploaded }),
  });
  ok(an.status === 200 && an.data.report?.meta?.id === 'othermod', '上传后直接分析出结果（沿用了旧链路）');
  ok(an.data.report?.packaging?.nestedJars?.length === 1, '报告里带着包特征给界面');

  const list = await call('analyze/uploads');
  ok(list.data.jars.some((j) => j.path === uploaded), '上传列表里能找到');

  const bad = await call('analyze/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'broken.jar' },
    body: Buffer.from('this is definitely not a jar, '.repeat(4)),
  });
  ok(bad.status === 400 && /不是有效的 jar/.test(bad.data.error), '坏文件返回明确错误', bad.data.error);

  const inner = await call('analyze/extract-inner', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: uploaded, entry: 'META-INF/jars/dep.jar' }),
  });
  ok(inner.status === 200 && inner.data.ok, '内嵌 jar 拆出来成功', inner.data.error || '');
  const innerAn = await call('analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: inner.data.path }),
  });
  ok(innerAn.data.report?.meta?.id === 'dep', '拆出来的内嵌 mod 也能单独分析');

  const srcFile = await call('analyze/source', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: uploaded, entry: 'com/example/OtherMod.java' }),
  });
  ok(srcFile.status === 200 && srcFile.data.text?.includes('class OtherMod'), 'sources jar 的 .java 正文能直接读', srcFile.data.error || '');
  const badSrc = await call('analyze/source', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: uploaded, entry: '../../evil.java' }),
  });
  ok(badSrc.status === 400, '拒绝读目录穿越的源码条目');

  const evil = await call('analyze/extract-inner', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: uploaded, entry: '../../evil.jar' }),
  });
  ok(evil.status === 400, '拒绝展开目录穿越的条目');

  const delOutside = await call('analyze/upload-remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path.join(TMP, 'outside.jar') }),
  });
  ok(delOutside.status === 400, '拒绝删除缓存目录外的文件');

  const del = await call('analyze/upload-remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: uploaded }),
  });
  ok(del.data.removed === true && !fs.existsSync(uploaded), '删除上传的副本');

  await new Promise((resolve) => server.close(resolve));
}

// ---------------- 收尾 ----------------
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 临时目录删不掉也不影响结论 */ }
console.log(failed ? `\n${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
