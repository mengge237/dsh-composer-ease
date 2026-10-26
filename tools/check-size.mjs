#!/usr/bin/env node
// 结构闸：单文件行数上限 + 生成物与片段一致
//
// 为什么要有它：这个仓 84 次提交里 `refactor` 是 0 次，`lib/client.js` 长到 1629 行、
// 80 个函数、最长 178 行 —— 而闸只查"测试绿 + 版本一致"，看不见结构。
// 这条闸把"结构"变成可判定的东西：片段超上限、或生成物没跟上片段，都直接红。
//
// 判据：
// ① lib/client/*.js 每个片段 ≤ MAX_LINES（默认 400）
// ② node tools/build-client.mjs --check 必须通过（生成物 = 片段拼出来的）
// ③ lib/index.js / lib/words.js 等手写文件 ≤ MAX_FILE_LINES（默认 600，词典与生成物豁免）
// 退出码：0 干净 / 1 有超限 / 2 生成物不一致

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const MAX_LINES = Number(process.env.MAX_CLIENT_LINES || 400)
const MAX_FILE_LINES = Number(process.env.MAX_FILE_LINES || 600)
// 生成物与数据文件不计行数：它们是数据，不是逻辑。
const EXEMPT = new Set(['cjk-lexicon.js', 'en-lexicon.js', 'domain-words.js', 'en-common.js', 'words.js'])

const count = (p) => fs.readFileSync(p, 'utf8').split('\n').length
let bad = 0

const dir = path.join(ROOT, 'lib/client')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
  const n = count(path.join(dir, f))
  const over = n > MAX_LINES
  if (over) bad++
  console.log(`${over ? 'RED ' : 'ok  '} lib/client/${f.padEnd(22)} ${String(n).padStart(5)} 行`)
}

for (const f of fs.readdirSync(path.join(ROOT, 'lib')).filter((x) => x.endsWith('.js')).sort()) {
  if (EXEMPT.has(f) || f === 'client.js') continue   // client.js 是生成物，由片段各自把关
  const n = count(path.join(ROOT, 'lib', f))
  const over = n > MAX_FILE_LINES
  if (over) bad++
  console.log(`${over ? 'RED ' : 'ok  '} lib/${f.padEnd(28)} ${String(n).padStart(5)} 行`)
}

if (bad) {
  console.error(`\n${bad} 个文件超过行数上限（片段 ≤${MAX_LINES}，手写文件 ≤${MAX_FILE_LINES}）`)
  console.error('拆法：按「一个关注点一个片段」切进 lib/client/NN-*.js，再跑 node tools/build-client.mjs')
  process.exit(1)
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-client.mjs'), '--check'], { stdio: 'inherit' })
} catch {
  process.exit(2)
}
console.log('\n结构闸：干净')
