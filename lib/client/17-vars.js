// ── 模块：提示词变量 ──────────────────────────────────
// 打 {{ 时给出可插入的变量，接受后直接落成真实文本（不留下 {{...}} 占位）。
// 对齐成熟项目的做法（Open WebUI / LibreChat 的 prompt variables）：变量在发送前展开成值。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var CLIP_CACHE = { at: 0, text: '' }
    function readClipboardSoft() {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) return Promise.resolve('')
        if (Date.now() - CLIP_CACHE.at < 30000 && CLIP_CACHE.text) return Promise.resolve(CLIP_CACHE.text)
        return navigator.clipboard.readText().then(function (t) {
          CLIP_CACHE = { at: Date.now(), text: String(t || '').slice(0, 400) }
          return CLIP_CACHE.text
        }).catch(function () { return '' })
      } catch (e) { return Promise.resolve('') }
    }

 /** 用给定上下文展开变量：纯函数，便于离线断言。 */
    function expandVariables(text, ctx) {
      var c = ctx || {}
      return String(text || '')
        .replace(/\{\{\s*date\s*\}\}/g, c.date || '')
        .replace(/\{\{\s*selection\s*\}\}/g, c.selection || '')
        .replace(/\{\{\s*clipboard\s*\}\}/g, c.clipboard || '')
    }

 /** `{{` 之后给变量候选：值直接是展开后的文本，接受即可用。 */
    function variableCandidates(ed, tail) {
      var t = String(tail == null ? '' : tail)
      var at = t.lastIndexOf(';')
      if (at < 0) return Promise.resolve(null)
      var typed = t.slice(at + 1).toLowerCase()
      var sel = ''
      try { sel = selectedText(ed) || '' } catch (e) {}
      var today = new Date()
      var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
      return readClipboardSoft().then(function (clip) {
        var defs = [
          { key: 'selection', label: '选中的文本', value: sel },
          { key: 'clipboard', label: '剪贴板', value: clip },
          { key: 'date', label: '今天日期', value: dateStr }
        ]
        var out = []
        for (var i = 0; i < defs.length; i++) {
          var d = defs[i]
          if (typed && d.key.indexOf(typed) !== 0) continue
          if (!d.value) continue
          out.push({ kind: 'word', value: d.value, label: '{{' + d.key + '}} ' + d.label, detail: d.label, src: 'var', filterText: d.key })
        }
        return out.length ? out : null
      })
    }
