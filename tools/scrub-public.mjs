#!/usr/bin/env node
// 洗稿器：把公开仓里的「对话原话 / 本机路径 / 内部分工」洗成中性表述。
//
// 分工原则（2026-10-22 定）：
//   - **公开仓**只讲"改了什么、为什么、怎么验"；不写谁在什么时候说了什么（那是私有留档的事）。
//   - 逐字证据永远留在私有档（gh-archive / 会话存档），不进公开仓。
//
// 用法：
//   node tools/scrub-public.mjs --dry-run      # 只报告：命中多少、涉及哪些文件
//   node tools/scrub-public.mjs --apply        # 实际改写（改完要自己 git diff 看一遍再提交）
//
// 注意：只洗**工作树**。历史里已有的旧内容需要重写历史或转私有仓，见文档末节。

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const APPLY = process.argv.includes('--apply')
const EXEMPT = new Set(['tools/check-privacy.mjs', 'tools/scrub-public.mjs', 'docs/如何做 README 图.md', 'THIRD-PARTY.md'])

/** 顺序有意义：先把"整句引述"洗掉，再洗零散的路径与约定，否则会洗成半截话。 */
const RULES = [
  // ① 整段引述 → 中性表述。三种常见形态都要吞掉**连同引号里的原话**：
  //    「维护者 2026-10-22 报「…」」「维护者 2026-10-16 报的「…」」「维护者要求「…」」
  {
    what: '对话引述（带日期）→ 中性表述',
    rx: /维护者\s*(\d{4}-\d{2}-\d{2})?\s*(?:反馈|报告|报的?|说的?|要求的?|指出|提到|认为)?\s*[：:]?\s*「[^」]{0,240}」/g,
    to: (_m, date) => (date ? `${date} 的一次反馈` : '一次反馈'),
  },
  // ② 已经只剩"使用中/维护者"但后面还挂着引号的（上一版洗稿的残留形态）
  { what: '残留引用 → 中性', rx: /(?:使用中|维护者)\s*(?:\d{4}-\d{2}-\d{2})?\s*的?\s*「[^」]{0,240}」/g, to: () => '一次反馈' },
  { what: '裸的「维护者」', rx: /维护者/g, to: () => '使用中' },
  // ③ 本机绝对路径 → 占位
  { what: '本机绝对路径', rx: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s`"')）\]]*/g, to: () => '<本地路径>' },
  // ④ 本机工作区约定 → 中性
  { what: '临时目录约定', rx: /[56]_临时/g, to: () => '临时目录' },
  // ⑤ 私有配置与宿主本机构建
  { what: 'DSH 私有配置', rx: /~\/\.dsh|AGENTS\.md/g, to: () => '本地配置' },
  { what: '宿主本机构建路径', rx: /deepseek-harness[\\/][^\s`"')）]*/g, to: () => '<宿主目录>' },
]

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean)
  .filter((f) => /\.(md|mjs|js|json|ya?ml|txt|svg|ps1|py)$/.test(f))
  .filter((f) => !EXEMPT.has(f))

let touched = 0
let replaced = 0
for (const f of files) {
  const abs = path.join(ROOT, f)
  let text
  try { text = fs.readFileSync(abs, 'utf8') } catch { continue }
  const before = text
  const counts = {}
  // 测试里那些 `E:/path`、`临时目录` 是**夹具**（故意造的假路径），洗了会把用例洗红；
  // 所以 test/ 下只洗对话引述，不动路径类规则。
  const isTest = f.startsWith('test/')
  for (const r of RULES) {
    if (isTest && /路径|临时目录|宿主|私有配置/.test(r.what)) continue
    text = text.replace(r.rx, (...args) => {
      replaced++
      counts[r.what] = (counts[r.what] || 0) + 1
      return typeof r.to === 'function' ? r.to(...args) : r.to
    })
  }
  if (text !== before) {
    touched++
    console.log(`  ${f.padEnd(38)} ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join('，')}`)
    if (APPLY) fs.writeFileSync(abs, text)
  }
}

console.log(`\n${APPLY ? '已改写' : '将改写'} ${touched} 个文件，共 ${replaced} 处`)
if (!APPLY) console.log('确认无误后跑：node tools/scrub-public.mjs --apply  然后 git diff 看一遍')
else console.log('现在跑 node tools/check-privacy.mjs 复核，再 git diff / 提交')
