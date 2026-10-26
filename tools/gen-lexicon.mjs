#!/usr/bin/env node
// 生成 lib/en-lexicon.js（T2：真英文词表）与 lib/domain-words.js（T3：本机领域词）。
//
// 为什么要两件一起生成：词表（an-array-of-english-words，27 万词，MIT）**没有词频**，
// 只在 27 万里按字母序取前 N 等于随机；而本机语料（代码 + 文档）恰好提供频次。
// 所以：用本机语料给词表打分，取前 cap 进词库；语料里高频、词表里没有的（dsh / lexical / keymap）
// 另存成领域词，两者都带出处。
//
// 用法：
//   node tools/gen-lexicon.mjs --words <index.json|words.txt> \
//        --corpus lib docs --corpus ~/.dsh/本地配置 --cap 30000 --domain-cap 1500
// 产出（直接覆盖，幂等）：
//   lib/en-lexicon.js     EN_LEXICON（Set）+ enMatches / isCompleteEnWord / isWordPrefix / EN_LEXICON_SOURCE
//   lib/domain-words.js   DOMAIN_WORDS（数组）+ DOMAIN_WORDS_SOURCE

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function args(argv) {
  const out = { words: '', corpus: [], cap: 30000, domainCap: 1500 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--words') out.words = argv[++i]
    else if (a === '--corpus') out.corpus.push(argv[++i])
    else if (a === '--cap') out.cap = Number(argv[++i])
    else if (a === '--domain-cap') out.domainCap = Number(argv[++i])
  }
  return out
}

const expand = (p) => p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.yml', '.yaml', '.ps1', '.py'])

/** 收集语料文本（有界：文件数 3000、单文件 2MB）。 */
function readCorpus(roots, exts) {
  const allow = exts || TEXT_EXT
  const chunks = []
  let files = 0
  const walk = (p, depth) => {
    if (files >= 3000 || depth > 6) return
    let st
    try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) {
      if (st.size > 2 * 1024 * 1024) return
      if (!allow.has(path.extname(p).toLowerCase())) return
      try { chunks.push(fs.readFileSync(p, 'utf8')); files++ } catch {}
      return
    }
    if (!st.isDirectory()) return
    let ents = []
    try { ents = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(path.join(p, e.name), depth + 1)
    }
  }
  for (const r of roots) walk(path.resolve(expand(r)), 0)
  return chunks.join('\n')
}

function tokenFreq(text) {
  const m = new Map()
  const re = /[A-Za-z][A-Za-z0-9_-]{1,31}/g
  let r
  while ((r = re.exec(text))) {
    const w = r[0].toLowerCase()
    if (w.length < 2) continue
    m.set(w, (m.get(w) || 0) + 1)
  }
  return m
}

function loadWordList(p) {
  const raw = fs.readFileSync(path.resolve(expand(p)), 'utf8')
  let arr
  if (raw.trim().startsWith('[')) arr = JSON.parse(raw)
  else arr = raw.split(/\r?\n/)
  return new Set(arr.map((w) => String(w || '').trim().toLowerCase())
    .filter((w) => /^[a-z][a-z-]{2,11}$/.test(w)))
}

const A = args(process.argv.slice(2))
if (!A.words) { console.error('缺 --words <词表文件>'); process.exit(2) }

const all = loadWordList(A.words)
const roots = A.corpus.length ? A.corpus : ['lib', 'docs']
const freq = tokenFreq(readCorpus(roots))
// T3 的领域词只从**文档**里取：源码标识符（wordpos / charcode / selectionstart）不是用户会打的词，
// 进了候选池就是噪声。频次排序（上面那句）仍然用全语料，因为要判断哪个英文词在本机更常用。
const freqDoc = tokenFreq(readCorpus(roots, new Set(['.md', '.txt'])))

// 打分：本机语料频次为主；语料没出现的词，用「越短越可能常用」做次序（英文常用词绝大多数 ≤8 字母）。
const scored = []
for (const w of all) {
  const f = freq.get(w) || 0
  scored.push([w, f, f > 0 ? 0 : w.length])
}
scored.sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]) || (a[0] < b[0] ? -1 : 1))
const kept = scored.slice(0, A.cap).map((x) => x[0]).sort()

// 领域词：语料高频、但**合并后的词库**里没有的（dsh / lexical / keymap 这类）。
// 判据必须对合并集（kept + 关键字表），只对原始词表判会把 if/const/ev/md 这些代码碎片放进来。
const KEYWORDS = []
// 关键词表在 lib/words.js 里，这里直接读，避免两处各写一份。
{
  const src = fs.readFileSync(path.resolve('lib/words.js'), 'utf8')
  for (const m of src.matchAll(/"([a-z][a-z0-9_-]{1,23})"/g)) KEYWORDS.push(m[1])
}
const merged = new Set([...kept, ...KEYWORDS])
// 领域词不许是词库里任何词的前缀 —— `docum` 这种碎片整串精确匹配会拿高分，反过来把 `document` 压下去
// （2026-10-22 实测）。判定用前缀集合，30k 词建一次集合就够快。
const keptSet = new Set(kept)
function isFragmentOfWord(w) {
  for (const k of keptSet) if (k.length > w.length && k.startsWith(w)) return true
  return false
}
const domain = [...freqDoc.entries()]
  // 不收带下划线的：文档里这类多半是路径（a_workspace / s_software），不是用户会打的词
  .filter(([w, n]) => n >= 3 && w.length >= 3 && !w.includes('_') && !merged.has(w)
    && /^[a-z][a-z0-9-]{1,31}$/.test(w) && !isFragmentOfWord(w))
  .sort((a, b) => b[1] - a[1])
  .slice(0, A.domainCap)
  .map(([w]) => w)

const wordsFile = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const root = process.cwd()

const header = (what, extra) => `// dsh-composer-ease —— ${what}
// 本文件由 tools/gen-lexicon.mjs 生成，**不要手改**（改了就下次生成即被覆盖）。
// 重新生成：node tools/gen-lexicon.mjs --words <词表> --corpus lib docs --cap ${A.cap} --domain-cap ${A.domainCap}
// 出处与许可证见 EN_LEXICON_SOURCE / DOMAIN_WORDS_SOURCE 与本仓 THIRD-PARTY.md${extra || ''}
`

const en = `import { LANG_WORDS, HTML_ATTRS, CSS_PSEUDO, CSS_AT_RULES, COMMON_WORDS } from './words.js'
import { CURATED_COMMON } from './en-common.js'

${header('英文词表（T2：真英文词表 ∩ 本机语料频次）', `
// 数据来源：an-array-of-english-words 2.0.0（MIT，words/an-array-of-english-words），
// 原始 274,937 词 → 只留 3-12 字符纯字母 → 用本机语料频次排序取前 ${A.cap}。
// 词表本身没有词频，所以「顺序」这一半来自本机语料（T3），生成脚本把两者合在一起。`)}
export const EN_LEXICON = new Set(${JSON.stringify(kept, null, 0).replace(/,/g, ', ')})

/** 手写补充：关键字表与常用文件名并入（保证 inp→input 这种永远有，不依赖词表版本）。 */
for (const w of [...Object.values(LANG_WORDS).flat(), HTML_ATTRS, CSS_PSEUDO, CSS_AT_RULES, COMMON_WORDS]) {
  const s = String(w || '').toLowerCase()
  if (/^[a-z][a-z-]{1,23}$/.test(s)) EN_LEXICON.add(s)
}

/** 以 prefix 开头的英文词；短的排前面（补全目标是打完词，不是找最长的）。 */
export function enMatches(prefix, cap) {
  const p = String(prefix || '').toLowerCase()
  if (p.length < 2) return []
  const out = []
  for (const w of EN_LEXICON) {
    if (w.length > p.length && w.startsWith(p)) out.push(w)
  }
  // 三级排序：① 手写常用词优先（常用度先验）② 语料名次 ③ 短的、字母序
  out.sort((a, b) => ((EN_COMMON.has(b) ? 1 : 0) - (EN_COMMON.has(a) ? 1 : 0))
    || ((EN_RANK.get(a) ?? 1e9) - (EN_RANK.get(b) ?? 1e9))
    || (a.length - b.length) || (a < b ? -1 : 1))
  return out.slice(0, cap || 8)
}

/** prefix 本身是完整英文词（用来给「已打完的词」加分，**不做中文那种碎片清零**）。 */
export function isCompleteEnWord(prefix) {
  const p = String(prefix || '').toLowerCase()
  return p.length >= 2 && EN_LEXICON.has(p)
}

/** prefix 是不是某个英文词的真前缀。 */
export function isWordPrefix(prefix) {
  const p = String(prefix || '').toLowerCase()
  if (p.length < 2) return false
  for (const w of EN_LEXICON) if (w.length > p.length && w.startsWith(p)) return true
  return false
}

export function enLexiconSize() { return EN_LEXICON.size }

/** 常用度先验：手写表 ∪ 关键字表。排序时它优先于长度与名次（delete 要压过 deled）。 */
export const EN_COMMON = new Set([...CURATED_COMMON, ...Object.values(LANG_WORDS).flat()]
  .map((w) => String(w || '').toLowerCase())
  .filter((w) => /^[a-z][a-z-]{1,23}$/.test(w)))

/** 名次表：词 → 本机语料频次名次（越小越常用）。补全排序用它，别用长度猜常用度。 */
export const EN_RANK = new Map(${JSON.stringify(kept.map(function (w, i) { return [w, i] }), null, 0).replace(/\],\[/g, '],[')}.sort(function (a, b) { return a[0] < b[0] ? -1 : 1 }))

export const EN_LEXICON_SOURCE = {
  repo: 'https://github.com/words/an-array-of-english-words',
  license: 'MIT',
  version: '2.0.0',
  upstream_words: ${274937},
  kept: EN_LEXICON.size,
  ordering: '本机语料频次（T3）排序后取前 ${A.cap}，词表本身无词频',
}
`

const dom = `${header('本机领域词（T3：代码与文档里高频、但英文词表里没有的词）')}
export const DOMAIN_WORDS = ${JSON.stringify(domain, null, 0).replace(/,/g, ', ')}

export const DOMAIN_WORDS_SOURCE = {
  what: '从本机语料统计的高频词（TF），只收词表里没有的',
  roots: ${JSON.stringify(A.corpus)},
  kept: DOMAIN_WORDS.length,
  note: '生成式数据：换机器或换语料后会变，因此不写死出处，只记本机根目录与条数。',
}
`

fs.writeFileSync(path.join(root, 'lib/en-lexicon.js'), en)
fs.writeFileSync(path.join(root, 'lib/domain-words.js'), dom)
console.log(`en-lexicon.js: ${kept.length} 词（词表 ${all.size} → 语料排序取前 ${A.cap}）`)
console.log(`domain-words.js: ${domain.length} 词，例：${domain.slice(0, 12).join(', ')}`)
