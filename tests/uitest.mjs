/**
 * 界面冒烟测试 —— 用 Chrome DevTools Protocol 驱动无头 Edge/Chrome。
 *
 * 做的事：
 *   1. 起一个无头浏览器，打开编辑器首页
 *   2. 依次点开每个内容类型 / 弹窗，每步截一张图
 *   3. 全程收集 JS 异常、console.error、资源加载失败
 *   4. 最后扫一遍 DOM，检查有没有 "undefined" / "NaN" / "[object Object]" 漏到界面上
 *
 *   node tests/uitest.mjs [--port 4173] [--browser <可执行文件>]
 *
 * 退出码非 0 表示界面层有问题。截图落在 tests/artifacts/ 下。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, 'artifacts');

const argOf = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const APP_PORT = Number(argOf('port', 4173));
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
const DEBUG_PORT = 9223;

const CANDIDATES = [
  argOf('browser'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const browserPath = CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('找不到可用的 Chrome/Edge。用 --browser 指定路径。');
  process.exit(2);
}

// 拆解台端到端测试用：一个本机构建的、真有内容（tier/物品/配方）的 jar。
// 合成的最小 jar（只有 fabric.mod.json）没有这些条目，验不出数值编辑，
// 所以读 fallen 包的字节，在页面里经 fetch 上传到服务端导入缓存后走真实 UI。
const FALLEN_JAR = path.resolve(HERE, '..', '..', 'fallen', 'build', 'libs', 'fallen-0.1.0.jar');
const FALLEN_B64 = fs.existsSync(FALLEN_JAR) ? fs.readFileSync(FALLEN_JAR).toString('base64') : '';

// ---------------------------------------------------------------- 启动浏览器
// 每次跑用一个新的临时 profile，跑完不删（沙箱里删目录风险高，留着也无所谓）
const profile = path.join(
  process.env.TEMP || process.env.TMPDIR || '/tmp',
  `mcstudio-uitest-${Date.now()}`,
);
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

const child = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, step = 150) {
  const t0 = Date.now();
  let lastErr = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      lastErr = null;
    } catch (e) {
      // 「元素还没出现」是正常的等待过程，继续等；
      // 但「求值表达式本身写错了」（语法错误 / 变量不存在）永远等不出来，
      // 再重试就是白白浪费 20 秒，还把真因藏起来 —— 这种直接抛出去。
      const msg = String(e?.message || e);
      if (/SyntaxError|is not defined|is not a function|Unexpected/i.test(msg)) throw e;
      lastErr = e;
    }
    if (Date.now() - t0 > timeout) {
      throw new Error(`等待超时${lastErr ? `（最后一次报错：${lastErr.message}）` : ''}`);
    }
    await sleep(step);
  }
}

const targets = await waitFor(async () => {
  const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const list = await r.json();
  return list.find((t) => t.type === 'page') || null;
}, 20000);

// ---------------------------------------------------------------- CDP 客户端
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('无法连接浏览器调试端口'));
});

let seq = 0;
const pending = new Map();
const problems = []; // { kind, text }

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push({ kind: '异常', text: `${d.text} ${d.exception?.description || ''}`.trim() });
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push({ kind: 'console.error', text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push({ kind: '网络/日志', text: `${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim() });
  }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }
    }, 20000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(ART, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

/** 关掉最上层弹窗（弹窗的关闭按钮是 .icon-btn，不是 .modal-close） */
async function closeAnyModal() {
  const closed = await evaluate(`(() => {
    const hosts = [...document.querySelectorAll('.modal-host')];
    const last = hosts[hosts.length - 1];
    if (!last) return false;
    (last.querySelector('.modal-head .icon-btn') || last).click();
    return true;
  })()`);
  if (closed) await sleep(250);
  return closed;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// ---------------------------------------------------------------- 开始测试
const steps = [];
const record = (name, note) => steps.push({ name, note });
/** 本次跑测试自己造出来的包，收尾时删掉 —— 否则每跑一次库里多一个 ui_2、ui_3 */
const createdPacks = [];
let projectRoot = '';

/** 读当前工程的根目录，给库接口用 */
async function findProjectRoot() {
  if (projectRoot) return projectRoot;
  projectRoot = await evaluate(`fetch('/api/projects').then(r => r.json()).then(j => {
    const list = j.projects || [];
    const p = list.find(x => x.id === 'testmod') || list[0];
    return p ? p.root : '';
  }).catch(() => '')`);
  return projectRoot;
}

/**
 * 在页面里拼一个最小合法 jar（store 模式 ZIP），再真的派发一次 drop 事件。
 * 这样测的是完整链路：拖放事件 → XHR 二进制上传 → 服务端落盘 → 自动分析 → 报告渲染。
 * 不依赖本机有没有现成的第三方 jar。
 */
const DROP_JAR_JS = `(() => {
  function buildZip(files) {
    const enc = new TextEncoder();
    const locals = [], cens = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data);
      const loc = new Uint8Array(30), lv = new DataView(loc.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x800, true); lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
      const local = new Uint8Array(30 + name.length + data.length);
      local.set(loc, 0); local.set(name, 30); local.set(data, 30 + name.length);
      const cen = new Uint8Array(46), cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, off, true);
      const c = new Uint8Array(46 + name.length);
      c.set(cen, 0); c.set(name, 46);
      locals.push(local); cens.push(c); off += local.length;
    }
    const cdLen = cens.reduce((n, c) => n + c.length, 0);
    const e = new Uint8Array(22), ev = new DataView(e.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
    const all = [...locals, ...cens, e];
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  const meta = JSON.stringify({
    id: 'uitest_drop', name: '拖入测试模组', version: '1.0',
    depends: { minecraft: '26.3' }, authors: ['uitest']
  });
  const bytes = buildZip([{ name: 'fabric.mod.json', data: meta }]);
  const file = new File([bytes], 'uitest-drop.jar', { type: 'application/java-archive' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const box = document.querySelector('.import-drop');
  if (!box) return { ok: false, why: '找不到拖放框' };
  box.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { ok: true, size: bytes.length };
})()`;

async function packIds() {
  const root = await findProjectRoot();
  return evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(root)}))
    .then(r => r.json()).then(j => (j.packs || []).map(p => p.id)).catch(() => [])`);
}

try {
  await send('Page.navigate', { url: APP_URL });
  // 工程不止一个时会停在欢迎页，得先点进一个（优先 testmod）
  await waitFor(() => evaluate(`!!document.querySelector('.project-card, .nav-item')`), 20000);

  // ---------- 欢迎页的上手卡 ----------
  // 四条主路各一张卡，积木那张排第一（最不需要会编程的那条）。
  // 这里只查「有几张卡、积木卡是不是第一张」，不点 —— 点了就进工程了。
  {
    const wc = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.start-card')];
      return {
        n: cards.length,
        titles: cards.map(c => c.querySelector('.start-card-title')?.textContent || ''),
      };
    })()`);
    if (wc.n) {
      record('00-欢迎页 上手卡有四张', wc.n === 4 ? '通过' : `只有 ${wc.n} 张`);
      record('00-欢迎页 积木卡排第一', wc.titles[0]?.includes('积木') ? '通过' : `第一张是「${wc.titles[0]}」`);
      if (wc.n !== 4) problems.push({ kind: '欢迎页', text: `上手卡只有 ${wc.n} 张，应为 4 张` });
      if (!wc.titles[0]?.includes('积木')) problems.push({ kind: '欢迎页', text: '积木卡没排第一' });
    }
  }

  const entered = await evaluate(`(() => {
    if (document.querySelector('.nav-item')) return 'already';
    const cards = [...document.querySelectorAll('.project-card')];
    if (!cards.length) return '';
    const target = cards.find((c) => c.textContent.includes('testmod')) || cards[0];
    const name = target.querySelector('.project-name')?.textContent || '';
    target.click();
    return name;
  })()`);
  if (entered && entered !== 'already') {
    console.log(`  （欢迎页 → 进入工程 ${entered}）`);
    await sleep(900);
  }
  await waitFor(() => evaluate(`!!document.querySelector('.nav-item')`), 20000);
  await sleep(600);
  record('01-首屏', '打开工程后默认进入物品编辑');
  await shot('01-首屏');

  // 逐个内容类型
  const tabs = [
    ['方块', '02-方块'],
    ['配方', '03-配方'],
    ['矿物生成', '04-矿物生成'],
    ['工具材质', '05-工具材质'],
    ['盔甲材质', '06-盔甲材质'],
    ['进度', '13-进度'],
    ['物品', '07-物品'],
  ];
  for (const [label, file] of tabs) {
    const ok = await evaluate(`(() => {
      const hit = [...document.querySelectorAll('.nav-item')].find(b => (b.querySelector('.nav-text')?.textContent || '').trim() === ${JSON.stringify(label)});
      if (!hit) return false;
      hit.click();
      return true;
    })()`);
    if (!ok) {
      problems.push({ kind: '界面', text: `左侧找不到「${label}」` });
      continue;
    }
    await sleep(450);
    record(file, `切换到 ${label}`);
    await shot(file);
  }

  // 代码浏览
  const codeOpened = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '代码');
    if (!b) return false; b.click(); return true;
  })()`);
  if (codeOpened) {
    await sleep(900);
    record('08-代码浏览', '打开代码浏览器');
    await shot('08-代码浏览');
    await closeAnyModal();
    await sleep(300);
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「代码」按钮' });
  }

  // 校验
  // ---------- 效果库：捕获 → 存库 → 装回工程 ----------
  const clickByText = (sel, text, mode = 'eq') =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .find(x => ${mode === 'eq' ? `x.textContent.trim() === ${JSON.stringify(text)}` : `x.textContent.includes(${JSON.stringify(text)})`});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  if (await clickByText('.app-bar button', '库')) {
    await sleep(500);
    record('16-效果库', '切换到效果库面板');
    await shot('16-效果库');

    if (await clickByText('.panel-bar button', '从工程捕获', 'has')) {
      await sleep(400);
      const packsBefore = await packIds();
      await evaluate(`(() => {
        const inp = document.querySelector('.modal input[placeholder]');
        if (inp) inp.value = 'UI 测试包';
        const all = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === '全选');
        if (all) all.click();
        return true;
      })()`);
      await sleep(250);
      record('17-捕获对话框', '勾了内容的捕获弹窗');
      await shot('17-捕获对话框');

      if (await clickByText('.modal-foot button', '存进库', 'has')) {
        await sleep(900);
        const hasCard = await evaluate(`!!document.querySelector('.lib-card')`);
        if (!hasCard) problems.push({ kind: '界面', text: '捕获后库里没有出现卡片' });
        record('18-库里有了', '捕获的包出现在列表里');
        await shot('18-库里有了');
        for (const id of await packIds()) if (!packsBefore.includes(id)) createdPacks.push(id);

        // 点开详情 → 装回工程
        if (await evaluate(`(() => { const c = document.querySelector('.lib-card'); if (!c) return false; c.click(); return true; })()`)) {
          await sleep(700);
          record('19-包详情', '包的内容明细与操作按钮');
          await shot('19-包详情');

          if (await clickByText('.detail-actions button', '装进当前工程', 'has')) {
            await sleep(900);
            record('20-安装预览', '装之前先告诉你会发生什么');
            await shot('20-安装预览');
            // 真的点「装进去」会往当前工程写入内容。每跑一次就多一套，
            // 跑几十次工程里就是几百个 ruby_2 / ruby_3 —— 所以默认只看预览，
            // 要验写入加 --install（语义本身 tests/pack.mjs 已经覆盖）。
            if (!process.argv.includes('--install')) {
              await closeAnyModal();
              await sleep(300);
              record('21-装好了', '只到预览为止（加 --install 才会真写进工程）');
            } else if (await clickByText('.modal-foot button', '装进去', 'has')) {
              await sleep(1400);
              record('21-装好了', '内容已并入工程');
              await shot('21-装好了');
            }
          } else {
            problems.push({ kind: '界面', text: '包详情里找不到「装进当前工程」' });
          }
        }
      } else {
        problems.push({ kind: '界面', text: '捕获弹窗里没存成功' });
      }
    } else {
      problems.push({ kind: '界面', text: '效果库里找不到「从工程捕获」' });
    }
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「库」按钮' });
  }

  // ---------- 分析器 ----------
  if (await clickByText('.app-bar button', '分析')) {
    await sleep(500);
    record('22-分析面板', '分析面板初始态');
    await shot('22-分析面板');

    // 点第一个「最近的 jar」——优先挑一个本机构建的，省得依赖用户的游戏目录
    const picked = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.chip-btn')];
      if (!chips.length) return null;
      const mine = chips.find((c) => c.textContent.includes('本机构建')) || chips[0];
      mine.click();
      return mine.textContent.trim();
    })()`);
    if (picked) {
      // 分析要读 jar + 解 class，给够时间
      await waitFor(() => evaluate(`!!document.querySelector('.an-name')`), 30000, 300);
      const summary = await evaluate(`(() => {
        const name = document.querySelector('.an-name')?.textContent || '';
        const stats = [...document.querySelectorAll('.stat')].slice(0, 6).map(s => s.textContent.trim());
        const abilities = document.querySelectorAll('.ability-row').length;
        return { name, stats, abilities };
      })()`);
      record('23-分析报告', `分析 ${picked} → ${summary.name}，${summary.abilities} 项能力`);
      await shot('23-分析报告');

      if (!summary.abilities) problems.push({ kind: '界面', text: '分析报告里没有识别出任何能力' });

      // 勾一个效果模板，打包
      const checked = await evaluate(`(() => {
        const cb = [...document.querySelectorAll('.ability-row input[type=checkbox]')][0];
        if (!cb) return false;
        cb.click();
        return true;
      })()`);
      if (checked) {
        await sleep(200);
        if (await clickByText('.an-actions button', '打包选中的内容', 'has')) {
          await sleep(500);
          record('24-打包对话框', '把选中的内容和效果打包');
          await shot('24-打包对话框');
          await closeAnyModal();
          await sleep(300);
        }
      }

      // ---------- 存成笔记：分析结论沉淀进知识库 ----------
      // 这是「分析别人的 mod → 丰富自己」的落点。后端 tests/knowledge.mjs
      // 验过沉淀往返，这里验界面按钮真能点通、存完立刻能被检索到
      // （检索不到就等于 AI 引用不了，笔记白存）。
      // 跑完只删本次新建的，用户原有的学习记录不动。
      const beforeIds = await evaluate(
        `fetch('/api/knowledge/list').then(r=>r.json()).then(j=>(j.docs||[]).filter(d=>d.source==='learned').map(d=>d.id)).catch(()=>[])`,
      );
      if (await clickByText('.an-actions button', '存成笔记', 'has')) {
        const done = await waitFor(
          () => evaluate(`[...document.querySelectorAll('.an-actions button')].some(b => b.textContent.includes('已存'))`),
          25000, 300,
        ).catch(() => false);
        const after = await evaluate(
          `fetch('/api/knowledge/list').then(r=>r.json()).then(j=>(j.docs||[]).filter(d=>d.source==='learned').map(d=>({id:d.id,title:d.title}))).catch(()=>[])`,
        );
        const fresh = after.filter((d) => !beforeIds.includes(d.id));
        const hits = await evaluate(
          `fetch('/api/knowledge/search?q='+encodeURIComponent(${JSON.stringify(summary.name || '')})+'&limit=20').then(r=>r.json()).then(j=>(j.hits||[]).filter(h=>h.source==='learned').length).catch(()=>0)`,
        );
        record('24b-存成笔记', `按钮${done ? '已存' : '没确认'}；学习记录 ${after.length} 篇（本次新建 ${fresh.length}）；检索命中 ${hits} 段`);
        await shot('24b-存成笔记');
        if (!done) problems.push({ kind: '界面', text: '点「存成笔记」后按钮没有变成「已存」' });
        if (!after.length) problems.push({ kind: '界面', text: '存成笔记后知识库里没有学习记录' });
        if (!hits) problems.push({ kind: '界面', text: '刚存的学习笔记检索不到（AI 也就引用不了）' });
        for (const d of fresh) {
          const body = JSON.stringify({ id: d.id });
          await evaluate(`fetch('/api/knowledge/delete',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.json()).catch(()=>null)`);
        }
      } else {
        problems.push({ kind: '界面', text: '分析面板里找不到「存成笔记」' });
      }
    } else {
      problems.push({ kind: '界面', text: '分析面板里没有可点的 jar（本机没有现成的构建产物）' });
    }
    // ---------- 直接拖入别人的 jar ----------
    // 必须放在分析面板流程最后：它会替换 A.report，插在打包/存笔记前面会改掉前置数据。
    const dropStart = await evaluate(DROP_JAR_JS);
    if (dropStart?.ok) {
      const got = await waitFor(
        () => evaluate(`!!document.querySelector('.an-name')?.textContent?.includes('拖入测试模组')`),
        30000, 300,
      ).catch(() => false);
      const status = await evaluate(`document.querySelector('.import-status')?.textContent || ''`);
      record('24c-拖入 jar 直接分析', `拖入 ${dropStart.size} 字节 → ${got ? '自动出报告' : '没出报告'}；状态：${status.slice(0, 60)}`);
      await shot('24c-拖入 jar 直接分析');
      if (!got) problems.push({ kind: '界面', text: '拖入 jar 后没有自动分析出报告' });
      // 清掉本次上传的副本，别把测试垃圾留在用户目录
      const cached = await evaluate(
        `fetch('/api/analyze/uploads').then(r=>r.json()).then(j=>(j.jars||[]).find(x=>x.name.includes('uitest-drop'))?.path||'').catch(()=>'')`,
      );
      if (cached) {
        const body = JSON.stringify({ path: cached });
        await evaluate(`fetch('/api/analyze/upload-remove',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.json()).catch(()=>null)`);
      }
    } else {
      problems.push({ kind: '界面', text: `分析面板里找不到拖放区：${dropStart?.why || '未知'}` });
    }

    // 回编辑区，后面的步骤还要用
    await clickByText('.panel-bar button', '返回编辑', 'has');
    await sleep(400);
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「分析」按钮' });
  }

  // ---------- 拆解台：把导入的 mod 当成一个个可研究的东西 ----------
  // 真实 UI 路径：上传一个真有内容的 jar → 管理已导入 → 拆解 → 改数值 → 导出存库 → 校验改动落地。
  // 合成的最小 jar（只有 fabric.mod.json）没有 tier/物品，验不出数值编辑，
  // 所以用本机构建的 fallen 包（190KB），经页面 fetch 上传到服务端导入缓存。
  if (!FALLEN_B64) {
    problems.push({ kind: '环境', text: '拆解台测试：找不到 fallen-0.1.0.jar（先构建 fallen 工程）' });
  } else if (await clickByText('.app-bar button', '分析')) {
    await sleep(400);
    // 上传 fallen jar 到服务端导入缓存，使其出现在「管理已导入」列表里
    const up = await evaluate(`(async () => {
      const bin = Uint8Array.from(atob(${JSON.stringify(FALLEN_B64)}), c => c.charCodeAt(0));
      const r = await fetch('/api/analyze/upload', { method:'POST', headers:{'x-file-name':'fallen-uitest.jar'}, body: bin });
      const j = await r.json().catch(() => null);
      return j && j.path ? j.path : '';
    })()`);
    if (!up) {
      problems.push({ kind: '界面', text: '拆解台测试：fallen jar 上传到导入缓存失败' });
    } else {
      const opened = await clickByText('.analyze-panel button', '管理已导入…', 'has');
      if (!opened) {
        problems.push({ kind: '界面', text: '拆解台测试：分析面板找不到「管理已导入…」' });
      } else {
        await sleep(400);
        const clicked = await evaluate(`(() => {
          const row = [...document.querySelectorAll('.import-row')].find(r => r.textContent.includes('fallen'));
          if (!row) return false;
          const b = [...row.querySelectorAll('button')].find(x => x.textContent.trim() === '拆解');
          if (!b) return false;
          b.click();
          return true;
        })()`);
        if (!clicked) {
          problems.push({ kind: '界面', text: '拆解台测试：导入管理里找不到 fallen 的「拆解」入口' });
        } else {
          const loaded = await waitFor(
            () => evaluate(`!!document.querySelector('.inspect-nav .nav-item')`),
            20000, 300,
          ).catch(() => false);
          if (!loaded) {
            problems.push({ kind: '界面', text: '拆解台测试：点「拆解」后报告没加载（导航分组没出来）' });
          } else {
            // 切到「工具材质」分组（tier 才有耐久这种能改的数值）
            await evaluate(`(() => {
              const b = [...document.querySelectorAll('.inspect-nav .nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '工具材质');
              if (b) b.click();
            })()`);
            // 默认全选，改第一个 tier 卡片的耐久字段
            const edited = await waitFor(
              () => evaluate(`(() => {
                const card = document.querySelector('.inspect-main .card');
                if (!card) return false;
                const input = card.querySelector('.card-fields .field input.input.sm');
                if (!input) return false;
                input.value = '2222';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              })()`),
              8000, 200,
            ).catch(() => false);
            if (!edited) {
              problems.push({ kind: '界面', text: '拆解台测试：工具材质分组没有可编辑的耐久输入框' });
            } else {
              const exported = await clickByText('.inspect-main button', '导出为包（存库）', 'has');
              if (!exported) {
                problems.push({ kind: '界面', text: '拆解台测试：工具材质工具栏找不到「导出为包（存库）」' });
              } else {
                // promptBox：填名字、点确定
                const named = await waitFor(
                  () => evaluate(`(() => {
                    const box = document.querySelector('.modal input.input');
                    if (!box) return false;
                    box.value = 'UITest 拆解包';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                    const ok = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === '确定');
                    if (ok) { ok.click(); return true; }
                    return false;
                  })()`),
                  8000, 200,
                ).catch(() => false);
                if (!named) {
                  problems.push({ kind: '界面', text: '拆解台测试：导出对话框（promptBox）没弹出来' });
                } else {
                  const rootI = await findProjectRoot();
                  const validated = await waitFor(async () => {
                    const packs = await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI)})).then(r => r.json()).then(j => j.packs || []).catch(() => [])`);
                    const pk = packs.find((p) => p.name === 'UITest 拆解包');
                    if (!pk) return false;
                    const detail = await evaluate(`fetch('/api/library/pack?root=' + encodeURIComponent(${JSON.stringify(rootI)}) + '&id=' + encodeURIComponent(${JSON.stringify(pk.id)})).then(r => r.json()).then(j => j.pack || null).catch(() => null)`);
                    if (!detail) return false;
                    const tiers = (detail.content && detail.content.entries && detail.content.entries.tier) || [];
                    return tiers.some((t) => t.durability === 2222) ? { id: pk.id, n: tiers.length } : false;
                  }, 15000, 400).catch(() => false);
                  record('24d-拆解台导出', validated ? `改耐久 2222 已随包存库（tier ${validated.n} 项，包 ${validated.id}）` : '改后的数值没出现在导出的包里');
                  if (!validated) problems.push({ kind: '界面', text: '拆解台测试：导出后包里 tier 的 durability 没变成 2222（改动没落地）' });
                  else {
                    // 收尾：删掉本次造的包
                    await evaluate(`fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI)}, id: ${JSON.stringify(validated.id)} }) }).then(r => r.json()).catch(() => null)`);
                  }
                }
              }
            }
          }
          // 关掉可能残留的弹窗，回到编辑区
          await closeAnyModal();
          await sleep(200);
          await clickByText('.inspect-panel .panel-bar button', '返回', 'has');
          await sleep(400);
        }
      }

      // ---------- 扩展工具：Goety 的自定义配方 / 聚晶 / 套装词条 ----------
      // Goety jar 已经在服务端导入缓存里（不用再传 15MB），直接点「拆解」进拆解台，
      // 验证：扩展注册的新分组出现在导航里 → 扩展字段能改 → 改动随包导出并落库。
      if (await clickByText('.app-bar button', '分析')) {
        await sleep(400);
        if (await clickByText('.analyze-panel button', '管理已导入…', 'has')) {
          await sleep(500);
          const goetyOpened = await evaluate(`(() => {
            const row = [...document.querySelectorAll('.import-row')].find(r => /goetyrevelation/i.test(r.textContent));
            if (!row) return false;
            const b = [...row.querySelectorAll('button')].find(x => x.textContent.trim() === '拆解');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          if (!goetyOpened) {
            record('24e-扩展分组', '导入缓存里没有 GoetyRevelation，跳过扩展 UI 校验');
          } else {
            const ready = await waitFor(() => evaluate(`!!document.querySelector('.inspect-nav .nav-item')`), 30000, 300).catch(() => false);
            const navs = ready ? await evaluate(`[...document.querySelectorAll('.inspect-nav .nav-text')].map(x => x.textContent.trim())`) : [];
            const extGroups = navs.filter((t) => ['聚晶', '套装词条', '仪式/熔炉配方'].includes(t));
            if (!ready) {
              problems.push({ kind: '界面', text: '扩展测试：点「拆解」后 Goety 报告没加载出来' });
            } else if (extGroups.length < 3) {
              problems.push({ kind: '界面', text: `扩展测试：拆解台导航里缺少扩展分组（现有 ${navs.join('/')}）` });
            } else {
              // 切到「聚晶」，把「等级」改成 8
              await evaluate(`(() => {
                const b = [...document.querySelectorAll('.inspect-nav .nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '聚晶');
                if (b) b.click();
              })()`);
              const edited = await waitFor(() => evaluate(`(() => {
                const row = [...document.querySelectorAll('.inspect-main .card .field')].find(f => (f.querySelector('.field-l')?.textContent || '').trim() === '等级');
                if (!row) return false;
                const input = row.querySelector('input.input.sm');
                if (!input) return false;
                input.value = '8';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              })()`), 10000, 200).catch(() => false);
              if (!edited) {
                problems.push({ kind: '界面', text: '扩展测试：聚晶分组里没有「等级」输入框' });
              } else {
                const rootI2 = await findProjectRoot();
                // 先清掉可能残留的同名包，避免存库时撞 id
                await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI2)})).then(r => r.json()).then(j => (j.packs || []).filter(p => p.name === 'UITest Goety 扩展包')).then(ps => Promise.all(ps.map(p => fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI2)}, id: p.id }) })))).then(() => true).catch(() => null)`);
                const exported = await clickByText('.inspect-main button', '导出为包（存库）', 'has');
                if (!exported) {
                  problems.push({ kind: '界面', text: '扩展测试：找不到「导出为包（存库）」' });
                } else {
                  const named = await waitFor(() => evaluate(`(() => {
                    const box = document.querySelector('.modal input.input');
                    if (!box) return false;
                    box.value = 'UITest Goety 扩展包';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                    const ok = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === '确定');
                    if (ok) { ok.click(); return true; }
                    return false;
                  })()`), 10000, 200).catch(() => false);
                  if (!named) {
                    problems.push({ kind: '界面', text: '扩展测试：导出对话框没弹出来' });
                  } else {
                    const v2 = await waitFor(async () => {
                      const packs = await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI2)})).then(r => r.json()).then(j => j.packs || []).catch(() => [])`);
                      const pk = packs.find((p) => p.name === 'UITest Goety 扩展包');
                      if (!pk) return false;
                      const detail = await evaluate(`fetch('/api/library/pack?root=' + encodeURIComponent(${JSON.stringify(rootI2)}) + '&id=' + encodeURIComponent(${JSON.stringify(pk.id)})).then(r => r.json()).then(j => j.pack || null).catch(() => null)`);
                      if (!detail) return false;
                      const e = (detail.content && detail.content.entries) || {};
                      const focus = e.focus || [];
                      const recipes = e.goetyRecipe || [];
                      const hit = focus.find((f) => f.level === 8);
                      return (hit && recipes.length > 60) ? { id: pk.id, focus: focus.length, recipes: recipes.length, hit: hit.id } : false;
                    }, 60000, 700).catch(() => false);
                    record('24e-扩展分组', v2
                      ? `扩展分组 ${extGroups.join('/')} 已进拆解台；聚晶 ${v2.hit} 等级改成 8 并随包存库（聚晶 ${v2.focus} 条 · 自定义配方 ${v2.recipes} 条）`
                      : '扩展分组/改动没能在导出包里验证到');
                    if (!v2) problems.push({ kind: '界面', text: '扩展测试：导出包里没找到 level=8 的聚晶，或自定义配方没进包' });
                    else {
                      await evaluate(`fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI2)}, id: ${JSON.stringify(v2.id)} }) }).then(r => r.json()).catch(() => null)`);
                    }
                  }
                }
              }
            }
            await closeAnyModal();
            await sleep(200);
            await clickByText('.inspect-panel .panel-bar button', '返回', 'has');
            await sleep(400);
          }
        }
      }
      // ---------- 扩展工具：Goety 基础库的状态效果 / 法术 / 数值配置 ----------
      // 基础库 jar（goety-2.5.55.4，78MB）已在服务端导入缓存里。
      // 验证：五个新分组出现在导航里 → 法术的「灵魂消耗」能改 → 改动随包导出并落库。
      if (await clickByText('.app-bar button', '分析')) {
        await sleep(400);
        if (await clickByText('.analyze-panel button', '管理已导入…', 'has')) {
          await sleep(500);
          const baseOpened = await evaluate(`(() => {
            const row = [...document.querySelectorAll('.import-row')].find(r => /goety-2\\.5\\.55/i.test(r.textContent));
            if (!row) return false;
            const b = [...row.querySelectorAll('button')].find(x => x.textContent.trim() === '拆解');
            if (!b) return false;
            b.click();
            return true;
          })()`);
          if (!baseOpened) {
            record('24f-基础库效果', '导入缓存里没有 Goety 基础库，跳过基础库 UI 校验');
          } else {
            const ready = await waitFor(() => evaluate(`!!document.querySelector('.inspect-nav .nav-item')`), 60000, 400).catch(() => false);
            const navs = ready ? await evaluate(`[...document.querySelectorAll('.inspect-nav .nav-text')].map(x => x.textContent.trim())`) : [];
            const baseGroups = navs.filter((t) => ['状态效果', '法术', '数值配置', '酿造效果', '附魔'].includes(t));
            if (!ready) {
              problems.push({ kind: '界面', text: '基础库测试：点「拆解」后基础库报告没加载出来' });
            } else if (baseGroups.length < 5) {
              problems.push({ kind: '界面', text: `基础库测试：拆解台导航里缺少基础库分组（现有 ${navs.join('/')}）` });
            } else {
              // 切到「法术」，把第一张卡片的「灵魂消耗」改成 77
              await evaluate(`(() => {
                const b = [...document.querySelectorAll('.inspect-nav .nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '法术');
                if (b) b.click();
              })()`);
              const edited = await waitFor(() => evaluate(`(() => {
                const card = [...document.querySelectorAll('.inspect-main .card')].find(c =>
                  [...c.querySelectorAll('.field')].some(f => (f.querySelector('.field-l')?.textContent || '').trim() === '灵魂消耗'));
                if (!card) return false;
                const row = [...card.querySelectorAll('.field')].find(f => (f.querySelector('.field-l')?.textContent || '').trim() === '灵魂消耗');
                const input = row && row.querySelector('input.input.sm');
                if (!input) return false;
                input.value = '77';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return (card.querySelector('.card-id')?.textContent || '').trim();
              })()`), 15000, 250).catch(() => false);
              if (!edited) {
                problems.push({ kind: '界面', text: '基础库测试：法术分组里没有「灵魂消耗」输入框' });
              } else {
                const rootI3 = await findProjectRoot();
                await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI3)})).then(r => r.json()).then(j => (j.packs || []).filter(p => p.name === 'UITest Goety 基础库包')).then(ps => Promise.all(ps.map(p => fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI3)}, id: p.id }) })))).then(() => true).catch(() => null)`);
                const exported = await clickByText('.inspect-main button', '导出为包（存库）', 'has');
                if (!exported) {
                  problems.push({ kind: '界面', text: '基础库测试：找不到「导出为包（存库）」' });
                } else {
                  const named = await waitFor(() => evaluate(`(() => {
                    const box = document.querySelector('.modal input.input');
                    if (!box) return false;
                    box.value = 'UITest Goety 基础库包';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                    const ok = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === '确定');
                    if (ok) { ok.click(); return true; }
                    return false;
                  })()`), 15000, 250).catch(() => false);
                  if (!named) {
                    problems.push({ kind: '界面', text: '基础库测试：导出对话框没弹出来' });
                  } else {
                    const v3 = await waitFor(async () => {
                      const packs = await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI3)})).then(r => r.json()).then(j => j.packs || []).catch(() => [])`);
                      const pk = packs.find((p) => p.name === 'UITest Goety 基础库包');
                      if (!pk) return false;
                      const detail = await evaluate(`fetch('/api/library/pack?root=' + encodeURIComponent(${JSON.stringify(rootI3)}) + '&id=' + encodeURIComponent(${JSON.stringify(pk.id)})).then(r => r.json()).then(j => j.pack || null).catch(() => null)`);
                      if (!detail) return false;
                      const e = (detail.content && detail.content.entries) || {};
                      const spells = e.spell || [];
                      const cfg = e.spellConfig || [];
                      const effs = e.statusEffect || [];
                      const hit = spells.find((s) => s.id === edited);
                      return (hit && hit.soulCost === 77 && cfg.length > 1000 && effs.length > 100)
                        ? { id: pk.id, spells: spells.length, cfg: cfg.length, effs: effs.length, hit: hit.id }
                        : false;
                    }, 90000, 800).catch(() => false);
                    record('24f-基础库效果', v3
                      ? `基础库分组 ${baseGroups.join('/')} 已进拆解台；法术 ${v3.hit} 灵魂消耗改成 77 并随包存库（效果 ${v3.effs} · 法术 ${v3.spells} · 配置 ${v3.cfg}）`
                      : '基础库分组/改动没能在导出包里验证到');
                    if (!v3) problems.push({ kind: '界面', text: '基础库测试：导出包里没找到 soulCost=77 的法术，或配置条目没进包' });
                    else {
                      await evaluate(`fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI3)}, id: ${JSON.stringify(v3.id)} }) }).then(r => r.json()).catch(() => null)`);
                    }
                  }
                }
              }
            // 24g：改数值 → 预览生效产物 → 导出包里带 toml 覆写
            // 这一条验证的是「改了数值真的能生效」这条链路：
            // 光改条目不落文件等于没改，所以必须看到生成的 toml。
            const navs2 = await evaluate(`[...document.querySelectorAll('.inspect-nav .nav-text')].map(x => x.textContent.trim())`);
            const baseGroups2 = navs2.filter((t) => ['状态效果', '法术', '数值配置', '酿造效果', '附魔'].includes(t));
            if (baseGroups2.length < 5) {
              record('24g-数值回写', '基础库分组没出来，跳过数值回写校验');
            } else {
              await evaluate(`(() => {
                const b = [...document.querySelectorAll('.inspect-nav .nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '数值配置');
                if (b) b.click();
              })()`);
              await sleep(600);
              // 数值配置有 1579 条，界面每页只渲染 200 条（防卡顿），
              // 所以先用搜索框过滤到目标条目再改 —— 这也是正常用户会走的路径。
              const searched = await evaluate(`(() => {
                const box = document.querySelector('.inspect-main input.inspect-search');
                if (!box) return false;
                box.value = 'vexcost';
                box.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              })()`);
              if (!searched) problems.push({ kind: '界面', text: '数值回写测试：找不到搜索框' });
              await sleep(600);
              const cfgEdited = await waitFor(() => evaluate(`(() => {
                const card = [...document.querySelectorAll('.inspect-main .card')].find(c => {
                  const id = (c.querySelector('.card-id')?.textContent || '').trim();
                  return id && id.indexOf('vexcost') >= 0;
                });
                if (!card) return false;
                const row = [...card.querySelectorAll('.field')].find(f => (f.querySelector('.field-l')?.textContent || '').trim() === '数值');
                const input = row && row.querySelector('input.input.sm');
                if (!input) return false;
                input.value = '66';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return (card.querySelector('.card-id')?.textContent || '').trim();
              })()`), 20000, 300).catch(() => false);

              if (!cfgEdited) {
                problems.push({ kind: '界面', text: '数值回写测试：数值配置分组里找不到「数值」输入框' });
              } else {
                const prev = await clickByText('.inspect-main button', '预览生效产物', 'has');
                if (!prev) {
                  problems.push({ kind: '界面', text: '数值回写测试：找不到「预览生效产物」按钮' });
                } else {
                  const shown = await waitFor(() => evaluate(`(() => {
                    const files = [...document.querySelectorAll('.override-file')];
                    if (!files.length) return false;
                    const paths = files.map(f => (f.querySelector('.override-file-path')?.textContent || '').trim());
                    const toml = files.map(f => (f.querySelector('.override-file-content')?.textContent || '')).join('\\n');
                    return { paths: paths, hasValue: /=\\s*66/.test(toml) };
                  })()`), 20000, 300).catch(() => false);
                  record('24g-数值回写', shown
                    ? `预览生效产物：${shown.paths.join('、')}（新值已写入 ${shown.hasValue ? '是' : '否'}）`
                    : '预览生效产物没展示出生成的文件');
                  if (!shown) problems.push({ kind: '界面', text: '数值回写测试：预览面板里没看到生成的文件' });
                  else if (!shown.hasValue) problems.push({ kind: '界面', text: '数值回写测试：生成的 toml 里没有新值 66' });
                  await closeAnyModal();
                  await sleep(300);

                  // 再导一次包，确认包里带着这些覆写文件
                  const rootI4 = await findProjectRoot();
                  const exported2 = await clickByText('.inspect-main button', '导出为包（存库）', 'has');
                  if (exported2) {
                    const named2 = await waitFor(() => evaluate(`(() => {
                      const box = document.querySelector('.modal input.input');
                      if (!box) return false;
                      box.value = 'UITest Goety 数值回写包';
                      box.dispatchEvent(new Event('input', { bubbles: true }));
                      const ok = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === '确定');
                      if (!ok) return false;
                      ok.click();
                      return true;
                    })()`), 15000, 250).catch(() => false);
                    if (named2) {
                      const v4 = await waitFor(async () => {
                        const packs = await evaluate(`fetch('/api/library/packs?root=' + encodeURIComponent(${JSON.stringify(rootI4)})).then(r => r.json()).then(j => j.packs || []).catch(() => [])`);
                        const pk = packs.find((p) => p.name === 'UITest Goety 数值回写包');
                        if (!pk) return false;
                        const detail = await evaluate(`fetch('/api/library/pack?root=' + encodeURIComponent(${JSON.stringify(rootI4)}) + '&id=' + encodeURIComponent(${JSON.stringify(pk.id)})).then(r => r.json()).then(j => j.pack || null).catch(() => null)`);
                        if (!detail) return false;
                        const files = (detail.content && detail.content.files) || [];
                        const toml = files.find((f) => String(f.path).endsWith('.toml'));
                        const java = files.find((f) => String(f.path).endsWith('.java'));
                        if (!toml) return false;
                        return { id: pk.id, tomlPath: toml.path, hasValue: /=\s*66/.test(toml.content || ''), javaPath: java ? java.path : '' };
                      }, 90000, 800).catch(() => false);
                      record('24g2-包内覆写', v4
                        ? `包里带了 ${v4.tomlPath}${v4.javaPath ? ' 与 ' + v4.javaPath : ''}（新值已写入 ${v4.hasValue ? '是' : '否'}）`
                        : '导出包里没找到 toml 覆写文件');
                      if (!v4) problems.push({ kind: '界面', text: '数值回写测试：导出包里没有 toml 覆写文件' });
                      else if (!v4.hasValue) problems.push({ kind: '界面', text: '数值回写测试：包里 toml 没有新值 66' });
                      else {
                        await evaluate(`fetch('/api/library/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(rootI4)}, id: ${JSON.stringify(v4.id)} }) }).then(r => r.json()).catch(() => null)`);
                      }
                    }
                  }
                }
                await closeAnyModal();
                await sleep(200);
              }
            }
            }
            await closeAnyModal();
            await sleep(200);
            await clickByText('.inspect-panel .panel-bar button', '返回', 'has');
            await sleep(400);
          }

          // ---------- 24h：Goety Delight 附属包 ----------
          // 验证附属包的新分组（数值配置 / 状态效果 / 附魔 / 仪式料理配方）能进拆解台，
          // 并且改数值能生成它自己的 toml 覆写。
          if (await clickByText('.app-bar button', '分析')) {
            await sleep(400);
            if (await clickByText('.analyze-panel button', '管理已导入…', 'has')) {
              await sleep(500);
              const delightOpened = await evaluate(`(() => {
                const row = [...document.querySelectorAll('.import-row')].find(r => /goetydelight/i.test(r.textContent));
                if (!row) return false;
                const b = [...row.querySelectorAll('button')].find(x => x.textContent.trim() === '拆解');
                if (!b) return false;
                b.click();
                return true;
              })()`);
              if (!delightOpened) {
                record('24h-Delight分组', '导入缓存里没有 Goety Delight，跳过');
              } else {
                const dReady = await waitFor(() => evaluate(`!!document.querySelector('.inspect-nav .nav-item')`), 60000, 400).catch(() => false);
                const dNavs = dReady ? await evaluate(`[...document.querySelectorAll('.inspect-nav .nav-text')].map(x => x.textContent.trim())`) : [];
                const dGroups = dNavs.filter((t) => ['数值配置', '状态效果', '附魔', '仪式/料理配方'].includes(t));
                if (!dReady) {
                  problems.push({ kind: '界面', text: 'Delight 测试：点「拆解」后报告没加载出来' });
                } else if (dGroups.length < 4) {
                  problems.push({ kind: '界面', text: `Delight 测试：拆解台导航缺少附属包分组（现有 ${dNavs.join('/')}）` });
                } else {
                  // 切到「数值配置」，改一个数值，看有没有生成它自己的 toml
                  await evaluate(`(() => {
                    const b = [...document.querySelectorAll('.inspect-nav .nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '数值配置');
                    if (b) b.click();
                  })()`);
                  await sleep(700);
                  const dEdited = await waitFor(() => evaluate(`(() => {
                    const box = document.querySelector('.inspect-main input.inspect-search');
                    if (!box) return false;
                    box.value = 'cakeEffectRadius';
                    box.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                  })()`), 15000, 300).catch(() => false);
                  await sleep(700);
                  const dVal = await waitFor(() => evaluate(`(() => {
                    const card = [...document.querySelectorAll('.inspect-main .card')].find(c => {
                      const id = (c.querySelector('.card-id')?.textContent || '').trim();
                      return id && id.indexOf('cakeeffectradius') >= 0;
                    });
                    if (!card) return false;
                    const row = [...card.querySelectorAll('.field')].find(f => (f.querySelector('.field-l')?.textContent || '').trim() === '数值');
                    const input = row && row.querySelector('input.input.sm');
                    if (!input) return false;
                    input.value = '48';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    return (card.querySelector('.card-id')?.textContent || '').trim();
                  })()`), 20000, 300).catch(() => false);
                  if (!dVal) {
                    problems.push({ kind: '界面', text: 'Delight 测试：数值配置里找不到「数值」输入框' });
                  } else {
                    const dPrev = await clickByText('.inspect-main button', '预览生效产物', 'has');
                    if (!dPrev) {
                      problems.push({ kind: '界面', text: 'Delight 测试：找不到「预览生效产物」按钮' });
                    } else {
                      const dShown = await waitFor(() => evaluate(`(() => {
                        const files = [...document.querySelectorAll('.override-file')];
                        if (!files.length) return false;
                        const paths = files.map(f => (f.querySelector('.override-file-path')?.textContent || '').trim());
                        const toml = files.map(f => (f.querySelector('.override-file-content')?.textContent || '')).join('\\n');
                        return { paths: paths, hasValue: /=\\s*48/.test(toml) };
                      })()`), 20000, 300).catch(() => false);
                      record('24h-Delight分组', dShown
                        ? `附属包分组 ${dGroups.join('/')} 已进拆解台；预览产物 ${dShown.paths.join('、')}（新值已写入 ${dShown.hasValue ? '是' : '否'}）`
                        : '预览生效产物没展示出生成的文件');
                      if (!dShown) {
                        // 预览没出来时把现场 dump 出来 —— 界面只弹提示不报错，
                        // 不看 DOM 就只知道「没生成」，不知道是被什么挡住的。
                        const dump = await evaluate(`(() => ({
                          overrideFileCount: document.querySelectorAll('.override-file').length,
                          modalTitles: [...document.querySelectorAll('.modal-head h3')].map(x => x.textContent.trim()),
                          toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()),
                        }))()`);
                        problems.push({ kind: '界面', text: `Delight 测试：预览面板里没看到生成的文件（弹窗 ${dump.modalTitles.join('/') || '无'}；提示 ${dump.toasts.join('/') || '无'}；文件节点 ${dump.overrideFileCount}）` });
                      } else if (!dShown.hasValue) problems.push({ kind: '界面', text: 'Delight 测试：生成的 toml 里没有新值 48' });
                    }
                  }
                  await closeAnyModal();
                  await sleep(300);
                }
                await closeAnyModal();
                await sleep(200);
                await clickByText('.inspect-panel .panel-bar button', '返回', 'has');
                await sleep(400);
              }
            }
          }
        }
      }
      // 清掉本次上传的 fallen 副本，别把测试垃圾留在用户导入缓存
      await evaluate(`fetch('/api/analyze/upload-remove', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ path: ${JSON.stringify(up)} }) }).then(r => r.json()).catch(() => null)`);
    }
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「分析」按钮（拆解台测试跳过）' });
  }

  // ---------- 学习中心 ----------
  if (await clickByText('.app-bar button', '学习')) {
    const ready = await waitFor(() => evaluate(`!!document.querySelector('.kb-tree .kb-item')`), 15000, 200).catch(() => false);
    if (!ready) problems.push({ kind: '界面', text: '学习中心没加载出目录' });

    // 正文是异步取回来的（目录先到、文章后到），要等它渲染完再数代码块
    await waitFor(() => evaluate(`!!document.querySelector('.kb-article-title')`), 10000, 150).catch(() => {});
    const hasCode = await waitFor(() => evaluate(`document.querySelectorAll('.code-block').length > 0`), 8000, 200).catch(() => false);

    const kb = await evaluate(`(() => ({
      docs: document.querySelectorAll('.kb-item').length,
      trees: document.querySelectorAll('.kb-tree').length,
      cats: [...new Set([...document.querySelectorAll('.kb-cat')].map(x => x.textContent.replace(/\\d+$/, '').trim()))],
      stats: document.querySelector('.kb-stat-line')?.textContent || '',
      hint: document.querySelector('.kb-stat-hint')?.textContent || '',
      title: document.querySelector('.kb-article-title')?.textContent || '',
      active: document.querySelector('.kb-item.active .kb-item-title')?.textContent || '',
      blocks: document.querySelectorAll('.code-block').length,
      tables: document.querySelectorAll('.md-table').length,
    }))()`);
    record('25-学习中心', `${kb.stats}；目录 ${kb.docs} 项 · 分类 ${kb.cats.join('/')}`);
    await shot('25-学习中心');

    if (!kb.docs) problems.push({ kind: '界面', text: '学习中心目录是空的' });
    if (kb.trees !== 1) problems.push({ kind: '界面', text: `学习中心有 ${kb.trees} 个目录树（面板被重复挂载）` });
    if (!kb.title) problems.push({ kind: '界面', text: '学习中心没有默认打开一篇文档' });
    if (!hasCode || !kb.blocks) problems.push({ kind: '界面', text: '默认文档里没有渲染出代码块（markdown 渲染可能没生效）' });
    // 默认打开的那篇要在目录里高亮，否则用户不知道自己在看哪篇
    if (kb.title && !kb.active) problems.push({ kind: '界面', text: '当前打开的文档在目录里没有高亮' });

    // 点第二篇，确认真的换了一篇（标题必须变）
    const switched = await evaluate(`(() => {
      const items = [...document.querySelectorAll('.kb-item')];
      const next = items.find(x => !x.classList.contains('active'));
      if (!next) return null; next.click(); return next.querySelector('.kb-item-title')?.textContent || '';
    })()`);
    if (switched) {
      // 注意要等到「有标题且和上一篇不同」—— 只判断「变了」会被切换瞬间的空标题骗过
      const changed = await waitFor(
        () => evaluate(`(() => {
          const t = document.querySelector('.kb-article-title')?.textContent || '';
          return Boolean(t) && t !== ${JSON.stringify(kb.title)};
        })()`),
        8000,
        200,
      ).catch(() => false);
      const t2 = await evaluate(`document.querySelector('.kb-article-title')?.textContent || ''`);
      const blocks2 = await evaluate(`document.querySelectorAll('.code-block').length`);
      record('26-换一篇', `点「${switched}」→ ${t2 || '(空)'} · ${blocks2} 个代码块`);
      if (!changed) problems.push({ kind: '界面', text: `换一篇后正文没变（点了「${switched}」还停在「${kb.title}」）` });
      if (!t2) problems.push({ kind: '界面', text: '换一篇后正文是空的' });
      await shot('26-学习文档');
    }

    // 搜索：输入框是 debounce 的，要等一会儿
    const hit = await evaluate(`(() => {
      const i = document.querySelector('.kb-search');
      if (!i) return false;
      i.value = '注册物品';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (hit) {
      const got = await waitFor(() => evaluate(`document.querySelectorAll('.kb-hit').length > 0`), 6000, 200).catch(() => false);
      const n = await evaluate(`document.querySelectorAll('.kb-hit').length`);
      record('27-知识检索', got ? `搜「注册物品」命中 ${n} 段` : '搜「注册物品」没出结果');
      if (!got) problems.push({ kind: '界面', text: '知识库搜索没有结果' });
      await shot('27-知识检索');
    } else {
      problems.push({ kind: '界面', text: '学习中心找不到搜索框' });
    }

    // 代码块上的「装成钩子」：必须先看预览、再点确认，取消绝不落盘。
    // 挑一个干净的 java 片段（带 import/package 的会被静态检查拦掉，按钮本来就该禁用）。
    const rootForHook = await findProjectRoot();
    const hookListUrl = `/api/hooks/list?root=${encodeURIComponent(rootForHook)}`;
    const hooksBefore = await evaluate(`fetch(${JSON.stringify(hookListUrl)}).then(r => r.json()).then(j => j.hooks || [])`);
    const picked = await evaluate(`(() => {
      for (const b of document.querySelectorAll('.code-block')) {
        const lang = (b.querySelector('.code-lang')?.textContent || '').trim();
        if (lang.toLowerCase() !== 'java') continue;
        const code = b.querySelector('.code-body code')?.textContent || '';
        if (/^\\s*(import|package)\\s/m.test(code)) continue;
        const btn = [...b.querySelectorAll('.code-head button')].find(x => x.textContent.trim() === '装成钩子');
        if (!btn) continue;
        btn.click();
        return { len: code.length };
      }
      return null;
    })()`);
    if (!picked) {
      problems.push({ kind: '界面', text: 'Java 代码块上没有「装成钩子」按钮' });
    } else {
      // modal 是同步建的，预览数据要等一次生成预演；等落点出现再断言
      const shown = await waitFor(
        () => evaluate(`!!document.querySelector('.hook-target .mono') || !![...document.querySelectorAll('.hook-issue')].find(x => /预览失败/.test(x.textContent))`),
        15000, 200,
      ).catch(() => false);
      const box = await evaluate(`(() => ({
        target: document.querySelector('.hook-target')?.textContent || '',
        injected: (document.querySelector('.hook-injected')?.textContent || '').length,
        issues: [...document.querySelectorAll('.hook-issue')].map(x => x.textContent.trim()),
        meta: document.querySelector('.hook-meta')?.textContent || '',
        metaHtml: (document.querySelector('.hook-meta')?.outerHTML || '').slice(0, 240),
        confirmDisabled: document.querySelector('.modal-foot button.btn.primary')?.disabled ?? null,
        note: document.querySelector('.hook-note')?.textContent || '',
      }))()`);
      record('27b-装钩子预览', `[${box.meta.trim()}] 落点 ${box.target.slice(0, 60)} · 插入预览 ${box.injected} 字 · 检查 ${box.issues.length} 条`);
      await shot('27b-装钩子预览');
      if (!shown) problems.push({ kind: '界面', text: '点「装成钩子」没有弹出预览框' });
      if (!box.meta.trim()) problems.push({ kind: '界面', text: `预览框没显示目标工程与平台：${box.metaHtml}` });
      if (!box.injected) problems.push({ kind: '界面', text: '预览框里没有「插入之后」的真实代码' });
      if (!/生成/.test(box.note)) problems.push({ kind: '界面', text: '预览框没说明「还要点生成才生效」' });
      if (box.confirmDisabled !== false) problems.push({ kind: '界面', text: `干净代码的确认按钮不该被禁用（disabled=${box.confirmDisabled}）` });

      // 取消 → 工程数据必须原封不动
      await evaluate(`(() => {
        const b = [...document.querySelectorAll('.modal-foot button')].find(x => x.textContent.trim() === '取消');
        if (b) b.click(); return true;
      })()`);
      await sleep(250);
      const afterCancel = await evaluate(`fetch(${JSON.stringify(hookListUrl)}).then(r => r.json()).then(j => j.hooks || [])`);
      const closed = await evaluate(`!document.querySelector('.hook-install')`);
      if (!closed) problems.push({ kind: '界面', text: '点「取消」后预览框没关' });
      if (afterCancel.length !== hooksBefore.length) problems.push({ kind: '界面', text: '点「取消」竟然把钩子写进工程了' });

      // 再打开一次，这次真的确认
      await evaluate(`(() => {
        const btn = [...document.querySelectorAll('.code-block .code-head button')].find(x => x.textContent.trim() === '装成钩子');
        if (btn) btn.click(); return true;
      })()`);
      const ready2 = await waitFor(() => evaluate(`!!document.querySelector('.modal-foot button.btn.primary:not(:disabled)')`), 10000, 200).catch(() => false);
      if (!ready2) problems.push({ kind: '界面', text: '第二次打开预览时确认按钮没就绪' });
      else {
        await evaluate(`(() => { document.querySelector('.modal-foot button.btn.primary').click(); return true; })()`);
        const grew = await waitFor(
          () => evaluate(`fetch(${JSON.stringify(hookListUrl)}).then(r => r.json()).then(j => j.hooks.length === ${hooksBefore.length + 1})`),
          10000, 250,
        ).catch(() => false);
        record('27c-确认装钩子', grew ? `用户确认后钩子 +1（共 ${hooksBefore.length + 1}）` : '确认后钩子没有落盘');
        if (!grew) problems.push({ kind: '界面', text: '点「确认装进去」后工程里没有新钩子' });

        // 只删本次新增的那个，不动用户已有钩子
        await evaluate(`fetch(${JSON.stringify(hookListUrl)}).then(r => r.json()).then(j => {
          const extra = (j.hooks || []).filter(h => !((${JSON.stringify(hooksBefore.map(h => h.id))}).includes(h.id)));
          return Promise.all(extra.map(h => fetch('/api/hooks/remove', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: ${JSON.stringify(rootForHook)}, id: h.id }),
          })));
        }).then(() => true).catch(() => false)`);
        await sleep(300);
        const cleaned = await evaluate(`fetch(${JSON.stringify(hookListUrl)}).then(r => r.json()).then(j => j.hooks.length === ${hooksBefore.length})`);
        if (!cleaned) problems.push({ kind: '界面', text: '装钩子的界面测试没把新增钩子清理掉' });
      }
      // onChanged 会重渲染面板，等代码块和按钮一起回来再继续下一步
      await waitFor(
        () => evaluate(`[...document.querySelectorAll('.code-block .code-head button')].some(x => x.textContent.trim() === '问 AI')`),
        15000, 200,
      ).catch(() => false);
    }

    // 代码块上的「问 AI」：把这段代码带进 AI 面板，而不是只把人送过去
    const asked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('.code-block .code-head button')].find(x => x.textContent.trim() === '问 AI');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!asked) {
      const dump = await evaluate(`(() => ({
        blocks: document.querySelectorAll('.code-block').length,
        btns: [...document.querySelectorAll('.code-block .code-head button')].map(x => x.textContent.trim()),
        panel: document.querySelector('.full-panel')?.className || '',
        modal: !!document.querySelector('.modal-host'),
      }))()`);
      problems.push({ kind: '界面', text: `代码块上没有「问 AI」按钮 ${JSON.stringify(dump)}` });
    } else {
      const jumped = await waitFor(() => evaluate(`!!document.querySelector('.ai-composer')`), 8000, 200).catch(() => false);
      await closeAnyModal();
      await sleep(200);
      const draft = await evaluate(`document.querySelector('.ai-composer textarea')?.value || ''`);
      record('26b-问AI', draft ? `代码块「问 AI」→ 输入框带上 ${draft.length} 字草稿` : '代码块「问 AI」没把内容带过去');
      if (!jumped) problems.push({ kind: '界面', text: '点「问 AI」没跳到 AI 面板' });
      if (!draft) problems.push({ kind: '界面', text: '点「问 AI」后输入框是空的' });
      await shot('26b-问AI');
    }

    // 返回编辑
    await clickByText('.panel-bar button', '返回编辑', 'has');
    await sleep(400);
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「学习」按钮' });
  }

  // ---------- AI 面板 ----------
  if (await clickByText('.app-bar button', 'AI')) {
    const ready = await waitFor(() => evaluate(`!!document.querySelector('.ai-composer')`), 10000, 200).catch(() => false);
    if (!ready) problems.push({ kind: '界面', text: 'AI 面板没加载出来' });

    const cfg = await evaluate(`fetch('/api/ai/config').then(r => r.json()).catch(() => null)`);
    const hasKey = Boolean(cfg?.config?.hasKey);

    // 没配 key 时进来会直接弹设置框（比先给一个空白输入框友好）
    const autoSettings = await waitFor(() => evaluate(`!!document.querySelector('.ai-settings')`), 3000, 150).catch(() => false);
    if (!hasKey) {
      record('28-AI面板', autoSettings ? '首次进入自动弹出配置框' : '首次进入没自动弹配置框');
      if (!autoSettings) problems.push({ kind: '界面', text: '没配 key 时进 AI 面板没有引导配置' });
      await shot('28-AI面板');
      await closeAnyModal();
      await sleep(300);
    }

    const ai = await evaluate(`(() => ({
      welcome: document.querySelectorAll('.ai-welcome').length,
      chips: document.querySelectorAll('.ai-chips button').length,
      composer: document.querySelectorAll('.ai-composer textarea, .ai-composer input').length,
    }))()`);
    record('28b-欢迎页', `欢迎区 ${ai.welcome} · 示例问题 ${ai.chips} 个 · 输入框 ${ai.composer} 个`);
    if (!ai.chips) problems.push({ kind: '界面', text: 'AI 欢迎页没有示例问题' });
    if (!ai.composer) problems.push({ kind: '界面', text: 'AI 面板没有输入框' });
    await shot('28b-AI欢迎页');

    // 没配 key 时点一个问题：不该渲染错误卡片，而是把设置框弹出来 ——
    // 少一步「看到报错→自己找设置」，比报错更有用。
    // 注意示例问题是「填进输入框」而不是直接发送，得自己点发送。
    if (!hasKey) {
      const filled = await evaluate(`(() => {
        const b = document.querySelector('.ai-chips button');
        if (!b) return '';
        b.click();
        const i = document.querySelector('.ai-composer textarea');
        return i ? i.value : '';
      })()`);
      record('28c-示例问题', filled ? `点示例 → 输入框变成「${filled.slice(0, 18)}」` : '点示例问题没填进输入框');
      if (!filled) problems.push({ kind: '界面', text: '点示例问题没把问题填进输入框' });

      if (filled) {
        const sent = await evaluate(`(() => {
          const b = [...document.querySelectorAll('.ai-composer button')].find(x => x.textContent.trim() === '发送');
          if (!b) return false; b.click(); return true;
        })()`);
        if (!sent) problems.push({ kind: '界面', text: 'AI 面板没有「发送」按钮' });
        const opened = await waitFor(() => evaluate(`!!document.querySelector('.ai-settings')`), 8000, 200).catch(() => false);
        const info = await evaluate(`(() => ({
          presets: document.querySelectorAll('.ai-settings select option').length,
          keyField: document.querySelectorAll('.ai-settings input[type=password]').length,
          test: [...document.querySelectorAll('.ai-settings button')].some(b => b.textContent.includes('测试连接')),
          hint: [...document.querySelectorAll('.ai-settings .field-hint')].map(x => x.textContent).find(t => /不会上传|只存在/.test(t)) || '',
        }))()`);
        record('29-AI未配置', `无 key 发送 → 弹出设置框（预设 ${info.presets} 个 · key 框 ${info.keyField} · 测试按钮 ${info.test ? '有' : '无'}）`);
        if (!opened) problems.push({ kind: '界面', text: '没配 key 时发送没有引导去设置' });
        else {
          if (!info.keyField) problems.push({ kind: '界面', text: 'AI 设置里没有 key 输入框' });
          if (!info.test) problems.push({ kind: '界面', text: 'AI 设置里没有「测试连接」' });
          if (!info.hint) problems.push({ kind: '界面', text: 'AI 设置没说明 key 存在哪' });
        }
        await shot('29-AI未配置');
        await closeAnyModal();
        await sleep(300);
      }
    } else {
      const fire = () => evaluate(`(() => {
        const b = document.querySelector('.ai-chips button');
        if (b) b.click();
        const s = [...document.querySelectorAll('.ai-composer button')].find(x => x.textContent.trim() === '发送');
        if (!s) return false;
        s.click();
        return true;
      })()`);

      // ---- 第一轮：验证「停止」能中止且保留已生成的字 ----
      // 慢速 mock（每段 400ms）让我们来得及在流式进行中点下去。
      const sent0 = await fire();
      if (!sent0) problems.push({ kind: '界面', text: 'AI 面板没有「发送」按钮' });

      const becameStop = await waitFor(
        () => evaluate(`(document.querySelector('.ai-send')?.textContent || '').trim() === '停止' && (document.querySelector('.ai-stream-text')?.textContent || '').length > 0`),
        10000, 100,
      ).catch(() => false);
      record('29-流式进行中', becameStop ? '发送键变「停止」，纯文本增量输出' : '没观察到流式进行态');
      if (!becameStop) problems.push({ kind: '界面', text: '流式输出期间发送键没有变成「停止」' });
      if (becameStop) await evaluate(`(() => { const b = document.querySelector('.ai-send'); if (b) b.click(); return true; })()`);

      const settled = await waitFor(
        () => evaluate(`(document.querySelector('.ai-send')?.textContent || '').trim() === '发送' && !document.querySelector('.ai-stream-text')`),
        15000, 150,
      ).catch(() => false);
      const stopInfo = await evaluate(`(() => {
        const list = [...document.querySelectorAll('.ai-msg.assistant')];
        const a = list[list.length - 1];
        return { text: (a?.querySelector('.ai-bubble')?.textContent || '').length, meta: a?.querySelector('.ai-meta')?.textContent || '' };
      })()`);
      record('29-流式停止', settled ? `点停止 → 保留 ${stopInfo.text} 字 · ${stopInfo.meta}` : '停止后界面没复位');
      if (!settled) problems.push({ kind: '界面', text: '点停止后流式状态没有结束' });
      else if (!/已停止/.test(stopInfo.meta)) problems.push({ kind: '界面', text: `停止后没标「已停止」：${stopInfo.meta}` });
      else if (!stopInfo.text) problems.push({ kind: '界面', text: '点停止后把已生成的文字丢了' });
      await shot('29-流式停止');

      // 清掉这一轮，重新完整跑一遍看回答/引用/代码块
      await clickByText('.panel-bar button', '清空对话', 'has');
      await sleep(250);
      const reset = await evaluate(`(() => ({
        chips: document.querySelectorAll('.ai-chips button').length,
        assistants: document.querySelectorAll('.ai-msg.assistant').length,
      }))()`);
      if (!reset.chips || reset.assistants) {
        problems.push({ kind: '界面', text: '「清空对话」没有把欢迎页和旧消息复位' });
      }
      const filled2 = await evaluate(`(() => {
        const b = document.querySelector('.ai-chips button');
        if (b) b.click();
        return document.querySelector('.ai-composer textarea')?.value || '';
      })()`);
      const afterSend2 = await evaluate(`(() => {
        const s = [...document.querySelectorAll('.ai-composer button')].find(x => x.textContent.trim() === '发送');
        if (!s) return 'NOBTN';
        s.click();
        return document.querySelector('.ai-send')?.textContent || '';
      })()`);
      const sent = afterSend2 !== 'NOBTN' && Boolean(filled2);
      if (!sent) problems.push({ kind: '界面', text: '清空对话后找不到「发送」按钮或没填上问题' });

      // 只等 `.ai-msg.assistant` 出现会在第一个字之前就返回，读到空回答；
      // 必须等发送键复位 + 纯文本占位消失，那才是 markdown 渲染完的时刻。
      const got = await waitFor(
        () => evaluate(`(document.querySelector('.ai-send')?.textContent || '').trim() === '发送' && !!document.querySelector('.ai-msg.assistant') && !document.querySelector('.ai-stream-text')`),
        90000, 400,
      ).catch(() => false);
      const info = await evaluate(`(() => {
        const a = document.querySelector('.ai-msg.assistant');
        return {
          user: Boolean(document.querySelector('.ai-msg.user')),
          textLen: (a?.querySelector('.ai-bubble')?.textContent || '').length,
          code: a?.querySelectorAll('.code-block').length || 0,
          sources: a?.querySelectorAll('.ai-source').length || 0,
          meta: a?.querySelector('.ai-meta')?.textContent || '',
        };
      })()`);
      record('29-AI回答', `回答 ${info.textLen} 字 · 代码块 ${info.code} · 引用 ${info.sources} 条 · ${info.meta || '(无用量)'}`);
      if (!got) problems.push({ kind: '界面', text: 'AI 回答没渲染出来' });
      if (!info.user) problems.push({ kind: '界面', text: '提问没显示成用户气泡' });
      if (!info.textLen) problems.push({ kind: '界面', text: 'AI 回答是空的' });
      if (!info.sources) problems.push({ kind: '界面', text: 'AI 回答没带引用来源' });
      // 流式期间是纯文本，结束后必须整篇换成 markdown，代码块才出得来
      if (!info.code) problems.push({ kind: '界面', text: '流式结束后回答里的代码块没渲染成 markdown' });
      await shot('29-AI回答');

      // 点一条引用，应该跳回学习中心那一节
      if (info.sources) {
        const jumped = await evaluate(`(() => {
          const b = document.querySelector('.ai-source');
          if (!b) return ''; b.click(); return b.textContent;
        })()`);
        const back = await waitFor(() => evaluate(`!!document.querySelector('.kb-article-title')`), 8000, 200).catch(() => false);
        record('29b-引用跳转', back ? `点「${jumped}」→ 回到学习中心` : '点引用没跳回学习中心');
        if (!back) problems.push({ kind: '界面', text: '点 AI 的引用来源没跳回学习中心' });
        await shot('29b-引用跳转');
      }
      await clickByText('.panel-bar button', '返回编辑', 'has');
      await sleep(300);
    }

    await clickByText('.panel-bar button', '返回编辑', 'has');
    await sleep(400);
  } else {
    problems.push({ kind: '界面', text: '顶栏找不到「AI」按钮' });
  }

  const preflight = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '校验');
    if (!b) return false; b.click(); return true;
  })()`);
  if (preflight) {
    await sleep(900);
    record('09-校验', '点校验看报告');
    await shot('09-校验');
    await closeAnyModal();
    await sleep(300);
  }

  // 模块管理
  const mods = await evaluate(`(() => {
    const b = [...document.querySelectorAll('.nav-item')].find(x => (x.querySelector('.nav-text')?.textContent || '').trim() === '模块管理');
    if (!b) return false; b.click(); return true;
  })()`);
  if (mods) {
    await sleep(900);
    record('10-模块管理', '看模块注册表');
    await shot('10-模块管理');
    await closeAnyModal();
    await sleep(300);
  } else {
    problems.push({ kind: '界面', text: '左侧找不到「模块管理」' });
  }

  // 贴图来源各模式（自动 / 原版改色 / 矿石合成 / 自己画）
  const modes = await evaluate(`(() => {
    return [...document.querySelectorAll('.texture-picker .seg-btn')].map(b => b.textContent.trim());
  })()`);
  record('11-贴图模式', '贴图来源模式：' + JSON.stringify(modes));

  // DOM 健康检查
  const dirty = await evaluate(`(() => {
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (!t) continue;
      // null 也扫：Element.append(null) 会留下一个内容为 "null" 的文本节点，
      // 这种 bug 在截图里很容易被忽略，但在页面上就是一个突兀的 null
      if (/(^|\\s)undefined(\\s|$)|(^|\\s)null(\\s|$)|NaN|\\[object Object\\]/.test(t)) {
        bad.push(t.trim().slice(0, 60));
        if (bad.length > 8) break;
      }
    }
    return bad;
  })()`);
  if (dirty.length) problems.push({ kind: '界面', text: `界面出现脏值：${dirty.join(' | ')}` });

  // 可选：真的点一次「构建 jar」，验证日志轮询与产物展示
  if (process.argv.includes('--build')) {
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('构建 jar'));
      if (!b) return false; b.click(); return true;
    })()`);
    if (!clicked) {
      problems.push({ kind: '界面', text: '顶栏找不到「构建 jar」' });
    } else {
      await sleep(2500);
      await shot('14-构建中');
      const done = await waitFor(
        () => evaluate(`document.body.innerText.includes('BUILD SUCCESSFUL') || document.body.innerText.includes('构建失败')`),
        180000,
        800,
      ).catch(() => false);
      record('14-构建', done ? '构建跑完并显示了结果' : '构建等待超时');
      if (!done) problems.push({ kind: '构建', text: '等不到构建结果' });
      await shot('15-构建完成');
    }
  }

  // ---------- 收尾：删掉本次测试造出来的包 ----------
  // 测试该自己收拾。不清的话跑十次库里就有十个「UI 测试包」，
  // 下次真用编辑器的人（我自己）还得先分辨哪个是测试留下的。
  if (createdPacks.length) {
    const root = await findProjectRoot();
    let gone = 0;
    for (const id of createdPacks) {
      const okDel = await evaluate(
        `fetch('/api/library/delete', { method: 'POST', headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ root: ${JSON.stringify(root)}, id: ${JSON.stringify(id)} }) })
           .then(r => r.json()).then(j => j.ok !== false).catch(() => false)`,
      );
      if (okDel) gone++;
    }
    record('30-收尾', `删掉本次测试建的 ${gone}/${createdPacks.length} 个包`);
  }

  const counts = await evaluate(`(() => ({
    nav: document.querySelectorAll('.nav-item').length,
    fields: document.querySelectorAll('.field, .form-field, .row').length,
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input, select, textarea').length,
  }))()`);
  record('12-DOM 统计', JSON.stringify(counts));

  // ---------- 界面体检：抓「el() 把子节点当属性」这类静默丢失 ----------
  // 症状：元素上出现名为 0/1/2 的属性（Object.entries(节点) 的副产品）。
  const junk = await evaluate(`(() => {
    const bad = [];
    for (const node of document.querySelectorAll('*')) {
      for (const a of node.getAttributeNames()) {
        if (/^\\d+$/.test(a)) { bad.push(node.tagName.toLowerCase() + '.' + a + '=' + node.getAttribute(a)); break; }
      }
    }
    return bad.slice(0, 8);
  })()`);
  if (junk.length) {
    problems.push({ kind: '界面', text: `有元素把子节点写进了属性位置（内容被静默丢掉）：${junk.slice(0, 3).join(' / ')}` });
  } else {
    record('12b-属性体检', '没有「子节点写进属性位置」这类静默丢失');
  }

  // ---------- 积木编辑器 ----------
  // 覆盖：进视图 → 加事件 → 加语句 → 改参数 → 拖进容器 → 编译预览
  {
    const vb = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const q = (s) => document.querySelector(s);
      const qa = (s) => [...document.querySelectorAll(s)];
      const out = {};

      // 从顶栏进「积木」视图
      const btn = qa('.app-bar button').find(b => b.textContent.trim() === '积木');
      if (!btn) { out.err = '顶栏没有「积木」按钮'; return out; }
      btn.click();
      await sleep(2000);
      out.panel = !!q('.visual-panel');
      out.cats = qa('.vb-cat').length;
      out.libItems = qa('.vb-palette-item').length;

      // 展开事件分类，加一个事件帽
      const evtHead = qa('.vb-cat-head').find(h => h.textContent.includes('事件'));
      if (evtHead && !qa('.vb-palette-item').some(i => i.dataset.op?.startsWith('event.'))) {
        evtHead.click(); await sleep(400);
      }
      const evt = qa('.vb-palette-item').find(i => i.dataset.op?.startsWith('event.'));
      if (!evt) { out.err = '事件分类里没有事件积木'; return out; }
      evt.click(); await sleep(800);
      out.programs = qa('.vb-program').length;
      out.hat = !!q('.vb-program-hat .vb');

      // 加一条语句积木
      const pHead = qa('.vb-cat-head').find(h => h.textContent.includes('玩家'));
      if (pHead) { pHead.click(); await sleep(400); }
      const msg = qa('.vb-palette-item').find(i => i.dataset.op === 'player.message');
      if (!msg) { out.err = '玩家分类里没有消息积木'; return out; }
      msg.click(); await sleep(800);

      const progs = qa('.vb-program');
      const stack = progs[progs.length - 1].querySelector('.vb-program-stack');
      out.stack = stack ? stack.querySelectorAll(':scope > .vb').length : -1;
      out.hasInput = !!stack?.querySelector('input.vb-input-field');
      out.hasSelect = !!stack?.querySelector('select.vb-field-select');

      // 改参数（这个改动必须在后面的预览里能看见 —— 曾经丢过）
      const input = stack?.querySelector('input.vb-input-field');
      if (input) {
        input.value = '冒烟测试消息';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
      }

      // 加 if，验证容器槽
      const fHead = qa('.vb-cat-head').find(h => h.textContent.includes('流程'));
      if (fHead) { fHead.click(); await sleep(400); }
      const ifItem = qa('.vb-palette-item').find(i => i.dataset.op === 'flow.if');
      if (ifItem) { ifItem.click(); await sleep(800); }
      const stack2 = qa('.vb-program')[qa('.vb-program').length - 1].querySelector('.vb-program-stack');
      out.bodySlot = !!stack2?.querySelector('.vb-body');

      // 往容器里放一条积木（模拟拖放）
      const body = stack2?.querySelector('.vb-body');
      if (body) {
        const dt = new DataTransfer();
        dt.setData('application/x-mcstudio-block', 'player.heal');
        body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await sleep(800);
      }
      const stack3 = qa('.vb-program')[qa('.vb-program').length - 1].querySelector('.vb-program-stack');
      out.bodyKids = stack3?.querySelector('.vb-body')?.querySelectorAll(':scope > .vb').length || 0;

      // 编译预览
      const prev = qa('button').find(b => b.textContent.includes('编译预览'));
      if (prev) { prev.click(); await sleep(2500); }
      const code = q('.vb-code')?.textContent || '';
      out.code = !!code;
      out.hasMsg = code.includes('冒烟测试消息');
      out.hasHeal = /player\\.heal\\(/.test(code);
      out.hasIf = /if\\s*\\(/.test(code);

      return out;
    })()`);

    if (vb.err) {
      problems.push({ kind: '积木', text: vb.err });
    } else {
      const checks = [
        ['积木面板渲染', vb.panel],
        ['积木分类有内容', vb.cats > 0 && vb.libItems > 0],
        ['事件帽能加出程序', vb.programs >= 1 && vb.hat],
        ['语句积木接上了', vb.stack >= 1],
        ['积木上有输入框和下拉', vb.hasInput && vb.hasSelect],
        ['if 有容器槽', vb.bodySlot],
        ['能往容器里放积木', vb.bodyKids === 1],
        ['编译预览出代码', vb.code],
        ['改过的参数进了代码', vb.hasMsg],
        ['容器里的积木进了代码', vb.hasHeal],
        ['条件结构进了代码', vb.hasIf],
      ];
      for (const [name, cond] of checks) {
        if (cond) record('31-积木 ' + name, '通过');
        else problems.push({ kind: '积木', text: name + '：没通过' });
      }
      await evaluate(`document.querySelector('.visual-canvas')?.scrollTo(0, 0)`);
    }
  }

  // ---------- 积木入门向导 ----------
  // 覆盖：打开向导 → 步进 → 「带我做」真的操作界面 → 最后一步「完成」能收掉面板
  // 关键回归点：面板重绘必须用 setContent 而不是 fill（fill 是追加，
  // 会叠出好几层向导，点「下一步」动的是最早那层，界面看着像没反应）。
  {
    const gd = await evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const q = (s) => document.querySelector(s);
      const qa = (s) => [...document.querySelectorAll(s)];
      const out = {};

      // 清空工程里存着的积木程序，让向导从干净状态开始
      const chip = q('.proj-chip')?.textContent || '';
      const curId = chip.trim().split(/\\s+/).pop() || '';
      const list = await fetch('/api/projects').then(r => r.json()).catch(() => null);
      const hit = (list?.projects || []).find(p => p.id === curId);
      if (hit) {
        await fetch('/api/visual/program', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: hit.root, programs: [] }),
        }).catch(() => {});
      }
      out.curId = curId;

      // 打开向导
      const openBtn = qa('.panel-bar button').find(b => b.textContent.includes('入门'));
      if (!openBtn) { out.err = '工具条没有「入门」按钮'; return out; }
      openBtn.click();
      await sleep(600);

      out.shown = !!q('.vb-guide');
      out.dots = qa('.vb-guide-dot').length;
      out.title1 = q('.vb-guide-title')?.textContent || '';
      out.count1 = q('.vb-guide-count')?.textContent || '';
      out.panels = qa('.vb-guide').length;   // 必须恒为 1

      // 步进：步数应该 +1，标题应该变
      const next = qa('.vb-guide-actions button').find(b => b.textContent.includes('下一步'));
      if (next) { next.click(); await sleep(400); }
      out.count2 = q('.vb-guide-count')?.textContent || '';
      out.title2 = q('.vb-guide-title')?.textContent || '';
      out.panelsAfter = qa('.vb-guide').length;

      // 「带我做」：第 2 步的动作是展开「事件」分类
      const doBtn = q('.vb-guide-do');
      out.doText = doBtn?.textContent || '';
      if (doBtn) { doBtn.click(); await sleep(600); }
      out.eventOpen = qa('.vb-palette-item').some(i => String(i.dataset.op || '').startsWith('event.'));

      // 跳到最后一步，「完成」应该能点、点了面板就收掉
      const dots = qa('.vb-guide-dot');
      if (dots.length) { dots[dots.length - 1].click(); await sleep(350); }
      const finish = qa('.vb-guide-actions button').find(b => b.textContent.trim() === '完成');
      out.finishFound = !!finish;
      out.finishDisabled = finish ? !!finish.disabled : true;
      if (finish) { finish.click(); await sleep(400); }
      out.closed = !q('.vb-guide');

      // 收尾：把向导加的程序清掉，别给工程留垃圾
      if (hit) {
        await fetch('/api/visual/program', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: hit.root, programs: [] }),
        }).catch(() => {});
      }
      return out;
    })()`);

    if (gd.err) {
      problems.push({ kind: '向导', text: gd.err });
    } else {
      const checks = [
        ['向导能打开', gd.shown],
        ['有步骤进度点', gd.dots >= 10],
        ['面板只有一层', gd.panels === 1 && gd.panelsAfter === 1],
        ['下一步能步进', gd.count1 !== gd.count2 && gd.title1 !== gd.title2],
        ['「带我做」操作了界面', gd.eventOpen],
        ['最后一步「完成」能点', gd.finishFound && !gd.finishDisabled],
        ['完成后向导收掉', gd.closed],
      ];
      for (const [name, cond] of checks) {
        if (cond) record('32-向导 ' + name, '通过');
        else problems.push({ kind: '向导', text: name + '：没通过' });
      }
    }
  }
} finally {
  ws.close();
  child.kill();
}

// ---------------------------------------------------------------- 报告
console.log('\n界面冒烟测试');
console.log('浏览器：', browserPath);
console.log('地址：  ', APP_URL);
for (const s of steps) console.log(`  ✓ ${s.name}  ${s.note}`);

if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  ✗ [${p.kind}] ${p.text}`);
  console.log(`\n截图目录：${ART}`);
  process.exit(1);
}
console.log(`\n全部通过。截图目录：${ART}`);
