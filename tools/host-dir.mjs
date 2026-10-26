// 宿主插件目录的发现：从各 profile 的 `dependencies['<pkg>'] = 'link:<dir>'` 读出来。
//
// 为什么不写死路径：写死既是本机隐私（会跟着公开仓一起发出去），也不可移植。
// 而 profile 的 package.json 本来就记着"谁被 link 到哪"，那是唯一真源。
//
// 解析顺序：
// ① 环境变量 DSH_PLUGIN_HOST（显式覆盖，最高优先）
// ② ~/.dsh/profiles/*/package.json 里 dsh-composer-ease 的 link: 目标
// ③ 找不到 → null（调用方决定报错还是跳过，CI 上就是跳过）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PKG = 'dsh-composer-ease'

export function profilesDir() {
  return path.join(os.homedir(), '.dsh', 'profiles')
}

/** 返回 { dir, from } —— from 说明是环境变量还是哪个 profile 给的。 */
export function findHostDir() {
  const env = process.env.DSH_PLUGIN_HOST
  if (env && fs.existsSync(env)) return { dir: path.resolve(env), from: 'DSH_PLUGIN_HOST' }

  const base = profilesDir()
  if (!fs.existsSync(base)) return { dir: null, from: '没有 profiles 目录' }

  for (const prof of fs.readdirSync(base)) {
    const pkgFile = path.join(base, prof, 'package.json')
    if (!fs.existsSync(pkgFile)) continue
    let deps = {}
    try { deps = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).dependencies || {} } catch { continue }
    const spec = deps[PKG]
    if (typeof spec !== 'string') continue
    const m = /^link:(.+)$/.exec(spec.trim())
    if (!m) continue
    const dir = m[1].trim()
    if (fs.existsSync(dir)) return { dir: path.resolve(dir), from: `profile:${prof} 的 link:` }
  }
  return { dir: null, from: '没找到 link: 目标' }
}
