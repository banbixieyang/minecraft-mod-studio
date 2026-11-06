/**
 * 入门向导的浏览器端验证。
 *
 * 重点不是「面板显示出来了」，而是**向导真的能替用户操作界面** ——
 * 一步步点「带我做」，看画布上是不是真的多出程序、真的出预览代码。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const out = { steps: [] };
  const say = (m) => out.steps.push(m);

  // ⚠️ 欢迎页没有 .app-bar（它自己整套渲染），
  //    所以必须先点一张工程卡片进工程，才拿得到顶栏和积木入口。
  for (let i = 0; i < 60; i++) {
    if (qa('.project-card').length || qa('.app-bar button').length) break;
    await sleep(250);
  }
  const cards = qa('.project-card');
  if (cards.length) {
    // ⚠️ 按名字找会挑错 —— 有好几个工程名里带「测试」。
    //    testmod 的名字叫「测试模组」。
    (cards.find((c) => c.textContent.includes('测试模组')) || cards[0]).click();
    await sleep(2500);
  }

  // ⚠️ 清空前先从顶栏读出当前是哪个工程 ——
  //    启动时若 localStorage 里有记录，boot 会自动打开那个工程，
  //    跟「点进来的卡片」可能不是同一个。按 id 定位才不会挑错。
  const chipText = q('.proj-chip')?.textContent || '';
  const currentId = chipText.trim().split(/\s+/).pop() || '';

  // ⚠️ 先把工程里存着的积木程序清空 ——
  //    向导第 10 步会真的「保存」，不清理的话每跑一次就多攒一段程序，
  //    程序数会一路往上涨，测的就不是同一个场景了。
  out.currentId = currentId;
  out.cleared = await (async () => {
    try {
      const list = await fetch('/api/projects').then((r) => r.json()).catch(() => null);
      const projects = list?.projects || [];
      const hit = projects.find((p) => p.id === currentId);
      if (!hit) return 'no-project:' + currentId;
      const r = await fetch('/api/visual/program', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: hit.root, programs: [] }),
      });
      return r.ok ? 'ok' : 'http-' + r.status;
    } catch (e) { return 'err:' + e.message; }
  })();
  say(`当前工程 ${currentId}，清空积木程序：${out.cleared}`);
  await sleep(500);

  // 进积木视图
  for (let i = 0; i < 40; i++) {
    const b = qa('.app-bar button').find((x) => x.textContent.trim() === '积木');
    if (b) { b.click(); break; }
    await sleep(250);
  }
  await sleep(2500);

  // 打开向导
  const openBtn = qa('.panel-bar button').find((b) => b.textContent.includes('入门'));
  if (!openBtn) return { err: '工具条没有「入门」按钮' };
  openBtn.click();
  await sleep(500);

  out.guideShown = !!q('.vb-guide');
  out.stepCount = qa('.vb-guide-dot').length;
  out.firstTitle = q('.vb-guide-title')?.textContent || '';
  say(`向导打开：${out.guideShown}，共 ${out.stepCount} 步`);

  // 一步步点「带我做」，每步之后检查画布
  const trace = [];
  for (let step = 0; step < out.stepCount; step++) {
    const title = q('.vb-guide-title')?.textContent || '';
    const doBtn = q('.vb-guide-do');
    if (doBtn) {
      doBtn.click();
      await sleep(900);
    }
    trace.push({
      title,
      programs: qa('.vb-program').length,
      blocks: qa('.vb').length,
      msg: (q('.vb-code')?.textContent || '').includes('我做了一个模组'),
    });
    // 下一步
    const next = qa('.vb-guide-actions button').find((b) => b.textContent.includes('下一步'));
    if (!next) break;
    next.click();
    await sleep(350);
  }
  out.trace = trace;

  // 最后一步应该是「完成」
  out.lastTitle = q('.vb-guide-title')?.textContent || '';

  // 面板体检
  const txt = q('.visual-panel')?.textContent || '';
  out.leaked = ['undefined', 'NaN', '[object Object]'].filter((w) => txt.includes(w));

  // 预览代码里应该有中文和 heal
  const code = q('.vb-code')?.textContent || '';
  out.codeLen = code.length;
  out.hasChinese = code.includes('你好呀');
  out.hasHeal = /heal\(/.test(code);
  out.programs = qa('.vb-program').length;

  return out;
})()
