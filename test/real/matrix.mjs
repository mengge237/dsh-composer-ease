// 用例矩阵：一条命令把 32 个用例在同一台运行中的宿主上跑 N 轮，输出每轮的通过/失败与实际值。
// 前置：先起一个干净的 demo 宿主 —— dsh --profile demo --port 3081 --no-open
// 用法：node test/real/matrix.mjs "http://127.0.0.1:3081/?token=…" 3
// 为什么放在 test/real/：它要活宿主与浏览器，不进 npm test（那五支是离线假 DOM / 纯逻辑）。
// 判据：每轮 32 条全绿才算过；失败项会打印实际值（弹层状态、文本、caret），不用再补日志。
let chromium
for (const spec of ['playwright', process.env.PLAYWRIGHT_ENTRY].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break } catch (e) {}
}
if (!chromium) { console.error('缺 playwright：npm i -g playwright，或设 PLAYWRIGHT_ENTRY 指到已装的那份'); process.exit(2) }
const URL_ = process.argv[2];
const ROUNDS = Number(process.argv[3] || 3);
const browser = await chromium.launch({ headless: true });
const results = [];

function check(round, name, ok, reading) { results.push({ round, name, ok: !!ok, reading: reading === undefined ? '' : String(reading) }); }

for (let round = 1; round <= ROUNDS; round++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && String(m.text()).indexOf('deepseek-account') < 0) errors.push(m.text()) });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4200);
  await page.evaluate(() => { localStorage.removeItem('dsh-composer-ease:quoteMode'); localStorage.removeItem('dsh-composer-ease:kinds-off'); localStorage.removeItem('dsh-composer-ease:pairStrict') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4200);
  const text = () => page.evaluate(() => { const root = document.querySelector('[data-composer-input]'); let s = ''; const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); let n; while ((n = it.nextNode())) s += n.nodeValue; return s });
  const popup = () => page.evaluate(() => { const el = document.getElementById('dsh-cp-popup'); return { display: el ? el.style.display : 'none', rows: el ? Array.from(el.children).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()) : [], ghost: (document.getElementById('dsh-cp-ghost') || {}).textContent || '', copies: document.querySelectorAll('#dsh-cp-popup').length } });
  const menuRows = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]')).map((o) => (o.innerText || '').replace(/\s+/g, ' ').trim()));
  const caret = () => page.evaluate(() => { const root = document.querySelector('[data-composer-input]'); const sel = window.getSelection(); if (!sel || !sel.rangeCount) return -1; const r = sel.getRangeAt(0); const pre = r.cloneRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset); return pre.toString().length });
  async function reset(s) { await page.click('[data-composer-input]'); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.waitForTimeout(90); if (s) await page.keyboard.type(s, { delay: 25 }); await page.waitForTimeout(110) }
  async function seedType(s) { await page.keyboard.type(s, { delay: 45 }); await page.waitForTimeout(650) }

  // A 补全
  await reset(''); await seedType('fu');
  let pp = await popup(); check(round, 'A1 英文前缀弹层', pp.display === 'block' && pp.rows.length > 0, pp.display + ' / ' + pp.rows.slice(0, 2).join(' | '));
  await reset(''); await seedType('文档');
  pp = await popup(); check(round, 'A2 中文前缀弹层', pp.display === 'block' && pp.rows.length > 0, pp.rows.slice(0, 2).join(' | '));
  await reset(''); await seedType('// fun');
  pp = await popup(); check(round, 'A3 注释行不弹', pp.display !== 'block', pp.display);
  await reset(''); await seedType('"fun');
  pp = await popup(); check(round, 'A4 引号内照常弹', pp.display === 'block', pp.display);
  await reset(''); await page.keyboard.press('Control+Space'); await page.waitForTimeout(600);
  pp = await popup(); check(round, 'A5 Ctrl+Space 手动', pp.display === 'block', pp.rows.length + ' 行');
  await reset(''); await page.keyboard.type('@pack', { delay: 35 }); await page.waitForTimeout(900);
  let rows = await menuRows(); check(round, 'A6 @ 菜单有行', rows.length > 0, rows.length + ' 行: ' + rows.slice(0, 2).join(' | '));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // B 键位
  await reset(''); await seedType('fun');
  const beforeTab = await popup();
  await page.keyboard.press('Tab'); await page.waitForTimeout(500);
  const afterTabText = await text();
  check(round, 'B1 Tab 接受', afterTabText !== 'fun' && afterTabText.length >= 3, JSON.stringify(afterTabText) + ' ← ' + JSON.stringify(beforeTab.rows[0] || ''));
  await reset(''); await seedType('fu'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  pp = await popup(); check(round, 'B2 下键换选中（灰字跟着变）', pp.ghost !== '' || pp.rows.length > 1, JSON.stringify(pp.ghost));
  await reset(''); await seedType('nod'); const p0 = await popup();
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
  const p1 = await popup(); const c1 = await caret(); const t1 = await text();
  check(round, 'B3 左键收弹层', p0.display === 'block' && p1.display !== 'block' && t1 === 'nod' && c1 === 2, p0.display + '→' + p1.display + ' caret=' + c1);
  await page.keyboard.type('e', { delay: 40 }); await page.waitForTimeout(700);
  const p2 = await popup(); check(round, 'B4 继续打字再提示', p2.display === 'block', (await text()));
  await page.keyboard.press('Home'); await page.waitForTimeout(250);
  const p3 = await popup(); check(round, 'B5 Home 收弹层', p3.display !== 'block' && (await caret()) === 0, p3.display);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await reset(''); await seedType('fu'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const p4 = await popup(); check(round, 'B6 Esc 收弹层', p4.display !== 'block', p4.display);

  // C 配对
  await reset(''); await page.keyboard.type('(', { delay: 20 }); await page.waitForTimeout(250);
  check(round, 'C1 半角括号配对', (await text()) === '()', await text());
  await reset(''); await page.keyboard.type('（', { delay: 20 }); await page.waitForTimeout(300);
  check(round, 'C2 全角括号配对', (await text()) === '（）', await text());
  await reset(''); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(300);
  check(round, 'C3 引号默认配对', (await text()) === '""', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(120); await page.keyboard.type('(', { delay: 20 }); await page.waitForTimeout(400);
  check(round, 'C4 框选包裹', (await text()) === '(abc)', await text());
  await reset(''); await page.keyboard.type('()', { delay: 20 }); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200); await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
  check(round, 'C5 空对一次删两侧', (await text()) === '', JSON.stringify(await text()));
  await reset(''); await page.keyboard.type('"abc', { delay: 25 }); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(400);
  check(round, 'C6 末尾补闭合', (await text()) === '"abc"', await text());
  // 默认 auto 会自动补成一对，所以要造「奇数个引号」只能是：先写正文，再把光标挪到**开头**打一个引号
  // （右边紧跟文字时不补对，于是只落一个开符）。
  await reset(''); await page.keyboard.type('还没闭合', { delay: 25 }); await page.keyboard.press('Home'); await page.waitForTimeout(150);
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(700);
  const warn = await page.evaluate(() => {
    const root = document.querySelector('[data-composer-input]');
    const layer = document.getElementById('dce-quote-warn-layer');
    const sel = window.getSelection(); let line = null;
    if (sel && sel.rangeCount) { const rr = sel.getRangeAt(0).cloneRange(); rr.collapse(true); const rects = rr.getClientRects(); if (rects.length) line = rects[rects.length - 1] }
    const waves = layer ? Array.from(layer.children).map((c) => Math.round(c.getBoundingClientRect().top)) : [];
    return { waves, textBottom: line ? Math.round(line.bottom) : null, boxBottom: Math.round(root.getBoundingClientRect().bottom) }
  });
  check(round, 'C7 未闭合波浪线贴文字', warn.waves.length > 0 && warn.textBottom !== null && Math.abs(warn.waves[0] - warn.textBottom) <= 4, JSON.stringify(warn));

  // D / 菜单
  await reset(''); await page.keyboard.type('/', { delay: 30 }); await page.waitForTimeout(1000);
  rows = await menuRows();
  check(round, 'D1 / 菜单三行设置', rows.filter((r) => r.indexOf('引号模式') >= 0 || r.indexOf('候选类型') >= 0 || r.indexOf('严格配对') >= 0).length === 3, rows.length + ' 行');
  await reset(''); await page.keyboard.type('/comp', { delay: 35 }); await page.waitForTimeout(1100);
  rows = await menuRows();
  check(round, 'D2 /comp 设置行让位', rows.filter((r) => r.indexOf('引号模式') >= 0).length === 0 && rows.some((r) => r.indexOf('compact') >= 0), rows.length + ' 行');
  await reset(''); await page.keyboard.type('/compot', { delay: 35 }); await page.waitForTimeout(1100);
  rows = await menuRows();
  check(round, 'D3 /compot 错拼兜底', rows.some((r) => r.indexOf('/compact') >= 0), rows.join(' | ').slice(0, 90));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // E 边界与回归
  await reset(''); await seedType('# fun');
  pp = await popup(); check(round, 'E1 井号注释行不弹', pp.display !== 'block', pp.display);
  await reset(''); await seedType('a // fun');
  pp = await popup(); check(round, 'E2 行内 // 照常弹', pp.display === 'block', pp.display);
  await reset(''); await page.keyboard.type('abc', { delay: 25 }); await page.keyboard.press('Home'); await page.waitForTimeout(150);
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(350);
  check(round, 'E3 文字前打引号只落一个', (await text()) === '"abc', await text());
  await reset('');
  for (let k = 0; k < 3; k++) { await page.keyboard.press('Backquote'); await page.waitForTimeout(120) }
  await page.waitForTimeout(250);
  check(round, 'E4 反引号三连成围栏', (await text()) === '```', await text());
  await reset('');
  for (let k = 0; k < 3; k++) { await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(120) }
  await page.waitForTimeout(250);
  check(round, 'E5 引号三连仍是一对', (await text()) === '""', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(120);
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(500);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  check(round, 'E6 单行包裹撤销一拍', (await text()) === 'abc', await text());
  await reset(''); await seedType('fun');
  await page.keyboard.press('Tab'); await page.waitForTimeout(500);
  const afterAccept = await popup();
  check(round, 'E7 接受后弹层不复开', afterAccept.display !== 'block', afterAccept.display + ' / ' + JSON.stringify(await text()));
  await reset(''); await page.keyboard.type('@pack', { delay: 35 }); await page.waitForTimeout(900);
  await page.keyboard.press('Tab'); await page.waitForTimeout(600);
  const picked = await text();
  check(round, 'E8 @ 菜单 Tab 插入路径', picked.length > 4 && picked.indexOf('@') < 0, JSON.stringify(picked));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // F 稳定性
  pp = await popup(); check(round, 'F1 只有一个弹层节点', pp.copies <= 1, 'copies=' + pp.copies);
  check(round, 'F2 无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

const total = results.length;
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const byRound = {};
for (const r of results) { byRound[r.round] = byRound[r.round] || { pass: 0, fail: 0 }; r.ok ? byRound[r.round].pass++ : byRound[r.round].fail++ }
console.log(JSON.stringify({ rounds: ROUNDS, total, passed, failedCount: failed.length, byRound, failed }, null, 2));
await browser.close();