#!/usr/bin/env node
// 真机留证：跑 test/real/matrix.mjs 并把结果写成 test/real/last-run.json。
// 为什么不在 CI 跑：真机矩阵要一个活着的 dsh 宿主（端口 + token）与 Playwright dial，
// 这些在 CI 里能装但不稳定；所以改为「本地跑一次、把读数入仓」，评审看得到证据。
// 用法：node tools/real-run.mjs <baseUrl> [rounds]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const url = process.argv[2]
const rounds = process.argv[3] || '1'
if (!url) { console.error('用法：node tools/real-run.mjs <baseUrl> [rounds]'); process.exit(2) }

let pkgVersion = 'unknown'
try { pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version } catch (e) {}

let out = ''
try {
  out = execFileSync(process.execPath, [path.join(ROOT, 'test', 'real', 'matrix.mjs'), url, rounds], { encoding: 'utf8' })
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '')
  console.error('矩阵执行失败：' + String(e.message || e))
}
const m = out.match(/\{[\s\S]*\}\s*$/)
let result = null
try { result = m ? JSON.parse(m[0]) : null } catch (e) {}
const record = {
  ranAt: new Date().toISOString(),
  packageVersion: pkgVersion,
  baseUrlHost: String(url).replace(/token=[^&]+/, 'token=***'),
  rounds: Number(rounds),
  total: result && result.total != null ? result.total : null,
  passed: result && result.passed != null ? result.passed : null,
  failedCount: result && result.failedCount != null ? result.failedCount : null,
  failed: (result && result.failed) || [],
}
fs.writeFileSync(path.join(ROOT, 'test', 'real', 'last-run.json'), JSON.stringify(record, null, 2) + '\n')
console.log('真机留证已写：test/real/last-run.json  passed=' + record.passed + '/' + record.total)
if (record.failedCount) process.exit(1)
