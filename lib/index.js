// dsh-composer-pro —— 服务端半边：给浏览器侧补全弹层供数据。
// 两个只读路由（本机同源）：
//   GET /dsh-composer-pro/config.json  → 键位/配对表 + 词表规模与**借用出处**（诊断用）
//   GET /dsh-composer-pro/words?prefix=&lang= → 候选：语言词表（标签/关键字/属性名）
//        + 工作区文件路径 + settings 里配置的模型名 + 常用代码片段
// 数据来源：词表见 lib/words.js（只借开源数据、出处与许可证在文件头与 THIRD-PARTY.md）；
// 其余都是磁盘现读。不发消息、不写任何文件。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LANG_WORDS, HTML_ATTRS, LANG_ALIASES, WORD_STATS } from './words.js'

const name = 'dsh-composer-pro'
const inject = ['webServer']

/** 借用的数据来源（写清源地址与 commit；只借数据，不搬代码）。 */
const SOURCES = [
  { what: 'JS / Python / Java 关键字', repo: 'https://github.com/microsoft/monaco-editor', license: 'MIT', commit: 'f54d769', path: 'src/languages/definitions/<lang>/<lang>.ts' },
  { what: 'HTML 标签与全局属性', repo: 'https://github.com/codemirror/lang-html', license: 'MIT', commit: '06eec80', path: 'src/complete.ts' },
  { what: 'CSS 伪类与 at 规则表', repo: 'https://github.com/codemirror/lang-css', license: 'MIT', commit: '7b7835b', path: 'src/complete.ts' },
  { what: 'CSS 属性名', repo: 'https://github.com/mdn/browser-compat-data', license: 'CC0-1.0', commit: '0416078', path: 'css/properties/*.json' },
]

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

/** VSCode 风格的自动配对表（行为参照 VSCode，MIT 项目的交互设计，未复制源码）。 */
const PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'" }

/** 常用代码片段（kind:'snippet'，accept 时整段插入）。 */
const SNIPPETS = [
  { label: 'function', value: 'function name() {\n  \n}' },
  { label: 'arrow', value: 'const fn = (x) => x' },
  { label: 'if', value: 'if (cond) {\n  \n}' },
  { label: 'for', value: 'for (let i = 0; i < n; i++) {\n  \n}' },
  { label: 'try/catch', value: 'try {\n  \n} catch (err) {\n  console.error(err)\n}' },
  { label: 'log', value: "console.log('')" },
]

function readJsonOrNull(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

/** 工作区根：宿主 workspace.json（v2 形状：tables.workspaces 是 id→{path,...} 字典），存在才算，最多取 3 个。 */
function workspaceRoots() {
  const st = readJsonOrNull(path.join(DSH_HOME, 'storages', 'workspace.json'))
  const tab = st && st.tables && st.tables.workspaces
  const list = tab ? Object.values(tab) : (st && Array.isArray(st.workspaces) ? st.workspaces : [])
  const out = []
  for (const w of list) {
    const p = w && w.path
    if (!p) continue
    try { if (fs.statSync(p).isDirectory()) out.push(p) } catch {}
    if (out.length >= 3) break
  }
  return out
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', '.venv', 'venv', '.idea', '.vscode'])

/** 目录内相对路径清单：深度 ≤ maxDepth，总量封顶，最近修改优先。 */
function collectFiles(root, maxDepth, cap) {
  const out = []
  const walk = (dir, rel, depth) => {
    if (out.length >= cap || depth > maxDepth) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= cap) return
      if (e.name.startsWith('.') && depth > 0) continue
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name, depth + 1) }
      else out.push(rel ? rel + '/' + e.name : e.name)
    }
  }
  walk(root, '', 0)
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

/** 打分排序：前缀/路径段前缀 > 段内或子串 > 子序列；同分短者优先。纯函数，selftest 直接喂。
 * 2026-10-16（维护者真机踩到「输入 i 却给出一堆不相干文件、还被反复插进正文」）后收紧：
 *   - **文件候选只认「某个路径段以查询开头」**（attrib → 临时目录/attrib-index.diff），
 *     段内中段匹配要查询 ≥3 字符，纯子序列一概不给 —— 路径太长，子序列等于随机命中，
 *     逼着人逐个核对别的文件（原话「被迫核对以外的文件」）；
 *   - 子序列只留给非文件候选（词表/模型名/片段），且查询至少 3 个字符才启用。 */
function rankCandidates(cands, prefix, cap) {
  const p = String(prefix || '').toLowerCase()
  const re = p ? new RegExp('(^|[/\\\\])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null
  const scored = []
  for (const c of cands) {
    const v = String(c.value || '').toLowerCase()
    const isFile = c.kind === 'file'
    let score = -1
    if (!p) score = 3
    else if (isFile) {
      // 路径候选：只认「某个路径段以查询开头」（attrib → 临时目录/attrib-index.diff）。
      // 段内中段匹配要查询至少 3 个字符；纯子序列一概不给 —— 路径太长，子序列等于随机命中。
      if (re.test(v)) score = 0
      else if (p.length >= 3 && v.includes(p)) score = 1
    } else {
      if (v.startsWith(p)) score = 0
      else if (v.includes(p)) score = 1
      else if (p.length >= 3) {
        let i = 0
        for (const ch of v) { if (ch === p[i]) i++ }
        if (i === p.length) score = 2
      }
    }
    if (score >= 0) scored.push({ c, score, len: c.value.length })
  }
  scored.sort((a, b) => a.score - b.score || a.len - b.len || (a.c.value < b.c.value ? -1 : 1))
  return scored.slice(0, cap || 12).map((s) => s.c)
}

/** 文件索引缓存：以前每敲一个键都全盘走一遍工作区（深处 3 层、封顶 400），纯浪费。
 *  20s TTL；同时缓存模型 id（要重读 settings 真源）。 */
const INDEX_TTL_MS = 20000
const indexCache = { files: null, filesAt: 0, models: null, modelsAt: 0 }
function filesCached() {
  const now = Date.now()
  if (indexCache.files && now - indexCache.filesAt < INDEX_TTL_MS) return indexCache.files
  const out = []
  for (const root of workspaceRoots()) {
    const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
    for (const rel of collectFiles(base, 3, 400)) out.push({ rel, base: path.basename(base) })
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
  const seen = new Set()
  const push = (value, detail, src) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ kind: 'word', value, detail, src })
  }
  const pool = []
  if (lang && LANG_WORDS[lang]) pool.push([LANG_WORDS[lang], lang + ' 词表'])
  pool.push([LANG_WORDS.html, 'html 标签'])
  pool.push([LANG_WORDS.javascript, 'JS 关键字'])
  pool.push([HTML_ATTRS, 'html 属性'])
  if (lang === 'css') pool.push([LANG_WORDS.css, 'CSS 属性'])
  for (const [words, detail] of pool) for (const w of words) push(w, detail, 'words.js')
  return out
}

function buildCandidates(prefix, lang) {
  const cands = []
  for (const c of wordCandidates(prefix, lang)) cands.push(c)
  for (const f of filesCached()) cands.push({ kind: 'file', value: f.rel, detail: f.base })
  for (const id of modelsCached()) cands.push({ kind: 'model', value: id, detail: '模型' })
  for (const s of SNIPPETS) cands.push({ kind: 'snippet', value: s.value, detail: '片段 ' + s.label, label: s.label })
  return rankCandidates(cands, prefix, 12)
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
        send(res, 200, { ok: true, prefix, lang, candidates: buildCandidates(prefix, lang) })
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => () => { for (const d of disposers) { try { d() } catch {} } })
}

export { name, inject, apply }
export const internals = { PAIRS, SNIPPETS, SOURCES, rankCandidates, parseModelIds, collectFiles, workspaceRoots, buildCandidates, wordCandidates, normalizeLang, DSH_HOME }
