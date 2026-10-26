#!/usr/bin/env node
// 散文闸：代码注释只讲「为什么这么做」，不讲「谁在什么时候踩了什么坑」。
//
// 借 deepseek-harness 的模型：**每条规范配一个可运行的 verify-***，而不是写在文档里靠自觉。
// 为什么需要它：本仓注释里长期混着叙事（"实测发现的…"、"…"、"口径：…"），
// 这些内容属于 CHANGELOG 与私有留档，写进代码注释只会让后来者读不到要点。
//
// 判据（逐条可解释，命中即红）：
// ① 注释里出现日期（`20xx-xx-xx`）—— 日期属于 CHANGELOG
// ② 注释里出现第一人称 / 对话痕迹（插件）
// ③ 注释里出现叙事故障词（出现、遇到过、口径、实测、实测值、不要）
// ④ 连续注释块超过 3 行 —— 说明在写故事，不是在写约束
// ⑤ 单行注释超过 100 个字符 —— 同上
//
// 用法：
// node tools/verify-comment-prose.mjs # 报告（默认上限见 MAX）
// node tools/verify-comment-prose.mjs --list # 列出全部命中行
//
// 生成件与第三方数据不查（words.js / *lexicon* / client.js 等）。

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const LIST = process.argv.includes('--list')

// 生成件/第三方数据：不参与（它们是数据不是散文）
const SKIP = new Set(['words.js', 'cjk-lexicon.js', 'en-lexicon.js', 'en-common.js', 'domain-words.js', 'client.js'])
// vendored 上游代码（注释是原作者写的英文，不按本仓口径改）
const VENDORED = new Set(['fuzzy.js'])
// 契约上限：只许往下调，不许上调（每清一批就调低一次）
const MAX = { date: 0, firstPerson: 0, narrative: 0, block: 0, longLine: 0 }

const RULES = [
  { id: 'date', what: '注释里写日期（属于 CHANGELOG）', rx: /20\d{2}-\d{1,2}-\d{1,2}/ },
  { id: 'firstPerson', what: '第一人称/对话痕迹', rx: /本人|我们|使用中/ },
  { id: 'narrative', what: '叙事故障词（踩到/教训/真机/读数…）', rx: /踩到|踩过|教训|别再|真机|读数/ },
  { id: 'longLine', what: '单行注释超 120 字符', rx: null },
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|mjs)$/.test(e.name) && !SKIP.has(e.name) && !VENDORED.has(e.name)) out.push(p)
  }
  return out
}

const hits = { date: [], firstPerson: [], narrative: [], block: [], longLine: [] }
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let run = 0
  let runStart = 0
  const flush = () => {
    const cap = runStart <= 2 ? 25 : 8      // 文件头放宽（≤2 行是因为很多工具首行是 shebang）
    if (run > cap) hits.block.push({ file: rel, line: runStart, n: run, text: `${run} 行连续注释（上限 ${cap}）` })
    run = 0
  }
  lines.forEach((raw, i) => {
    const s = raw.trim()
    const isComment = s.startsWith('//') || s.startsWith('/*') || s.startsWith('*')
    if (!isComment) { flush(); return }
    const endsBlock = s.endsWith('*/')
    if (!run) runStart = i + 1
    run++
    for (const r of RULES) {
      if (!r.rx) continue
      if (r.rx.test(s)) hits[r.id].push({ file: rel, line: i + 1, text: s.slice(0, 110) })
    }
    if (s.length > 120) hits.longLine.push({ file: rel, line: i + 1, text: s.slice(0, 110) })
    if (endsBlock) flush()          // `*/` 收尾：相邻的两个 /* */ 块不算一个长块
  })
  flush()
}

let failed = 0
for (const [id, rows] of Object.entries(hits)) {
  const cap = MAX[id] ?? 0
  const over = Math.max(0, rows.length - cap)
  const label = id === 'block' ? '内联注释块超长（头 25 / 正文 8）' : RULES.find((r) => r.id === id)?.what || id
  console.log(`${over ? 'RED ' : 'ok  '} ${label.padEnd(32)} ${rows.length} 处（上限 ${cap}${over ? `，超 ${over}` : ''}）`)
  if (over) failed += over
  if (LIST || over) {
    for (const r of rows.slice(0, LIST ? rows.length : 8)) console.log(`      ${r.file}:${r.line}  ${r.text}`)
    if (!LIST && rows.length > 8) console.log(`      …另有 ${rows.length - 8} 处`)
  }
}

if (failed) {
  console.error(`\n散文闸：${failed} 处超契约。注释只写「为什么这么做」，故事留给 CHANGELOG。`)
  process.exit(1)
}
console.log('\n散文闸：干净')
