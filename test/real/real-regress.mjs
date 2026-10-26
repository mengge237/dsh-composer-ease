// 真机回归：引号改动碰到的邻接行为（假 DOM 是 TEXTAREA，覆盖不到 contenteditable 这条路）
// 用法：node test/real/real-regress.mjs "http://127.0.0.1:3081/?token=…"
let chromium
for (const spec of ['playwright', 'file:///<本地路径>']) {
  try { ({ chromium } = await import(spec)); break } catch (e) {}
}
if (!chromium) { console.error('缺 playwright：装一个（npm i -g playwright）或改这里第二条回退路径'); process.exit(2) }

const URL_ = process.argv[2]
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const cdp = await page.context().newCDPSession(page)

await page.evaluate(() => {
  const CE = '[data-composer-input]'
  const rootOf = () => document.querySelector(CE)
  window.__flat = (root) => {
    if (!root) return ''
    let s = ''; const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); let n
    while ((n = it.nextNode())) s += n.nodeValue
    return s
  }
  window.__caret = () => {
    const root = rootOf(); const sel = window.getSelection()
    if (!root || !sel || !sel.rangeCount) return -1
    const r = sel.getRangeAt(0)
    if (!root.contains(r.startContainer)) return -2
    const pre = r.cloneRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset)
    return pre.toString().length
  }
  window.__state = () => ({ text: window.__flat(rootOf()), caret: window.__caret() })
  function pointAt(nodes, off) {
    let acc = 0
    for (const node of nodes) {
      const len = node.nodeValue.length
      if (acc + len >= off) return { node, off: off - acc }
      acc += len
    }
    const last = nodes[nodes.length - 1]
    return last ? { node: last, off: last.nodeValue.length } : null
  }
  window.__place = (off, endOff) => {
    const root = rootOf(); const nodes = []; let m
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    while ((m = tw.nextNode())) nodes.push(m)
    const a = pointAt(nodes, off)
    const b = typeof endOff === 'number' ? pointAt(nodes, endOff) : a
    if (!a || !b) return false
    const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return true
  }
})
const st = () => page.evaluate(() => window.__state())
async function reset() {
  await page.click('[data-composer-input]')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(250)
}
async function ime(text, settle) {
  const w = settle === undefined ? 200 : settle
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  if (w) await page.waitForTimeout(Math.min(60, w))
  await cdp.send('Input.insertText', { text })
  if (w) await page.waitForTimeout(w)
}
const results = []
async function scene(name, expect, expectCaret, fn) {
  await reset()
  await fn()
  await page.waitForTimeout(320)
  const s = await st()
  const pass = s.text === expect && (expectCaret === null || expectCaret === expectCaret && s.caret === expectCaret)
  results.push({ name, pass, got: s.text, caret: s.caret })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  期望=${JSON.stringify(expect)}/${expectCaret} 实得=${JSON.stringify(s.text)}/${s.caret}`)
}

await scene('空框打 ( → ()', '()', 1, async () => { await page.keyboard.press('Shift+Digit9') })
await scene('空框打 [ → []', '[]', 1, async () => { await page.keyboard.press('BracketLeft') })
await scene('空框打 ` → ``', '``', 1, async () => { await page.keyboard.press('Backquote') })

await scene('配对之后接着打字要落在两符之间', '"你好"', 3, async () => {
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(200)
  await ime('你好')
})

await scene('a 后打 ( → 只插一个（保护 call(）', 'a(', 2, async () => {
  await page.keyboard.insertText('a'); await page.waitForTimeout(150)
  await page.keyboard.press('Shift+Digit9')
})

await scene('中文正文后打 ( → 配对', '说明()', 3, async () => {
  await ime('说明')
  await page.keyboard.press('Shift+Digit9')
})

await scene('空对 () 里按一次 Backspace 删两侧', '', 0, async () => {
  await page.keyboard.press('Shift+Digit9'); await page.waitForTimeout(250)
  await page.keyboard.press('Backspace')
})
await scene('空对 “” 里按一次 Backspace 删两侧', '', 0, async () => {
  await page.keyboard.insertText('“'); await page.waitForTimeout(300)
  await page.keyboard.press('Backspace')
})

await scene('“” 中间再打 “ → 跳过去不多插', '“”', 2, async () => {
  await page.keyboard.insertText('“'); await page.waitForTimeout(300)
  await page.keyboard.insertText('“')
})

await scene('右边是文字时打 " → 只插一个', '"abc', 1, async () => {
  await page.keyboard.insertText('abc'); await page.waitForTimeout(200)
  await page.evaluate(() => window.__place(0)); await page.waitForTimeout(200)
  await page.keyboard.press('Shift+Quote')
})

await scene('框住中文引号：选中 abc 打 “', '“abc”', 5, async () => {
  await page.keyboard.insertText('abc'); await page.waitForTimeout(200)
  await page.evaluate(() => window.__place(0, 3)); await page.waitForTimeout(200)
  await page.keyboard.insertText('“')
})

await scene('已有未闭合开符 + 选中内容再打同一个 → 补闭合不是再框一层', '"abc"', 5, async () => {
  await page.keyboard.insertText('abc'); await page.waitForTimeout(200)
  await page.evaluate(() => window.__place(0)); await page.waitForTimeout(200)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(250)
  await page.evaluate(() => window.__place(1, 4)); await page.waitForTimeout(200)
  await page.keyboard.press('Shift+Quote')
})

/* 手速：真人上屏之后紧接着按键（2026-10-20 使用中复现的那条就是这里漏的）。
 * 这几条必须有 —— 慢速版全绿而快速版红过整整一轮，因为光标复位当时靠盲定时器，
 * 要么没抢在输入法前面，要么在用户打完字之后才开火。 */
const FAST = 10
await scene('手速·空框 " → 中文 → "（每步 10ms，靠配对后光标在两符之间）', '"你好"', 4, async () => {
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(FAST)
  await ime('你好', FAST)
  await page.keyboard.press('Shift+Quote')
})
await scene('手速·中文 → Home → " → End → "（每步 10ms）', '"你好"', 4, async () => {
  await ime('你好', FAST)
  await page.keyboard.press('Home'); await page.waitForTimeout(FAST)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(FAST)
  await page.keyboard.press('End'); await page.waitForTimeout(FAST)
  await page.keyboard.press('Shift+Quote')
})
await scene('手速·空框 " → 立刻上屏中文 → 立刻再打 "（零等待）', '"你好"', 4, async () => {
  await page.keyboard.press('Shift+Quote')
  await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.insertText', { text: '你好' })
  await page.keyboard.press('Shift+Quote')
})

/* 使用中 2026-10-20 的原路径：先打「你好」→ 前面打 `"` → 再打 `"`。
 * 这是唯一一条能把「`"你好""`」造出来的路（真机复现：选中文字打 `"` 会框成 `"你好"`，
 * 光标落在闭符之后，再打 `"` 就堆出第三个）。两种落法都要守：
 *   A 回最前打 `"`（没有选中）→ 再打同一个 = 补闭合到段尾；
 *   B 选中文字打 `"`（框住）→ 再打同一个 = 不再堆。 */
await scene('使用中路径A·你好 → Home → " → 立刻再打 " ', '"你好"', 4, async () => {
  await ime('你好')
  await page.keyboard.press('Home'); await page.waitForTimeout(180)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(200)
  await page.keyboard.press('Shift+Quote')
})
await scene('使用中路径A·鼠标点行首 → " → 再打 " ', '"你好"', 4, async () => {
  await ime('你好')
  const r = await page.evaluate(() => { const b = document.querySelector('[data-composer-input]').getBoundingClientRect(); return { x: b.left + 4, y: b.top + b.height / 2 } })
  await page.mouse.click(r.x, r.y); await page.waitForTimeout(180)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(200)
  await page.keyboard.press('Shift+Quote')
})
await scene('使用中路径B·全选 → " (框住) → 再打 " ', '"你好"', 4, async () => {
  await ime('你好')
  await page.keyboard.press('Control+a'); await page.waitForTimeout(150)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(250)
  const mid = await st()
  if (mid.text !== '"你好"') throw new Error('造态失败（应为框住的结果）：' + JSON.stringify(mid))
  await page.keyboard.press('Shift+Quote')
})
await scene('使用中路径B·框住后快打（10ms）再打 " ', '"你好"', 4, async () => {
  await ime('你好')
  await page.keyboard.press('Control+a'); await page.waitForTimeout(150)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(10)
  await page.keyboard.press('Shift+Quote')
})

/* 手快那一拍（2026-10-20 的一次反馈）。
 * 断开两键之间的等待，逼出「上一键的光标复位还没落地就来了下一键」这种顺序。 */
await scene('手速·空框 0ms 连按两下 " → 仍是 ""', '""', 2, async () => {
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.press('Shift+Quote')
})
await scene('手速·空框 0ms 连按三下 " → """', '"""', 3, async () => {
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.press('Shift+Quote')
})
await scene('手速·打完 " 立刻上屏中文 → 落在两符之间', '"你好"', 3, async () => {
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.insertText('你好')
})
await scene('手速·打完 " 立刻再打 " 再上屏中文 → ""你好', '""你好', 4, async () => {
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.press('Shift+Quote')
  await page.keyboard.insertText('你好')
})

const pass = results.filter(r => r.pass).length
console.log(`\n真机回归：${pass}/${results.length} 通过`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
