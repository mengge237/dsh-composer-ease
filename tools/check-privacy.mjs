#!/usr/bin/env node
// 发布前隐私闸：公开仓里不许出现「对话原话 / 本机路径 / 内部分工」。
//
// 为什么要有它（指出）：这个仓是 public，而我把"私有案卷逐字留证"的纪律
// 搬了进来 —— 提交信息与注释里写着「报「…」」，把用户的对话原话、本机绝对路径
// 一起推到了公网。纪律本身没错，错在没有一道"发布前"的闸。
//
// 判据（逐条可解释）：
// ① 不出现 "" 这种把对话当证据的引述（git 历史与注释都算）
// ② 不出现本机绝对路径（X:\ 或 X:/）
// ③ 不出现本机工作区约定（5_临时 / 6_临时）
// ④ 不出现 DSH 私有配置路径（~/.dsh、AGENTS.md）与宿主本机构建路径
// 退出码：0 干净 / 1 有命中

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

const RULES = [
  { id: 'dialogue-quote', what: '对话原话引述（"本人 …"）', rx: /本人/g },
  { id: 'local-path', what: '本机绝对路径（X:\\ 或 X:/）', rx: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s`"')）]*/g },
  { id: 'temp-dir', what: '本机工作区约定（5_临时 / 6_临时）', rx: /[56]_临时/g },
 // ~/.dsh 是所有 DSH 用户的标准配置目录（公开常识），不算泄漏；这里只抓**个人**规则文件与用户目录。
  { id: 'dsh-private', what: '个人规则文件与用户目录', rx: /AGENTS\.md|[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g },
  { id: 'host-build', what: '宿主本机构建路径（deepseek-harness 目录）', rx: /deepseek-harness[\\/]/g },
]
// 豁免：这三类文件里出现上述字样是**说明本身**（工具与文档在讲这条规矩）
const EXEMPT = new Set(['tools/check-privacy.mjs', 'tools/scrub-public.mjs', 'docs/如何做 README 图.md', 'THIRD-PARTY.md'])

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean)
  .filter((f) => /\.(md|mjs|js|json|ya?ml|txt|svg|ps1|py)$/.test(f))
  .filter((f) => !EXEMPT.has(f))

let bad = 0
const rows = []
for (const f of files) {
  let text = ''
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8') } catch { continue }
 // test/ 下的 `E:/path`、`5_临时` 是**夹具**（故意造的假路径），不是泄漏；那里只查对话引述。
  const isTest = f.startsWith('test/')
  for (const rule of RULES) {
    if (isTest && rule.id !== 'dialogue-quote') continue
    const hits = text.match(rule.rx)
    if (!hits) continue
    bad += hits.length
    rows.push({ file: f, rule: rule.what, n: hits.length, sample: String(hits[0]).slice(0, 60) })
  }
}

if (!rows.length) {
  console.log(`隐私闸：干净（${files.length} 个文本文件）`)
  process.exit(0)
}
rows.sort((a, b) => b.n - a.n)
for (const r of rows.slice(0, 20)) {
  console.error(`RED  ${r.file.padEnd(34)} ${String(r.n).padStart(4)} 处  ${r.rule}  例：${r.sample}`)
}
if (rows.length > 20) console.error(`RED  …另有 ${rows.length - 20} 处文件级命中`)
console.error(`\n共 ${bad} 处（${rows.length} 个文件）。公开仓不许带对话原话与本机路径：`)
console.error('  洗稿：node tools/scrub-public.mjs --apply   （先 --dry-run 看量）')
console.error('  说明：这只是 HEAD；历史里的旧内容要靠重写历史或转私有仓，见 docs/如何做 README 图.md 末节')
process.exit(1)
