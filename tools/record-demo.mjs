#!/usr/bin/env node
// 录一段真机 demo 生成 GIF —— 取代"手工截几张图再拼"的做法。
//
// 管线（两个**专用工具**，不自己造轮子）：
//   1) Playwright 驱动真机页面，边操作边抓帧（`page.screenshot`），帧上带真实时间戳；
//   2) gifenc（纯 JS 的 GIF 编码器，专做调色板量化 + 抖动）按时间戳写帧，全局调色板压体积。
//
// 为什么不用 ffmpeg：本机取 ffmpeg 静态包时被加速代理的 TLS 中间人挡过（UNABLE_TO_VERIFY_LEAF_SIGNATURE），
// 而 gifenc 只走 npm registry，装得上、结果也够好（flat UI 上 256 色全局调色板几乎看不出损失）。
//
// 用法：
//   node tools/record-demo.mjs <url> [--out docs/demo.gif] [--fps 15] [--width 900]
// 依赖（不进本仓；用环境变量指过去）：
//   DEMO_DEPS=<dir with node_modules>    默认找 <本地路径>
//   里面需要：gifenc、pngjs
//   Playwright 默认用本机 dev-browser 自带那份，可用 PLAYWRIGHT_ENTRY 覆盖。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const argv = process.argv.slice(2)
const url = argv.find((a) => a.startsWith('http'))
if (!url) { console.error('用法：node tools/record-demo.mjs <url> [--out docs/demo.gif]'); process.exit(2) }
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const OUT = path.resolve(ROOT, argOf('out', 'docs/demo.gif'))
const FPS = Number(argOf('fps', 15))
const WIDTH = Number(argOf('width', 900))
const COLORS = Number(argOf('colors', 256))
const FORMAT = argOf('format', 'rgb565')     // rgb565 更准、rgb444 更小
const STRIDE = Math.max(1, Number(argOf('stride', 1)))   // 抽帧步长：2 = 每两帧留一帧，延迟相加

const DEPS = process.env.DEMO_DEPS || '<本地路径>'
const req = createRequire(path.join(DEPS, 'placeholder.js'))
let GIFEncoder, quantize, applyPalette, PNG
try {
  ({ GIFEncoder, quantize, applyPalette } = req('gifenc'))
  ;({ PNG } = req('pngjs'))
} catch (e) {
  console.error('缺依赖：在 DEMO_DEPS 指向的目录里 npm i gifenc pngjs\n', e.message)
  process.exit(2)
}

const PW_ENTRY = process.env.PLAYWRIGHT_ENTRY || 'file:///<本地路径>'
let chromium
try { ({ chromium } = await import(PW_ENTRY)) } catch (e) {
  console.error('取不到 playwright：', e.message); process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: WIDTH, height: 560 }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)

const box = await page.locator('[data-composer-input]').first().boundingBox()
if (!box) { console.error('找不到输入框'); await browser.close(); process.exit(3) }
// 只录输入框周边：弹层向下展开，所以下方留得多
const clip = {
  x: Math.max(0, Math.round(box.x - 40)),
  y: Math.max(0, Math.round(box.y - 56)),
  width: Math.min(WIDTH, Math.round(box.width + 80)),
  height: Math.min(560, Math.round(box.height + 300)),
}
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.evaluate(() => {
  const CE = '[data-composer-input]'
  window.__clearBox = () => {
    const r = document.querySelector(CE)
    if (!r) return
    r.focus()
    const s = window.getSelection(); const g = document.createRange()
    g.selectNodeContents(r); s.removeAllRanges(); s.addRange(g)
  }
})

const frames = []
let last = Date.now()
let recording = true
async function pump() {
  while (recording) {
    try {
      const buf = await page.screenshot({ type: 'png', clip })
      const now = Date.now()
      frames.push({ buf, ms: now - last })
      last = now
    } catch (e) { break }
  }
}
const pumpTask = pump()

// ── 剧本：四幕，全程真打字（不留围栏：反引号会被插件自己配对，会把剧本搅乱）────────
const type = (s, per = 70) => page.keyboard.type(s, { delay: per })
async function clearAll() {
  await page.keyboard.press('Escape')
  for (let i = 0; i < 8; i++) {
    const empty = await page.evaluate(() => !(document.querySelector('[data-composer-input]') || {}).textContent)
    if (empty) return
    await page.evaluate(() => window.__clearBox())
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(90)
  }
}
await page.waitForTimeout(150)
await type('def', 95); await page.waitForTimeout(500)          // ① 补全弹层 + 灰字
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(240)   // ② 灰字跟着选中走
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(240)
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(240)
await page.keyboard.press('Tab'); await page.waitForTimeout(450)         // ③ Tab 接受
await clearAll(); await page.waitForTimeout(200)
await type('docum', 80); await page.waitForTimeout(600)        // ④ 英文词 + 文件混排
await page.keyboard.press('Escape'); await page.waitForTimeout(250)
await clearAll(); await page.waitForTimeout(200)
await type('他说"这句话没闭合', 50); await page.waitForTimeout(650)   // ⑤ 引号未闭合波浪线
await page.waitForTimeout(200)

recording = false
await pumpTask
await browser.close()

if (frames.length < 4) { console.error('抓到的帧太少：', frames.length); process.exit(4) }
const clampMs = (ms) => Math.max(Math.round(1000 / (FPS * 1.6)), Math.min(400, ms))

// 全局调色板：从中间帧量化 256 色（flat UI 够用，逐帧调色板会让体积翻倍）
const mid = frames[Math.floor(frames.length / 2)]
const midPng = PNG.sync.read(mid.buf)
const palette = quantize(new Uint8Array(midPng.data), COLORS, { format: FORMAT })

// 抽帧：把连续 STRIDE 帧的时长累加到保留的那一帧上（保住"真实时长"，只是降低采样率）
const kept = []
for (let i = 0; i < frames.length; i += STRIDE) {
  let ms = 0
  for (let k = i; k < Math.min(i + STRIDE, frames.length); k++) ms += frames[k].ms
  kept.push({ buf: frames[i].buf, ms })
}

const gif = GIFEncoder()
for (const f of kept) {
  const png = PNG.sync.read(f.buf)
  const idx = applyPalette(new Uint8Array(png.data), palette, FORMAT)
  gif.writeFrame(idx, png.width, png.height, { palette, delay: clampMs(f.ms), dispose: 2 })
}
gif.finish()
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.from(gif.bytes()))
const kb = Math.round(fs.statSync(OUT).size / 1024)
console.log(`已生成 ${path.relative(ROOT, OUT)}：${kept.length}/${frames.length} 帧（抽帧 1/${STRIDE}）/ ${COLORS} 色 ${FORMAT} / ${midPng.width}×${midPng.height} / ${kb} KB`)
