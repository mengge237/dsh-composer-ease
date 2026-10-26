#!/usr/bin/env node
// 机制闸②：**"该做一次只重构的提交了"**（2026-10-22 定的那条，改成可判定）
//
// 背景：本仓 84 次提交里 `refactor` 是 0 次 —— 不是不会重构，是没有任何东西逼它发生，
// 每次都是"修这条症状"的最小补丁（单次改动中位数 33 行、46% ≤30 行）。
// 这条闸把"重构"变成会到期的东西：从上一次 `refactor:` 提交算起，普通提交超过预算就红。
//
// 判据（都可调，走环境变量）：
//   MAX_SINCE_REFACTOR  默认 40 —— 距上次 refactor 的提交数上限
//   MAX_FIX_RATIO       默认 0.55 —— 窗口内 fix 占比上限（超了说明一直在打补丁）
// 窗口 = 最近 MAX_SINCE_REFACTOR 条提交（走 git log，只读）。
//
// 退出码：0 干净 / 1 到期（该排一次重构）/ 2 读不到 git

import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const MAX_SINCE = Number(process.env.MAX_SINCE_REFACTOR || 40)
const MAX_FIX = Number(process.env.MAX_FIX_RATIO || 0.55)

let log = []
try {
  log = execFileSync('git', ['log', '--format=%s'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
} catch {
  console.error('读不到 git log（不在仓库里？）')
  process.exit(2)
}

const isRefactor = (s) => /^refactor(\(|:|：)/.test(s)
const since = log.findIndex(isRefactor)          // -1 = 从来没重构过
const window = log.slice(0, MAX_SINCE)
const fixes = window.filter((s) => /^fix(\(|:|：)/.test(s)).length
const ratio = window.length ? fixes / window.length : 0

console.log(`提交总数 ${log.length}｜距上次 refactor：${since < 0 ? '从未' : since + ' 条'}（预算 ${MAX_SINCE}）`)
console.log(`最近 ${window.length} 条里 fix 占比 ${(ratio * 100).toFixed(0)}%（上限 ${(MAX_FIX * 100).toFixed(0)}%）`)

const overdue = since < 0 || since >= MAX_SINCE
if (overdue) {
  console.error('\nRED  该排一次「只做重构」的提交了：不改行为、只拆结构/删重复，单独立一条 refactor: 提交。')
  console.error('     先看 lib/client/*.js 哪个片段最长、tools/check-dup.mjs 有没有同名/重复块。')
  process.exit(1)
}
if (ratio > MAX_FIX) {
  console.error(`\nRED  最近 ${window.length} 条里 fix 太多（${(ratio * 100).toFixed(0)}% > ${(MAX_FIX * 100).toFixed(0)}%）：`)
  console.error('     说明一直在打补丁攒债 —— 排一次重构轮，或把某个反复修的机制删掉重写。')
  process.exit(1)
}
console.log('机制闸②：干净（重构还没到期）')
