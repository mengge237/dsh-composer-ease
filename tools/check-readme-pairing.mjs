#!/usr/bin/env node
// 双语 README 配对闸（照 deepseek-harness 的 README.i18n.yaml 做法）：
// ① 两份 README 的 `##` 小节数量与顺序必须一致（标题文字可各写各的语言）；
// ② 每个小节正文的 md5 记进 README.i18n.yaml，正文改了这一侧就得同步另一侧并重记。
// 用法：node tools/check-readme-pairing.mjs [--write]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const PAIR = [['README.md', 'en'], ['README.zh.md', 'zh']]
const STORE = path.join(ROOT, 'README.i18n.yaml')

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 16)

/** 按 `## ` 切小节：返回 [{title, body}]，代码围栏内的 `## ` 不算标题。 */
function sections(text) {
  const out = []
  let cur = null
  let fence = false
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) fence = !fence
    if (!fence && /^## /.test(line)) { cur = { title: line.slice(3).trim(), body: [] }; out.push(cur); continue }
    if (cur) cur.body.push(line)
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() }))
}

const parsed = {}
for (const [rel, lang] of PAIR) parsed[lang] = { rel, list: sections(read(rel)) }

const en = parsed.en.list
const zh = parsed.zh.list
let bad = 0
if (en.length !== zh.length) {
  console.error(`RED  两份 README 的小节数不一致：${parsed.en.rel} ${en.length} 个 / ${parsed.zh.rel} ${zh.length} 个`)
  bad++
}
const limits = Math.min(en.length, zh.length)
const records = []
for (let i = 0; i < limits; i++) {
  records.push({ slug: en[i].title, en: md5(en[i].body), zh: md5(zh[i].body) })
}

if (process.argv.includes('--write')) {
  const lines = ['# 双语 README 成对记录：每个小节正文的 md5（改一边就要同步另一边并重记）。', '# 重新生成：node tools/check-readme-pairing.mjs --write', 'sections:']
  for (const r of records) lines.push(`  - slug: ${JSON.stringify(r.slug)}`, `    en: ${r.en}`, `    zh: ${r.zh}`)
  fs.writeFileSync(STORE, lines.join('\n') + '\n')
  console.log(`已写入 README.i18n.yaml（${records.length} 个小节）`)
  process.exit(bad ? 1 : 0)
}

if (!fs.existsSync(STORE)) {
  console.error('RED  缺 README.i18n.yaml：先跑 node tools/check-readme-pairing.mjs --write')
  process.exit(1)
}
const store = fs.readFileSync(STORE, 'utf8')
for (const r of records) {
  if (store.indexOf(`en: ${r.en}`) < 0) { console.error(`RED  README.md 的小节「${r.slug}」改了，README.i18n.yaml 没重记`); bad++ }
  if (store.indexOf(`zh: ${r.zh}`) < 0) { console.error(`RED  README.zh.md 的小节「${r.slug}」改了，README.i18n.yaml 没重记`); bad++ }
}
if (bad) { console.error(`\n双语 README 配对闸：${bad} 处不一致`); process.exit(1) }
console.log(`双语 README 配对闸：干净（${records.length} 个小节，两份小节一一对应）`)
