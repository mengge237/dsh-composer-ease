// 合规自检（0 网络 0 额度）：许可与条例能不能站得住，不靠嘴说，靠这一支跑出来。
// 覆盖面：自家许可、借用件出处与许可证原文、逐字搬来的代码有没有带出处头、
//         运行时有没有第三方依赖、仓里有没有密钥、版本号与更新日志是否对得上。
// 这些是「可以公开」的前提条件；动了 lib/ 或 THIRD-PARTY.md 就会在这里现形。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let n = 0
function ok(label, fn) { fn(); n++; console.log('  ok   ' + label) }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const readBytes = (p) => readFileSync(join(ROOT, p))
const pkg = JSON.parse(read('package.json'))
const third = read('THIRD-PARTY.md')
const readme = read('README.md')
const license = read('LICENSE')

/** 借用件台账：仓库 / 许可 / commit / 取用文件。改借用范围必须同时改这里与 THIRD-PARTY.md。 */
const BORROWED = [
  { repo: 'microsoft/monaco-editor', license: 'MIT', commit: 'f54d769', what: 'JS/Python/Java 关键字' },
  { repo: 'codemirror/lang-html', license: 'MIT', commit: '06eec80', what: 'HTML 标签与全局属性' },
  { repo: 'codemirror/lang-css', license: 'MIT', commit: '7b7835b', what: 'CSS 伪类与 at 规则' },
  { repo: 'mdn/browser-compat-data', license: 'CC0-1.0', commit: '0416078', what: 'CSS 属性名' },
  { repo: 'microsoft/vscode', license: 'MIT', commit: '0b4e063', what: '模糊打分引擎与字符判据（逐字搬代码）' },
]

ok('自家许可是 MIT 且署名在（公开的前提）', () => {
  assert.match(license, /MIT License/, '自家 LICENSE 要是 MIT')
  assert.match(license, /Copyright \(c\) 2026 mengge237/, '要写明版权人')
  assert.equal(pkg.license, 'MIT', 'package.json 的 license 字段要与 LICENSE 一致')
})

ok('每个借用件都在 THIRD-PARTY.md 台账里：仓库 + 许可 + 钉住的 commit', () => {
  for (const b of BORROWED) {
    assert.ok(third.includes(b.repo), '台账缺 ' + b.repo)
    assert.ok(third.includes('`' + b.commit + '`'), b.repo + ' 的 commit 要钉住：' + b.commit)
  }
  assert.ok(third.includes('CC0-1.0'), 'CC0 那一件要标出来')
  // README 的「来源与许可」也要指向出处，不能只藏在 THIRD-PARTY 里
  assert.ok(readme.includes('THIRD-PARTY.md'), 'README 要指向 THIRD-PARTY.md')
  assert.ok(/##\s*来源与许可/.test(readme), 'README 要有「来源与许可」一节')
})

ok('许可证原文照录：MIT 文本按版权人各一份，CC0 有声明', () => {
  const mitBlocks = third.split('Permission is hereby granted').length - 1
  // microsoft/monaco-editor、codemirror（两个包同一份文本，同一版权人）、microsoft/vscode
  assert.ok(mitBlocks >= 3, 'MIT 原文至少三份（monaco / codemirror / vscode），现在 ' + mitBlocks)
  assert.ok(/CC0 1\.0|CC0-1\.0/.test(third), 'CC0 要写明')
  assert.match(third, /public domain|Public Domain|CC0/i, 'CC0 的公有领域声明要在')
})

ok('逐字搬来的代码必须带出处头（仓库 + commit + 改了什么）', () => {
  const fuzzy = read('lib/fuzzy.js')
  assert.match(fuzzy, /microsoft\/vscode/, 'fuzzy.js 要写明取自 microsoft/vscode')
  assert.match(fuzzy, /0b4e063/, 'fuzzy.js 要钉 commit')
  assert.match(fuzzy, /只做两处改动|去掉 TypeScript 类型注解/, 'fuzzy.js 要写明改了什么（MIT 要求标注改动）')
  assert.match(fuzzy, /THIRD-PARTY\.md/, 'fuzzy.js 要指回许可证原文')
  // 只借数据的那份也要写清「一行代码都没搬」与数据源
  const words = read('lib/words.js')
  for (const b of BORROWED.filter((x) => x.repo !== 'microsoft/vscode')) {
    assert.ok(words.includes(b.repo), 'words.js 头部缺数据源 ' + b.repo)
  }
  assert.match(words, /一行代码都没有搬|只借用/, 'words.js 要写明只借数据')
})

ok('运行时没有第三方依赖（装了也不需要别人的代码在我这儿跑）', () => {
  const deps = Object.keys(pkg.dependencies || {})
  const peer = Object.keys(pkg.peerDependencies || {})
  assert.deepEqual(deps, [], '不该有 dependencies：' + deps.join(','))
  assert.deepEqual(peer, [], '不该有 peerDependencies：' + peer.join(','))
})

ok('仓里没有密钥/令牌（公开仓的硬线）', () => {
  const PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/,           // DeepSeek/OpenAI 风格
    /ghp_[A-Za-z0-9]{20,}/,            // GitHub PAT
    /github_pat_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{12,}/,               // AWS
    /xox[baprs]-[A-Za-z0-9-]{10,}/,    // Slack
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ]
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const rel = dir ? dir + '/' + e.name : e.name
      if (e.isDirectory()) walk(rel)
      else files.push(rel)
    }
  }
  walk('')
  assert.ok(files.length >= 10, '要真扫到文件：' + files.length)
  for (const f of files) {
    const body = readBytes(f).toString('utf8')
    for (const re of PATTERNS) assert.ok(!re.test(body), f + ' 里疑似有密钥：' + re)
  }
})

ok('版本号与 README 更新日志最新一条一致', () => {
  const versions = [...readme.matchAll(/^-\s+\*\*(\d+\.\d+\.\d+)\*\*/gm)].map((m) => m[1])
  assert.ok(versions.length >= 3, '更新日志要有历史条目：' + versions.join(','))
  assert.equal(versions[0], pkg.version, 'README 最新条目要等于 package.json 版本：' + versions[0] + ' vs ' + pkg.version)
})

ok('登记表那侧的条例也照顾到了：npm 键要么是合法包名要么不写', () => {
  // dsh-community-plugins 的 index 闸：npm 必须是合法包名，null 会被拒（2026-10-16 实测）
  const name = pkg.npm
  if (name !== undefined) {
    assert.equal(typeof name, 'string', 'npm 键不能是 null/数字')
    assert.match(name, /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/, 'npm 键要是合法包名：' + name)
  }
  assert.ok(existsSync(join(ROOT, 'cordis.patch.yml')), 'bundle 声明要在，登记表按它认插件')
})

console.log(`\n${n} 项全过`)
