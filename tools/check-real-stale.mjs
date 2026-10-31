#!/usr/bin/env node
// 端到端留证新鲜度：超过 14 天或版本与 package.json 不一致时提示补跑（不阻断 check:all）。
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const p = path.join(ROOT, 'test', 'real', 'last-run.json')
if (!fs.existsSync(p)) { console.log('端到端留证：缺 test/real/last-run.json（跑 npm run test:real <url>）'); process.exit(0) }
const r = JSON.parse(fs.readFileSync(p, 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const days = (Date.now() - Date.parse(r.ranAt)) / 86400000
const issues = []
if (!(days <= 14)) issues.push('留证已 ' + days.toFixed(1) + ' 天（上限 14）')
if (r.packageVersion !== pkg.version) issues.push('留证版本 ' + r.packageVersion + ' 与当前 ' + pkg.version + ' 不一致')
if (r.failedCount) issues.push('上次有 ' + r.failedCount + ' 条失败')
console.log(issues.length ? '端到端留证：需要补跑 —— ' + issues.join('；') : '端到端留证：新鲜（' + r.passed + '/' + r.total + '，' + r.ranAt + '）')
