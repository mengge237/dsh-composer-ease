// 用例矩阵：一条命令把 38 个用例在同一台运行中的宿主上跑 N 轮，输出每轮的通过/失败与实际值。
// 前置：先起一个干净的 demo 宿主 —— dsh --profile demo --port 3081 --no-open
// 用法：node test/real/matrix.mjs "http://127.0.0.1:3081/?token=…" 3
// 为什么放在 test/real/：它要活宿主与浏览器，不进 npm test（那五支是离线假 DOM / 纯逻辑）。
// 判据：每轮 38 条全绿才算过；失败项会打印实际值（弹层状态、文本、caret），不用再补日志。
let chromium
for (const spec of ['playwright', process.env.PLAYWRIGHT_ENTRY].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break } catch (e) {}
}
if (!chromium) { console.error('缺 playwright：npm i -g playwright，或设 PLAYWRIGHT_ENTRY 指到已装的那份'); process.exit(2) }
const URL_ = process.argv[2];
const ROUNDS = Number(process.argv[3] || 3);
const browser = await chromium.launch({ headless: true });
const results = [];

const VERBOSE = process.argv.includes('--verbose');
function check(round, name, ok, reading) {
  results.push({ round, name, ok: !!ok, reading: reading === undefined ? '' : String(reading) });
 // --verbose 逐条打印：要拿「某一条真的跑过」当证据时用它
  if (VERBOSE) console.log((ok ? '  ok   ' : '  FAIL ') + 'r' + round + ' ' + name + (reading === undefined ? '' : '  ← ' + String(reading).slice(0, 120)));
}

for (let round = 1; round <= ROUNDS; round++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 // 剪贴板权限：C27 要真粘一次（合成粘贴在宿主上不落字，必须走真实 Ctrl+V）
  try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write']) } catch (e0) {}
  const errors = [];
 // 只把「跟本插件有关」的错误算红：别的插件（pet / task-board / auth-cookie-guard）的 400/404
 // 是本机 profile 里那几个插件的既有噪声，不该让本插件的稳定性判据永远红（实测 URL 见 probe-f2）。
  const FOREIGN = /\/api\/(pet|task-board|dsh-auth-cookie-guard)\//
  page.on('response', (r) => { if (r.status() >= 400 && !FOREIGN.test(r.url())) errors.push('http ' + r.status() + ' ' + r.url()) })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = String(m.text())
    if (t.indexOf('deepseek-account') >= 0) return
    if (/status of (400|404)/.test(t)) return   // 资源加载失败的原文不带 URL，前面 response 那条已经按 URL 判过了
    errors.push(t)
  });
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
  const cdp = await page.context().newCDPSession(page)
 // 输入法那两条路：上屏（无组成）与「组成 + 上屏」—— 后者才是中文输入法的日常形状
  const imeType = async (t) => { await cdp.send('Input.insertText', { text: t }); await page.waitForTimeout(420) }
  const imeCompose = async (t) => {
    await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length })
    await page.waitForTimeout(60)
    await cdp.send('Input.insertText', { text: t })
    await page.waitForTimeout(520)
  }
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
  check(round, 'C2 全角括号换半角（默认开）', (await text()) === '()', await text());
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

  // C8-C12 输入法路径（组成与上屏），三引号/框不住那两类的回归闸
  await reset(''); await imeCompose('\u201c');
  check(round, 'C8 组成上屏 “ 只落一对', (await text()) === '\u201c\u201d', await text());
  await reset(''); await imeCompose('\uff08');
  check(round, 'C9 组成上屏 （ 换半角一对', (await text()) === '()', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeCompose('\u201c');
  check(round, 'C10 选中 + 组成上屏 “ 框得住', (await text()) === '\u201cabc\u201d', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('\uff08');
  check(round, 'C11 选中 + 上屏 （ 框得住且保持全角', (await text()) === '（abc）', await text());
  await reset(''); await imeType('\u201c'); await page.keyboard.type('\u4f60\u597d', { delay: 25 }); await imeType('\u201d');
  check(round, 'C12 引号写完再打闭符不多一个', (await text()) === '\u201c\u4f60\u597d\u201d', await text());
  // C13-C16：全角闭符换算、括号内光标、< 包裹、括号后打字不跑到外面
  await reset(''); await imeType('\uff09');
  check(round, 'C13 全角闭符换成半角', (await text()) === ')', await text());
  await reset(''); await imeType('\uff08');
  check(round, 'C14 括号换算后光标在括号内', (await text()) === '()' && (await caret()) === 1, await text() + ' caret=' + await caret());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('<');
  check(round, 'C15 选中 + 上屏 < 框得住', (await text()) === '<abc>', await text());
  await reset(''); await imeType('\uff08'); await page.keyboard.type('abc', { delay: 25 }); await page.waitForTimeout(200);
  check(round, 'C16 括号里打的字留在括号内', (await text()) === '(abc)', await text());
  // C17：组成上屏补出来的那一对，光标必须留在两符之间，否则下一字打到引号外面
  await reset(''); await imeCompose('\u201c'); await page.keyboard.type('X', { delay: 15 }); await page.waitForTimeout(300);
  check(round, 'C17 上屏成对后打字落在引号内', (await text()) === '\u201cX\u201d', await text() + ' caret=' + await caret());
  // C20-C23：多行包裹、嵌套包裹、包裹后立刻打闭符、包裹后撤销
  // C26：片段候选接受 —— 文字要落地、弹层要收起
  // C27：自动补出来的空对里粘贴，内容要落在两个符号之间（此前落到对子外面）
  await reset(''); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(450);
  const pairBase = await text();
  await page.evaluate(async () => { try { await navigator.clipboard.writeText('hello') } catch (e) {} });
  await page.keyboard.press('Control+v'); await page.waitForTimeout(800);
  check(round, 'C27 空对里粘贴落在符号之间', pairBase === '""' && (await text()) === '"hello"', JSON.stringify({ base: pairBase, after: await text() }));
  await reset(''); await page.keyboard.type('fn', { delay: 25 }); await page.waitForTimeout(1000);
  await page.keyboard.press('Tab'); await page.waitForTimeout(900);
  check(round, 'C26 片段候选接受后文字落地且弹层收起', /^function [A-Za-z]*\(/.test(await text().catch(() => '')) || (await text()).indexOf('function ') === 0
    ? (await popup()).display === 'none' && (await text()).indexOf('function ') === 0 : false, JSON.stringify((await text()).slice(0, 40)));
  // C24-C25：有选区按 Ctrl+Space 要弹层（此前无反应）、一次上屏长文本不许被配对逻辑拆开
  await reset('abcdef'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft'); await page.waitForTimeout(150);
  await page.keyboard.press('Control+ '); await page.waitForTimeout(700);
  const ppSel = await popup();
  check(round, 'C24 有选区按 Ctrl+Space 也弹层', (await text()) === 'abcdef' && ppSel.display !== 'none' && ppSel.rows.length > 0, JSON.stringify({ display: ppSel.display, rows: ppSel.rows.slice(0, 2) }));
  await reset(''); await imeType('这是一个很长的中文句子，包含“引号”与（括号）还有 English words 与 123。'); await page.waitForTimeout(500);
  check(round, 'C25 一次上屏长文本不被拆开', (await text()) === '这是一个很长的中文句子，包含“引号”与（括号）还有 English words 与 123。', (await text()).slice(0, 40));

  await reset('ab'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('cd', { delay: 20 }); await page.waitForTimeout(200);
  await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('(');
  check(round, 'C20 多行选区也能整段框住', (await text()) === '(ab\ncd)', await JSON.stringify(await text()));
  await reset('outer text'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('(');
  await page.waitForTimeout(300); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('\u300c');
  check(round, 'C21 已包裹的整段再包一层', (await text()) === '\u300c(outer text)\u300d', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('(');
  await page.waitForTimeout(360); await imeType(')'); await page.waitForTimeout(300);
  check(round, 'C22 包裹后立刻打闭符不多一个', (await text()) === '(abc)', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await imeType('(');
  await page.waitForTimeout(420); await page.keyboard.press('Control+z'); await page.waitForTimeout(420);
  check(round, 'C23 包裹后撤销一次回到裸文本', (await text()) === 'abc', await text());
  // C18-C19：上屏之后**紧接着**输入（闭符走粘贴原子编辑，落点由那次编辑决定）
  await reset(''); await imeCompose('\u201c'); await page.keyboard.type('ab', { delay: 8 }); await page.waitForTimeout(400);
  check(round, 'C18 上屏后立刻打字仍在引号内', (await text()) === '\u201cab\u201d', await text());
  // C18b：框住一段之后紧接着打字，字必须落进引号里（不是跑到闭符后面）
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(60);
  await page.keyboard.type('X', { delay: 10 }); await page.waitForTimeout(400);
  check(round, 'C18b 框住后立刻打字落在引号内', (await text()) === '"abcX"', await text());
  await reset('abc'); await page.keyboard.press('Control+a'); await page.waitForTimeout(140); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(450);
  await page.keyboard.type('Y', { delay: 10 }); await page.waitForTimeout(400);
  check(round, 'C18c 框住等待后再打字仍落在引号内', (await text()) === '"abcY"', await text());
  await reset(''); await imeCompose('\u201c'); await page.keyboard.type('ab', { delay: 8 }); await page.waitForTimeout(250);
  const inner19 = await text()
  await page.keyboard.press('Control+a'); await page.waitForTimeout(120); await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(600);
  const wrapped = await text()
  check(round, 'C19 上屏后立刻框选仍包得住', wrapped === '"' + inner19 + '"', JSON.stringify(wrapped));

  // C22：字符触发 + provider 契约（别家插件注册的来源能进补全）
  await page.evaluate(() => {
    const api = window.__DSH_COMPOSER_EASE__
    if (!api) return
    if (api.__t) api.__t()
    api.__t = api.register({ id: 'matrix-dot', priority: 1, triggerChars: ['.'], provide: () => [{ label: 'beta', insertText: 'beta' }] })
  })
  await reset(''); await page.keyboard.type('a.', { delay: 30 }); await page.waitForTimeout(700);
  const dotRows = await popup();
  check(round, 'C22 点号触发 provider 候选', dotRows.display === 'block' && dotRows.rows.some((r) => r.indexOf('beta') >= 0), dotRows.display + ' / ' + dotRows.rows.slice(0, 2).join(' | '));
  await page.evaluate(() => { const api = window.__DSH_COMPOSER_EASE__; if (api && api.__t) { api.__t(); api.__t = null } })
  await reset(''); await page.keyboard.type('a.', { delay: 30 }); await page.waitForTimeout(600);
  const dotRows2 = await popup();
  check(round, 'C23 撤掉 provider 后点号不出层', dotRows2.display !== 'block', dotRows2.display)

  // D / 菜单
  await reset(''); await page.keyboard.type('/', { delay: 30 }); await page.waitForTimeout(1000);
  rows = await menuRows();
 // 设置类入口已搬去设置页："/" 只留一行「严格配对」，其余四项不该再出现在这里
  check(round, 'D1 / 菜单只留严格配对一行', rows.filter((r) => r.indexOf('严格配对') >= 0).length === 1
    && rows.filter((r) => r.indexOf('引号模式') >= 0 || r.indexOf('候选类型') >= 0 || r.indexOf('全角括号') >= 0 || r.indexOf('重置插件设置') >= 0).length === 0, rows.length + ' 行');
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
  await reset('');
  await page.keyboard.type('第一段', { delay: 20 }); await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('第二段', { delay: 20 }); await page.waitForTimeout(200);
  await page.keyboard.press('Control+a'); await page.waitForTimeout(120);
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(1200);
  const twoText = await text();
  check(round, 'E9 两段选区也包得住', twoText.charAt(0) === '"' && twoText.charAt(twoText.length - 1) === '"', JSON.stringify(twoText));
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