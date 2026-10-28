// dsh-composer-ease —— 服务端半边：给浏览器侧补全弹层供数据。
// 两个只读路由（本机同源）：
// GET /dsh-composer-ease/config.json → 键位/配对表 + 词表规模与**借用出处**（诊断用）
// GET /dsh-composer-ease/words?prefix=&lang= → 候选：语言词表（标签/关键字/属性名）
// + 工作区文件路径 + settings 里配置的模型名 + 常用代码片段
// 数据来源：词表见 lib/words.js（只借开源数据、出处与许可证在文件头与 THIRD-PARTY.md）；
// 其余都是磁盘现读。不发消息、不写任何文件。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LANG_WORDS, HTML_ATTRS, LANG_ALIASES, WORD_STATS, COMMON_WORDS } from './words.js'
import { fuzzyScore } from './fuzzy.js'
import { CJK_LEXICON, lexiconMatches, isCompleteWord } from './cjk-lexicon.js'
import { enMatches, isCompleteEnWord, EN_COMMON } from './en-lexicon.js'
import { DOMAIN_WORDS } from './domain-words.js'

const name = 'dsh-composer-ease'
const inject = ['webServer']

/** 借用的数据来源（写清源地址与 commit；只借数据，不搬代码）。 */
const SOURCES = [
  { what: 'JS / Python / Java 关键字', repo: 'https://github.com/microsoft/monaco-editor', license: 'MIT', commit: 'f54d769', path: 'src/languages/definitions/<lang>/<lang>.ts' },
  { what: 'HTML 标签与全局属性', repo: 'https://github.com/codemirror/lang-html', license: 'MIT', commit: '06eec80', path: 'src/complete.ts' },
  { what: 'CSS 伪类与 at 规则表', repo: 'https://github.com/codemirror/lang-css', license: 'MIT', commit: '7b7835b', path: 'src/complete.ts' },
  { what: 'CSS 属性名', repo: 'https://github.com/mdn/browser-compat-data', license: 'CC0-1.0', commit: '0416078', path: 'css/properties/*.json' },
 // 中文词典与英文词表都是「本仓自带数据」，出处写自家仓库；中文数据的上游另在 cjk 那行注明。
  { what: '中文常用词表（2-4 字，按频次前 30000）', repo: 'https://github.com/mengge237/dsh-composer-ease', license: 'MIT', commit: '02e67e6', path: 'lib/cjk-lexicon.js（上游 fxsjy/jieba extra_dict/dict.txt.big，MIT）' },
  { what: '英文词表（T2：30k，语料频次排序）', repo: 'https://github.com/words/an-array-of-english-words', license: 'MIT', commit: 'v2.0.0', path: 'lib/en-lexicon.js（生成：tools/gen-lexicon.mjs）' },
  { what: '本机领域词（T3：文档高频、词表没有的）', repo: 'https://github.com/mengge237/dsh-composer-ease', license: 'MIT', commit: 'e00dda0', path: 'lib/domain-words.js' },
]

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** VSCode 风格的自动配对表（行为参照 VSCode，MIT 项目的交互设计，未复制源码）。
 * 补全角/中文成对符：中文输入法下原来「（」不会有「）」。 */
const PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'",
                '（': '）', '【': '】', '「': '」', '《': '》', '“': '”', '‘': '’' }

/** 常用代码片段（kind:'snippet'，accept 时整段插入）。 */
// 片段支持 VS Code 的占位符语法 `${n:默认值}`：接受后光标落在第 1 个占位符，Tab 依次往后跳
// （补；客户端 expandSnippet 负责展开与算落点）。
const SNIPPETS = [
 // **单行**片段：实测，多行文本在这台宿主上插不可靠 —— Lexical 的模型选区
 // 不认 DOM Range，粘贴时选区已塌到末尾（结果变成"追加"而不是"替换 token"）。
 // 所以片段一律写成一行；需要占位符就用 VS Code 的 `${n:默认值}` 语法，客户端 expandSnippet 展开。
  { label: 'function', value: 'function ${1:name}(${2:args}) {}' },
  { label: 'arrow', value: 'const ${1:fn} = (${2:x}) => ${3:body}' },
  { label: 'if', value: 'if (${1:cond}) {}' },
  { label: 'for', value: 'for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {}' },
  { label: 'try/catch', value: 'try {} catch (${1:err}) {}' },
  { label: 'log', value: 'console.log(${1:value})' },
]

function readJsonOrNull(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** 工作区根：宿主 workspace.json（v2 形状：tables.workspaces 是 id→{path,...} 字典），存在才算，最多取 3 个。 */
/* 最近动过的那个工作区就是"当前"：workspace.json 每条都有 updatedAt，
 * 按它倒序取前 3 个。第一个会被当作 current（见 filesCached 的 bonus）——
 * 否则打 README 的前几个字母时，排上来的是别的项目的 README。 */
function workspaceRoots() {
  const st = readJsonOrNull(path.join(DSH_HOME, 'storages', 'workspace.json'))
  const tab = st && st.tables && st.tables.workspaces
  const list = tab ? Object.values(tab) : (st && Array.isArray(st.workspaces) ? st.workspaces : [])
  const withTime = []
  for (const w of list) {
    const p = w && w.path
    if (!p) continue
    let ok = false
    try { ok = fs.statSync(p).isDirectory() } catch {}
    if (!ok) continue
    const t = Date.parse((w && w.updatedAt) || (w && w.createdAt) || '') || 0
    withTime.push({ p, t })
  }
  withTime.sort((a, b) => b.t - a.t)
  return withTime.slice(0, 3).map((x) => x.p)
}

/* 不该出现在候选里的目录：构建产物之外，还包括本机约定的中间态目录
 * （临时目录/临时目录/3_产出 之类）—— ：输入框里常常要用 README 当上下文，
 * 可候选里冒出来的却是 临时目录 下的东西，而 400 条上限先被它们占满。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next',
  '.venv', 'venv', '.idea', '.vscode', '临时目录', '临时目录', 'coverage', 'out', 'vendor', '.cache',
  '.turbo', 'backups', 'backups-live', 'storages', 'sessions', '.dsh-build', '.sidebar-upstream',
 // 别人的仓副本：里面的 README 不是"我的上下文"，直接跳过（contextScore 里那 -500 只算第二道保险）
  'ref_repo', 'third_party', 'external', '_upstream'])

/* 「常用作上下文」的打分：越大越靠前。README / CHANGELOG / AGENTS 这类文件是输入框里
 * 最常被引用的，论"值不值得挤进前 400 条"它们该在构建产物与笔记之上。 */
const TOP_NAMES = /^(readme|changelog|agents|claude|contributing|package)\.md$/i
/* 别人的仓副本（ref_repo / third_party / external / _upstream）里的 README 不是"我的上下文"，
 * 扣掉 —— 否则它们会顶掉当前工作区里真正在用的那份。 */
const VENDORED = /(^|\/)(ref_repo|third_party|external|_upstream|vendor)\//i
// 一次反馈。
// 判据是**路径**而不是仓库名：harness 安装目录、插件目录、依赖目录一律压到底。
const HARNESS_DIR = /(deepseek[-_]harness|dsh-(fixes|kit|shim|020rc2|017)|node_modules|(^|\/)plugins\/)/i
function contextScore(rel, depth, bonus) {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  let s = 0
  if (TOP_NAMES.test(base) && depth === 0) s = 1000
  else if (TOP_NAMES.test(base)) s = 700
  else if (rel.endsWith('.md') && depth === 0) s = 500
  else if (rel.startsWith('docs/') && rel.endsWith('.md')) s = 400
  else if (rel.endsWith('.md')) s = 300
  if (VENDORED.test(rel)) s -= 500
  if (HARNESS_DIR.test(rel)) s -= 2000      // 压到 0 以下：只有词候选全部落空时它才可能进池
  return s + (bonus || 0)
}

/** 目录内相对路径清单：深度 ≤ maxDepth，按「常用作上下文」打分降序，同分按修改时间新→旧。 */
function collectFiles(root, maxDepth, cap, bonus) {
  const items = []
  const walk = (dir, rel, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && depth > 0) continue
      const childRel = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), childRel, depth + 1)
        continue
      }
      let mtime = 0
      try { mtime = fs.statSync(path.join(dir, e.name)).mtimeMs } catch {}
      items.push({ rel: childRel, score: contextScore(childRel, depth, bonus), mtime })
    }
  }
  walk(root, '', 0)
  items.sort((a, b) => (b.score - a.score) || (b.mtime - a.mtime) || (a.rel < b.rel ? -1 : 1))
  const out = []
  for (const it of items) {
    if (out.length >= cap) break
    out.push({ rel: it.rel, ctx: it.score })
  }
  return out
}

/** 从 profile 用户层/settings.yaml 扒模型 id：真源里模型条目缩进 ≥ 8 的 `- id:`。 */
function parseModelIds(text) {
  const out = []
  for (const m of String(text || '').matchAll(/^ {8,}- id:\s*([A-Za-z0-9._:/-]+)/gm)) {
    if (out.indexOf(m[1]) < 0) out.push(m[1])
  }
  return out
}

function modelIdsAllProfiles() {
  const ids = []
  for (const p of [path.join(DSH_HOME, 'settings.yaml'),
                   path.join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml'),
                   path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml')]) {
    try { for (const id of parseModelIds(fs.readFileSync(p, 'utf8'))) if (ids.indexOf(id) < 0) ids.push(id) } catch {}
  }
  return ids
}

/** 打分排序：**用 VS Code 的 fuzzyScore**（lib/fuzzy.js 逐字取自 microsoft/vscode，MIT）。
 * 返回的第二个以后是命中位置，客户端拿它给列表加粗 —— 与 VS Code 的建议列表一致。
 * 文件候选另外过一道可达性闸：路径段前缀，或查询 ≥3 字符时的段内子串
 * （路径太长，单字符查询会命中一大片，逼着人逐个核对）。 */
/** 中文候选：词典里更长的词（前缀命中）。**是否允许提示由 isCompleteWord 决定**——
 * 碎片（如「档管」）连门都进不来（一次反馈要求）。 */
function lexiconCandidates(prefix) {
  const p = String(prefix || '')
  if (!p || !/[\u4e00-\u9fff]/.test(p)) return []
  if (!isCompleteWord(p)) return []
  return lexiconMatches(p, 8).map((w) => ({ kind: 'word', value: w, detail: '词典', src: 'cjk-lexicon.js' }))
}

function rankCandidates(cands, prefix, cap) {
  const p = String(prefix || '').toLowerCase()
  const re = p ? new RegExp('(^|[/\\\\])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null
  const scored = []
  for (const c of cands) {
    const v = String(c.value || '')
    const vl = v.toLowerCase()
    if (p && c.kind === 'file') {
      if (!re.test(vl) && !(p.length >= 3 && vl.includes(p))) continue
    }
    if (!p) {
      scored.push({ c, score: 0, matches: [], len: v.length })
      continue
    }
 // 借 VS Code 的 `suggest.matchOnWordStartOnly`（**只对长前缀的「词」开**）：
 // VS Code 默认关（模糊优先），但词候选在 ≥4 字符时还允许中间匹配，
 // 只会让冷词与路径混排（`libr` 出 libra/libri 却不出 library 那种感觉）。
 // 收敛成：kind=word 且 prefix ≥4 → 必须词首匹配；文件与短前缀保持模糊。
    // 词的『必须前缀匹配』门槛从 4 降到 2：2 字已经很具体，模糊匹配只会带进 try/itemprop 这类无关词
    // 2 字前缀必须前缀匹配（模糊在 2 字上只会带进 try/itemprop），3 字保留 VS Code 的模糊语义，>=4 早已要求前缀
    if (c.kind === 'word' && (p.length === 2 || p.length >= 4) && !vl.startsWith(p)) continue
    const r = fuzzyScore(p, p, 0, vl, vl, 0)
    if (!r) continue
 // VS Code 的命中位置是从尾部回填的（倒序），这里归一成正序，客户端直接拿来加粗
    scored.push({ c, score: r[0], matches: r.slice(2).slice().sort((x, y) => x - y), len: v.length })
  }
 // 并列时先看上下文分（当前工作区 +200、README 类 1000）再看长度：
 // 只按 fuzzyScore 排会把跨工作区的上下文信息丢掉，README 就排不上来。
  scored.sort((a, b) => b.score - a.score
    || ((b.c.ctx || 0) - (a.c.ctx || 0))
    || a.len - b.len
    || (a.c.value < b.c.value ? -1 : 1))
 // 纯字母前缀（≥3）时，**词候选整段排在文件候选前面**：fuzzyScore 给路径命中的分本就偏高，
 // 不这样分区，打 dsh / gh- 时前几条永远是被 deepseek-harness 之类目录下的文件占掉
 // （就是这个）。文件内部与词内部各自的相对顺序不变（稳定分区）。
  let ordered = scored
 // 带连字符的（gh-、dsh-）同样按词优先分区：它们是「领域词前缀」，不是路径
  if (/^[A-Za-z][A-Za-z0-9-]{2,}$/.test(p)) {
 // 词优先，但**留配额**：词最多 6 条、非词（文件/模型/片段）至少 2 条。
 // 整段分区 + 上限 8 会把文件全饿死（短前缀 'hel' 上只剩 help/held/hele…，
 // 想选文件时一条都看不到），单测直接照出来了。
    const word = [], other = []
    for (const s of scored) (s.c.kind === 'word' ? word : other).push(s)
    const cap0 = cap || 8
    const wq = Math.min(6, word.length)
    const oq = Math.min(Math.max(2, cap0 - wq), other.length)
    ordered = word.slice(0, wq).concat(other.slice(0, oq))
    if (ordered.length < cap0) ordered = ordered.concat(word.slice(wq), other.slice(oq))
  }
 // **不做相对分数截断**（试过又撤）：VS Code 的 fuzzyScore 语义是「弱匹配排在下面，
 // 但仍要列出来」（`abc` 对 `axbxc` 是负分也照样出现），按 50% 砍会把它们删掉、并误删
 // `libsdk/auth.ts` 这类合法路径。压噪声靠三件：上限 8、词优先分区、harness 目录降权。
  return ordered.slice(0, cap || 12).map((s) => Object.assign({}, s.c, { matches: s.matches }))
}

/** 文件索引缓存：以前每敲一个键都全盘走一遍工作区（深处 3 层、封顶 400），纯浪费。
 * 20s TTL；同时缓存模型 id（要重读 settings 真源）。 */
const INDEX_TTL_MS = 20000
const indexCache = { files: null, filesAt: 0, models: null, modelsAt: 0 }
function filesCached() {
  const now = Date.now()
  if (indexCache.files && now - indexCache.filesAt < INDEX_TTL_MS) return indexCache.files
  const out = []
  const roots = workspaceRoots()
  for (let i = 0; i < roots.length; i++) {
    const base = roots[i].replace(/\\/g, '/').replace(/\/+$/, '')
 // 当前工作区（roots[0]，即最近动过的那个）整体 +200，让它压过别的项目里的同名文件
    const bonus = i === 0 ? 200 : 0
    for (const f of collectFiles(base, 3, 400, bonus)) {
      out.push({ rel: f.rel, base: path.basename(base), ctx: f.ctx, current: i === 0 })
    }
  }
  indexCache.files = out
  indexCache.filesAt = now
  return out
}
function modelsCached() {
  const now = Date.now()
  if (indexCache.models && now - indexCache.modelsAt < INDEX_TTL_MS) return indexCache.models
  indexCache.models = modelIdsAllProfiles()
  indexCache.modelsAt = now
  return indexCache.models
}

/** 围栏标记 → 词表键；认不出就返回空串（只上公共词表）。 */
function normalizeLang(hint) {
  const h = String(hint || '').trim().toLowerCase().replace(/^\./, '')
  if (!h) return ''
  if (Object.prototype.hasOwnProperty.call(LANG_WORDS, h)) return h
  return LANG_ALIASES[h] || ''
}

/** 语言词表 → 候选。公共池（HTML 标签 + JS 关键字）永远在，保证没有语言上下文时也能补（inp → input）。 */
function wordCandidates(prefix, lang) {
  const out = []
 // 中文碎片（不是完整词义）连词表候选都不给（至少要符合完整词义）
  if (/^[\u4e00-\u9fff]/.test(String(prefix || '')) && !isCompleteWord(prefix)) return out
  const seen = new Set()
  const push = (value, detail, src, langKey) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ kind: 'word', value, detail, src, lang: langKey })
  }
  const pool = []
  if (lang && LANG_WORDS[lang]) pool.push([LANG_WORDS[lang], lang + ' 词表', lang])
 // 高频文件名先入池：README.md / package.json / 本地配置 这类是用户提问里最常被点名的词，
 // 不该等语言词表排完才出现（语言只是其中一个表象）。
  pool.push([COMMON_WORDS, '常用文件名'])
  pool.push([LANG_WORDS.html, 'html 标签', 'html'])
  pool.push([LANG_WORDS.javascript, 'JS 关键字', 'javascript'])
  pool.push([HTML_ATTRS, 'html 属性', 'html'])
  if (lang === 'css') pool.push([LANG_WORDS.css, 'CSS 属性', 'css'])
  // 来源即档位：lang 关键字 450 > 常用文件名 445 > html 标签/属性 425（都低于英文常用词 440 之外的加成）
  const tierOf = (detail) => (/关键字/.test(detail) ? 450 : (/常用文件名/.test(detail) ? 445 : (/html/.test(detail) ? 425 : 0)))
  for (const [words, detail, langKey] of pool) for (const w of words) { const n0 = out.length; push(w, detail, 'words.js', langKey); if (out.length > n0 && tierOf(detail)) out[out.length - 1].ctx = tierOf(detail) }
 // 词典补在池子**之后**：words.js 里已有的词，出处仍记 words.js（去重时 `seen` 先到先得）。
  if (/^[\u4e00-\u9fff]/.test(String(prefix || ''))) {
    for (const w of lexiconMatches(prefix, 8)) push(w, '词典', 'cjk-lexicon.js', 'zh')
  } else if (/^[A-Za-z][A-Za-z-]{1,23}$/.test(String(prefix || ''))) {
 // 英文（补）：中文靠「完整词义」清零，英文**不清零** —— 前缀正是补全的用法。
    const pl = String(prefix || '').toLowerCase()
    // 短前缀（<=3）只留常用词：`ty` 下 tye/tyde/tyed 这类生僻词是纯噪声
    for (const w of enMatches(prefix, 8)) { if (pl.length <= 3 && !EN_COMMON.has(String(w).toLowerCase())) continue; push(w, '英文词', 'en-lexicon.js', 'en') }
 // T3 本机领域词（dsh / gh-archive / deepseek-harness 这类）：词表里没有、但本机文档高频。
 // 单独计数 —— 早先拿 out.length 当计数器，池子早把 out 撑满，一次也没推出去。
    let domN = 0
    for (const w of DOMAIN_WORDS) {
      if (domN >= 6) break
      if (!w.startsWith(pl)) continue
      const before = out.length
      push(w, '本机词', 'domain-words.js', 'en')
      if (out.length > before) domN++
    }
 // 统一抬分：**所有**以 prefix 开头的词候选（不论出自词表、关键字表还是领域词）按三档给 ctx，
 // 否则 words.js 里的 input 会被词表里的 inpours 压住（它没有 ctx）。
    for (const c of out) {
      if (c.kind !== 'word') continue
      const v = String(c.value || '').toLowerCase()
      if (!v.startsWith(pl)) continue
 // 整词加分只给「真的是一个词」的（isCompleteEnWord）：否则 docum 这种非词串也会吃满分，
 // 反过来把 document 压下去（实测）。
      // Rare lexicon words (not in EN_COMMON, e.g. tye/tyde) sink to 380 so keywords win.
      const rare = c.src === 'en-lexicon.js' && !EN_COMMON.has(v)
      const base = c.ctx || 0; const want = (v === pl && isCompleteEnWord(v)) ? 480 : (EN_COMMON.has(v) ? Math.max(base, 440) : (rare ? 380 : Math.max(base, 400)))
      c.ctx = Math.max(c.ctx || 0, want)
    }
  }
  return out
}

function buildCandidates(prefix, lang) {
 // 碎片前缀：整条候选清零（文件/模型/词表都不给），客户端据此连弹层都不开
  if (/^[\u4e00-\u9fff]/.test(String(prefix || '')) && !isCompleteWord(prefix)) return []
  const cands = []
  for (const c of wordCandidates(prefix, lang)) cands.push(c)
  for (const f of filesCached()) cands.push({ kind: 'file', value: f.rel, detail: f.base, ctx: f.ctx })
  for (const id of modelsCached()) cands.push({ kind: 'model', value: id, detail: '模型' })
  for (const s of SNIPPETS) cands.push({ kind: 'snippet', value: s.value, detail: '片段 ' + s.label, label: s.label })
  return rankCandidates(cands, prefix, 8)
}

/** 信任栅栏：只接本机（loopback Host；带 Origin 必须同源）。抄 dsh-better-sidebar/whale 同一套判据。 */
function isTrusted(ctx, req) {
  const host = String(req.headers.host || '')
  const h = host.split(':')[0]
  if (!(h === '127.0.0.1' || h === 'localhost' || h === '[::1]')) return false
  const origin = req.headers.origin
  if (origin) { try { if (new URL(origin).host !== host) return false } catch { return false } }
  return true
}

function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function apply(ctx) {
  const disposers = []
  const registerRoute = (route) => ctx.webServer.register(Object.assign({}, route, {
    handler: async (req, res) => {
      if (!isTrusted(ctx, req)) return send(res, 403, { ok: false, error: '只接受本机来源' })
      return route.handler(req, res)
    },
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: '/' + name + '/config.json',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'use GET' })
      send(res, 200, {
        ok: true, pairs: PAIRS,
        keys: { completion: 'Ctrl+Space（打 2 个以上字母也自动弹）', accept: 'Tab / Enter', dismiss: 'Esc' },
        version: '0.2.0',
        wordStats: WORD_STATS,
        sources: SOURCES,
      })
    },
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: '/' + name + '/words',
    handler(req, res) {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'use GET' })
        const url = new URL(req.url, 'http://127.0.0.1')
        const prefix = url.searchParams.get('prefix') || ''
        const lang = normalizeLang(url.searchParams.get('lang'))
        send(res, 200, { ok: true, prefix, lang, candidates: buildCandidates(prefix, lang),
        wordGate: /^[\u4e00-\u9fff]/.test(String(prefix || '')) ? isCompleteWord(prefix) : true })
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => () => { for (const d of disposers) { try { d() } catch {} } })
}

export { name, inject, apply }
export const internals = {
  isCompleteWord, lexiconCandidates, PAIRS, SNIPPETS, SOURCES, rankCandidates, contextScore, parseModelIds, collectFiles, workspaceRoots, buildCandidates, wordCandidates, normalizeLang, DSH_HOME }
