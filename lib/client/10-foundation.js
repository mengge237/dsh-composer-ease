// ── 模块：表与文本工具 ────────────────────────────────
// 成对符号表（PAIRS/CLOSERS/家族/奇偶判据）、shouldPair、以及 contenteditable 的取文/摆光标/插字原语。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var ROUTE_WORDS = '/dsh-composer-ease/words'
    // 2026-10-16 加全角/中文成对符：使用中实测「输入（ 只出（」——中文输入法下原来完全没有配对。
    // 全角走 input 事件那条补配对（IME 合成的字符不一定有对应的 keydown）。
    var PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'",
                  '（': '）', '【': '】', '「': '」', '『': '』', '《': '》', '〈': '〉', '“': '”', '‘': '’' }
    var CLOSERS = { ')': '(', ']': '[', '}': '{', '`': '`', '"': '"', "'": "'",
                    '）': '（', '】': '【', '」': '「', '』': '『', '》': '《', '〉': '〈', '”': '“', '’': '‘' }

    // ── 纯逻辑（selftest 直接喂）───────────────────────────────────────────
    /** **成对家族**：所有成对符号的开符与闭符（半角 + 中文标点）。
     *  2026-10-20 使用中三条反馈同一类：①有前引号再打引号出两个 ②中文模式打引号变多个
     *  ③括号也一样（`(` 后面再打 `(` 会变 `(()`）——所以守卫要从「引号」扩到整个家族：
     *  光标前一个字符是家族里的任意成员时，只插一个字符、不补对。 */
    var PAIRED_CHAR = /[()[\]{}（）【】「」『』《》〈〉“”‘’"'`]$/

    /** 光标前这段文字里，`open` 是否处在一个**没闭合**的状态。
     *  2026-10-20 一次反馈就是这个漏的：
     *  原来只看前一个字符（`PAIRED_CHAR`），当前面是「好」这种正文时看不到更早那个开符，
     *  于是又补一对，得到 `"你好""`。对称引号按奇偶判，非对称按开符多于闭符判。 */
    /* 引号家族（使用中 2026-10-21 报的根因）：全角 “ 与半角 " 在判定里必须算同一个"引号位"，
     * 否则中文输入法下混着打就永远被判成"没有开符"，于是一路补对、各处冒出多个引号。
     * 规则只有一条：**引号永远成对，家族内合计字符数为奇 = 还有未闭合的引号**。
     * 括号不进家族：`（` 与 `(` 语义不同，混用不算一对。 */
    var QUOTE_FAMILY = '"\u201c\u201d\u201e\u201f\uff02\u0027\u2018\u2019\u201a\u201b\uff07'
    function isQuoteChar(ch) { return !!ch && QUOTE_FAMILY.indexOf(ch) >= 0 }
    function quoteCount(text) {
      var q = String(text || ''), n = 0
      for (var i = 0; i < q.length; i++) if (QUOTE_FAMILY.indexOf(q[i]) >= 0) n++
      return n
    }

    function isUnbalancedBefore(text, open, close) {
      var s = String(text || '')
      // 引号按家族奇偶判：`“你好` 与 `"你好` 同为未闭合，混着打也算一对
      if (isQuoteChar(open) || isQuoteChar(close)) return quoteCount(s) % 2 === 1
      var o = 0, c = 0
      for (var i = 0; i < s.length; i++) {
        if (s[i] === open) o++
        else if (close !== open && s[i] === close) c++
      }
      return close === open ? (o % 2 === 1) : (o > c)
    }
    /** 光标前那一段的最后是不是「一个**非空**成对符号的闭符」——即这块内容已经被框好了。
     *  用来挡「框完再打一次闭符，于是多堆一个」：`"你好"` 再打 `"` 不该变成 `"你好""`。
     *  **空对（`""`、`()`）不算**：连打引号/括号是「写 ``` 围栏」那类正常用法，见行为矩阵里的连按用例。 */
    function alreadyClosedBefore(before, open, close) {
      var s = String(before || '')
      if (s.length < 3) return false                        // 至少要「开符 + 一个字符 + 闭符」
      // 只认「同字符」的已闭合（`"abc"` 后再打 " 才跳过）。
      // 混宽一律不吞 —— 那是2026-10-21 的一次反馈。
      if (s.charAt(s.length - 1) !== close) return false
      if (s.charAt(s.length - 2) === open) return false     // 空对：放行（连按引号仍要能打出来）
      return isUnbalancedBefore(s.slice(0, -1), open, close)
    }
    /** 该不该自动补闭符（VS Code 的那条规则）：
     *  ⓪ 光标前一个字符是成对家族成员 → 不配，只插这一个（使用中 2026-10-20 定的口径，一刀切）；
     *  ① 光标前是标识符/路径字符 → 不配（保护 `a(b`、`<本地路径>` 这类写法）；
     *  ② **光标右边紧跟字母/数字/汉字 → 不配，只插这一个开符** —— 正是「在一段已有文字前打前引号」
     *     的场景（使用中 2026-10-16 真机踩到：被补成一对，于是多出一个引号）；
     *  ③ 右边是空白、闭符、行尾才补。 */
    function shouldPair(before, after, ch) {
      // 引号（2026-10-22 使用中要求恢复「打一个引号得一对」）：
      //   严格配对开 → 老行为，一律补对；
      //   严格配对关（默认）→ 也补对，但按 VS Code `editor.autoClosingQuotes` 的
      //   `beforeWhitespace` 口径收窄：**右边紧跟文字时不补**（保护「在一段已有文字前打前引号」，
      //   使用中 2026-10-16 真机踩到的多一个引号就是这条），左边已是成对符号时也不补。
      //   历史：2026-10-21 曾一律只插一个，原因是配对后光标靠 DOM Range 复位，
      //   快速连打会多冒一个引号；现在走的是括号那条 `insertAtomic + placeCaretVerified`
      //   的复核链（文本护栏 + 跨帧校验），所以放回来。
      if (isQuoteChar(ch)) {
        // warn 模式（默认）：不自动补闭引号 —— 闭符落到句子末尾、以及"打完一个引号多一个"的
        // 两类投诉都源于自动补对；这里改为只插当前字符，由 lintQuotes 标红提示。
        if (quoteMode() !== 'auto') return false
        if (pairStrict()) return true
        if (/[A-Za-z0-9_\u4e00-\u9fff]/.test(String(after || ''))) return false
        if (PAIRED_CHAR.test(String(before || '').slice(-1))) return false
        return true
      }
      if (/[A-Za-z0-9_\u4e00-\u9fff]/.test(String(after || ''))) return false
      var last = before.slice(-1)
      if (PAIRED_CHAR.test(last)) return false
      if (/[\u4e00-\u9fff]$/.test(last)) return true      // 中文正文后面当然要配对
      return !/[A-Za-z0-9_./\\@#-]$/.test(last)
    }
    /** 取 caret 前的当前 token（补全用）：文件/标识符字符集，遇空白或换行截断。 */
    /** 展开片段占位符：`${n:默认值}` → 默认值（或空），同时算出每个落点的**偏移**。
     *  返回 { text, stops }；stops 按占位符编号升序（与出现顺序无关），供 Tab 依次跳。 */
    function expandSnippet(v) {
      var src = String(v || '')
      var re = /\$\{(\d+)(?::([^}]*))?\}/g
      var out = '', stops = [], m, last = 0
      while ((m = re.exec(src))) {
        out += src.slice(last, m.index)
        out += m[2] || ''
        stops.push({ n: Number(m[1]), at: out.length })
        last = re.lastIndex
      }
      out += src.slice(last)
      stops.sort(function (a, b) { return a.n - b.n })
      return { text: out, stops: stops.map(function (s) { return s.at }) }
    }

    function tokenBefore(text) {
      var m = String(text || '').match(/([A-Za-z0-9_./@:,-]*)$/)
      return m ? m[1] : ''
    }
    /** 键位决策表：返回动作名，selftest 与真实监听共用判据。 */
    function keyAction(k) {
      if (k.ctrl && k.code === 'Space') return 'complete'
      if (k.key === 'Escape') return 'dismiss'
      // 2026-10-16（使用中真机踩到）：聊天框里**回车必须发送**，不能被补全弹层吃掉。
      // 原来 Enter 也算接受，弹层开着时连按回车就把候选一遍遍插进正文（打出
      // "i临时目录/attrib-index.dif临时目录/attrib-index.dif…" 那种滚雪球）。接受只留 Tab。
      if (k.__popupOpen && k.key === 'Tab') return 'accept'
      if (k.key === 'Backspace' && !k.__collapsedFalse) return 'pairbackspace'
      // 对称引号（" ' `）右边已经是同一个字符：走「跳过」而不是再补一对（否则就是多出来的那一对）
      if (k.__nextIsCloser && Object.prototype.hasOwnProperty.call(CLOSERS, k.key)) return 'pairclose'
      if (Object.prototype.hasOwnProperty.call(PAIRS, k.key)) return 'pairopen'
      if (Object.prototype.hasOwnProperty.call(CLOSERS, k.key)) return 'pairclose'
      return null
    }

    // ── DOM 层 ──────────────────────────────────────────────────────────────
    function composerOf(el) {
      if (!el || el === document.body) return null
      var c = el.closest ? el.closest('[data-composer-input], textarea, [contenteditable="true"], [contenteditable=""]') : null
      return c
    }
    function isText(ed) {
      return ed && (ed.tagName === 'TEXTAREA' || ed.tagName === 'INPUT')
    }
    /* 我们的 keydown 监听在**捕获阶段**，跑在 Lexical 自己的键位处理之前；插入后立刻改光标/选区
     * 会被 Lexical 随后的渲染覆盖（真机扫出来的）。contenteditable 这条路一律往后推一拍再改选区。 */
    function soon(fn) { try { setTimeout(fn, 0) } catch (e) { fn() } }

    function insertText(ed, text) {
      if (isText(ed)) {
        var s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        var start = ed.selectionStart, end = ed.selectionEnd
        s.call(ed, ed.value.slice(0, start) + text + ed.value.slice(end))
        ed.selectionStart = ed.selectionEnd = start + text.length
        ed.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        ed.focus()
        document.execCommand('insertText', false, text)
      }
    }
    /** 插文本的**通用入口**：多行走合成 paste（2026-10-22 真机：片段是多行的，
     *  `execCommand('insertText')` 在真 Lexical 上会被吃掉 —— 连点选片段都插不进去）。
     *  宿主接下 paste（返回 false = preventDefault 过）就不再兜底；否则退回 execCommand。 */
    function insertRich(ed, text) {
      var s = String(text == null ? '' : text)
      if (isText(ed) || s.indexOf('\n') < 0) return insertText(ed, s)
      try {
        var dt = new DataTransfer()
        dt.setData('text/plain', s)
        var evP = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        if (ed.dispatchEvent(evP) === false) return
      } catch (e) {}
      insertText(ed, s)
    }

    function selectedText(ed) {
      if (isText(ed)) return ed.value.slice(ed.selectionStart, ed.selectionEnd)
      var sel = window.getSelection()
      return sel && !sel.isCollapsed ? sel.toString() : ''
    }

    /* 2026-10-16 真机扫出来的坑：Lexical 不认 `sel.modify(...)` —— 在真 composer 上
     * 配对后的光标、跳闭合、删空对、环绕选区还原、Tab 替换 token 全都没生效（值对了、位置全错）。
     * 改成把 composer 文本摊平成一个字符偏移，用显式 Range 定位/选区。文本节点之外的东西
     * （br、mention 之类）按 0 长处理：真 composer 里就是纯文本，够用。 */
    function flatText(ed) {
      try {
        var w = document.createTreeWalker(ed, 4 /* SHOW_TEXT */, null)
        var out = '', node
        while ((node = w.nextNode())) out += node.nodeValue || ''
        return out
      } catch (e) { return '' }
    }
    /** 数一个文档片段里文本节点的字符数（与 flatText 同口径：只数文本节点，不含块边界）。 */
    function textLenOf(frag) {
      try {
        var w = document.createTreeWalker(frag, 4 /* SHOW_TEXT */, null)
        var n = 0, node
        while ((node = w.nextNode())) n += (node.nodeValue || '').length
        return n
      } catch (e) { return 0 }
    }
    function caretOffset(ed) {
      try {
        var sel = window.getSelection()
        if (!sel || !sel.rangeCount) return -1
        var r = sel.getRangeAt(0)
        var pre = r.cloneRange()
        pre.selectNodeContents(ed)
        pre.setEnd(r.endContainer, r.endOffset)
        return pre.toString().length
      } catch (e) { return -1 }
    }
    /** 摆光标：文本域直接写 selectionStart，contenteditable 才需要 Range（setSelectionRange 只认 Selection）。 */
    function setCaret(ed, off) {
      if (off < 0) return
      if (isText(ed)) { try { ed.selectionStart = ed.selectionEnd = off } catch (e) {} ; return }
      setSelectionRange(ed, off, off)
    }
    /** 当前光标偏移，文本域与 contenteditable 同一个口径（caretOffset 只认 Selection）。 */
    function caretPos(ed) {
      if (isText(ed)) { try { return ed.selectionStart } catch (e) { return -1 } }
      return caretOffset(ed)
    }
    /** 把选区设成 composer 内的 [start, end) 字符区间；失败返回 false。 */
    function setSelectionRange(ed, start, end) {
      try {
        var sel = window.getSelection()
        if (!sel) return false
        var walker = document.createTreeWalker(ed, 4, null)
        var acc = 0, node, startNode = null, startOff = 0, endNode = null, endOff = 0
        while ((node = walker.nextNode())) {
          var len = (node.nodeValue || '').length
          if (startNode === null && acc + len >= start) { startNode = node; startOff = Math.max(0, start - acc) }
          if (acc + len >= end) { endNode = node; endOff = Math.max(0, end - acc); break }
          acc += len
        }
        var r = document.createRange()
        if (startNode && endNode) { r.setStart(startNode, startOff); r.setEnd(endNode, endOff) }
        else { r.selectNodeContents(ed); r.collapse(false) }
        sel.removeAllRanges(); sel.addRange(r)
        return true
      } catch (e) { return false }
    }

    function caretChar(ed, dir) {
      try {
        if (isText(ed)) {
          var i = ed.selectionStart
          return dir > 0 ? ed.value[i] || '' : ed.value[i - 1] || ''
        }
        var off = caretOffset(ed)
        if (off < 0) return ''
        var t = flatText(ed)
        return dir > 0 ? (t[off] || '') : (t[off - 1] || '')
      } catch (e) { return '' }
    }
    function selectBack(ed, n) { // 把 caret 前 n 个字符变成选区（补全替换 token 用）
      try {
        if (isText(ed)) { ed.selectionStart = Math.max(0, ed.selectionStart - n); return }
        var off = caretOffset(ed)
        if (off >= 0) setSelectionRange(ed, Math.max(0, off - n), off)
      } catch (e) {}
    }
    /** 环绕选区：把选中内容用一对符号框起来，**光标落在闭符之后**（使用中 2026-10-20 定的落点：
     *  框完之后继续打字要接在 `"内容"` 的后面，而不是回选到中间；正常打引号那条路不变，
     *  仍是光标落在成对符号中间）。
     *  插入通道踩过两次坑，都是真机实测出来的：
     *  ① 原写法 `insertText(open + selTxt + close)` 在真 Lexical 上会把内容吃掉（三行变 "\n\n"）；
     *  ② 「两次 execCommand 各插一个字符」也不行 —— 插入那一刻是对的，随后 Lexical 按自己的模型
     *     重渲染，把内容清成只剩最后一个字符（探针读数：`"AAA\nBBB"` → `"`）。
     *  所以：**Lexical 只认 paste 通道**（合成 ClipboardEvent，让编辑器自己落段落）。实测粘贴后
     *  `"AAA\nBBB\nCCC"` 三行完整保留。没被接管时才退回 execCommand。 */
    /* 上一次框选的范围：用于「再打一次同一个引号 = 取消这次框选」（使用中 2026-10-21）。 */
