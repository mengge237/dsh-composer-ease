// ── 模块：词法上下文（纯逻辑）────────────────────────
// 判断光标前处于普通/行注释/块注释/字符串哪一态；供输入处理决定要不要提示。


    function lexicalContext(text) {
      var s = String(text || '')
      var state = 'plain'
      var quote = ''
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i)
        var n = s.charAt(i + 1)
        if (state === 'block') { if (c === '*' && n === '/') { state = 'plain'; i++ } ; continue }
        if (state === 'line') { if (c === '\n') state = 'plain'; continue }
        if (state === 'string') {
          if (c === '\\') { i++; continue }
          if (c === quote) { state = 'plain'; quote = '' }
          continue
        }
        if (c === '/' && n === '/') {
          var ls = s.lastIndexOf('\n', i - 1) + 1
          if (/^\s*$/.test(s.slice(ls, i))) { state = 'line'; i++; continue }
        }
        if (c === '/' && n === '*') { state = 'block'; i++; continue }
        if (c === '#' && (i === 0 || s.charAt(i - 1) === '\n')) { state = 'line'; continue }
        if (c === "'" || c === '"' || c === '`') { state = 'string'; quote = c; continue }
      }
      if (state === 'plain') {
        var lineStart = s.lastIndexOf('\n') + 1
        if (/^\s*(<!--|--)/.test(s.slice(lineStart))) state = 'line'
      }
      return { state: state, quote: quote }
    }
 /* 从一段输出里挑出「文件:行」的路径（失败的日志里常见）。只取 basename，最多 6 个。 */
    var FAIL_FILE_RE = /([A-Za-z0-9_./\\-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|java)):(\d+)/g
    function extractFailFiles(text) {
      var s = String(text || '')
      FAIL_FILE_RE.lastIndex = 0
      var out = [], seen = {}
      var m
      while ((m = FAIL_FILE_RE.exec(s)) !== null) {
        var base = m[1].split(/[\\/]/).pop()
        if (!base || seen[base]) continue
        seen[base] = 1
        out.push(base)
        if (out.length >= 6) break
      }
      return out
    }
    function inCommentLine(before) {
      var s = String(before || '')
      var i = s.lastIndexOf('\n')
      return COMMENT_LINE.test(i < 0 ? s : s.slice(i + 1))
    }
