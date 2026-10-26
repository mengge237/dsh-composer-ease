#!/usr/bin/env node
// 把宿主插件目录换成指向本仓的 junction —— 让"改代码的地方"和"被加载的地方"是同一份。
//
// 为什么：插件在宿主里被 `link:` 引用，而 `link:` 指向的那个目录以前是**另一份拷贝**，
// 于是每次改完都要 sync，忘了就是"仓库里是新版、本地跑的是旧版"。做成 junction 之后
// 物理上只有一份，版本不可能不同步。
//
// 用法：
//   node tools/link-host.mjs            # 报告当前关系（不动任何东西）
//   node tools/link-host.mjs --apply    # 真正替换（会把原目录改名成 <dir>.hostbak，验证后再删）
//
// 安全：① 只处理"宿主目录不是本仓"的情况；② 原目录保留为 .hostbak，验证通过才提示删除；
// ③ 任何一步失败都会把原目录改回原名。

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { findHostDir } from './host-dir.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const APPLY = process.argv.includes('--apply')
const { dir: HOST, from } = findHostDir()

if (!HOST) {
  console.error('找不到宿主插件目录：' + from)
  console.error('  → 先 dsh plugin --profile web add <本仓路径>，或用 DSH_PLUGIN_HOST 指定')
  process.exit(2)
}

const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
const same = real(HOST).toLowerCase() === real(ROOT).toLowerCase()

console.log(`本仓：${ROOT}`)
console.log(`宿主：${HOST}（来自 ${from}）`)
console.log(`关系：${same ? '已经是同一份（junction 或同一路径）' : '两份独立目录 —— 会漂移'}`)

if (same) process.exit(0)
if (!APPLY) {
  console.log('\n要合并成一份：node tools/link-host.mjs --apply')
  process.exit(0)
}

if (!fs.existsSync(path.join(ROOT, '.git'))) { console.error('本仓不是 git 仓，拒绝替换'); process.exit(2) }
if (!fs.existsSync(path.join(HOST, 'package.json'))) { console.error('宿主目录不像插件目录，拒绝替换'); process.exit(2) }

const bak = HOST + '.hostbak'
if (fs.existsSync(bak)) { console.error(`备份名已存在，先处理：${bak}`); process.exit(2) }

fs.renameSync(HOST, bak)
try {
  execFileSync('cmd', ['/c', 'mklink', '/J', HOST, ROOT], { stdio: 'inherit' })
  const ok = fs.existsSync(path.join(HOST, 'package.json')) && fs.existsSync(path.join(HOST, '.git'))
  if (!ok) throw new Error('junction 建好后读不到 package.json 或 .git')
  console.log(`\n已合并：${HOST} → ${ROOT}`)
  console.log(`原目录留作 ${bak}；确认 dsh web 能正常加载（刷新页面/重启宿主）后，可删掉它：`)
  console.log(`  Remove-Item -Recurse -Force "${bak}"`)
} catch (e) {
  console.error('替换失败，正在回滚：', e.message)
  try { fs.rmdirSync(HOST) } catch {}
  fs.renameSync(bak, HOST)
  process.exit(1)
}
