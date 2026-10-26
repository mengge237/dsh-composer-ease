#!/usr/bin/env node
// 多副本一致性：把这台机器上所有「插件副本」列出来，比对版本与内容。
//
// 背景：这个插件在本机可能同时存在于
// ① 公开仓工作副本（改代码的地方）
// ② 宿主插件目录（两个 profile 用 `link:` 指向它，**真正被加载的是这份**）
// ③ 各 profile 的 node_modules 条目（通常是指向 ② 的链接，不是独立副本）
// 只要 ① 与 ② 不同步，就会出现"仓库里已经是新版、本地跑的还是旧版"。
//
// 用法：
// node tools/copies.mjs # 报告：每份的路径 / realpath / 版本 / 是否链接
// node tools/copies.mjs --check # 只比对：版本或内容不一致就退出码 1（CI 里没副本会跳过）
// node tools/copies.mjs --sync # 把 ① 的内容推进到所有**真实目录**副本（链接的自动跳过）
//
// 环境变量：DSH_PLUGIN_HOST 覆盖宿主目录；HOME 决定 profile 位置。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { findHostDir } from './host-dir.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CHECK = process.argv.includes('--check')
const SYNC = process.argv.includes('--sync')

const ver = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version } catch { return null }
}
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
const norm = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }

// 运行时要比的文件（与 sync-host 的清单同源，避免两处各写一份）
const RUNTIME = [
  'lib/client.js', 'lib/index.js', 'lib/fuzzy.js', 'lib/words.js',
  'lib/cjk-lexicon.js', 'lib/en-lexicon.js', 'lib/en-common.js', 'lib/domain-words.js',
  'package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md',
]

const found = []
const add = (label, p) => {
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return
  const r = real(p)
  if (found.some((x) => x.real === r)) return
  found.push({ label, path: p, real: r, version: ver(r), linked: path.resolve(p) !== path.resolve(r) })
}

add('公开仓（源）', ROOT)
const host = findHostDir()
add(host.dir ? `宿主插件目录（${host.from}）` : '宿主插件目录', host.dir)
const profiles = path.join(os.homedir(), '.dsh', 'profiles')
if (fs.existsSync(profiles)) {
  for (const p of fs.readdirSync(profiles)) {
    add(`profile:${p}`, path.join(profiles, p, 'node_modules', 'dsh-composer-ease'))
  }
}

const repoVersion = ver(ROOT)
console.log(`源：${ROOT}  version=${repoVersion}\n`)
for (const c of found) {
  console.log(`${c.linked ? '链接→' : '实体  '} ${c.label.padEnd(18)} version=${String(c.version).padEnd(8)} ${c.real}`)
}

// 只比"实体目录"的副本；链接的已经指向别人，不重复比
const reals = found.filter((c) => !c.linked && path.resolve(c.real) !== path.resolve(ROOT))
if (!reals.length) {
  console.log('\n没有需要比对的实体副本（只有源本体，或其余都是链接）')
  if (CHECK) { console.log('副本闸：跳过（无副本）'); process.exit(0) }
  process.exit(0)
}

let drift = 0
const report = []
for (const c of reals) {
  const bad = []
  if (c.version !== repoVersion) bad.push(`版本 ${c.version} ≠ ${repoVersion}`)
  const diffFiles = RUNTIME.filter((f) => {
    const a = norm(path.join(ROOT, f))
    const b = norm(path.join(c.real, f))
    return a !== null && b !== null && a !== b
  })
  if (diffFiles.length) bad.push(`${diffFiles.length} 个文件内容不同（${diffFiles.slice(0, 3).join(', ')}${diffFiles.length > 3 ? '…' : ''}）`)
  report.push({ c, bad })
  if (bad.length) drift++
}

console.log('')
for (const { c, bad } of report) {
  console.log(`${bad.length ? 'DIFF' : 'ok  '} ${c.label.padEnd(18)} ${bad.length ? bad.join('；') : '与源一致'}`)
}

if (SYNC && drift) {
  const host = reals.find((c) => c.label.includes('宿主'))
  if (host) {
    console.log('\n推进内容到宿主副本…')
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-host.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, DSH_PLUGIN_HOST: host.real },
    })
  } else {
    console.log('\n没找到宿主副本，跳过同步')
  }
  process.exit(0)
}

if (CHECK) {
  if (drift) {
    console.error(`\n副本闸：${drift} 份副本与源不一致`)
    console.error('  同步：npm run sync:copies（= node tools/copies.mjs --sync）')
    console.error('  提醒：服务端半边（lib/index.js 等）改完要重启 dsh web 才装载')
    process.exit(1)
  }
  console.log('\n副本闸：干净')
}
