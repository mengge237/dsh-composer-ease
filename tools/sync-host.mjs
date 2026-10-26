#!/usr/bin/env node
// 把"宿主真正加载的那份副本"同步到本仓 HEAD 的内容，并打印一致性表。
//
// 为什么需要它：profile 用 `link:<宿主插件目录>` 装插件，
// 宿主加载的是**那份副本**，不是这个公开仓的工作副本。我因此白测过两轮实测
// （改了公开仓、宿主还跑旧码），这一条把它变成一次命令 + 一张表。
//
// 用法：
// node tools/sync-host.mjs # 复制并核对
// node tools/sync-host.mjs --check # 只核对，不一致就退出码 1
// 目标目录可用环境变量覆盖：DSH_PLUGIN_HOST
//
// 判据：只比「文本内容」（换行归一），不比字节 —— git 在 Windows 上会把工作副本转成 CRLF，
// 直接比 sha 会把纯换行差异报成不一致（实测 cjk-lexicon.js 就是这样）。

import { findHostDir } from './host-dir.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
// 宿主目录从 profile 的 link: 里发现（见 tools/host-dir.mjs），环境变量只是覆盖手段
const FOUND = findHostDir()
const HOST = FOUND.dir
if (!HOST) {
  console.error('找不到宿主插件目录：' + FOUND.from)
  console.error('  → 用 DSH_PLUGIN_HOST=<插件目录> 显式指定，或先 dsh plugin --profile web add <本仓路径>')
  process.exit(2)
}
const CHECK = process.argv.includes('--check')

// 宿主运行时要的文件：两头代码 + 数据 + 元数据 + 文档
// docs/ 下的图与文档也要同步：宿主那份 README 引用的就是这些相对路径，
// 不同步就会出现"仓库里换了新 banner、本地看到还是旧的"（实际出现）。
const DOCS = (() => {
  const out = []
  const walk = (rel) => {
    let ents = []
    try { ents = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const r = rel + '/' + e.name
      if (e.isDirectory()) walk(r)
      else if (/\.(svg|png|gif|md)$/i.test(e.name)) out.push(r)
    }
  }
  walk('docs')
  return out
})()

const FILES = [
  'lib/client.js', 'lib/index.js', 'lib/fuzzy.js', 'lib/words.js',
  'lib/cjk-lexicon.js', 'lib/en-lexicon.js', 'lib/en-common.js', 'lib/domain-words.js',
  'package.json', 'cordis.patch.yml', 'README.md', 'THIRD-PARTY.md', 'CHANGELOG.md',
  ...DOCS,
]

const norm = (p) => {
  try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') } catch { return null }
}

if (!fs.existsSync(HOST)) {
  console.error(`宿主副本目录不存在：${HOST}\n（用 DSH_PLUGIN_HOST 指定，或先装插件）`)
  process.exit(2)
}

let diff = 0
const rows = []
for (const f of FILES) {
  const src = path.join(ROOT, f)
  const dst = path.join(HOST, f)
  const a = norm(src)
  const b = norm(dst)
  if (a === null) { rows.push(['缺失(仓)', f]); diff++; continue }
  if (b === null) { rows.push(['缺失(宿)', f]); diff++; continue }
  if (a === b) { rows.push(['ok', f]); continue }
  rows.push(['DIFF', f])
  diff++
  if (!CHECK) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

const w = Math.max(...rows.map((r) => r[1].length))
for (const [state, f] of rows) console.log(`${state.padEnd(9)} ${f.padEnd(w)}`)
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
if (CHECK) {
  if (diff) { console.error(`\n${diff} 个文件与宿主副本不一致（真机会跑到旧码）：node tools/sync-host.mjs`) ; process.exit(1) }
  console.log(`\n宿主副本与仓一致（版本 ${version}）`)
} else {
  console.log(`\n已同步到 ${HOST}（版本 ${version}；本次修正 ${diff} 个文件）`)
  if (diff) console.log('提示：服务端半边（lib/index.js 等）改动要重启 dsh web 才装载；客户端半边刷新页面即可。')
}
