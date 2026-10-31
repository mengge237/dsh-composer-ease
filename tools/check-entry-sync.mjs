#!/usr/bin/env node
// 条目同步闸：docs/registry-entry.json 必须与 package.json 对齐，且描述里不许写死过期版本号。
// 为什么需要它：登记 PR 被打回的原因一直是「描述与上游不一致」（版本停滞、字段编造）。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'registry-entry.json'), 'utf8'))
const bad = []
const need = ['id', 'name', 'nameEn', 'author', 'repo', 'category', 'subcategory', 'description', 'descriptionEn']
for (const k of need) if (!entry[k]) bad.push('条目缺字段：' + k)
if (entry.id !== pkg.name) bad.push('id 与包名不一致：' + entry.id + ' vs ' + pkg.name)
const repo = String(pkg.repository && pkg.repository.url || pkg.repository || '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
if (repo && entry.repo !== repo) bad.push('repo 与 package.json 不一致：' + entry.repo + ' vs ' + repo)
// 描述里出现形如 0.9.x 的版本号就必须等于当前版本（避免再写「当前 0.9.1」这种 stagnation）
for (const text of [entry.description, entry.descriptionEn, entry.name, entry.nameEn]) {
  const m = String(text || '').match(/\b\d+\.\d+\.\d+\b/g)
  if (m) for (const v of m) if (v !== pkg.version) bad.push('描述里的版本 ' + v + ' 与 package.json ' + pkg.version + ' 不一致')
}
if (bad.length) {
  for (const b of bad) console.error('RED  ' + b)
  console.error('\n条目同步闸：' + bad.length + ' 处不一致（docs/registry-entry.json）')
  process.exit(1)
}
console.log('条目同步闸：干净（id/repo/版本与 package.json 一致，字段齐备）')
