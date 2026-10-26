#!/usr/bin/env node
// 把 lib/client/*.js 片段按序拼回宿主加载的单个 bundle：lib/client.js
//
// 为什么需要这一步：宿主只认 `exports["./client"]` 指向的那一个文件（CJS bundle 形态，
// 见 lib/client/_head.js 的 __ModuleLoader__.load 包裹），它不做多文件解析。
// 所以作者侧拆成 8 个片段（每个 ≤400 行，便于局部注意力和审阅），发布侧仍是单文件。
//
// 用法：
//   node tools/build-client.mjs           # 生成 lib/client.js
//   node tools/build-client.mjs --check   # 只校验：生成物与片段是否一致（闸用，退出码 1 表示不一致）

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const DIR = path.join(ROOT, 'lib/client')
const OUT = path.join(ROOT, 'lib/client.js')

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))
const mods = files.filter((f) => /^\d\d-/.test(f)).sort()
if (!mods.length) { console.error('lib/client/ 下没有片段文件'); process.exit(2) }
if (!files.includes('_head.js') || !files.includes('_tail.js')) {
  console.error('缺 _head.js 或 _tail.js'); process.exit(2)
}

const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\s+$/, '')
const parts = [read('_head.js'), ...mods.map(read), read('_tail.js')]
const banner = [
  '// ⚠ 本文件由 tools/build-client.mjs 从 lib/client/*.js 生成，**不要直接改**。',
  '// 改片段：lib/client/' + mods.join('、'),
  '',
].join('\n')

let text = parts.join('\n\n')
// 抬头注释（原文件第 1-10 行）留在 _head.js 里；banner 插在它之前会打断文件头注释块的连贯性，
// 所以 banner 放在首个非注释行之前。
const lines = text.split('\n')
let firstCode = lines.findIndex((l) => l.trim() && !l.trim().startsWith('//'))
if (firstCode < 0) firstCode = 0
const out = [...lines.slice(0, firstCode), banner, ...lines.slice(firstCode)].join('\n').replace(/\s+$/, '') + '\n'

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (cur !== out) {
    console.error('client.js 与片段不一致：先跑 node tools/build-client.mjs')
    process.exit(1)
  }
  console.log(`OK  client.js 与 ${mods.length} 个片段一致（${out.split('\n').length} 行）`)
  process.exit(0)
}

fs.writeFileSync(OUT, out)
console.log(`已生成 lib/client.js：${mods.length} 个片段，${out.split('\n').length} 行`)
