// ── 模块：历史召回 ────────────────────────────────────
// 面向「对 agent 下指令」的输入框：↑ 翻上一次发出去的 prompt，↓ 往回翻，带前缀过滤。
// 历史只存在本机 localStorage（最多 50 条、连续重复去重），不上报、不发给服务端。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var HIST_KEY = 'dsh-composer-ease:prompt-history'
    var HIST_MAX = 50
    var histList = null
    var histCursor = -1
    var histTyped = ''

    function histLoad() {
      if (histList) return histList
      histList = []
      try {
        var raw = window.localStorage.getItem(HIST_KEY)
        var j = raw ? JSON.parse(raw) : null
        if (j && j.length) histList = j.filter(function (x) { return x && typeof x.t === 'string' })
      } catch (e) {}
      return histList
    }

    function histSave() {
      try { window.localStorage.setItem(HIST_KEY, JSON.stringify(histList.slice(0, HIST_MAX))) } catch (e) {}
    }

 /** 记下一条真正发出去的 prompt：空白、过长（>20000 字）、与上一条相同都跳过。 */
    function rememberPrompt(text) {
      var t = String(text || '').trim()
      if (!t || t.length > 20000) return
      var list = histLoad()
      if (list.length && list[0].t === t) return
      list.unshift({ t: t, at: Date.now() })
      if (list.length > HIST_MAX) list.length = HIST_MAX
      histSave()
    }

 /** 前缀过滤后的候选（按时间从新到旧）。prefix 为空时就是全部。 */
    function histMatches(prefix) {
      var p = String(prefix || '')
      return histLoad().filter(function (x) { return !p || x.t.indexOf(p) === 0 })
    }

 /** ↑：回到更早的一条；已经在最旧一条就停住。返回要填进输入框的文本（null = 不动）。 */
    function histOlder(prefix) {
 // 翻第二条起要沿用「开始翻之前」的前缀：此时输入框里已经是被翻出来的历史，拿它当前缀就只剩一条
      var pfx = histCursor >= 0 ? histTyped : String(prefix || '')
      var list = histMatches(pfx)
      if (!list.length) return null
      if (histCursor < 0) { histTyped = pfx; histCursor = 0 }
      else if (histCursor < list.length - 1) histCursor++
      return list[histCursor].t
    }

 /** ↓：回到更新的一条；翻过最新一条就还原成用户这次输入的前缀。 */
    function histNewer(prefix) {
      var pfx = histCursor >= 0 ? histTyped : String(prefix || '')
      var list = histMatches(pfx)
      if (!list.length || histCursor < 0) return null
      if (histCursor > 0) { histCursor--; return list[histCursor].t }
      histCursor = -1
      return histTyped
    }

    function histReset() { histCursor = -1 }
