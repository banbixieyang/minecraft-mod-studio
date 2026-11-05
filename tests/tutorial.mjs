/**
 * 教程上手入口的冒烟测试。
 *
 * 验证五件事：
 *   1. 首页有「上手引导」三张卡；
 *   2. 三张卡逐个点开，都能打开对应的那篇文档（不是「打不开」）；
 *   3. 使用手册正文真的有内容（不是空白）；
 *   4. 知识库目录里找得到「拆解别人的 mod」；
 *   5. 顶栏「手册」按钮也能直达使用手册。
 *
 * 这是「让所有人可以上手」的最后一环 —— 教程写得再好，
 * 入口找不到、或者点了打不开，等于没写。
 *
 *   node tests/tutorial.mjs
 *
 * 退出码非 0 表示有问题。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ART = path.join(HERE, 'artifacts');
const APP_PORT = 4188;
const DEBUG_PORT = 9339;
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;

// 浏览器：跟 uitest 用同一套查找逻辑（本机一般是 Edge）
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browserPath = CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('找不到可用的 Chrome/Edge。');
  process.exit(2);
}

const profile = path.join(
  process.env.TEMP || process.env.TMPDIR || '/tmp',
  `mcstudio-tutorial-${Date.now()}`,
);
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

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
      // 「元素还没出现」是正常的等待过程；
      // 但表达式本身写错了永远等不出来 —— 这种直接抛出去，别白等 20 秒。
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

// ---------------------------------------------------------------- 起服务
const server = spawn(
  process.execPath,
  [path.join(ROOT, 'studio.mjs'), 'start', '--port', String(APP_PORT), '--no-open'],
  { cwd: ROOT, stdio: 'ignore' },
);

await waitFor(async () => {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`).catch(() => null);
  return r && r.ok;
}, 25000).catch(() => null);

// ---------------------------------------------------------------- 起浏览器
const chrome = spawn(
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
const problems = [];
const steps = [];

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
  fs.writeFileSync(path.join(ART, `${name}.png`), Buffer.from(r.data, 'base64'));
}

const record = (name, note) => {
  steps.push({ name, note });
  console.log(`  ${name}${note ? ' — ' + note : ''}`);
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// ---------------------------------------------------------------- 开始测试
console.log('【教程上手入口】');

try {
  await send('Page.navigate', { url: APP_URL });
  // 等首页渲染出来（欢迎页有 .start-card，工程页有 .app-bar）
  await waitFor(() => evaluate(`!!document.querySelector('.start-card, .app-bar')`), 25000);

  // ---- 1. 首页上手卡片 ----
  const cards = await waitFor(() => evaluate(`(() => {
    const els = [...document.querySelectorAll('.start-card')];
    if (!els.length) return false;
    return els.map((e) => ({
      title: (e.querySelector('.start-card-title')?.textContent || '').trim(),
      link: (e.querySelector('.start-card-link')?.textContent || '').trim(),
    }));
  })()`));

  record('首页上手卡片', `${cards.length} 张：${cards.map((c) => c.title).join(' / ')}`);
  if (cards.length !== 3) {
    problems.push({ kind: '界面', text: `上手卡片应该是 3 张，实际 ${cards.length} 张` });
  }
  for (const need of ['自己的模组', '拆别人', '手册']) {
    if (!cards.some((c) => c.title.includes(need))) {
      problems.push({ kind: '界面', text: `上手卡片里缺了包含「${need}」的那张` });
    }
  }
  await shot('tutorial-home');

  // ---- 2~4. 三张卡逐个点开 ----
  // 每张卡对应一篇文档，点开必须真的打开那一篇 —— 打不开就是「打不开」错误页。
  const expectations = [
    { key: '手册', title: /使用手册/ },
    { key: '拆别人', title: /拆解别人的\s*mod/ },
    { key: '自己的模组', title: /从零到出/ },
  ];

  for (const exp of expectations) {
    // 每点一张卡就跳进学习中心了 —— 想点下一张得先回欢迎页。
    await evaluate(`(() => {
      localStorage.removeItem('mcstudio.lastProject');
      location.reload();
      return true;
    })()`);
    await sleep(900);
    await waitFor(() => evaluate(`!!document.querySelector('.start-card')`), 25000);

    const clicked = await evaluate(`(() => {
      const key = ${JSON.stringify(exp.key)};
      const cards = [...document.querySelectorAll('.start-card')];
      const target = cards.find(c => ((c.querySelector('.start-card-title')?.textContent) || '').includes(key));
      if (!target) return false;
      target.click();
      return true;
    })()`);

    if (!clicked) {
      problems.push({ kind: '界面', text: `点不到「${exp.key}」那张卡` });
      continue;
    }

    const title = await waitFor(() => evaluate(`(() => {
      const t = document.querySelector('.kb-article-title');
      return t ? t.textContent.trim() : false;
    })()`), 15000, 300).catch(() => null);

    if (!title) {
      problems.push({ kind: '界面', text: `点了「${exp.key}」那张卡，右侧没打开文档` });
      record(`卡片跳转 · ${exp.key}`, '✗ 没打开文档');
      continue;
    }
    if (!exp.title.test(title)) {
      problems.push({ kind: '界面', text: `「${exp.key}」那张卡打开了《${title}》，不是预期的文档` });
    }
    record(`卡片跳转 · ${exp.key}`, `《${title}》`);

    // 使用手册要多看一眼正文 —— 打开了但正文空着，等于没打开
    if (exp.key === '手册') {
      const bodyLen = await evaluate(`(document.querySelector('.kb-article-body')?.textContent || '').length`);
      if (!bodyLen || bodyLen < 500) {
        problems.push({ kind: '界面', text: `使用手册正文太短（${bodyLen} 字），可能没渲染出来` });
      } else {
        record('手册正文长度', `${bodyLen} 字`);
      }
      await shot('tutorial-manual');
    }
  }

  // ---- 5. 目录里有「拆解别人的 mod」 ----
  const treeHas = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.kb-item-title')].map(e => e.textContent.trim());
    return items.some(t => /拆解别人的\\s*mod/.test(t));
  })()`);
  if (!treeHas) {
    problems.push({ kind: '界面', text: '知识库目录里找不到「拆解别人的 mod」这一篇' });
  } else {
    record('目录包含拆解教程', '✓');
  }

  // ---- 6. 顶栏「手册」按钮 ----
  // 顶栏只在工程视图里有，所以先回首页再打开一个工程。
  await evaluate(`(() => {
    localStorage.removeItem('mcstudio.lastProject');
    location.reload();
    return true;
  })()`);
  await sleep(1200);
  await waitFor(() => evaluate(`!!document.querySelector('.start-card, .app-bar')`), 25000);

  const openedProject = await waitFor(() => evaluate(`(() => {
    const c = document.querySelector('.project-card');
    if (!c) return false;
    c.click();
    return true;
  })()`), 15000, 300).catch(() => false);

  if (!openedProject) {
    problems.push({ kind: '界面', text: '打不开任何工程，顶栏按钮没测成' });
  } else {
    const barOk = await waitFor(() => evaluate(`!!document.querySelector('.app-bar')`), 20000, 300).catch(() => false);
    if (!barOk) {
      problems.push({ kind: '界面', text: '进工程后顶栏没出现' });
    } else {
      const hasBtn = await evaluate(`(() => {
        const b = [...document.querySelectorAll('.app-bar button')].find(x => x.textContent.trim() === '手册');
        return !!b;
      })()`);
      if (!hasBtn) {
        problems.push({ kind: '界面', text: '顶栏没有「手册」按钮' });
        record('顶栏手册按钮', '✗ 没有');
      } else {
        record('顶栏手册按钮', '✓ 存在');
        await evaluate(`(() => {
          const b = [...document.querySelectorAll('.app-bar button')].find(x => x.textContent.trim() === '手册');
          b.click();
          return true;
        })()`);
        const t = await waitFor(() => evaluate(`(() => {
          const el = document.querySelector('.kb-article-title');
          return el ? el.textContent.trim() : false;
        })()`), 15000, 300).catch(() => null);
        if (!t || !/使用手册/.test(t)) {
          problems.push({ kind: '界面', text: `顶栏「手册」没打开使用手册（打开的是《${t || '无'}》）` });
        } else {
          record('顶栏手册直达', `《${t}》`);
          await shot('tutorial-topbar-manual');
        }
      }
    }
  }
} catch (e) {
  problems.push({ kind: '运行', text: `测试异常：${e.message}` });
  console.log('  ✗ 异常：', e.message);
}

// ---------------------------------------------------------------- 收尾
console.log('\n────────────────────────');
if (problems.length) {
  console.log('有问题：');
  for (const p of problems) console.log(`  [${p.kind}] ${p.text}`);
} else {
  console.log('全部通过');
  console.log(`  截图：${ART}/tutorial-*.png`);
}
try { server.kill(); } catch { /* 已退出 */ }
try { chrome.kill(); } catch { /* 已退出 */ }
await sleep(300);
process.exit(problems.length ? 1 : 0);
