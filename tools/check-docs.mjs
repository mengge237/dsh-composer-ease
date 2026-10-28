#!/usr/bin/env node
// 文档闸：等价 deepseek-harness 的 verify-md-links + verify-doc-budgets。
//
// 为什么要有它：本仓的 README / docs / THIRD-PARTY 是手写件，改动多、容易腐化——
// 链接指向已删文件、单文件长成一本册子。这两类问题人眼扫不出来，机器一秒就能查。
//
// 判据：
// ① 相对链接（`[x](./path)` / `[x](docs/y.md)`）必须能在盘上找到；http(s)/mailto/#anchor 跳过
// ② 行数预算：README ≤ 400、THIRD-PARTY ≤ 400、docs/*.md ≤ 600（可用环境变量覆盖）
// ③ 不许有 TODO/FIXME 空壳
// 退出码：0 干净 / 1 有问题

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const BUDGET = {
  'README.md': Number(process.env.MAX_README_LINES || 400),
  'THIRD-PARTY.md': Number(process.env.MAX_THIRDPARTY_LINES || 400),
  'CHANGELOG.md': Number(process.env.MAX_CHANGELOG_LINES || 2000),
  docs: Number(process.env.MAX_DOC_LINES || 600),
}

const files = []
const push = (p) => { if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p) }
for (const f of ['README.md', 'README.zh.md', 'THIRD-PARTY.md', 'CHANGELOG.md']) push(path.join(ROOT, f))
for (const dir of ['docs', '.github']) {
  const d = path.join(ROOT, dir)
  if (!fs.existsSync(d)) continue
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name)
      if (e.isDirectory()) walk(q)
      else if (e.name.endsWith('.md')) files.push(q)
    }
  }
  walk(d)
}

// 双语 README 契约：英文那份是主展示（README.md），中文那份是副展示（README.zh.md），
// 两份都要存在、都要链到对方 —— 只留一份或链错，这条闸直接红。
for (const [self, other] of [['README.md', 'README.zh.md'], ['README.zh.md', 'README.md']]) {
  const f = path.join(ROOT, self)
  if (!fs.existsSync(f)) { console.error(`RED  缺 ${self}（双语 README 缺一份）`); bad++; continue }
  const text = fs.readFileSync(f, 'utf8')
  if (text.indexOf('](' + other + ')') < 0) {
    console.error(`RED  ${self} 没有链到 ${other}（双语 README 要互相指得到）`)
    bad++
  }
}

let bad = 0
const budgetOf = (rel) => (rel.startsWith('docs/') ? BUDGET.docs : (BUDGET[rel] || BUDGET.docs))

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const text = fs.readFileSync(f, 'utf8')
  const lines = text.split('\n').length
  const limit = budgetOf(rel)
  if (lines > limit) {
    bad++
    console.error(`RED  行数超预算：${rel} ${lines} > ${limit}`)
  }
 // CHANGELOG 是历史记录，正文里引用这两个词（比如"禁 TODO"）是正常的，不算留坑。
  if (rel !== 'CHANGELOG.md' && /\b(TODO|FIXME)\b/.test(text)) {
    bad++
    console.error(`RED  留了 TODO/FIXME：${rel}`)
  }
 // 只查行内链接；代码围栏里的示例跳过（否则 doc 里写 `[x](y)` 当例子会假红）
 // 围栏代码块 + **行内代码**都要剥掉：文档里用反引号展示 `[x](y)` 这种语法是常态，
 // 不剥就会被当成死链（写「如何做 README 图」时出现）。
  const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(body))) {
    const target = m[1]
    if (/^(https?:|mailto:|#|data:)/i.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    const abs = path.resolve(path.dirname(f), decodeURIComponent(clean))
    if (!fs.existsSync(abs)) {
      bad++
      console.error(`RED  死链：${rel} → ${target}`)
    }
  }
}

if (bad) {
  console.error(`\n共 ${bad} 处文档问题（${files.length} 个文件被检查）`)
  process.exit(1)
}
console.log(`文档闸：干净（${files.length} 个文件，链接全通，行数均在预算内）`)
