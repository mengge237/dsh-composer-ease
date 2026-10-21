#!/usr/bin/env node
/**
 * 发布一致性检查（策略即代码）：package.json 的版本必须与 CHANGELOG 最新一条一致，
 * 每条 CHANGELOG 都必须带日期 + 提交 sha；确实没有对应提交的，必须写**显式豁免**「无 sha」，
 * 静默省略一律算红。
 *
 * 为什么需要它（2026-10-21 实况）：README 里的版本记录有 13 条日期是手写错的，0.9.11 还被追加到列表末尾。
 * 人写的东西必须有机器闸。
 *
 * 用法：
 *   node tools/check-release.mjs            # 真跑，红则退出码 1
 *   node tools/check-release.mjs --selftest # 自测（五格）
 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEAD = /^- \*\*(\d+\.\d+\.\d+)\*\*（(.+?)）/
const SHA = /`([0-9a-f]{7,40})`/
const EXEMPT = /无 sha/

function parseChangelog(text) {
  const entries = []
  const bad = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('- **')) continue
    const m = HEAD.exec(line)
    if (!m) { bad.push([line.slice(0, 60), '缺「（日期，sha）」这一节']); continue }
    const [, version, paren] = m
    const sha = SHA.exec(paren)
    const date = /(\d{4}-\d{2}-\d{2})/.exec(paren)
    if (sha) entries.push({ version, date: date ? date[1] : '', sha: sha[1], exempt: false })
    else if (EXEMPT.test(paren)) entries.push({ version, date: date ? date[1] : '', sha: null, exempt: true })
    else bad.push([line.slice(0, 60), '缺 sha（真没有对应提交就写「无 sha」）'])
  }
  return { entries, bad }
}

function cmp(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

export function check(pkgVersion, changelogText) {
  const problems = []
  const { entries, bad } = parseChangelog(changelogText)

  for (const [line, why] of bad) problems.push(`${why}：${line}`)
  if (!entries.length) problems.push('CHANGELOG 里没有可解析的版本条目')
  else {
    if (entries[0].version !== pkgVersion) {
      problems.push(`package.json 版本 ${pkgVersion} 与 CHANGELOG 最新条目 ${entries[0].version} 不一致`)
    }
    const seen = new Set()
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (seen.has(e.version)) problems.push(`版本重复：${e.version}`)
      seen.add(e.version)
      if (i > 0 && cmp(entries[i - 1].version, e.version) <= 0) {
        problems.push(`顺序错：${entries[i - 1].version} 应排在 ${e.version} 之前（最新在上）`)
      }
    }
  }
  return problems
}

function realRun() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const problems = check(pkg.version, log)
  const { entries } = parseChangelog(log)
  const exempt = entries.filter((e) => e.exempt).map((e) => e.version)
  if (!problems.length) {
    console.log(`OK  package.json ${pkg.version} 与 CHANGELOG 首条一致；共 ${entries.length} 条，全部带日期，`
      + `其中 ${entries.length - exempt.length} 条带 sha` + (exempt.length ? `，显式豁免 ${exempt.length} 条（${exempt.join(', ')}）` : ''))
    return 0
  }
  for (const p of problems) console.log('  RED  ' + p)
  console.log(`\n${problems.length} 个红（红=退出码 1）`)
  return 1
}

function selftest() {
  const cases = [
    ['一致 → 绿', '1.2.3', '- **1.2.3**（2026-10-21，`abcdef1`）：改了什么\n- **1.2.2**（2026-10-20，`abcdef0`）：更早', 0],
    ['版本不一致 → 红', '1.2.4', '- **1.2.3**（2026-10-21，`abcdef1`）：改了什么', 1],
    ['缺 sha → 红', '1.2.3', '- **1.2.3**（2026-10-21）：改了什么', 1],
    ['乱序 → 红', '1.2.2', '- **1.2.2**（2026-10-21，`abcdef1`）：改了什么\n- **1.2.3**（2026-10-20，`abcdef0`）：更早', 1],
    ['显式豁免 → 绿', '1.2.3', '- **1.2.3**（2026-10-21，`abcdef1`）：改了什么\n- **1.2.0**（2026-10-15，无 sha：早于本仓首个提交）：首版', 0],
  ]
  let failed = 0
  for (const [label, ver, text, want] of cases) {
    const got = check(ver, text).length ? 1 : 0
    const ok = got === want
    if (!ok) failed++
    console.log(`  ${label.padEnd(20)} 期望红=${want} 实际红=${got} ${ok ? 'ok' : 'FAIL'}`)
  }
  console.log(`\n自测 ${failed ? failed + ' 格失败' : '全过'}`)
  return failed ? 1 : 0
}

if (process.argv.includes('--selftest')) process.exit(selftest())
process.exit(realRun())
