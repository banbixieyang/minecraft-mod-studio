/**
 * 积木界面的探针脚本 —— 给 tests/visual-ui.mjs 用。
 *
 * 做的事：
 *   1. 从顶栏进「积木」视图
 *   2. 搭一小段有代表性的程序（事件 + 语句 + 条件 + 容器）
 *   3. 填上中文参数（这些字必须出现在生成的 Java 里）
 *   4. 出编译预览
 *   5. 回报统计数字，顺带检查有没有 "undefined" 漏到界面上
 *
 * 返回一个对象；visual-ui.mjs 会把它打印出来。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const out = { steps: [] };
  const say = (m) => out.steps.push(m);

  // ---- 等顶栏出来 ----
  // 页面是 SPA，首屏要拉工程清单；不等的话探针会跑在「还没渲染」的空页上。
  for (let i = 0; i < 60; i++) {
    if (qa('.app-bar button').length) break;
    await sleep(250);
  }

  // ---- 先点进一个工程（欢迎页状态没有工程上下文）----
  const cards = qa('.project-card');
  if (cards.length) {
    const target = cards.find((c) => c.textContent.includes('testmod')) || cards[0];
    target.click();
    await sleep(2500);
    say(`进了工程：${target.querySelector('.project-name')?.textContent || '?'}`);
  }

  const clickItem = async (op, label) => {
    const item = qa('.vb-palette-item').find((i) => i.dataset.op === op);
    if (!item) { say(`找不到积木 ${op}`); return false; }
    item.click();
    await sleep(700);
    say(`点了「${label || op}」`);
    return true;
  };
  /**
   * 展开某个分类。
   *
   * ⚠️ 分类是**单开**的，而且「事件」默认就展开着。
   *    所以不能无脑点分类头 —— 那会把已开的关掉。
   *    正确做法：拿一个该分类里的代表积木 op 去 DOM 里找，
   *    找得到说明这分类已经开着，否则点开它。
   */
  const openCat = async (name, probeOp) => {
    const has = (op) => qa('.vb-palette-item').some((i) => i.dataset.op === op);
    if (has(probeOp)) { say(`分类「${name}」本来就开着`); return true; }
    const head = qa('.vb-cat-head').find((h) => h.textContent.includes(name));
    if (!head) { say(`找不到分类 ${name}`); return false; }
    head.click();
    await sleep(400);
    if (!has(probeOp)) say(`分类「${name}」点开了但没看到 ${probeOp}`);
    return true;
  };

  // ---- 进视图 ----
  for (let i = 0; i < 40; i++) {
    const b = qa('.app-bar button').find((x) => x.textContent.trim() === '积木');
    if (b) { b.click(); break; }
    await sleep(250);
  }
  await sleep(2500);
  out.panel = !!q('.visual-panel');
  out.cats = qa('.vb-cat').length;
  say(`面板渲染：${out.panel}，分类 ${out.cats} 个`);

  // ---- 事件帽 ----
  await openCat('事件', 'event.player_tick');
  await clickItem('event.player_tick', '当玩家每 tick 时');

  // ---- 语句 ----
  await openCat('玩家', 'player.message');
  await clickItem('player.message', '给玩家发消息');

  // 改参数
  const stack = qa('.vb-program').at(-1)?.querySelector('.vb-program-stack');
  const input = stack?.querySelector('input.vb-input-field');
  if (input) {
    input.value = '小朋友你好，欢迎来到我的世界！';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    say('填了消息文字');
  }

  // ---- 条件 + 容器 ----
  await openCat('流程', 'flow.if');
  await clickItem('flow.if', '如果');

  const stack2 = qa('.vb-program').at(-1)?.querySelector('.vb-program-stack');
  const body = stack2?.querySelector('.vb-body');
  if (body) {
    const dt = new DataTransfer();
    dt.setData('application/x-mcstudio-block', 'player.heal');
    body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await sleep(800);
    say('往容器里放了「治疗」');
  }

  // ---- 编译预览 ----
  const prev = qa('button').find((b) => b.textContent.includes('编译预览'));
  if (prev) { prev.click(); await sleep(2600); say('点了编译预览'); }
  const code = q('.vb-code')?.textContent || '';
  out.codeLen = code.length;
  out.hasMsg = code.includes('小朋友你好');
  out.hasHeal = /player\.heal\(/.test(code);

  // ---- 界面体检 ----
  const bad = [];
  const scan = q('.visual-panel');
  if (scan) {
    const txt = scan.textContent || '';
    for (const w of ['undefined', 'NaN', '[object Object]', 'null']) {
      if (txt.includes(w)) bad.push(w);
    }
  }
  out.leaked = bad;
  out.blocks = qa('.vb').length;
  out.slots = qa('.vb-input-block').length;

  // 条件槽：应该是个能点「真/假」的芯片
  const chip = q('.vb-bool-chip');
  out.chip = chip ? { text: chip.textContent, value: chip.dataset.value } : null;
  // 代码区：不该横向溢出（改成换行后 scrollWidth 应接近 clientWidth）
  const codeEl = q('.vb-code');
  if (codeEl) {
    out.codeBox = {
      scrollW: codeEl.scrollWidth, clientW: codeEl.clientWidth,
      wrapped: codeEl.scrollWidth <= codeEl.clientWidth + 2,
    };
  }

  return out;
})()
