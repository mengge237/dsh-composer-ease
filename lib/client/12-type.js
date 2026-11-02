// ── 模块：VS Code 打字拦截层 ────────────────────────────────
// 模式枚举、before 集合、shouldAutoCloseBefore 与 buildTypeEdits（常量逐字取自 VS Code 产物）。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

// VS Code 打字拦截层（模式 + before 集合 + 编辑列表），常量取自其产物
    var AC_MODES = ['always', 'languageDefined', 'beforeWhitespace', 'never']
    var AC_BEFORE_QUOTES = ';:.,=}])> \t'
    var AC_BEFORE_BRACKETS = '\'"`;:.,=}])> \t'
    var AC_BEFORE_WS = ' \t'

 /** 设置 → 模式（认不得的值按 languageDefined 处理，与 VS Code 的默认值一致）。 */
    function autoCloseMode(kind) {
      var v = ''
      try { v = String(window.localStorage.getItem('dsh-composer-ease:autoClose' + (kind === 'quote' ? 'Quotes' : 'Brackets')) || '') } catch (e) {}
      return AC_MODES.indexOf(v) >= 0 ? v : 'languageDefined'
    }
    function setAutoCloseMode(kind, mode) {
      try { window.localStorage.setItem('dsh-composer-ease:autoClose' + (kind === 'quote' ? 'Quotes' : 'Brackets'), AC_MODES.indexOf(mode) >= 0 ? mode : 'languageDefined') } catch (e) {}
    }

 /** VS Code 的 shouldAutoCloseBefore：只有前一个字符落在集合里才补对。kind 决定用哪张集合。 */
    function shouldAutoCloseBefore(prev, mode, kind) {
      var m = AC_MODES.indexOf(mode) >= 0 ? mode : 'languageDefined'
      if (m === 'always') return true
      if (m === 'never') return false
      if (m === 'beforeWhitespace') return AC_BEFORE_WS.indexOf(prev) >= 0
      var set = kind === 'quote' ? AC_BEFORE_QUOTES : AC_BEFORE_BRACKETS
 // 空上下文、中文、字母数字后允许成对
      if (!prev) return true
      if (/[\u4e00-\u9fff]/.test(prev)) return true
      if (/[A-Za-z0-9_]/.test(prev)) return true
      return set.indexOf(prev) >= 0
    }

 /** 打一个字符要做的编辑（VS Code 的 typeWithInterceptors 子集）：
 *  返回 [{ range: [from, to], text }]，按 from 升序；空数组＝不干预，交原生插入。 */
    function buildTypeEdits(ch, ctx) {
      var c = ctx || {}
      var before = String(c.before || ''), after = String(c.after || '')
      var sel = c.selection || ''
      var off = before.length
      var close = PAIRS[ch] || ''
      var kind = isQuoteChar(ch) ? 'quote' : 'bracket'
      var mode = autoCloseMode(kind)
      var edits = []
 // 有选区：框住（surround）
      if (sel) {
        return [{ range: [off, off + sel.length], text: ch + sel + close, caret: off + 1, select: [off + 1, off + 1 + sel.length] }]
      }
 // 全角括号开关：换算成半角对子
      if (c.fwHalf && FW_TO_ASCII[ch]) { ch = FW_TO_ASCII[ch]; close = PAIRS[ch] || '' }
 // 右边已经是同一个闭符：跳过去（overtype）
      if (close && after === close) return [{ range: [off + 1, off + 1], text: '', caret: off + 1 }]
      if (!close) return edits
 // 已闭合 / 未闭合：只插一个
      if (alreadyClosedBefore(before, ch, close)) return edits
      if (close === ch && before.slice(-1) === ch) return edits
      if (isUnbalancedBefore(before, ch, close)) return edits
      if (!shouldAutoCloseBefore(before.slice(-1), mode, kind)) return edits
      if (/[A-Za-z0-9_\u4e00-\u9fff]/.test(String(after || ''))) return edits   // 右边紧跟文字时不补（VS Code 的 beforeWhitespace 精神）
      return [{ range: [off, off], text: ch + close, caret: off + 1 }]
    }
