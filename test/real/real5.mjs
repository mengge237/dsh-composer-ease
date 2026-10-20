// 真机五场验收（唯一有效的证据）。前置：先起纯净 profile：dsh --profile demo --port 3081 --no-open
// 用法：node test/real/real5.mjs "http://127.0.0.1:3081/?token=…"
let chromium
for (const spec of ['playwright', 'file:///<本地路径>']) {
  try { ({ chromium } = await import(spec)); break } catch (e) {}
}
if (!chromium) { console.error('缺 playwright：装一个（npm i -g playwright）或改这里第二条回退路径'); process.exit(2) }

const URL_ = process.argv[2]
if (!URL_) { console.error('缺 URL'); process.exit(2) }

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
// 中文走输入法的组字提交（不是 __place 硬摆位），尽量贴近真人
async function ime(text) {
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await page.waitForTimeout(60)
  await cdp.send('Input.insertText', { text })
  await page.waitForTimeout(200)
}

const results = []
async function scene(name, expect, expectCaret, fn) {
  await reset()
  await fn()
  await page.waitForTimeout(350)
  const s = await st()
  const pass = s.text === expect && (expectCaret === null || s.caret === expectCaret)
  results.push({ name, expect, got: s.text, expectCaret, caret: s.caret, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      期望 ${JSON.stringify(expect)} caret=${expectCaret} ｜ 实得 ${JSON.stringify(s.text)} caret=${s.caret}`)
}

// 1 空框打半角引号
await scene('1 空框打 "', '""', 1, async () => {
  await page.keyboard.press('Shift+Quote')
})

// 2 前方有引号 + 中间中文 + 末尾再打引号
await scene('2 前方有引号+中文，末尾再打 "', '"你好"', 4, async () => {
  await ime('你好')
  await page.keyboard.press('Home'); await page.waitForTimeout(180)
  await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(250)
  await page.keyboard.press('End'); await page.waitForTimeout(250)
  const mid = await st()
  if (mid.text !== '"你好') throw new Error('造态失败：' + JSON.stringify(mid))
  await page.keyboard.press('Shift+Quote')
})

// 3 框住普通文字
await scene('3 选中 abc 打 " → 框住', '"abc"', 5, async () => {
  await page.keyboard.insertText('abc'); await page.waitForTimeout(250)
  await page.evaluate(() => window.__place(0, 3)); await page.waitForTimeout(250)
  await page.keyboard.press('Shift+Quote')
})

// 4 Shift 连按（连打三下同一个引号）
await scene('4 Shift 连按三下 "', '"""', 3, async () => {
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+Quote'); await page.waitForTimeout(260) }
})

// 5 中文引号：空框要补成对；已有未闭合开符时末尾只插一个
await scene('5a 空框打 “', '“”', 1, async () => {
  await page.keyboard.insertText('“')
})
await scene('5b “你好 末尾再打 “', '“你好“', 4, async () => {
  await ime('你好')
  await page.keyboard.press('Home'); await page.waitForTimeout(180)
  await page.keyboard.insertText('“'); await page.waitForTimeout(250)
  await page.keyboard.press('End'); await page.waitForTimeout(250)
  const mid = await st()
  if (mid.text !== '“你好') throw new Error('造态失败：' + JSON.stringify(mid))
  await page.keyboard.insertText('“')
})

const pass = results.filter(r => r.pass).length
console.log(`\n真机五场：${pass}/${results.length} 通过`)
await browser.close()
process.exit(pass === results.length ? 0 : 1)
