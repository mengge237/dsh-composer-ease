// dsh-composer-ease —— 工作区符号抽取（本仓自建，无第三方依赖）。
// 目的：补上「只有文件名、没有函数/类」这一档差距。做法是正则扫描 + 上限保护，
// 不做语言服务：宁可漏，不可卡（扫描有文件数/字节/深度三重上限，超了就停）。

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', '5_临时', '.venv', 'venv', '__pycache__'])
const LANG_OF = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.tsx': 'ts', '.jsx': 'js', '.py': 'py', '.java': 'java' }

const RE_JS_FUNC = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g
const RE_JS_ARROW = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g
const RE_JS_CLASS = /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g
const RE_PY_DEF = /(?:^|\n)\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/g
const RE_PY_CLASS = /(?:^|\n)\s*class\s+(\w+)/g
const RE_JAVA_METHOD = /(?:^|\n)\s*(?:public|private|protected|static|final|synchronized|abstract)\s+[\w<>\[\],. ]+\s+(\w+)\s*\(([^)]*)\)\s*\{/g

 /** 从一段源码里抽符号；返回 [{name, kind, params}]。 */
export function extractSymbols(text, lang) {
  const out = []
  const push = (name, kind, params) => {
    if (!name || name.length < 2 || name.length > 60) return
    out.push({ name: name, kind: kind, params: String(params || '').replace(/\s+/g, ' ').trim().slice(0, 120) })
  }
  let m
  if (lang === 'js' || lang === 'ts') {
    while ((m = RE_JS_FUNC.exec(text)) !== null) push(m[1], 'function', m[2])
    while ((m = RE_JS_ARROW.exec(text)) !== null) push(m[1], 'function', m[2])
    while ((m = RE_JS_CLASS.exec(text)) !== null) push(m[1], 'class', '')
  } else if (lang === 'py') {
    while ((m = RE_PY_DEF.exec(text)) !== null) push(m[1], 'function', m[2])
    while ((m = RE_PY_CLASS.exec(text)) !== null) push(m[1], 'class', '')
  } else if (lang === 'java') {
    while ((m = RE_JAVA_METHOD.exec(text)) !== null) push(m[1], 'method', m[2])
  }
  return out
}

 /** 扫一遍工作区，返回去重后的符号表（同名只留第一条）。超上限就停，保证不拖住补全。 */
export function scanSymbols(fs, path, roots, opts) {
  const cap = Object.assign({ files: 400, bytes: 200 * 1024, depth: 6 }, opts || {})
  const seen = new Map()
  let files = 0
  const walk = (dir, depth, base) => {
    if (files >= cap.files || depth > cap.depth) return
    let names
    try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const ent of names) {
      if (files >= cap.files) return
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) { if (!SKIP_DIR.has(ent.name)) walk(full, depth + 1, base); continue }
      const lang = LANG_OF[path.extname(ent.name)]
      if (!lang) continue
      let st
      try { st = fs.statSync(full) } catch (e) { continue }
      if (st.size > cap.bytes) continue
      let text
      try { text = fs.readFileSync(full, 'utf8') } catch (e) { continue }
      files++
      for (const s of extractSymbols(text, lang)) {
        if (seen.has(s.name)) continue
        seen.set(s.name, { name: s.name, kind: s.kind, params: s.params, file: path.relative(base, full).replace(/\\/g, '/') })
      }
    }
  }
  for (const r of roots) walk(r, 0, r)
  return { symbols: Array.from(seen.values()), files: files }
}
