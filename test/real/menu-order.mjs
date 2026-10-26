// 只读探针：「严格配对」在 `/` 菜单里的名次（建，因一次反馈）。
// 用法：node probe.mjs "http://127.0.0.1:3081/?token=…"
// 判据：便捷输入框组的纵坐标必须小于「指令」「技能」组的纵坐标。
let chromium
for (const spec of ['playwright', 'file:///<本地路径>']) {
  try { ({ chromium } = await import(spec)); break } catch (e) {}
}
if (!chromium) { console.error('缺 playwright'); process.exit(2) }

const URL_ = process.argv[2]
if (!URL_) { console.error('缺 URL'); process.exit(2) }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)

// 触发源数量（宿主侧实测值）
const sources = await page.evaluate(() => window.__DSE_TRIGGER_SOURCES__)

const box = await page.locator('[data-composer-input]').first().boundingBox()
if (!box) { console.error('找不到输入框 [data-composer-input]'); await browser.close(); process.exit(3) }
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(300)
await page.keyboard.type('/')
await page.waitForTimeout(1200)

const read = await page.evaluate(() => {
  const want = ['添加', '指令', '技能', '便捷输入框', '严格配对']
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim()
    if (!want.includes(t)) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    out.push({ text: t, top: Math.round(r.top), left: Math.round(r.left) })
  }
 // 同名多份时留最靠上的一枚（组标题通常只有一个可见）
  const seen = new Map()
  for (const o of out) if (!seen.has(o.text) || seen.get(o.text).top > o.top) seen.set(o.text, o)
  return [...seen.values()].sort((a, b) => a.top - b.top)
})

console.log('触发源读数 __DSE_TRIGGER_SOURCES__ =', sources)
console.log('\n菜单里读到的条目（按纵坐标）：')
for (const r of read) console.log(`   top=${String(r.top).padStart(5)}  ${r.text}`)

const pos = n => { const i = read.findIndex(r => r.text === n); return i < 0 ? null : i }
const box_ = pos('便捷输入框'), skill = pos('技能'), cmd = pos('指令'), add = pos('添加')
const strict = pos('严格配对')

let pass = true
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) pass = false }
say(sources === 2, `两个触发源都注册了（实读 ${sources}）`)
say(strict !== null, '打 `/` 能看到「严格配对」条目')
if (box_ !== null && skill !== null) say(box_ < skill, `便捷输入框在技能之前（下标 ${box_} < ${skill}）`)
else say(false, '菜单里没读到「便捷输入框」或「技能」组标题')
if (box_ !== null && cmd !== null) say(box_ < cmd, `便捷输入框在指令之前（下标 ${box_} < ${cmd}）`)
if (box_ !== null && add !== null) say(box_ < add, `便捷输入框在添加之前（下标 ${box_} < ${add}）`)

await browser.close()
console.log(pass ? '\n真机菜单次序：PASS' : '\n真机菜单次序：FAIL')
process.exit(pass ? 0 : 1)
