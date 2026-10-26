#!/usr/bin/env node
// 机制闸①：**同一个机制出现第二套就先删一套**（定的那条，改成可判定）
//
// 背景：这个仓 84 次提交里 refactor 是 0 次，实际故障里有两次是"同一件事被实现了两遍"
// （光标复位一套、另一套又加了一份；词典接在池子前后各写一次）。人工评审看不住，
// 所以做成机器能查的两条：
// ① 同名顶层函数在多个文件里各定义一次 —— 一定是重复机制，直接红；
// ② 归一化后连续 12 行完全相同的代码块出现在 ≥2 个文件 —— 复制粘贴出来的第二套，红。
// 读的是 lib/client/*.js（作者侧片段）与 lib/*.js（手写半边），生成物 lib/client.js 不看。
//
// 退出码：0 干净 / 1 有重复

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const EXEMPT = new Set(['cjk-lexicon.js', 'en-lexicon.js', 'domain-words.js', 'en-common.js', 'words.js', 'client.js'])

const files = []
const dir = path.join(ROOT, 'lib/client')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) files.push(path.join(dir, f))
for (const f of fs.readdirSync(path.join(ROOT, 'lib')).filter((x) => x.endsWith('.js'))) {
  if (!EXEMPT.has(f)) files.push(path.join(ROOT, 'lib', f))
}

const norm = (s) => s.replace(/\s+/g, ' ').trim()
const defs = new Map()      // 函数名 → [文件:行]
const blocks = new Map()    // 归一化块 → [文件:行]
let bad = 0

for (const p of files) {
  const rel = path.relative(ROOT, p).replace(/\\/g, '/')
  const lines = fs.readFileSync(p, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:function\s+(\w+)|var\s+(\w+)\s*=\s*function)/.exec(lines[i])
    if (m) {
      const name = m[1] || m[2]
 // 按**半边**分域：浏览器半边（lib/client/*）与服务端半边（lib/*.js）各有一个宿主入口 apply，
 // 那是宿主约定，不是重复机制。同名只在同一半边里算重复。
      const half = rel.startsWith('lib/client/') ? 'client' : 'server'
      const key = half + ':' + name
      const where = `${rel}:${i + 1}`
      if (defs.has(key)) defs.get(key).push(where)
      else defs.set(key, [where])
    }
 // 连续 12 行的归一化指纹（跳过纯注释/纯括号行，避免假阳性）
    if (i + 11 < lines.length) {
      const win = lines.slice(i, i + 12).map(norm).filter(Boolean)
      if (win.length >= 8 && win.join('\n').replace(/[{}\s]/g, '').length > 120) {
        const key = win.join('⏎')
        const where = `${rel}:${i + 1}`
        if (blocks.has(key)) blocks.get(key).push(where)
        else blocks.set(key, [where])
      }
    }
  }
}

for (const [name, where] of defs) {
  if (where.length > 1) {
    bad++
    console.error(`RED  同名函数定义了两遍：${name} → ${where.join(' , ')}`)
  }
}
let dupBlocks = 0
for (const [, where] of blocks) {
  const byFile = [...new Set(where.map((w) => w.split(':')[0]))]
  if (byFile.length > 1) {
    dupBlocks++
    if (dupBlocks <= 5) console.error(`RED  跨文件重复代码块（12 行）：${where[0]} ≈ ${where[1]}`)
  }
}
if (dupBlocks > 5) console.error(`RED  …另有 ${dupBlocks - 5} 处跨文件重复块`)

if (bad || dupBlocks) {
  console.error(`\n共 ${bad} 个同名函数、${dupBlocks} 处跨文件重复块。`)
  console.error('规矩：同一机制只保留一套 —— 删掉旧的那套再合，别让两套并存（本仓的「光标复位」踩过两次）。')
  process.exit(1)
}
console.log(`机制闸①：干净（${files.length} 个文件，${defs.size} 个顶层定义，无跨文件重复块）`)
