// dsh-composer-ease —— 浏览器半边：键位层 + 补全弹层。
// 形态：宿主模块图里的一个 bundle（照 dsh-skill-meter / dsh-model-priority 的头尾抄结构），
// 不 require 任何第三方包（动态包里也只拿得到宿主 react，本件用不到）。
// 行为参照 VSCode（MIT）：自动配对、环绕选区、输入闭合符跳过、删除空对、Ctrl+Space 补全。
// **未复制 VSCode 源码**，只对齐交互；出处见 README 的「来源」节。
// 补全两类（加第 2 类）：
// 1) 本文词（VSCode 的 word based suggestions 口径）：草稿里出现过的标识符，本地即时算，不等网络；
// 2) 语言词表：HTML 标签 / JS·Python·Java 关键字 / CSS 属性名，服务端 lib/words.js 供，
// 数据借自 monaco-editor、codemirror、MDN BCD（均为宽松许可，源地址与 commit 见 words.js 头部与 THIRD-PARTY.md）。
// 触发：'/' 与 '@'，以及**打满两个标识符字符就自动弹**（VSCode 手感）；Tab/Enter 接受、Esc 关、上下选。
// ⚠ 本文件由 tools/build-client.mjs 从 lib/client/*.js 生成，**不要直接改**。
// 改片段：lib/client/10-foundation.js、20-pairing.js、30-popup.js、40-language.js、45-settings.js、50-caret.js、60-keys.js、70-input.js、80-apply.js

window.__ModuleLoader__.load({
  id: 'dsh-composer-ease',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

// ── 模块：表与文本工具 ────────────────────────────────
// 成对符号表（PAIRS/CLOSERS/家族/奇偶判据）、shouldPair、以及 contenteditable 的取文/摆光标/插字原语。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var ROUTE_WORDS = '/dsh-composer-ease/words'
 // 加全角/中文成对符：实测「输入（ 只出（」——中文输入法下原来完全没有配对。
 // 全角走 input 事件那条补配对（IME 合成的字符不一定有对应的 keydown）。
    var PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'",
                  '（': '）', '【': '】', '「': '」', '『': '』', '《': '》', '〈': '〉', '“': '”', '‘': '’' }
    var CLOSERS = { ')': '(', ']': '[', '}': '{', '`': '`', '"': '"', "'": "'",
                    '）': '（', '】': '【', '」': '「', '』': '『', '》': '《', '〉': '〈', '”': '“', '’': '‘' }

 // ── 纯逻辑（selftest 直接喂）───────────────────────────────────────────
 /** **成对家族**：所有成对符号的开符与闭符（半角 + 中文标点）。
 * 三条反馈同一类：①有前引号再打引号出两个 ②中文模式打引号变多个
 * ③括号也一样（`(` 后面再打 `(` 会变 `(()`）——所以守卫要从「引号」扩到整个家族：
 * 光标前一个字符是家族里的任意成员时，只插一个字符、不补对。 */
    var PAIRED_CHAR = /[()[\]{}（）【】「」『』《》〈〉“”‘’"'`]$/

 /** 光标前这段文字里，`open` 是否处在一个**没闭合**的状态。
 * 一次反馈就是这个漏的：
 * 原来只看前一个字符（`PAIRED_CHAR`），当前面是「好」这种正文时看不到更早那个开符，
 * 于是又补一对，得到 `"你好""`。对称引号按奇偶判，非对称按开符多于闭符判。 */
 /* 引号家族（根因）：全角 “ 与半角 " 在判定里必须算同一个"引号位"，
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

 /** 没闭合的那个引号在全文里的下标（撇号不算，与 unclosedQuoteCount 同口径）。
 * 标红要画在**这个字符**底下，而不是整行：一行里只有一个引号真的有问题。 */
    function unmatchedQuoteIndex(text) {
      var s = String(text || ''), n = 0, last = -1
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i)
        if (!isQuoteChar(c)) continue
        if (c === '\u0027' || c === '\u2019') {
          var pv = s.charAt(i - 1), nx = s.charAt(i + 1)
          if (/[A-Za-z0-9]/.test(pv) && /[A-Za-z0-9]/.test(nx)) continue
        }
        n++
        last = i
      }
      return n % 2 === 1 ? last : -1
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
 * 用来挡「框完再打一次闭符，于是多堆一个」：`"你好"` 再打 `"` 不该变成 `"你好""`。
 * **空对（`""`、`()`）不算**：连打引号/括号是「写 ``` 围栏」那类正常用法，见行为矩阵里的连按用例。 */
    function alreadyClosedBefore(before, open, close) {
      var s = String(before || '')
      if (s.length < 3) return false                        // 至少要「开符 + 一个字符 + 闭符」
 // 只认「同字符」的已闭合（`"abc"` 后再打 " 才跳过）。
 // 混宽一律不吞 —— 那是的一次反馈。
      if (s.charAt(s.length - 1) !== close) return false
      if (s.charAt(s.length - 2) === open) return false     // 空对：放行（连按引号仍要能打出来）
      return isUnbalancedBefore(s.slice(0, -1), open, close)
    }
 /** 该不该自动补闭符（VS Code 的那条规则）：
 * ⓪ 光标前一个字符是成对家族成员 → 不配，只插这一个（定的口径，一刀切）；
 * ① 光标前是标识符/路径字符 → 不配（保护 `a(b`、`<本地路径>` 这类写法）；
 * ② **光标右边紧跟字母/数字/汉字 → 不配，只插这一个开符** —— 正是「在一段已有文字前打前引号」
 * 的场景（实测发现的：被补成一对，于是多出一个引号）；
 * ③ 右边是空白、闭符、行尾才补。 */
    function shouldPair(before, after, ch) {
 // 引号（恢复「打一个引号得一对」）：
 // 严格配对开 → 老行为，一律补对；
 // 严格配对关（默认）→ 也补对，但按 VS Code `editor.autoClosingQuotes` 的
 // `beforeWhitespace` 口径收窄：**右边紧跟文字时不补**（保护「在一段已有文字前打前引号」，
 // 实测发现的多一个引号就是这条），左边已是成对符号时也不补。
 // 历史：曾一律只插一个，原因是配对后光标靠 DOM Range 复位，
 // 快速连打会多冒一个引号；现在走的是括号那条 `insertAtomic + placeCaretVerified`
 // 的复核链（文本护栏 + 跨帧校验），所以放回来。
      if (isQuoteChar(ch)) {
 // warn 模式（默认）：不自动补闭引号 —— 闭符落到句子末尾、以及"打完一个引号多一个"的
 // 两类投诉都源于自动补对；这里改为只插当前字符，由 lintQuotes 标红提示。
        if (quoteMode() !== 'auto') return false
        if (pairStrict()) return true
        if (/[A-Za-z0-9_\u4e00-\u9fff]/.test(String(after || ''))) return false
 // 引号是自对称的，前一个引号到底是开符还是闭符只能看**奇偶**：奇数 = 还悬着一个开符，
 // 这一下不该再补对；偶数 = 前面那对已经闭合，新打的引号应当开一对新的（反馈：其他引号都闭合
 // 的情况下，新打引号不出对）。
        var lastCh = String(before || '').slice(-1)
        if (isQuoteChar(lastCh) && quoteCount(String(before || '')) % 2 === 1) return false
        if (!isQuoteChar(lastCh) && PAIRED_CHAR.test(lastCh)) return false
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
 * 返回 { text, stops }；stops 按占位符编号升序（与出现顺序无关），供 Tab 依次跳。 */
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
 // （实测发现的）：聊天框里**回车必须发送**，不能被补全弹层吃掉。
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
 /* 插件的 keydown 监听在**捕获阶段**，跑在 Lexical 自己的键位处理之前；插入后立刻改光标/选区
 * 会被 Lexical 随后的渲染覆盖（实测扫出来的）。contenteditable 这条路一律往后推一拍再改选区。 */
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
 /** 插文本的**通用入口**：多行走合成 paste（实测：片段是多行的，
 * `execCommand('insertText')` 在真 Lexical 上会被吃掉 —— 连点选片段都插不进去）。
 * 宿主接下 paste（返回 false = preventDefault 过）就不再兜底；否则退回 execCommand。 */
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

 /* 实测扫出来的坑：Lexical 不认 `sel.modify(...)` —— 在真 composer 上
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
  /** 环绕选区：把选中内容用一对符号框起来，光标落在闭符之后（框完继续打字接在闭符后面）。
   * 插入只能走 **paste 通道**（合成 ClipboardEvent）—— `insertText` 拼好的多行文本会被 Lexical 吃掉，
   * 连续两次 execCommand 也会被它的重渲染清成最后一个字符。没被接管时才退回 execCommand。 */
 /* 上一次框选的范围：用于「再打一次同一个引号 = 取消这次框选」（）。 */

// ── 模块：配对与框选 ────────────────────────────────
// wrapSelection / repairWrapDup / tryUnwrap / surroundSelection：把选区框起来、以及框完的反选与清理。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var lastWrap = null

 /* 框选只是"一个动作"：期间不许弹补全。
 * 实测原因：Lexical 不认 preventDefault，会先把选区替成那一个字符，插件随后用 paste 补全；
 * 这中间的 input 事件足以让自动补全弹出来 —— 也就是说的"暴露第一个字然后进行提醒"。 */
    function wrapSelection(ed, open, selTxt, close) {
      var from = textBeforeCaret(ed).length
      var baseLen = textOf(ed).length
      var prevSuppress = suppressInput
      suppressInput = prevSuppress + 1
      closePopup()
      try {
        surroundSelection(ed, open, selTxt, close)
      } finally {
        suppressInput = prevSuppress          // 只压住自己这一次插入，不泄漏给下一键
        var start = from + open.length
        lastWrap = { ed: ed, open: open, close: close, start: start,
                     end: start + String(selTxt || '').length, inner: String(selTxt || '') }
 // 落地后按真文本复核（实测：全角 “ 包裹会多出一个开符 ——
 // Lexical 不认 preventDefault，粘贴之外它又按自己的键插了一遍；
 // 于是 Ctrl+Z 撤掉的是那个多余引号，而不是把原文还回来）。
 // 多拍复核：Lexical 那次"按自己的键再插一遍"落在插件第一次复核之后（实测），
 // 所以按 0/16/48/120/240ms 各看一次，命中一次就收（修复是幂等的）。
        var wantLen = baseLen + open.length + close.length
 // 多行/带空格的包裹走 execCommand 兜底时会被吃掉一部分（实测：围栏里选中整段再框，
 // 落地的是「开符 + 内容」，闭符没了）。所以落定后复核一次，缺哪一侧就补哪一侧。
        ;[0, 16, 48, 120, 240].forEach(function (ms) {
          setTimeout(function () { repairWrapDup(ed, open, String(selTxt || ''), close, wantLen) }, ms)
        })
      }
    }

 /* 「反选」：框完再打同一个引号 → 去掉两侧、内层重新选中。文本被别人改过就不认。
 * deleteAt(ed, off) 只删一个字符，从后往前删，开符那一侧的偏移不会被挪动。 */

 /** 包裹后按真文本复核：把「不在 open+内层+close 里」的多余开符删掉。
 * 实测 全角 “ 包裹时 Lexical 会按自己的模型再插一个开符，而且**落在文首**
 * （选中 abcd 的 1-3 → `“a“bc”d`），原来的判断只认紧挨着的 `open+open`，所以漏了。 */
    function repairWrapDup(ed, open, inner, close, wantLen) {
      try {
        var t = textOf(ed)
 // 长度不变量：包裹只在选区两侧各加一个字符。文本没变长就说明没有多余开符，
 // 一旦动手就会删掉正确的那一个（半角中文那例就是这么被删坏的）。
        if (typeof wantLen === 'number' && t.length <= wantLen) return
        var want = open + inner + close
        var at = t.indexOf(want)
        if (at < 0) return
        for (var i = 0; i < t.length; i++) {
          if (t.charAt(i) !== open) continue
          if (i >= at && i < at + open.length) continue     // 正确那个开符
          deleteAt(ed, i)                                   // 落在地上的多余开符
          t = textOf(ed)
          at = t.indexOf(want)
          break
        }
        if (at >= 0) {
          var endAt = at + want.length
          if (t.charAt(endAt - 1) === close) placeCaretVerified(ed, endAt, t)
          lastWrap && (lastWrap.start = at + open.length)
        }
      } catch (e) {}
    }

    function tryUnwrap(ed, open) {
      if (!lastWrap || lastWrap.ed !== ed || lastWrap.open !== open) return false
      if (open !== lastWrap.close) return false
      var w = lastWrap
      var text = textOf(ed)
      var start = w.start
      var exact = text.slice(w.start - 1, w.start) === open
        && text.slice(w.end, w.end + 1) === w.close
        && text.slice(w.start, w.end) === w.inner
      if (!exact) {
 // 位置口径在不同编辑器里不一致（textBeforeCaret 可能按选区起点也可能按末端），
 // 所以对不上时按「开符 + 内层 + 闭符」在全文里找一次；找不到才算被改过。
        var at = text.indexOf(open + w.inner + w.close)
        if (at < 0) { lastWrap = null; return false }
        start = at + open.length
      }
      lastWrap = null
      var innerEnd = start + w.inner.length
 // 一次替换，不留给编辑器中间态：选中 open+inner+close，用 inner 覆盖
      if (isText(ed)) {
        ed.selectionStart = start - 1
        ed.selectionEnd = innerEnd + 1
      } else {
        setSelectionRange(ed, start - 1, innerEnd + 1)
      }
      insertText(ed, w.inner)
      if (isText(ed)) {
        ed.selectionStart = start - 1
        ed.selectionEnd = start - 1 + w.inner.length
      } else {
        soon(function () { setSelectionRange(ed, start - 1, start - 1 + w.inner.length) })
      }
      return true
    }

 /** 多行包裹的第二步：确认「开符 + 内容 + 闭符」齐全，缺闭符就补一个（单字符插入）。
 * 幂等：已经齐了就什么都不做；找不到「开符 + 内容」也放手，不猜位置。 */
    function finishMultilineWrap(ed, open, inner, close) {
      try {
        var t = textOf(ed)
        var want = open + inner + close
        if (t.indexOf(want) >= 0) return
        var head = open + inner
        var at = t.indexOf(head)
        if (at < 0) return
        var pos = at + head.length
        if (t.charAt(pos) === close) return
        setSelectionRange(ed, pos, pos)
        suppressInput++
        insertText(ed, close)
        placeCaretVerified(ed, pos + close.length, t.slice(0, pos) + close + t.slice(pos))
      } catch (e) {}
    }
    function surroundSelection(ed, open, selTxt, close) {
      try {
        if (!isText(ed)) {
          var sel = window.getSelection()
          if (!sel || !sel.rangeCount) return
          var inner = String(selTxt || sel.toString() || '')
          var text = open + inner + close
 // 含换行的选区（两段以上、代码围栏整段）分两步包裹：
 // ① 80ms 后贴「开符 + 内容」—— 同拍贴整段时宿主会把**末尾的引号**吃掉（只丢引号，不丢别的字符）；
 // ② 再等 400ms 核对，缺闭符就用单字符插入补上（那时宿主已落定，单字符插入稳定）。
 // 判据：两段文本两侧引号齐全、每次一致；撤销两拍回到原句（单段仍是一拍）。
          if (String(inner).indexOf('\n') >= 0) {
            setTimeout(function () {
              try {
                var selNow = window.getSelection()
                if (!selNow || !selNow.rangeCount || !String(selNow)) return
                var dtM = new DataTransfer()
                dtM.setData('text/plain', open + String(inner))
                ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dtM, bubbles: true, cancelable: true }))
                setTimeout(function () { finishMultilineWrap(ed, open, String(inner), close) }, 400)
              } catch (eM) {}
            }, 80)
            return
          }
          var tailLen = 0
          try {
            var r0 = sel.getRangeAt(0)
            var afterR = document.createRange()
            afterR.selectNodeContents(ed)
            afterR.setStart(r0.endContainer, r0.endOffset)
            tailLen = textLenOf(afterR.cloneContents())
          } catch (e5) { tailLen = 0 }
          var handled = false
          try {
            var dt = new DataTransfer()
            dt.setData('text/plain', text)
            var evPaste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
            handled = ed.dispatchEvent(evPaste) === false     // false = 被 preventDefault = 编辑器接下了
          } catch (e3) {}
          dbg('wrap-paste', { ed: ed, sel: inner, handled: handled })
 // 兜底只在**宿主没接**时走 execCommand；它含空格会静默不落字，落没落由 wrapSelection 复核
          if (!handled) insertText(ed, text)
          soon(function () {                                  // 等 Lexical 落定，再把光标放到闭符之后
            try {
              var at = flatText(ed).length - tailLen
              if (at >= 0) setSelectionRange(ed, at, at)
            } catch (e4) {}
          })
          return
        }
        insertText(ed, open + selTxt + close)
        var endAt = ed.selectionStart                        // 文本插入完成后 caret 在整段之后
        ed.selectionStart = ed.selectionEnd = endAt          // 就在这里：闭符之后
      } catch (e) {}
    }

 // 弹层：一个 fixed div，数据来自 words 路由

// ── 模块：补全弹层 ────────────────────────────────
// 弹层 DOM、候选渲染与行样式、光标定位、类型图标、以及本文词（contextWords）的收集。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var popup = { root: null, items: [], index: 0, open: false, sig: '', wm: null }
    function ensurePopup() {
      if (popup.root) return popup.root
 // 同一页面可能被装了两份插件（本地路径 + GitHub 各一份）：复用已有的同一个元素，
 // 否则两套实例各画一个弹层，就成了「一个在输入框左上、一个在光标后」的两个框（实测）。
      var exist = document.getElementById('dsh-cp-popup')
      if (exist) { popup.root = exist; return exist }
      var d = document.createElement('div')
      d.id = 'dsh-cp-popup'
      d.setAttribute('data-dsh-plugin', 'dsh-composer-ease')
      d.style.cssText = 'position:fixed;z-index:2147480000;display:none;overflow-y:auto;overflow-x:hidden;' +
        'border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;' +
        'background:var(--dsw-alias-bg-layer-2,#1e1e1e);color:var(--dsw-alias-label-primary,inherit);' +
        'font:var(--dsw-font-xs,12.5px)/1.6 ui-monospace,Consolas,monospace;box-shadow:0 8px 24px rgba(0,0,0,.35)'
      document.body.appendChild(d)
      popup.root = d
      return d
    }
 /** 光标（caret）位置：弹层锚在光标上，而不是输入框左边缘 —— 否则一行长文时弹层会盖住半个视野。
 * 只读地量，不往宿主 DOM 里塞临时节点（那会扰动 Lexical）。 */
    function caretRect(ed) {
      try {
        if (!isText(ed)) {
          var sel = window.getSelection()
          if (sel && sel.rangeCount) {
            var r = sel.getRangeAt(0).cloneRange()
            var rects = r.getClientRects()
            if (rects && rects.length) return rects[rects.length - 1]
            var b = r.getBoundingClientRect()
            if (b && (b.width || b.height || b.top)) return b
          }
        }
      } catch (e) {}
      return ed.getBoundingClientRect()
    }
    function itemsSignature(items) {
      var out = []
      for (var i = 0; i < items.length; i++) out.push(items[i].kind + ':' + items[i].value)
      return out.join('|')
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] })
    }
 /** 命中字符加粗 —— VS Code 的建议列表就是这么标的（位置由服务端 fuzzyScore 给）。 */
    function boldHtml(label, matches) {
      var out = '', at = 0, s = String(label)
      for (var i = 0; i < matches.length; i++) {
        var idx = matches[i]
        if (idx < at || idx >= s.length) continue
        if (idx > at) out += escapeHtml(s.slice(at, idx))
        out += '<b>' + escapeHtml(s[idx]) + '</b>'
        at = idx + 1
      }
      if (at < s.length) out += escapeHtml(s.slice(at))
      return out
    }
 /** 列表右侧那个淡淡的类型词（VS Code 也只在右侧挂一个短类型）。 */
    function kindLabel(it) {
      if (it.src === 'context') return '上下文'
      if (it.src === 'composer') return '本文'
      if (it.kind === 'file') return '文件'
      if (it.kind === 'model') return '模型'
      if (it.kind === 'snippet') return '片段'
      var d = String(it.detail || '')
      if (d.indexOf('标签') >= 0) return '元素'
      if (d.indexOf('属性') >= 0) return '属性'
      if (d.indexOf('关键字') >= 0) return '关键字'
      if (d.indexOf('词表') >= 0) return '词表'
      return ''
    }
 /** 类型图标（VS Code 的建议框左侧就是图标；小方块 + 首字，纯 SVG，不用图片资源）。 */
    function kindIcon(it) {
      var label = kindLabel(it)
      var color = it.kind === 'file' ? '#7aa2f7' : (it.src === 'context' ? '#9ece6a' : (it.kind === 'model' ? '#e0af68' : '#9aa5b1'))
      var ch = label ? label.slice(0, 1) : '·'
      return '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
        '<rect x="0.5" y="0.5" width="11" height="11" rx="2.5" fill="none" stroke="' + color + '" stroke-opacity="0.55"/>' +
        '<text x="6" y="8.6" text-anchor="middle" font-size="7" fill="' + color + '">' + escapeHtml(ch) + '</text></svg>'
    }

 /** 只取**对话正文区**，不取整页（改）。
 * 宿主给的锚点在 0.2.0-rc.2 的 dsh-client-ui-chat 里实测有两处：
 * `[data-conversation-scroll]` 与 `[data-slot="conversation.chat.node"]`。
 * 为什么不读 document.body：左侧栏与设置面板里的词不是「对话内容」，算进候选既跑题，
 * 又会把弹层自己画出来的候选再喂回池子（自我喂养）。抓不到就回空串 —— 上层自然退回只看草稿，
 * 不抛错、不往宿主 DOM 里写任何东西。 */
    function conversationText() {
      try {
        var box = document.querySelector ? document.querySelector('[data-conversation-scroll]') : null
        if (!box || !box.innerText) {
          var node = document.querySelector ? document.querySelector('[data-slot="conversation.chat.node"]') : null
          box = node ? (node.parentNode || null) : null
        }
        var txt = box && box.innerText ? String(box.innerText) : ''
        return txt.length > 40 ? txt.slice(-12000) : ''
      } catch (e) { return '' }
    }

 /** 上下文候选：把**对话正文区**里的标识符挖出来（只读，不动宿主 DOM）。
 * 这是「提示内容跟上下文强关联」的来源：对话里出现过的词，打前缀就能补出来。2 秒缓存。 */
    var ctxCache = { text: '', words: [], at: 0 }
    function contextWords(ed) {
      try {
        var now = Date.now()
        if (now - ctxCache.at < 2000 && ctxCache.words.length) return ctxCache.words
 // 只吃对话正文（不裁剪：实测用 split(草稿) 抠自己人时，
 // 「inst」是「install_quarantine」的子串，会把上下文里的词劈坏）。自己人的重复交给去重处理。
        var text = conversationText()
        var counts = {}, m
 // 汉字词也收（2~8 个连续汉字算一个词）：「文档」「变量」这类中文词不进池子，
 // 光靠英文标识符就永远补不出来（指出）。
        var re = /[A-Za-z_][A-Za-z0-9_]{3,}|[\u4e00-\u9fff]+/g
        var CJK_STOP = { 我们: 1, 你们: 1, 他们: 1, 这个: 1, 那个: 1, 一个: 1, 什么: 1, 怎么: 1,
                         因为: 1, 所以: 1, 然后: 1, 如果: 1, 就是: 1, 可以: 1, 没有: 1, 已经: 1,
                         还是: 1, 但是: 1, 而且: 1, 现在: 1 }
        var STOP = { this: 1, that: 1, with: 1, from: 1, your: 1, have: 1, will: 1, that: 1, there: 1, their: 1, what: 1,
                     when: 1, then: 1, than: 1, they: 1, been: 1, were: 1, void: 1, true: 1, false: 1, null: 1 }
        while ((m = re.exec(text)) !== null) {
          var w = m[0]
          var low = w.toLowerCase()
          if (STOP[low] || CJK_STOP[w]) continue
 // 上下文里也**不把整串汉字当候选**（否则会把整句贴回来）；汉字串只切 2 字词块。
          if (!/^[\u4e00-\u9fff]+$/.test(w)) counts[w] = (counts[w] || 0) + 1
          if (/^[\u4e00-\u9fff]+$/.test(w)) {
            for (var gi = 0; gi + 2 <= w.length && gi < 400; gi++) {
              var g = w.slice(gi, gi + 2)
              if (!CJK_STOP[g]) counts[g] = (counts[g] || 0) + 1
            }
          }
        }
        var words = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1) }).slice(0, 120)
        ctxCache = { text: text, words: words, at: now }
        return words
      } catch (e) { return [] }
    }

 /** 候选选中行：可见的淡蓝底 + 左侧强调条（VS Code 的 activeSelection 观感）。 */
    var SEL_STYLE = 'background:rgba(86,140,224,.22) !important;box-shadow:inset 2px 0 0 0 #4c8dff;'

 /** 显示层折叠（一次反馈）：
 * harness/依赖目录里的文件不展开长路径，只显示 `dsh: <文件名>`；其它类型原样。
 * 只影响**显示**，插进正文的仍是完整路径（it.value）。 */
    var HARNESS_LABEL = /(deepseek[-_]harness|dsh-(fixes|kit|shim|020rc2|017)|node_modules|(^|\/)plugins\/)/i
    function foldLabel(it) {
      var v = String(it.value || '')
      if (it.kind !== 'file' || !HARNESS_LABEL.test(v)) return v
      var base = v.slice(v.lastIndexOf('/') + 1)
      return 'dsh: ' + base
    }

 /* 标红画在**文字底下**（每一行的文字框底边），不是输入框底边：
  * 输入框底边离文字约 27px，看起来像给整个框描一道线，和「这个词有问题」无关。
  * 用固定定位的覆盖层逐行画，不动宿主 DOM（Lexical 会重建节点、也会把行内样式冲掉）。 */
    var warnLayer = null, warnKey = ''
    function ensureWarnLayer() {
      if (warnLayer && warnLayer.parentNode) return warnLayer
      var exist = document.getElementById('dce-quote-warn-layer')
      if (exist) { warnLayer = exist; return exist }
      var d = document.createElement('div')
      d.id = 'dce-quote-warn-layer'
      d.setAttribute('data-dsh-plugin', 'dsh-composer-ease')
      d.setAttribute('aria-hidden', 'true')
      d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147479990'
      document.body.appendChild(d)
      warnLayer = d
      return d
    }
    function paintQuoteWarn(ed, idx) {
      try {
        var layer = ensureWarnLayer()
        if (idx === undefined || idx < 0) { if (layer.childNodes.length) layer.innerHTML = ''; warnKey = ''; return }
        var box = composerOf(ed) || ed
 // 只量**那一个字符**的盒子：一行里只有这个引号没闭合，画整行会让人以为整句都错了。
        var rect = null
        var walker = document.createTreeWalker(box, 4 /* SHOW_TEXT */, null)
        var node, acc = 0
        while ((node = walker.nextNode())) {
          var len = (node.nodeValue || '').length
          if (idx < acc + len) {
            var r = document.createRange()
            var at = idx - acc
            r.setStart(node, at)
            r.setEnd(node, Math.min(len, at + 1))
            var rects = r.getClientRects()
            if (rects && rects.length) rect = rects[0]
            break
          }
          acc += len
        }
        if (!rect) { if (layer.childNodes.length) layer.innerHTML = ''; return }
        var sig = Math.round(rect.left) + ',' + Math.round(rect.bottom) + ',' + Math.round(rect.width)
        if (sig === warnKey) return
        warnKey = sig
        layer.innerHTML = ''
        var wave = document.createElement('div')
        wave.style.cssText = 'position:fixed;left:' + Math.round(rect.left) + 'px;top:' + Math.round(rect.bottom - 3) + 'px;' +
          'width:' + Math.max(6, Math.round(rect.width)) + 'px;height:4px;background-repeat:repeat-x;background-position:left top;' +
          'background-size:8px 4px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'4\'><path d=\'M0 3 Q2 0 4 3 T8 3\' fill=\'none\' stroke=\'%23e5534b\' stroke-width=\'1.2\'/></svg>")'
        layer.appendChild(wave)
      } catch (e) {}
    }
    function renderPopup(anchor, force) {
      var d = ensurePopup()
      var sig = itemsSignature(popup.items) + '#' + (popup.wm ? popup.wm.text + popup.wm.angle : '')
      if (!force && popup.open && sig === popup.sig) return   // 列表没变就别重画：打字快时不再抖
      popup.sig = sig
      d.innerHTML = ''
 // 语言水印（定的口径）：不再在顶上写「据对话推断 · java」那种句子，
 // 只把**语言词表的语言名**做成底纹压在右下角，斜排、透明；语言越多越斜，封顶 45°。
 // 纯装饰：不吃点击、不进无障碍树，没有语言时整块不渲染。
      if (popup.wm && popup.wm.text) {
        var wm = document.createElement('div')
        wm.setAttribute('data-dsh-cp-wm', '1')
        wm.setAttribute('aria-hidden', 'true')
        wm.style.cssText = 'position:absolute;right:6px;bottom:2px;pointer-events:none;user-select:none;' +
          'transform:rotate(-' + popup.wm.angle + 'deg);transform-origin:right bottom;' +
          'font-size:18px;font-weight:700;letter-spacing:.04em;line-height:1;white-space:nowrap;' +
          'opacity:.15;color:var(--dsw-alias-label-primary,currentColor)'
        wm.textContent = popup.wm.text
        d.appendChild(wm)
      }
      popup.items.forEach(function (it, i) {
        var row = document.createElement('div')
        var label = foldLabel(it)
        var m = (it.matches && it.matches.length) ? it.matches : null
 // 布局照 VS Code：左边类型图标、中间标签（命中字符加粗）、**右边**淡类型词——
 // 类型信息一律在右侧，不会跑到候选名前面去（提的排版问题）。
        row.innerHTML = '<span style="flex:0 0 auto;line-height:0">' + kindIcon(it) + '</span>' +
          '<span style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (m ? boldHtml(label, m) : escapeHtml(label.length > 60 ? label.slice(0, 57) + '…' : label)) + '</span>' +
          '<span style="flex:0 0 auto;opacity:.4;font-size:11px;font-weight:400;margin-left:8px">' + escapeHtml(kindLabel(it)) + '</span>'
 // 选中态自己给一套看得见的样式：主题的 interactive-bg-hover 实测是 rgba(38,49,72,.06)，
 // 深色背景下等于没有（上下键改了选中也看不出来）。
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;' +
          (i === popup.index ? SEL_STYLE : '')
 // 用**被点这一行**的下标接受：早先只读 popup.index（靠悬停更新），
 // 没有 hover 时点任何一行都等于接受第一条（报「点击提示框没反应」）。
        row.onmousedown = function (ev) { ev.preventDefault(); popup.index = i; acceptCurrent() }
 // 悬停只换高亮：早先这里调 renderPopup 重建整层，鼠标一进去脚下的节点就被换掉，
 // mousedown 落不到稳定节点 → 「点击提示框没反应」（）。
        row.onmouseenter = function () {
          if (popup.index === i) return
          popup.index = i
          showGhost(anchor)          // 悬停换选中，行内预览同步（与方向键同一口径）
          var kids = d.children
          for (var kk = 0; kk < kids.length; kk++) {
            kids[kk].style.cssText = kids[kk].style.cssText.split(SEL_STYLE).join('') + (kk === i ? SEL_STYLE : '')
          }
        }
        d.appendChild(row)
      })
      if (anchor) {
        var caret = caretRect(anchor)
        var vw = window.innerWidth, vh = window.innerHeight
 // 宽度固定一档（不随候选长短抖），高度封顶，超出滚动 —— VSCode 建议框也是这个路子
        var width = Math.round(Math.min(520, Math.max(300, vw * 0.36)))
        var maxH = Math.round(Math.min(260, Math.max(140, vh * 0.3)))
        d.style.width = width + 'px'
        d.style.maxWidth = 'none'
        d.style.maxHeight = maxH + 'px'
        d.style.left = Math.max(8, Math.min(Math.round(caret.left), vw - width - 8)) + 'px'
        var roomBelow = vh - Math.round(caret.bottom)
        if (roomBelow >= maxH + 24) {          // 下面放得下就放下边（VSCode：优先光标下方）
          d.style.top = Math.round(caret.bottom + 6) + 'px'
          d.style.bottom = 'auto'
        } else {                               // 放不下才翻到上方，并贴住光标那一行
          d.style.bottom = Math.max(8, vh - Math.round(caret.top) + 6) + 'px'
          d.style.top = 'auto'
        }
      }
      d.style.display = 'block'
      popup.open = true
    }
 /* 行内提示（VSCode 的 inline suggestion 手感，原话「可以在前面添加类似 abc 的提示」）：
 * 首位候选比已打的前缀多出来的那截，用灰字贴在光标后面；不往宿主 DOM 里插节点，只浮一个 div。 */
    var ghost = { el: null }
    function ensureGhost() {
      if (ghost.el) return ghost.el
      var existG = document.getElementById('dsh-cp-ghost')
      if (existG) { ghost.el = existG; return existG }
      var d = document.createElement('div')
      d.id = 'dsh-cp-ghost'
      d.setAttribute('data-dsh-plugin', 'dsh-composer-ease')
      d.style.cssText = 'position:fixed;z-index:2147479999;display:none;pointer-events:none;white-space:pre;' +
        'color:var(--dsw-alias-label-secondary,rgba(165,175,190,.8));opacity:.8'
      document.body.appendChild(d)
      ghost.el = d
      return d
    }
    function hideGhost() { if (ghost.el) ghost.el.style.display = 'none' }
    function showGhost(ed, token) {
      if (!popup.open) return hideGhost()   // 浮层已经收了就别再出灰字（回车后迟到的响应会走到这里）
      try {
 // **跟着选中项走**（一次反馈）。
 // 早先固定取 items[0]，所以上下键改了选中、行内灰字不动 —— VS Code 的 suggest.preview 是随选中变化的。
        var it = popup.items[popup.index] || popup.items[0]
        var v = it ? String(it.value || '') : ''
 // token 缺省时从光标处现取：悬停/方向键这两条路手上没有 prefix 参数。
        var t = String(token == null ? tokenBefore(textBeforeCaret(ed)) : token)
        if (!t || !v || v.slice(0, t.length).toLowerCase() !== t.toLowerCase()) return hideGhost()
        var rest = v.slice(t.length)
        if (!rest || rest.length > 48) return hideGhost()
        var d = ensureGhost()
        var r = caretRect(ed)
        d.textContent = rest
        try { d.style.font = window.getComputedStyle(ed).font } catch (e) {}
        d.style.left = Math.round(r.left) + 'px'
        d.style.top = Math.round(r.top) + 'px'
        d.style.display = 'block'
      } catch (e) { hideGhost() }
    }

 /* 「弹层代数」：每次 closePopup 就 +1。
 * 一次反馈——
 * 真因是候选请求的 .then 在回车清场**之后**才回来，把浮层与灰字又画了一遍。
 * 发请求那一刻记下代数，响应回来对不上就直接丢弃，别去猜"还能不能画"。 */
    var popupEpoch = 0
    function closePopup() { popupEpoch++; if (popup.root) popup.root.style.display = 'none'; popup.open = false; popup.items = []; popup.sig = ''; lastSelText = ''; hideGhost() }
    var lastPrefix = null, inflight = 0

 /** 草稿里已有的单词（VSCode word based suggestions 的口径：标识符形状、长度≥3、按出现次数排）。 */

// ── 模块：语言判定与候选拉取 ────────────────────────────────
// docWords、语言投票与语言水印、fetchCandidates（本地词先上屏、网络回来再合并）。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function docWords(text, token) {
      var t = String(token || '').toLowerCase()
      if (!t) return []
      var counts = {}, m
 // 英文标识符 + 连续汉字词（2~8 字）都收；普通长串再补一个 2 字前缀，
 // 这样「文档里的变量」里也能提出「文档」（要的「像提示变量那样」）。
      var re = /[A-Za-z_][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]+/g
      var CJKONLY = /^[\u4e00-\u9fff]+$/
      while ((m = re.exec(String(text || ''))) !== null) {
        var w = m[0]
        if (w.toLowerCase() === t) continue
 // 整串汉字（「上好今天早上好」这种）不当候选：它是句子不是词，提示出来等于把整段话贴回给你。
 // 汉字串只出 2~4 字词块，见下面的切片。
        if (!CJKONLY.test(w)) counts[w] = (counts[w] || 0) + 1
        if (CJKONLY.test(w)) {
 // 中文没有空格分词：把每个连续汉字串拆成二元组/三元组，
 // 「先写一段关于文档的说明」里才能提出「文档」（草稿范围小，代价可忽略）。
          for (var ci = 0; ci + 2 <= w.length && ci < 400; ci++) {
            var g2 = w.slice(ci, ci + 2)
            if (g2 !== t) counts[g2] = (counts[g2] || 0) + 1
            if (ci + 3 <= w.length) {
              var g3 = w.slice(ci, ci + 3)
              if (g3 !== t) counts[g3] = (counts[g3] || 0) + 1
            }
            if (ci + 4 <= w.length) {
              var g4 = w.slice(ci, ci + 4)
              if (g4 !== t) counts[g4] = (counts[g4] || 0) + 1
            }
          }
        }
      }
      return Object.keys(counts)
        .filter(function (w) { return w.toLowerCase().indexOf(t) === 0 })
        .sort(function (a, b) { return counts[b] - counts[a] || a.length - b.length || (a < b ? -1 : 1) })
        .slice(0, 5)
        .map(function (w) {
          var pos = []
          for (var i = 0; i < t.length; i++) pos.push(i)   // 前缀命中：把已打的那几个字符加粗
          return { kind: 'word', value: w, detail: '本文', src: 'composer', matches: pos }
        })
    }

 /** 草稿里最近一个围栏标记（```js / ```python）当语言提示；没有就交给服务端上公共词表。 */
    function langHint(text) {
      var m = String(text || '').match(/```([A-Za-z0-9+#._-]{1,12})/g)
      return m && m.length ? m[m.length - 1].slice(3) : ''
    }

    function composerText(ed) {
      try { return isText(ed) ? ed.value : String((composerOf(ed) || ed).innerText || '') } catch (e) { return '' }
    }

 /** 语言投票：返回语言 + 票数 + 命中明细。
 * 同一份投票既决定「上哪张词表」，也决定弹层顶上那行出处（
 * 「编程语言要和上下文有关联、并让人看见依据」）。票数低于 2 一律判不定。 */
    var LANG_RULES = [
      ['python', /\b(def|import|from|elif|lambda|None|True|False|self)\b/g, 1],
      ['python', /\.py\b|\bpip\b|\bpytest\b|\bvenv\b/g, 2],
      ['javascript', /\b(const|let|var|function|=>|async|await|module\.exports|require)\b/g, 1],
      ['javascript', /\.(js|mjs|ts|tsx|json)\b|\bnpm\b|\bnode\b/g, 2],
      ['html', /<\/?[a-z][a-z0-9-]*\b|\bclass=|\bid=|<\/div>|\b<!doctype\b/gi, 2],
      ['css', /\b(color|display|margin|padding|font-size|background)\s*:|\{[^}]*:[^}]*\}/g, 1],
      ['java', /\b(public|private|protected|void|static|implements|extends|new|String)\b|@Override|System\.out|String\[\]/g, 1]
    ]
    function inferLangVote(text) {
      var t = String(text || '')
      if (!t) return { lang: '', top: 0, hits: {} }
      var score = {}, hits = {}
      for (var i = 0; i < LANG_RULES.length; i++) {
        var m = t.match(LANG_RULES[i][1])
        if (!m) continue
        score[LANG_RULES[i][0]] = (score[LANG_RULES[i][0]] || 0) + m.length * LANG_RULES[i][2]
        hits[LANG_RULES[i][0]] = (hits[LANG_RULES[i][0]] || 0) + m.length
      }
      var best = '', top = 0, ranking = []
      for (var k in score) {
        if (score[k] > top) { top = score[k]; best = k }
        if (score[k] >= 2) ranking.push({ lang: k, score: score[k] })
      }
      ranking.sort(function (a, b) { return b.score - a.score || (a.lang < b.lang ? -1 : 1) })
      return { lang: top >= 2 ? best : '', top: top, hits: hits, ranking: ranking }
    }

 /** 语言水印（口径）：只写**语言名**，不写「据对话推断」这类句子；
 * 斜角随语言种数增长、封顶 45°（1→14°、2→26°、3→38°、4 及以上→45°）。没有语言就返回 null。 */
    function watermarkFor(langs) {
      var list = (langs || []).filter(Boolean).slice(0, 4)
      if (!list.length) return null
      return { text: list.join(' · '), angle: Math.min(45, 14 + 12 * (list.length - 1)) }
    }

 /** 从**上下文文本**（草稿 + 对话正文）推语言：围栏之外的第二条腿。 */
    function inferLang(text) { return inferLangVote(text).lang }

    function fetchCandidates(prefix, ed) {
      var draft = composerText(ed)
      var prefixList = [String(prefix || '')]
      if (/^[\u4e00-\u9fff]+$/.test(prefixList[0])) {
        for (var pl2 = 4; pl2 >= 2; pl2--) if (prefixList[0].length >= pl2) prefixList.push(prefixList[0].slice(-pl2))
      }
      var local = [], seenDraft = {}
      for (var di = 0; di < prefixList.length; di++) {
        var batch = docWords(draft, prefixList[di])
        for (var bi = 0; bi < batch.length; bi++) {
          var key = batch[bi].value.toLowerCase()
          if (seenDraft[key]) continue
          seenDraft[key] = 1
          local.push(batch[bi])
        }
        if (local.length >= 6) break     // 短前缀够用了就别再往更短的找
      }
      var fenced = langHint(draft)
      if (fenced) habitBump(fenced, 1)
      var ctxWords = contextWords(ed)
 // 投票用**对话原文**（不是去重后的词表）：词表是集合，`System.out` / `@Override` 这种
 // 带标点的语言指纹在切词时就被劈掉了，而且词频信息也丢了。原文截尾 4000 字够用。
      var ctxRaw = String(ctxCache.text || '').slice(-4000)
 // 语言优先级：围栏 → 上下文推断（草稿 + 对话正文）→ 习惯
      var vote = inferLangVote(draft + ' ' + ctxRaw)
      var lang = fenced || vote.lang || habitTop()
 // 语言水印（替代原来顶上那行「据对话推断 · java」）：只写语言名，斜排压在右下角。
 // 围栏时只报围栏那一个语言；否则报投票过线的语言，按票数从高到低，最多 4 个。
      var wmLangs = fenced ? [fenced]
        : (vote.ranking && vote.ranking.length ? vote.ranking.map(function (r) { return r.lang })
          : (lang ? [lang] : []))
      popup.wm = watermarkFor(wmLangs)
 // 上下文候选：对话里出现过的标识符按前缀补出来（跟上下文强关联的那一路）
 // 中文没有分词：整段汉字会被当成一个 token，所以按「1~4 字后缀」各试一次（长的优先），
 // 打「文」也能命中草稿里更早出现的「文档」（原话要求）。
      var p0 = String(prefix || '')
      var pfxList = [p0]
      if (/^[\u4e00-\u9fff]+$/.test(p0)) {
        for (var pl = 4; pl >= 2; pl--) if (p0.length >= pl) pfxList.push(p0.slice(-pl))
      }
      var ctxItems = []
      var seenLocal = {}
      local.forEach(function (i) { seenLocal[i.value.toLowerCase()] = 1 })
      ctxWords.forEach(function (w) {
        if (ctxItems.length >= 5) return
        var lw = w.toLowerCase()
        if (seenLocal[lw]) return
        for (var qi = 0; qi < pfxList.length; qi++) {
          var q = pfxList[qi].toLowerCase()
          if (!q || lw === q || lw.indexOf(q) !== 0) continue
          seenLocal[lw] = 1
          var pos = []
          for (var k = 0; k < q.length; k++) pos.push(k)
          ctxItems.push({ kind: 'word', value: w, detail: '上下文', src: 'context', matches: pos })
          return
        }
      })
      // ctx words lead only for prefix >= 3 (or CJK): a 2-char prefix must not be hijacked
      // by a word that merely appeared in the draft (measured: de led with DeepSeek).
      var ctxLead = /^[\u4e00-\u9fff]/.test(String(prefix || '')) || String(prefix || '').length >= 3
      var first = ctxLead ? local.concat(ctxItems) : local.slice()
      var cjkPrefix = /^[\u4e00-\u9fff]/.test(String(prefix || ''))
 // 中文要等服务端的「完整词义」闸：碎片连本地词都不许先上屏（否则会闪一下又不算数）
      if (first.length && !cjkPrefix) { popup.items = first; popup.index = 0; renderPopup(ed) }
      inflight++
      var seq = inflight
      var ep = popupEpoch        // 发请求时的代数：期间被关掉（回车发送/失焦/碎片闸）就作废这次响应
      fetch(ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&lang=' + encodeURIComponent(lang))
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (seq !== inflight) return // 后发先至的旧响应丢掉（补全弹层最怕错位）
          if (ep !== popupEpoch) return // 迟到的响应不许把已经收起来的浮层/灰字复活
 // 服务端判定这不是完整词义（碎片）→ 整条收起，连本地/上下文候选都不出
          if (d && d.wordGate === false) { closePopup(); return }
          var items = local.slice(), seen = {}
          local.forEach(function (i) { seen[i.value] = 1 })
 // 同一规则作用在 fetch 返回后的最终合并上（首屏那次只是占位）：短前缀下 ctx 词
 // 排在服务端候选**之后**，否则 DeepSeek 这类草稿词还是会顶掉 def/delete。
 var ctxList = ctxLead ? ctxItems : []
 ctxList.forEach(function (c) { if (!seen[c.value]) { seen[c.value] = 1; items.push(c) } })
 if (d && d.ok === true) (d.candidates || []).forEach(function (c) { if (c && !seen[c.value]) { seen[c.value] = 1; items.push(c) } })
 if (!ctxLead) ctxItems.forEach(function (c) { if (!seen[c.value]) { seen[c.value] = 1; items.push(c) } })
 // 类型开关：在**合并这一处**滤掉，后面的索引 / 灰字 / Tab 都跟着同一份列表
          items = items.filter(function (x) { return isKindOn(x.kind) })
          if (!items.length) { closePopup(); return }
          popup.items = items.slice(0, 12); popup.index = 0; renderPopup(ed); showGhost(ed, prefix)
        })
        .catch(function () { if (ep === popupEpoch && !first.length) closePopup() })
    }

// ── 模块：设置项（严格配对 / 引号模式 / 候选类型预设）──────────────────
// 从 70-input.js 拆出来的（加完候选类型预设后那个片段到 411 行，超结构闸的 400 上限）。
// 只放「存哪儿 + 怎么读 + 预设怎么切」，不碰事件处理。

    var PAIR_STRICT_KEY = 'dsh-composer-ease:pairStrict'
    function pairStrict() {
      try { return window.localStorage.getItem(PAIR_STRICT_KEY) === '1' } catch (e) { return false }
    }
    function setPairStrict(on) {
      try { window.localStorage.setItem(PAIR_STRICT_KEY, on ? '1' : '0') } catch (e) {}
    }

 /* 引号模式（）：'warn' = 不自动补闭引号，未闭合时标红提示（VS Code 的
 * 「标红而不是硬改」口径，默认）；'auto' = 老行为，打一个引号补一对。 */
 /* 候选类型开关（等价 VS Code `suggest.show*` 一族里插件有的四类）：
 * 存「关掉哪些」，默认全开；过滤在候选合并那一处做，索引/灰字/Tab 都跟着同一份列表。 */
    var KIND_KEY = 'dsh-composer-ease:kinds-off'
    var ALL_KINDS = [['word', '词'], ['file', '文件'], ['model', '模型'], ['snippet', '片段']]
    function kindsOff() {
      try { var a = JSON.parse(window.localStorage.getItem(KIND_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] }
    }
    function isKindOn(k) { return kindsOff().indexOf(k) < 0 }
    function toggleKind(k) {
      var off = kindsOff(), i = off.indexOf(k)
      if (i >= 0) off.splice(i, 1); else off.push(k)
      try { window.localStorage.setItem(KIND_KEY, JSON.stringify(off)) } catch (e) {}
    }

 /* 候选类型**预设**：不把四个开关摊成四行（`/` 菜单里太费），一行循环切换。
 * 组合仍是四个 kind 的开关，所以手改 localStorage 的 kinds-off 依然有效。 */
    var KIND_PRESETS = [
      { label: '全部', off: [] },
      { label: '无文件', off: ['file'] },
      { label: '只有词', off: ['file', 'snippet', 'model'] },
      { label: '全关', off: ['word', 'file', 'model', 'snippet'] },
    ]
    function kindPresetIndex() {
      var off = kindsOff().slice().sort().join(',')
      for (var i = 0; i < KIND_PRESETS.length; i++) {
        if (KIND_PRESETS[i].off.slice().sort().join(',') === off) return i
      }
      return -1          // 手工组合：不属于任何预设
    }
    function kindPresetLabel() {
      var i = kindPresetIndex()
      return i >= 0 ? KIND_PRESETS[i].label : '自定义'
    }
    function kindPresetDesc() {
      var i = kindPresetIndex()
      if (i < 0) return '自定义组合（' + ALL_KINDS.filter(function (k) { return isKindOn(k[0]) }).map(function (k) { return k[1] }).join('+') + '）'
      return i === 0 ? '词 + 文件 + 模型 + 片段 全开'
        : i === 1 ? '词 + 模型 + 片段（文件路径不进候选）'
        : i === 2 ? '只留词（词典 / 关键字 / 本机词）'
        : '四类全关（等于关掉补全）'
    }
    function kindPresetNextLabel() {
      var i = kindPresetIndex()
      return KIND_PRESETS[(i + 1) % KIND_PRESETS.length].label
    }
    function cycleKindPreset() {
      var next = KIND_PRESETS[(kindPresetIndex() + 1) % KIND_PRESETS.length]
      try { window.localStorage.setItem(KIND_KEY, JSON.stringify(next.off)) } catch (e) {}
    }

    var QUOTE_MODE_KEY = 'dsh-composer-ease:quoteMode'
 // 默认 auto：没有选区、前方也没有未闭合引号时，单独打一个引号就该得到一对。
 // 标红模式退成显式开关（/ 菜单里切），不再默认关掉配对。
    function quoteMode() {
      try { return window.localStorage.getItem(QUOTE_MODE_KEY) === 'warn' ? 'warn' : 'auto' } catch (e) { return 'auto' }
    }
    function setQuoteMode(m) {
      try { window.localStorage.setItem(QUOTE_MODE_KEY, m === 'auto' ? 'auto' : 'warn') } catch (e) {}
    }

 /* ── / 菜单：三行设置什么时候出、命令名怎么补 ───────────────────────
 * 宿主那侧只用子序列打分（dsh-web-frontend 里的 rankByName）：/comp 出 compact，
 * 但 /compot 这种错拼的子序列会断（整组只剩本插件那三行）。
 * 所以：① 三行也按 query 过滤，别在宿主那组消失后还赖在菜单里；
 * ② 错拼的兜底行由宿主的命令表来补（rescueRows），插件自己不解命令。 */
    function looseScore(query, text) {
      var q = String(query || '').toLowerCase(), t = String(text || '').toLowerCase()
      if (!q) return 0
      if (!t) return -1
      if (t.indexOf(q) === 0) return 1000 - Math.min(999, t.length - q.length)   // 前缀命中
      var at = t.indexOf(q)
      if (at > 0) return 800 - Math.min(799, at)                                  // 中段连续命中
      var ti = 0, hit = 0
      for (var qi = 0; qi < q.length; qi++) {
        var ch = q.charAt(qi)
        while (ti < t.length && t.charAt(ti) !== ch) ti++
        if (ti >= t.length) return -1                                             // 子序列也断：不命中
        ti++; hit++
      }
      return 400 + hit
    }
 /** 错拼容忍：正常命中一律不算（返回 -1），只有「跳过 ≤2 个查询字符、≤2 个目标字符」
 * 才给分数。实测 /compot → compact 恰好是跳 1 个查询字符（o）、2 个目标字符（a c）。 */
    function typoScore(query, text) {
      var q = String(query || '').toLowerCase(), t = String(text || '').toLowerCase()
      if (!q || !t || looseScore(q, t) >= 0) return -1
      var qi = 0, ti = 0, skipQ = 0, skipT = 0, hit = 0
      while (qi < q.length) {
        if (ti >= t.length) { skipQ += q.length - qi; break }
        if (q.charAt(qi) === t.charAt(ti)) { qi++; ti++; hit++; continue }
        var ahead = t.indexOf(q.charAt(qi), ti)
        if (ahead >= 0 && ahead - ti <= 2 && skipT + (ahead - ti) <= 2) { skipT += ahead - ti; ti = ahead; continue }
        skipQ++; qi++
        if (skipQ > 2) return -1
      }
      return hit >= 3 ? hit : -1
    }
 /** 三条设置行（定的口径：/ 菜单是操作入口不是设置面板，一行一条、点一下切一档）。 */
    function settingsRows() {
      var on = pairStrict()
      var qm = quoteMode()
      return [
        {
          name: '引号模式',
          label: qm === 'auto' ? '引号模式：自动补对' : '引号模式：标红提示',
          description: qm === 'auto'
            ? '当前：自动补对（打一个引号补一对；严格配对关时右侧有文字则只插一个）'
            : '当前：标红提示（默认；引号未闭合时输入框标红，不替你补）',
          hint: qm === 'auto' ? '点击改为标红提示' : '点击改为自动补对',
        },
        { name: '候选类型',
          label: '候选类型：' + kindPresetLabel(),
          description: '当前：' + kindPresetDesc(),
          hint: '点击切到：' + kindPresetNextLabel() },
        {
          name: '严格配对',
          label: '严格配对',
          description: on ? '当前：开（引号必须前后成对，混全角半角也算一对）' : '当前：关（默认，遇到已有引号就不再补对）',
          hint: on ? '点击关闭' : '点击开启',
        },
      ]
    }
 /** 取不到宿主命令表时的兜底：本机只有这三条内置命令（dsh-command-compact/goal/feedback）。 */
    var BUILTIN_COMMANDS = [['compact', '压缩上下文'], ['goal', '目标'], ['feedback', '反馈']]
 /** 错拼兜底行：宿主那份排名没排出来的命令，按「跳字」判据补一行（正常拼写不重复出）。 */
    function rescueRows(query, host, leading) {
      var q = String(query || '')
      if (!q) return []
      var matched = {}
      var seen = host && host.matched ? host.matched : []
      for (var i = 0; i < seen.length; i++) if (seen[i] && seen[i].name) matched[seen[i].name] = 1
      var pool = (host && host.all && host.all.length) ? host.all : BUILTIN_COMMANDS.map(function (c) {
        return { name: c[0], label: c[1] }
      })
      var out = []
      for (var j = 0; j < pool.length; j++) {
        var r = pool[j]
        if (!r || !r.name || matched[r.name]) continue       // 宿主已经排出来的行不再重复
 // 与宿主同一条位置判据：带输入提示的命令只在行首列（行内打 / 时不列）
        if (!leading && r.hint) continue
        var score = Math.max(typoScore(q, r.name), typoScore(q, r.label || ''))
        if (score < 0) continue
        out.push({
          name: r.name,
          label: '/' + r.name + (r.label ? '　' + r.label : ''),
          description: String(r.description || ''),
          hint: '错拼兜底',
          rescue: r.name,
        })
        if (out.length >= 3) break
      }
      return out
    }
    function triggerBasename(rel) {
      var t = String(rel || '')
      var i = t.lastIndexOf('/')
      return i >= 0 ? t.slice(i + 1) : t
    }

 /** 直接问一次只读路由，拿原始候选（不做 DOM 渲染，供触发源用）。 */
    function fetchItems(prefix) {
      var url = ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&lang='
      return fetch(url).then(function (r) { return r.json() }).then(function (d) {
        return d ? (Array.isArray(d.candidates) ? d.candidates : (Array.isArray(d.items) ? d.items : [])) : []
      }).catch(function () { return [] })
    }

// ── 模块：光标复位与接受 ────────────────────────────────
// placeCaretVerified / flushCaretFix / afterPairCheck / ensureCaretAt：插入后把光标放回该在的位置，以及 acceptCurrent。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var suppressInput = 0   // 我们自己插入文本后会派发 input；别让它回来又开一次弹层（连按即滚雪球）
    var caretEpoch = 0      // 每次按键 +1；延后的光标复位只认最后一次
 /* IME 合成中：拼音还没上屏，这时候的拉丁字母不是「输入内容」，不能触发补全。
 * 实测：打拼音 `ye` 时 JS 关键字 `yield` 被前缀命中，弹层＋灰字 `eld`
 * 盖在输入法候选窗旁边。VS Code 同样在 composition 期间不出建议。 */
    var composing = false
 /* 光标复位要**跨帧校验**：实测（demo 3081）配对后只调一次 `setSelectionRange`
 * 会被 Lexical 随后的一次重渲染冲掉 —— 空框打 `"` 拿到 `""` 但 caret 停在 0（开符之前），
 * 于是接着打字打到引号外面、连按第三下也被当成「跳过闭符」吞掉。
 * 这里按绝对偏移写几次，每次都读回来确认；期间只要又按了键（caretEpoch 变）就立刻放手，
 * 不去跟用户抢光标。文本域是同步的，写一次就返回。 */
  /* 光标复位：时机由 **Lexical 的 DOM 变化**来定，不能猜 —— 插件插入的文本节点在 microtask / rAF /
   * `setTimeout 0` 那一刻都还不存在，约 2ms 后才出现。盲目撒定时器两头出错：等不到那一格会被输入法
   * 上屏抢先（文字落到闭符外面），长尾回调又会在用户打完字后把光标拽回原位。
   * 做法：MutationObserver 等文本落地，再用**文本护栏**（`expect`）判断有没有人插手。 */
    var caretFix = null
    var caretObserver = null, caretObserverTarget = null
    function ensureCaretObserver(ed) {
      if (typeof MutationObserver === 'undefined') return
      try {
        if (caretObserver && caretObserverTarget === ed) return
        if (caretObserver) caretObserver.disconnect()
        caretObserver = new MutationObserver(function () { flushCaretFix() })
        caretObserver.observe(ed, { childList: true, subtree: true, characterData: true })
        caretObserverTarget = ed
      } catch (e) { caretObserver = null }
    }
    function flushCaretFix() {
      var f = caretFix
      if (!f) return
      if (f.epoch !== caretEpoch) { caretFix = null; return }     // 期间有按键/输入法接管：放手
      if (f.tries === undefined) f.tries = 0
      var now
      try { now = textOf(f.ed) } catch (e) { return }
      if (now !== f.expect) {
        if (now.length < f.expect.length) return                  // 自己的插入还没落地，等下一次 mutation
        caretFix = null; return                                   // 文本被别人改过：不猜，放手
      }
      var at = -1
      try {
        if (caretPos(f.ed) !== f.target) setCaret(f.ed, f.target)
        at = caretPos(f.ed)
      } catch (e) { at = -1 }
 /* **要连续两拍都读到目标位置、而且文本没再变**才算落地：
 * Lexical 的重渲染比插件的写入晚一拍（实测 ~2ms），只写一次会被它冲掉 ——
 * 那正是「空框打全角开符，配对后光标停在闭符之后」的实测值来源。 */
      if (at === f.target && f.lastText === now) f.stable = (f.stable || 0) + 1
      else f.stable = 0
      f.lastText = now
      if (f.stable >= 2) {
        caretFix = null
        if (typeof f.then === 'function') { try { f.then() } catch (e) {} }   // 落地后的复核
        return
      }
      if (++f.tries < 10) soon(flushCaretFix)
      else caretFix = null
    }
 /** 配对之后的**结果复核**：按「落地后的真文本」把判据重算一遍。
 * 读到的状态可能是旧的（Lexical 重渲染的空窗），但结果不能跟着旧走 ——
 * 本该「只插一个」的，就把多出来的闭符撤掉。判据在真文本上成立时这个函数什么都不做
 * （这正是正常路径），只在读到旧状态时才纠正。 */
    function afterPairCheck(ed, open, close, atOpen) {
      return function () {
        try {
          var t = textOf(ed)
          if (t.slice(atOpen, atOpen + 2) !== open + close) return   // 已经不是我们插的那一对了
          var b = t.slice(0, atOpen), n = t.charAt(atOpen + 2)
          if (!isUnbalancedBefore(b, open, close) && shouldPair(b, n, open)) return
          suppressInput++
          deleteAt(ed, atOpen + 1)                                   // 撤掉闭符 → 只剩一个开符
          placeCaretVerified(ed, atOpen + 1, t.slice(0, atOpen + 1) + t.slice(atOpen + 2))
          ensureCaretAt(ed, atOpen + 1)
        } catch (e) {}
      }
    }
 /** 插一段文本：优先用粘贴事件（Lexical 把它当一次原子编辑，落点稳定），不行再 execCommand。
 * 专门给"配对"这种紧跟下一键的场景用。 */
    function insertAtomic(ed, text) {
      var handled = false
      try {
        var dt = new DataTransfer()
        dt.setData('text/plain', text)
        var evPaste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
        handled = ed.dispatchEvent(evPaste) === false
      } catch (e) { handled = false }
      if (!handled) insertText(ed, text)
    }

 /** 读**实际**光标在编辑器纯文本里的偏移；读不到回 -1。 */
    function caretOffsetNow(ed) {
      try {
        if (isText(ed)) return ed.selectionStart
        var sel = window.getSelection()
        if (!sel || !sel.rangeCount) return -1
        var r = sel.getRangeAt(0)
        if (!r.collapsed) return -1
        var pre = document.createRange()
        pre.selectNodeContents(ed)
        pre.setEnd(r.startContainer, r.startOffset)
        return textLenOf(pre.cloneContents())
      } catch (e) { return -1 }
    }

 /** 把光标按**实际偏移**钉到 target：不对就硬设，再按梯子复验几拍。
 * 配对那条路不能只信"预期偏移"——编辑器可能自己挪过光标（全角引号就是这种情况）。 */
    function ensureCaretAt(ed, target, tries) {
      var left = tries === undefined ? 3 : tries
      var step = function (n) {
        if (target < 0) return
        if (caretOffsetNow(ed) === target) return
        try { setSelectionRange(ed, target, target) } catch (e) {}
 // 让编辑器（Lexical）把模型选区也同步过来，否则下一键会按它自己的模型落字
        try { document.dispatchEvent(new Event('selectionchange')) } catch (e2) {}
        if (n > 0) soon(function () { step(n - 1) })
      }
      step(left)
    }

 /** 把光标放到 target，但要等 `expect` 这段文本落地之后才动手。
 * `expect` = 插件自己这一次插入完成后的**整段文本**；文本长度更短＝还没落地（继续等），
 * 内容对不上＝别人（用户/输入法）插手了（放手，绝不抢光标）。
 * `then` = 落地后跑一次的复核。 */
    function placeCaretVerified(ed, target, expect, then) {
      if (target < 0) return
      var epoch = ++caretEpoch
      if (isText(ed)) {
        try { ed.selectionStart = ed.selectionEnd = target } catch (e) {}
        if (typeof then === 'function') { try { then() } catch (e) {} }
        return
      }
      caretFix = { ed: ed, target: target, expect: String(expect === undefined ? '' : expect), epoch: epoch, then: then }
      ensureCaretObserver(ed)
      flushCaretFix()                                   // 文本已经在位的情况（跳闭符那条路没有文本变化）
      soon(function () {                                  // 兜底：万一等不到 mutation
        if (caretFix && caretFix.epoch === caretEpoch) flushCaretFix()
      })
    }
 /** 片段占位符的待跳表：接受片段后填上，Tab 依次跳，任何其它按键/失焦清空。 */
    var snippetStops = null, snippetEpoch = 0

 /* 把光标前 [start, 光标) 这一段换成 text，并**核对结果**。
 * 一次反馈：接受后原文被吞掉、候选没进去，只能 Ctrl+Z 找回。
 * 真因是 contenteditable 这条路把「选 token → 插候选」交给 execCommand，而宿主 Lexical
 * 有时不认插件摆的选区（实测：打 文档 再 Tab 得到「文档管理文档」，多一份原文；
 * 另有一次候选一个字都没落进去）。所以：落一次 → 比整段文本 → 不对就 undo 这一笔，
 * 原文原地留着 —— 接受要么正确，要么什么都没发生。 */
    function spliceDraft(ed, start, text) {
      var before = textOf(ed)
      var caret = caretPos(ed)
      var end = caret >= 0 ? caret : before.length
      if (start < 0 || start > end) start = end
      var expected = before.slice(0, start) + text + before.slice(end)
      var multi = String(text).indexOf('\n') >= 0
      suppressInput++
      if (isText(ed)) {
        try { ed.selectionStart = start; ed.selectionEnd = end } catch (e) {}
        insertRich(ed, text)
        return textOf(ed) === expected
      }
      try {
        setSelectionRange(ed, start, end)
        insertRich(ed, text)          // 多行走 paste 通道，单行走 execCommand
        if (textOf(ed) === expected) return true
        if (multi) {                  // 宿主的 paste 是异步落的：给它一拍再核
          soon(function () {
            try { if (textOf(ed) !== expected) document.execCommand('undo') } catch (e2) {}
          })
          return true
        }
        if (before !== textOf(ed)) { try { document.execCommand('undo') } catch (e3) {} }
        return false
      } catch (e) { return false }
    }

    function acceptCurrent() {
      var it = popup.items[popup.index]
      var ed = lastComposer
      if (!it || !ed) { closePopup(); return }
      if (it.lang) habitBump(it.lang, 2)     // 接受过哪套词表的候选，就算在用哪门语言
 // token 必须在**接受这一拍**现算：lastToken 是弹层触发时的快照，
 // 打字比弹层快时会过期（实测：打 console.log 只回删了 'log'，前面的 'console.' 留在原地）。
      var tok = tokenBefore(textBeforeCaret(ed)) || lastToken || ''
      var caret0 = caretPos(ed)
      var start0 = (caret0 >= 0 && tok) ? Math.max(0, caret0 - tok.length) : caret0
      var payload = String(it.kind === 'file' ? String(it.value).replace(/\\/g, '/') : it.value)
      var stops = []
      if (it.kind === 'snippet') {
        var ex = expandSnippet(payload)
        payload = ex.text
        stops = ex.stops
      }
      snippetStops = null
 // 没落成就把原文留着、弹层也留着（换一条再来），Tab 不会看起来像没反应
      if (!spliceDraft(ed, start0, payload)) return
      closePopup()
      if (stops.length && start0 >= 0) {
 // 落点基准是**替换区间的起点**，不是插入前的光标位置（早先按光标算，光标会落在文本末尾）
        snippetStops = stops.map(function (s) { return start0 + s })
        snippetEpoch = caretEpoch
 // 先同步落一次（异步观察者赶不上下一拍），再用 placeCaretVerified 兜住编辑器把光标甩到末尾的情况
        try { setSelectionRange(ed, snippetStops[0], snippetStops[0]) } catch (e) {}
        placeCaretVerified(ed, snippetStops[0])
 // 再补一拍：Lexical 往往在插入落地后才把光标甩到末尾，placeCaretVerified 的观察者赶不上它
        var stop0 = snippetStops[0]
        soon(function () {
          if (!snippetStops || snippetStops[0] !== stop0) return
          try { setSelectionRange(ed, stop0, stop0) } catch (e) {}
        })
      }
    }

    var lastComposer = null, lastToken = '', lastSelText = ''

 /* 语言习惯：观察实际在用什么语言（围栏标记、以及接受过哪套词表的候选），
 * 存本地，下一次没写围栏时就按习惯上词表 —— 原话「通过观察用户操作习惯选择使用哪个语言」。 */
    var HABIT_KEY = 'dsh-composer-ease:lang-habit'
    function habitRead() { try { return JSON.parse(window.localStorage.getItem(HABIT_KEY) || '{}') || {} } catch (e) { return {} } }
    function habitBump(lang, weight) {
      if (!lang) return
      try {
        var h = habitRead(); h[lang] = (h[lang] || 0) + (weight || 1)
        window.localStorage.setItem(HABIT_KEY, JSON.stringify(h))
      } catch (e) {}
    }
    function habitTop() {
      var h = habitRead(), best = '', n = 0
      for (var k in h) { if (h[k] > n) { best = k; n = h[k] } }
      return best
    }

 /* 调试开关（默认关）：localStorage['dsh-composer-ease:debug']='1' 后刷新页面即开。
 * 存在的唯一理由：一次反馈在本机 Playwright 上复现不出来
 * （造不出真实输入法的 composition 事件），所以把实测上那几个字段原样打出来。 */
    var DBG = (function () {
      try { return window.localStorage.getItem('dsh-composer-ease:debug') === '1' } catch (e) { return false }
    })()
    function dbg(kind, o) {
      if (!DBG) return
      try {
        var ed = o && o.ed
        var t = ed ? textOf(ed) : ''
        var sel = ed ? [caretOffset(ed), selectedText(ed)] : ['-', '-']
        console.log('[cpe] ' + kind, JSON.stringify({
          key: o.key, data: o.data, itype: o.itype, composing: !!o.composing,
          before: o.before, sel: sel[1], caret: sel[0], text: t,
          action: o.action, prevented: !!o.prevented
        }))
      } catch (e) {}
    }

// ── 模块：键位层 ────────────────────────────────
// onKeyDown（配对、跳过闭符、空对删除、方向键选候选）与两个删除动作。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function onKeyDown(ev) {
      var ed = composerOf(ev.target)
      if (!ed) { if (popup.open) closePopup(); return }
      lastComposer = ed
      if (composing) return    // IME 合成期间不接管任何键（拼音的字母要原样交给输入法）
 /* 读状态之前，先把**上一键挂起的光标复位**就地落地（幂等：文本不匹配就什么都不做）。
 * 不这么做，下一键读到的就是旧光标位置 —— 空框打 `"` 得 `""` 之后手快再打 `"`，
 * 因为光标还没挪到两符中间，第二下会当成字面插入 → `"""`（一次反馈正是这一拍）。 */
      flushCaretFix()
      caretEpoch++            // 新按键作废上一键挂起的光标复位（否则旧回调会把光标拨回去）
      var k = { key: ev.key, code: ev.code, ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey,
                __popupOpen: popup.open, __collapsedFalse: !!(ev.target && ev.target === ed && selectedText(ed)),
                __nextIsCloser: caretChar(ed, +1) === ev.key }
      dbg('keydown', { ed: ed, key: ev.key, before: textBeforeCaret(ed), composing: composing })
 // 记下这一键按下时的选区：IME/全角那条路 keydown 拿不到字符，靠 input 事件回头补框选
      lastSelText = selectedText(ed)
 // 回车＝发送：先把弹层与灰字收干净，别让它们挂在被清空的输入框上。
 // （一次反馈——发送就是这条的收尾点）
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
 /* 无条件 closePopup：即使浮层还没画出来（候选响应还在路上）也要把代数 +1，
          否则回车之后到达的响应照样会把它画出来 —— 2026-10-21 真机 3081 把 /words 延迟 900ms 后复现到的正是这一格。 */
        closePopup()
        return
      }
 // 与 dsh-composer-history 共存：它用 Ctrl+R 开反向搜索。插件的候选层开着时先把层收掉，
 // 避免两个面板叠在一起（插件**不拦**这个键，交给它处理）——纸面对照后补。
      if (popup.open && (ev.ctrlKey || ev.metaKey) && (ev.key === 'r' || ev.key === 'R')) closePopup()
 // 片段占位符优先于补全接受：接受片段后 Tab 依次跳到下一个占位符（照 VS Code 的 snippet 行为）。
 // 非 Tab 的按键清空待跳表 —— 用户一动别的，就不该再跳。
      if (snippetStops && snippetStops.length) {
        if (ev.key === 'Tab' && !ev.shiftKey) {
          ev.preventDefault()
          var nowAt = caretPos(ed)
          var nxt = -1
          for (var si = 0; si < snippetStops.length; si++) {
            if (snippetStops[si] > nowAt) { nxt = snippetStops[si]; break }
          }
          if (nxt >= 0) placeCaretVerified(ed, nxt, textOf(ed))
          else snippetStops = null
          return
        }
        snippetStops = null
      }
 // 左右方向键 / Home / End 是「挪光标改字」，不是要补全：先把弹层收掉，再把键交回编辑器。
 // 只收这一次 —— 继续打字时 onInput 会重新拉候选，所以改完接着打仍然会提示。
      if (popup.open && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home' || ev.key === 'End')) {
        closePopup()
      }
 // 弹层优先：上下选必须先于 keyAction —— keyAction 对箭头返回空，放在它后面就永远走不到
 // （的一次反馈）。
      if (popup.open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault()
        popup.index = (popup.index + (ev.key === 'ArrowDown' ? 1 : -1) + popup.items.length) % popup.items.length
 // 必须 force：renderPopup 的签名只含 items 与语言水印、不含 index，
 // 非 force 时同一个 sig 会早退 →「按了键但高亮不动」（就是这个）。
        renderPopup(ed, true)
        showGhost(ed)          // 行内预览跟着选中项走（VS Code 的 suggest.preview 口径）
        return
      }
      var act = keyAction(k)
      if (!act) return
      if (act === 'dismiss') { if (popup.open) { ev.preventDefault(); closePopup() } return }
      if (act === 'accept' && popup.open) { ev.preventDefault(); acceptCurrent(); return }
      if (act === 'complete') {
        ev.preventDefault()
        lastToken = tokenBefore(textBeforeCaret(ed))
        fetchCandidates(lastToken, ed)
        return
      }
 // （一次反馈）：原来这里排除了 shift，
 // 于是 `{` `"` 这类要按 Shift 才打出来的开符、以及中文输入法 Shift+9 的「（」全都不配对。
 // 配对动作只对开符触发，Shift 不影响判断，放开它。
      if (act === 'pairopen' && ev.repeat) {
 // 按住符号键的自动重复：只插一个字符，不再成对（否则越按越多）
        ev.preventDefault()
        insertText(ed, ev.key)
        return
      }
      if (act === 'pairopen' && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
 // 反选优先：上一次框选范围还在、这次又是同一个引号 → 取消那次框选
        if (tryUnwrap(ed, ev.key)) { ev.preventDefault(); return }
        var before = textBeforeCaret(ed)
        var open = ev.key, close = PAIRS[open]
        var selTxt = selectedText(ed)
 // 明明有选区却读不出文本（选区落在 chip / mention 这类非文本节点上）：
 // 这时候任何插入都会把选区替掉，等于用引号吃掉选中内容 —— 宁可这一下什么都不做。
        if (!selTxt && k.__collapsedFalse) { ev.preventDefault(); return }
 // warn 模式：`"你好"` 这种已经框好的，再打同一个引号什么都不做（与 auto 的旧契约一致）
        if (quoteMode() !== 'auto' && isQuoteChar(open) && alreadyClosedBefore(before, open, close)) {
          ev.preventDefault(); return
        }
 // 空对里再打同一个引号 → 跳过（实测：快速连打时上一键的光标复位还没落地，
 // 光标可能停在对子后面，于是又补一对变成三个）。按**文本形状**判，不看光标：
 // 整段就是一个空对，或光标正好夹在空对中间，都算「已经在空对里」。
        if (close === open && isQuoteChar(open) && quoteMode() === 'auto') {
 // 仅 auto 模式：连打竞态下光标可能停在对子后面，此时跳过而不是再补一对。
 // warn 模式不自动补对，连按必须逐个字面插入（）。
          var tv = textOf(ed), pv = caretPos(ed)
          var onlyPair = tv === open + close
          var straddle = pv > 0 && pv < tv.length && tv.charAt(pv - 1) === open && tv.charAt(pv) === close
          if (onlyPair || straddle) {
            ev.preventDefault()
            placeCaretVerified(ed, tv.length, tv)     // 光标移到闭符之后
            return
          }
        }
        ev.preventDefault()
        if (selTxt) {
 // 拦住 Lexical：插件的监听是 capture 阶段，stopPropagation 之后它收不到这次按键，
 // 就不会"按自己的模型再插一遍"——实测 实测：不拦时 418ms 贴入 `“abc”`、
 // 423ms 它又插一个 `“`，于是撤销撤掉的是那个多余引号，而不是把原文还回来。
          try { ev.stopImmediatePropagation && ev.stopImmediatePropagation() } catch (e0) {}
          try { ev.stopPropagation() } catch (e0b) {}
 // 已有一个没闭合的开符在前（`"abc` 里选中 abc 再打 `"`）：这是「补闭合」而不是「再框一层」，
 // 否则会变成 `""abc"`。对称引号才这么做；非对称的（“”）按原来的框选走。
          if (close === open && isUnbalancedBefore(before, open, close)) {
            var selEnd = caretOffset(ed) + selTxt.length
            if (isText(ed)) { ed.selectionStart = ed.selectionEnd = ed.selectionEnd } else setSelectionRange(ed, selEnd, selEnd)
            insertText(ed, open)
          } else wrapSelection(ed, open, selTxt, close)
        }   // 环绕选区（2026-10-16 修：选区还原到内层）
        else if (caretChar(ed, +1) === close) {
 // 右边已经是这一对：跳过去，不要套一对（`“”` 中间再打 `“` 会变成一对套一对）
          var skipTo = caretPos(ed)
          if (skipTo >= 0) placeCaretVerified(ed, skipTo + 1, textOf(ed))   // 不插字，文本不变
 // 光标停在一个**已闭合**的闭符之后时不再吞掉这一键（旧实现 preventDefault 了什么都不做）：
 // 反馈是「其他引号都闭合的情况下，新打的引号没有成对」。现在交给 shouldPair 决定，
 // 默认 auto 下就是再开一对；要「不堆一个」请切到标红模式或开严格配对。
        } else if (before.slice(-1) === open
                   && isUnbalancedBefore(before, open, close)
                   && textOf(ed).length > before.length) {
 // 光标紧贴一个未闭合的开符、后面还有正文（`"|你好`）。
 // **旧实现把闭符 setCaret 到全文末尾** —— 这就是
 // 「后引号出现在句子后面、不在我要的位置」。改成一律在光标处字面插入：
 // 用户在哪打就在哪落，闭合与否交给 lintQuotes 标红提示。
          var atHere = caretPos(ed)
          insertText(ed, open)
          if (atHere >= 0) { try { setSelectionRange(ed, atHere + 1, atHere + 1) } catch (e) {} }
        } else if (close === open && before.slice(-1) === open && quoteCount(before) % 2 === 1) {
 // 对称引号（" ' `）前面是**还没闭合**的开符：只插一个（这是补闭合，不是再开一层）。
 // 前面那对已经闭合时走下面 shouldPair，开一对新的。
 // VS Code 的引号规则；不补这条时连按引号会 2→4→6 成串（的一次反馈）。
          insertText(ed, open)
        } else if (isUnbalancedBefore(before, open, close)) {
 // 更前面还有一个没闭合的开符（`"你好` 末尾再打 `"`、`“文字` 末尾再打 `“`）：
 // 这一下是在闭合它，不是再开一层 —— 只插一个字符。
          insertText(ed, open)
        } else if (shouldPair(before, caretChar(ed, +1), open)) {
          var basePair = textOf(ed), atPair = caretPos(ed)
          insertAtomic(ed, open + close)      // 原子插入：避免 Lexical 异步重写选区导致的竞态
 // 先同步落一次光标：异步观察者赶不上下一次按键（实测快速连打会变 4 个引号）
          if (atPair >= 0) { try { setSelectionRange(ed, atPair + 1, atPair + 1) } catch (e) {} }
 // 开符落在 atPair 这一格，光标要落在它后面一格（= 两符之间）。
 // 等文本真的落地才写（见 placeCaretVerified），expect 用来认出「有没有人插手」
          placeCaretVerified(ed, atPair + 1,
            atPair < 0 ? undefined : basePair.slice(0, atPair) + open + close + basePair.slice(atPair),
            atPair < 0 ? null : afterPairCheck(ed, open, close, atPair))
          if (atPair >= 0) ensureCaretAt(ed, atPair + 1)   // 编辑器若把光标挪到对子后面，这里按实际偏移纠回来
        } else {
          var atLiteral = caretPos(ed)
          insertText(ed, open)
 // 光标复位：字面插入后宿主可能把 caret 留在插字之前，导致下一次按键被
 // 「跳过闭符」判据吃掉（实测连按三下只得两个引号）。
          if (atLiteral >= 0) { try { setSelectionRange(ed, atLiteral + 1, atLiteral + 1) } catch (e) {} }
        }
        return
      }
      if (act === 'pairclose') {
        var expect = CLOSERS[ev.key]
        if (!selectedText(ed) && caretChar(ed, +1) === ev.key && PAIRS[expect] === ev.key) {
 // 后面就是应得的闭合符：跳过而不是再插一个（反引号对称，同判据成立）
          ev.preventDefault()
          var atClose = caretPos(ed)
          if (atClose >= 0) placeCaretVerified(ed, atClose + 1, textOf(ed))   // 不插字，文本不变
          return
        }
 // 引号且不该跳过时：必须字面插入，否则这一下被吞掉（实测连按三下只得两个引号）。
 // 括号不在此列 —— 让浏览器默认插入，别抢。
        if (isQuoteChar(ev.key)) {
          var bh = textBeforeCaret(ed)
          if (alreadyClosedBefore(bh, CLOSERS[ev.key], ev.key)) return   // 已框好：不再堆一个
          ev.preventDefault()
          var atLit = caretPos(ed)
          insertText(ed, ev.key)
          if (atLit >= 0) { try { setSelectionRange(ed, atLit + 1, atLit + 1) } catch (e) {} }
        }
        return
        return
      }
      if (act === 'pairbackspace' && !selectedText(ed)) {
        var prev = caretChar(ed, -1), next = caretChar(ed, +1)
        if (PAIRS[prev] === next) { // 光标正好夹在空对里：一次删掉两侧（VSCode 同款）
          ev.preventDefault()
 // 两次删除各派发一次 input；全角/中文标点那半边有「开符后自动补闭符」，
 // 前删后框里只剩一个 `（`，它会立刻补回 `）`，结果就变成只删了一侧
 // （取证：`（）`→`）`、`“”`→`”`，半角不受影响）。
          suppressInput += 2
          deleteForward(ed)
          deleteBackward(ed)
        }
      }
    }
    function deleteForward(ed) {
      try {
        if (isText(ed)) {
          var s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          var i = ed.selectionStart
          s.call(ed, ed.value.slice(0, i) + ed.value.slice(i + 1))
          ed.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
        var off = caretOffset(ed)
        if (off < 0) return
        setSelectionRange(ed, off, off + 1)   // 2026-10-16：从 sel.modify 换过来（Lexical 不认后者）
        document.execCommand('delete')
      } catch (e) {}
    }
    function deleteBackward(ed) {
      try {
        if (isText(ed)) {
          var s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          var i = ed.selectionStart
          if (i <= 0) return
          s.call(ed, ed.value.slice(0, i - 1) + ed.value.slice(i))
          ed.selectionStart = ed.selectionEnd = i - 1
          ed.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
        var off = caretOffset(ed)
        if (off <= 0) return
        setSelectionRange(ed, off - 1, off)   // 2026-10-16：同上
        document.execCommand('delete')
      } catch (e) {}
    }

// ── 模块：输入事件层 ────────────────────────────────
// beforeinput/input 两条路：补闭符、收尾、引号未闭合标红、触发源定义（buildTriggerSources）。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function textBeforeCaret(ed) {
      try {
        if (isText(ed)) return ed.value.slice(0, ed.selectionStart)
        var sel = window.getSelection(); if (!sel.rangeCount) return ''
        var r = sel.getRangeAt(0).cloneRange()
        var root = composerOf(ed) || document.body
        r.selectNodeContents(root); r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset)
        return r.toString()
      } catch (e) { return '' }
    }

 /* 引号未闭合提示：**必须在模块层**声明 —— 之前写在 apply() 里，而 scheduleQuoteLint
 * 在模块层引用它们，运行时抛 ReferenceError 被 try 吞掉，红线永远不出现（修）。 */
    var quoteLintTimer = null

 /** 「未闭合引号」计数：**撇号不算**——`let's` / `don't` 里的 ' 与 ’ 被词字符夹着，
 * 那是英文所有格，不是引号（从没打引号也会冒出标红）。 */
    function unclosedQuoteCount(text) {
      var s = String(text || ''), n = 0
      for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i)
        if (!isQuoteChar(c)) continue
        if (c === '\u0027' || c === '\u2019') {
          var pv = s.charAt(i - 1), nx = s.charAt(i + 1)
          if (/[A-Za-z0-9]/.test(pv) && /[A-Za-z0-9]/.test(nx)) continue
        }
        n++
      }
      return n
    }
    function lintQuotes(ed) {
      if (!ed) return
      var box = composerOf && composerOf(ed) || ed
      if (!box || !box.setAttribute) return
      var t = ''
      try { t = textOf(ed) || '' } catch (e) { t = '' }
      var bad = unclosedQuoteCount(t) % 2 === 1
      paintQuoteWarn(ed, bad ? unmatchedQuoteIndex(t) : -1)   // 只画在那个没闭合的引号底下
      try {
        if (bad) {
          box.setAttribute('data-dce-quote-warn', '1')
 // 不再挂文字提示（反馈：不需要显示「引号/反引号未闭合」），只留底下那条波浪线。
          box.setAttribute('data-dce-quote-hint', '')
        } else {
 // 置 '0' 而不是删除：CSS 只认 =1，且假 DOM/宿主里 removeAttribute 不一定生效
          box.setAttribute('data-dce-quote-warn', '0')
          box.setAttribute('data-dce-quote-hint', '')
          if (box.removeAttribute) box.removeAttribute('title')
        }
      } catch (e) {}
    }

    function scheduleQuoteLint(target) {
      if (quoteLintTimer) clearTimeout(quoteLintTimer)
      quoteLintTimer = setTimeout(function () { try { lintQuotes(target) } catch (e) {} }, 120)
    }
 /* 注释行里不提示：行首（允许缩进）是 // # <!-- -- 的那一行，补全没有意义。
 * 引号里的内容照旧提示 —— 那一侧是字符串，正是要补的地方。 */
    var COMMENT_LINE = /^\s*(\/\/|#|<!--|--)/
    function inCommentLine(before) {
      var s = String(before || '')
      var i = s.lastIndexOf('\n')
      return COMMENT_LINE.test(i < 0 ? s : s.slice(i + 1))
    }
    function onInput(ev) {
      try { scheduleQuoteLint(ev && ev.target) } catch (e0) {}   // 引号未闭合标红（不阻断输入）
 // 三种触发：'/' 与 '@'（引用/模型）、打标识符两个字母起自动弹（VSCode 手感）
      var ed = composerOf(ev.target)
      if (!ed) return
      if (suppressInput > 0) { suppressInput--; return }   // 这是接受候选时自己插的，别再弹
    dbg('input', { ed: ed, data: ev && ev.data, itype: ev && ev.inputType,
                   composing: composing || (ev && ev.isComposing), before: textBeforeCaret(ed) })
      if (composing || (ev && ev.isComposing)) { if (popup.open) closePopup(); return }   // IME 合成中不补全
 // 粘贴/拖入：先把残留的弹层与灰字收掉，也不为粘贴内容补全（否则灰字会停在旧位置）
      var itype = ev && ev.inputType ? String(ev.inputType) : ''
      if (itype.indexOf('Paste') >= 0 || itype.indexOf('Drop') >= 0) { closePopup(); return }
      lastSelText = ''
 // 全角/中文成对符走这条：IME 合成的字符不一定带对应 keydown，keydown 那条路抓不到。
      var b0 = textBeforeCaret(ed)
      var prev = b0.slice(-1)
      var want = PAIRS[prev]
 // `“文字` 末尾再打 `“` 时，上一行插入的是「闭合」而不是「开启」，
 // 这里若还去补 `”` 就会变成 `“文字“”`（一次反馈）。
      if (want && prev.charCodeAt(0) > 127 && caretChar(ed, +1) !== want
          && !isUnbalancedBefore(b0.slice(0, -1), prev, want)
          && shouldPair(b0.slice(0, -1), caretChar(ed, +1), prev)) {
        suppressInput++                                   // 自己插的闭符别再触发一轮
        var baseWant = textOf(ed), atWant = caretPos(ed)
        insertText(ed, want)
 // 闭符插在开符之后，光标回到两符之间
        placeCaretVerified(ed, b0.length,
          atWant < 0 ? undefined : baseWant.slice(0, atWant) + want + baseWant.slice(atWant))
        return
      }
      var before = textBeforeCaret(ed)
      lastComposer = ed
// 注释行：整行不提示（引号里的内容仍在引号那条规则之外，照旧提示）
      if (inCommentLine(before)) { if (popup.open) closePopup(); return }
      var m = before.match(/(^|\s)([/@])([A-Za-z0-9_.\\/:,-]*)$/)
      if (m) {
 // '/' 是 DSH 原生命令入口（dsh-commands：command/run、command/done）：
 // 插件不插手，免得两份菜单叠在一起、也免得给那条路加延迟（融合而不是抢）。
        if (m[2] === '/') { if (popup.open) closePopup(); return }
        lastToken = m[2] + m[3]; fetchCandidates(lastToken, ed); return
      }
      var w = before.match(/([A-Za-z_][A-Za-z0-9_]{1,}|[\u4e00-\u9fff]{1,})$/)
      if (w) {
        var tok = w[1]
 // 汉字没有空格分词：整句会被当成一个 token，取最后 4 个字当前缀（够长又不至于永不命中）
        if (/^[\u4e00-\u9fff]+$/.test(tok)) {
 // 中文至少要 2 个字才算「完整词义」，单字不提示（）
          if (tok.length < 2) { if (popup.open) closePopup(); return }
          if (tok.length > 4) tok = tok.slice(-4)
        }
        lastToken = tok
        fetchCandidates(lastToken, ed)
        return
      }
      if (popup.open) closePopup()
    }
 /* 框选 + 打符号（原话「选中然后 shift 加符号框住」）：
 * keydown 那条路对半角好使；**中文输入法/全角没有可用的 keydown**，所以再挂一条 beforeinput。
 * 实测取证（demo 3081 + Playwright）把两条老假设推翻了：
 * ① keydown 里读 DOM **不是**空的 —— 探针实测值 `text='\"你好' caret=3` 都对，影子状态不需要；
 * ② `preventDefault()` **拦不住 Lexical**：它照自己的模型再插一遍，于是「拦 + 自己插」出双份。
 * 现存唯一的真空窗是 `input` 事件：空框里首次插入 Lexical 根本不派发它（探针里只有
 * beforeinput，没有 input），所以「事后靠 onInput 补闭符」在那几场永远不触发。
 * 于是这条路改成：**判定在 beforeinput 做，落地等原生插完再收尾**（不拦默认、不自己插开符）。 */
    var pendingFix = null
    function textOf(ed) { return isText(ed) ? String(ed.value || '') : flatText(ed) }
 /** 删掉绝对偏移上的那一个字符（原生多插时用）。 */
    function deleteAt(ed, off) {
      try {
        if (isText(ed)) {
          var next = ed.value.slice(0, off) + ed.value.slice(off + 1)
          var desc = null
          try {
            desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
          } catch (e0) { desc = null }
          if (desc && desc.set) desc.set.call(ed, next)   // 受控组件只认原型 setter
          else ed.value = next                            // 没有描述符的环境直接赋值
          ed.selectionStart = ed.selectionEnd = off
          ed.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
        setSelectionRange(ed, off, off + 1)
        document.execCommand('delete')
      } catch (e) {}
    }
    function onBeforeInput(ev) {
      try {
        var ed = composerOf(ev.target)
        if (!ed) return
        flushCaretFix()          // 同上：先让上一键挂起的光标复位落地，再读状态
        if (suppressInput > 0) return
        var data = ev && typeof ev.data === 'string' ? ev.data : ''
    dbg('beforeinput', { ed: ed, data: data, itype: ev && ev.inputType, before: textBeforeCaret(ed), composing: composing })
        if (data.length !== 1 || !PAIRS[data]) return
        var open = data, close = PAIRS[open]
        var selTxt = selectedText(ed)
        if (selTxt) {
          ev.preventDefault()      // 文本域认这次取消；真 Lexical 不认（2026-10-20 探针：照样把选区替成那一个字符）
 // 再断掉传播：宿主那份监听在编辑器根节点上，不拦它就会自己把选区替成那一个字符，
 // 于是包裹变成「多一个开符」再由 repairWrapDup 删掉 —— 撤回里就多出「三个引号、两个引号」两拍。
          try { ev.stopImmediatePropagation && ev.stopImmediatePropagation() } catch (e1) {}
          try { ev.stopPropagation() } catch (e2) {}
          var bfSel = textBeforeCaret(ed)
          var selEnd = bfSel.length + selTxt.length
          if (close === open && isUnbalancedBefore(bfSel, open, close)) {
 // 前面已有一个没闭合的同一个引号：这一下是补闭合，不是再框一层
            setCaret(ed, selEnd)
            insertText(ed, open)
            return
          }
          if (isText(ed)) { wrapSelection(ed, open, selTxt, close); return }
 // contenteditable：Lexical 会把选区替成那一个开符，框完就多出一个
 // （实测值：选中 abc 打 “ → `““abc”`）。所以框完之后把多出来的那一个删掉。
          pendingFix = { ed: ed, open: open, close: close, off: bfSel.length - selTxt.length, selTxt: selTxt, action: 'surround' }
          wrapSelection(ed, open, selTxt, close)
          soon(flushBeforeFix)
          return
        }
        var before = textBeforeCaret(ed)
        var off = before.length
        var next = caretChar(ed, +1)
        var action = 'insert'
        if (next === close) action = 'skip'
        else if (alreadyClosedBefore(before, open, close)) action = 'skip'   // 已经框好了，别再堆一个
        else if (close === open && before.slice(-1) === open) action = 'insert'
        else if (isUnbalancedBefore(before, open, close)) action = 'insert'
        else if (shouldPair(before, next, open)) action = 'pair'
        if (action === 'insert') return          // 原生插一个就是想要的：零干预
        pendingFix = { ed: ed, open: open, close: close, off: off, len: before.length, action: action }
        soon(flushBeforeFix)
      } catch (e) {}
    }
 /** 原生那一个字符落地之后收尾。**幂等**：实测上 `input` 有时来有时不来，
 * onInput 那条补闭符的路和这里会撞在一起 —— 谁先到都只补一次（落地后先读有没有闭符）。 */
    function flushBeforeFix() {
      var p = pendingFix
      if (!p) return
      pendingFix = null
      try {
        var ed = p.ed, now = textOf(ed)
        if (p.action === 'surround') {
 // 粘贴那一下是 Lexical 自己异步落的（实测值：soon 那一拍还只有原生那个开符），
 // 所以按梯子反复看，直到「框好的形状」出现再把多出来的开符删掉、光标落到闭符之后。
          var ladder = [0, 16, 48, 110, 220], k = 0
          var tick = function () {
            try {
              var nw = textOf(ed)
              if (nw.slice(p.off, p.off + 2) === p.open + p.open) {
                suppressInput++                        // 原生多插的那一个开符
                deleteAt(ed, p.off)
                nw = textOf(ed)
              }
              var afterClose = p.off + 1 + p.selTxt.length + 1
              if (nw.charAt(afterClose - 1) === p.close) { placeCaretVerified(ed, afterClose, nw); return }
            } catch (e) {}
            if (++k < ladder.length) { try { setTimeout(tick, ladder[k]) } catch (e) {} }
          }
          tick()
          return
        }
        if (p.action === 'skip') {
 // 本该「跳过去」：原生若一个字符都没插（文本域认取消），现状已经是对的
          if (now.length === p.len) { placeCaretVerified(ed, Math.min(p.off + 1, now.length), now); return }
          if (now.charAt(p.off) !== p.open) return      // 落地的不是它：放手，不要猜
          suppressInput++                              // 原生把这一下当插入做了，多出一个开符：删掉
          deleteAt(ed, p.off)
          var afterDel = textOf(ed)
          placeCaretVerified(ed, Math.min(p.off + 1, afterDel.length), afterDel)
          return
        }
        if (now.charAt(p.off) !== p.open) return        // 没按预期落地：放手，不要猜
        if (now.charAt(p.off + 1) === p.close) {        // 已经补过了（onInput 那条路先到）
          placeCaretVerified(ed, p.off + 1, now)
          return
        }
        suppressInput++
        setCaret(ed, p.off + 1)
        insertText(ed, p.close)
        try { setSelectionRange(ed, p.off + 1, p.off + 1) } catch (e) {}   // 同上：同步一次
        placeCaretVerified(ed, p.off + 1, now.slice(0, p.off + 1) + p.close + now.slice(p.off + 1),
          afterPairCheck(ed, p.open, p.close, p.off))     // 输入法这条路同样落地后复核一遍
        ensureCaretAt(ed, p.off + 1)
      } catch (e) {}
    }

    function onCompositionStart(ev) {
      if (!composerOf(ev.target)) return
      composing = true
      caretEpoch++            // 输入法接管：作废我们自己挂起的光标复位，别跟它抢
      closePopup()            // 连灰字一起收起来（hideGhost 在 closePopup 里）
    }
    function onCompositionEnd(ev) {
      if (!composerOf(ev.target)) return
      composing = false
 // 上屏后按新内容重新判一次（中文词补全走这条路）
      try { onInput({ target: ev.target }) } catch (e) {}
    }

    function onBlurOut(ev) {
      var ed = composerOf(ev.relatedTarget)
      if (!ed && popup.open) closePopup()
    }

 /* ── 宿主输入触发源（照被录用插件的样子做）─────────────────────────────
 * dsh-client-ui-commands / -skill / -reference 都是把内容注册进宿主的输入触发菜单，
 * 位置、上下选、插入与撤销都由宿主负责。插件只提供 candidates 与 onPick，
 * 不再自己画弹层、也不再跟宿主抢触发字符。 */
 /* 「严格配对」开关（普通情况不必那么严，需要时可开）。
 * 存在 localStorage，默认 false；由 '/' 菜单里插件那组的第一条切换。 */
 // 借宿主的命令表做两件事：① 让本组与「指令」组同一拍落地（宿主那组要等命令目录 RPC，
 // 原来立即 resolve，菜单先蹦三行再被顶下去）；② 错拼时按它的表补一行。
 // 取不到（老宿主 / 没这个服务）就照旧立即返回，功能不缺。
    function hostCommands(ctx, session, req) {
      var cu = null
      try { cu = ctx && typeof ctx.get === 'function' ? ctx.get('commandUi') : null } catch (e) { cu = null }
      if (!cu || typeof cu.candidates !== 'function') return Promise.resolve(null)
      var full = { query: '', position: (req && req.position) || 'leading', signal: req && req.signal }
      try {
        return Promise.resolve(cu.candidates(session, req)).then(function (matched) {
          return Promise.resolve(cu.candidates(session, full)).then(function (all) {
            return { matched: matched || [], all: all || [] }
          })
        }).catch(function () { return null })
      } catch (e) { return Promise.resolve(null) }
    }
    function buildTriggerSources(ctx) {
      var fileSource = {
        trigger: '@',
        name: '便捷输入框',                 // 分组名：与宿主「文件与文件夹」并列，名字要唯一（重复注册会抛）
        order: 50,
        showGroupTitle: true,
        candidates: function (session, req) {
          var q = String((req && req.query) || '')
          return fetchItems(q).then(function (items) {
            return items.map(function (it) {
              var v = String(it.value || '')
              return {
                name: v,
                label: triggerBasename(v),
                description: String(it.detail || ''),
                hint: it.kind === 'file' ? '文件' : (it.kind === 'model' ? '模型' : ''),
              }
            })
          })
        },
        onPick: function (pick) { return { text: String(pick.candidate.name) } },
      }
      var slashSource = {
        trigger: '/',
        name: '便捷输入框',            // 与宿主的「指令」组并列；同 trigger 下 name 重复会抛
 // 宿主按 order 升序排：内置「指令」= 1、「技能」= 2。写 20 会被垫到技能下面
 // （的一次反馈）。开关类要放最上面，一打开菜单就看得到。
        order: 0,
        showGroupTitle: true,
        candidates: function (session, req) {
          var q = String((req && req.query) || '').trim()
 // 三行也按 query 过滤：宿主那组因为 query 不命中而消失时，别只剩本插件这组还赖在菜单里
          var rows = settingsRows().filter(function (r) {
            if (!q) return true
            return looseScore(q, r.name) >= 0 || looseScore(q, r.label || '') >= 0
          })
          return hostCommands(ctx, session, req).then(function (host) {
            var leading = !req || req.position !== 'inline'
            return rows.concat(rescueRows(q, host, leading))
          })
        },
        onPick: function (pick) {
          var cand = (pick && pick.candidate) || {}
 // 错拼兜底行：补成真命令名再交给宿主，插件自己不解命令
          if (cand.rescue) return { text: '/' + String(cand.rescue) + ' ' }
          if (String(pick.candidate.name) === '引号模式') setQuoteMode(quoteMode() === 'auto' ? 'warn' : 'auto')
          if (String(pick.candidate.name) === '严格配对') setPairStrict(!pairStrict())
          var pickName = String(pick.candidate.name)
          if (pickName === '候选类型') cycleKindPreset()
          return { text: '' }        // 清掉输入框里的 '/'，不插入任何文字
        },
      }
      return [fileSource, slashSource]
    }

// ── 模块：装载与卸载 ────────────────────────────────
// apply：单例守卫、输入触发源注册、七个事件监听与卸载。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function apply(ctx) {
 // 单例：同一页面被重复装载（HMR/重复注册）时，一次按键会被两套监听各处理一遍 → 引号/括号翻倍。
      if (typeof window !== 'undefined' && window.__DSH_COMPOSER_PRO_APPLIED__) {
        try { console.warn('[dsh-composer-ease] already applied, skip duplicate mount') } catch (e) {}
        return function () {}
      }
      if (typeof window !== 'undefined') window.__DSH_COMPOSER_PRO_APPLIED__ = true
      try {
        var strays = document.querySelectorAll('#dsh-cp-popup, #dsh-cp-ghost')
        for (var si = 0; si < strays.length; si++) strays[si].parentNode && strays[si].parentNode.removeChild(strays[si])
      } catch (e) {}
 /* 宿主输入触发源：照官方用法 ctx.inject([...], scope => …) —— 注入后的服务在 scope 上。
 * 前提：package.json 的 dsh.client.inject 与 exports.inject 都要声明 inputTriggers
 *（实测：只在其中一处声明时，apply 里取到的是 undefined）。 */
      var unwatchTriggers = []
      try { if (typeof window !== 'undefined') window.__DSE_TRIGGER_SOURCES__ = 0 } catch (e) {}
      var mountSources = function (svc) {
        if (!svc || typeof svc.registerSource !== 'function') return
        buildTriggerSources(ctx).forEach(function (src) {
          try {
            var off = svc.registerSource(src)
            unwatchTriggers.push(off)
            try { window.__DSE_TRIGGER_SOURCES__ = (window.__DSE_TRIGGER_SOURCES__ || 0) + 1 } catch (e) {}
          } catch (e) {
            try { console.warn('[dsh-composer-ease] registerSource 失败:', src.name, e && e.message) } catch (e2) {}
          }
        })
      }
      try {
        if (ctx && typeof ctx.inject === 'function') {
          ctx.inject(['inputTriggers'], function (scope) { mountSources(scope && scope.inputTriggers) })
        } else {
          mountSources((ctx && typeof ctx.get === 'function') ? ctx.get('inputTriggers') : null)
        }
      } catch (e) {
        try { console.warn('[dsh-composer-ease] 触发源注册异常:', e && e.message) } catch (e2) {}
      }
      var d = document
      d.addEventListener('keydown', onKeyDown, true)   // capture：先于 Lexical 自己的键位
      d.addEventListener('beforeinput', onBeforeInput, true)
 // ── 引号未闭合的标红提示（VS Code 的 squiggle 口径，不阻断输入）──────────
      if (document.getElementById && !document.getElementById('dce-quote-style')) {
        var st = document.createElement('style')
        st.id = 'dce-quote-style'
 // 波浪线不再画在框底：那条线离文字约 27px，看着像给整个框描边，与「这个词有问题」无关。
 // 现在由 paintQuoteWarn() 用覆盖层逐行画在**文字框底边**上；这里只留行内提示文字。
 // 不再用 ::after 显示文字提示：标红只是一个位置信号，句子内容不该被这句话挤动。
        st.textContent = '[data-dce-quote-warn="1"]{background:none!important}'
        try { document.head && document.head.appendChild(st) } catch (e) {}
      }
      d.addEventListener('input', onInput, true)
      d.addEventListener('focusout', onBlurOut, true)
      d.addEventListener('compositionstart', onCompositionStart, true)
      d.addEventListener('compositionend', onCompositionEnd, true)
      return function () {
        d.removeEventListener('keydown', onKeyDown, true)
        d.removeEventListener('beforeinput', onBeforeInput, true)
        d.removeEventListener('input', onInput, true)
        d.removeEventListener('focusout', onBlurOut, true)
        d.removeEventListener('compositionstart', onCompositionStart, true)
        d.removeEventListener('compositionend', onCompositionEnd, true)
        for (var ui = 0; ui < unwatchTriggers.length; ui++) { try { unwatchTriggers[ui]() } catch (e) {} }
        if (typeof window !== 'undefined') { window.__DSH_COMPOSER_PRO_APPLIED__ = false; window.__DSE_TRIGGER_SOURCES__ = 0 }
        closePopup()
      }
    }

    exports.apply = apply
    exports.inject = ['inputTriggers']   // 宿主输入触发服务：不声明则 scope 里拿不到（官方用法同）
    exports.__helpers__ = { pairStrict: pairStrict, setPairStrict: setPairStrict, repairWrapDup: repairWrapDup, unclosedQuoteCount: unclosedQuoteCount, expandSnippet: expandSnippet, isKindOn: isKindOn, toggleKind: toggleKind, kindPresetLabel: kindPresetLabel, cycleKindPreset: cycleKindPreset, quoteMode: quoteMode, setQuoteMode: setQuoteMode, lintQuotes: lintQuotes, quoteCount: quoteCount, buildTriggerSources: buildTriggerSources, settingsRows: settingsRows, looseScore: looseScore, typoScore: typoScore, rescueRows: rescueRows, inCommentLine: inCommentLine, PAIRS: PAIRS, PAIRED_CHAR: PAIRED_CHAR, CLOSERS: CLOSERS, shouldPair: shouldPair, tokenBefore: tokenBefore, keyAction: keyAction, docWords: docWords, langHint: langHint, inferLang: inferLang, inferLangVote: inferLangVote, watermarkFor: watermarkFor, conversationText: conversationText, contextWords: contextWords, contextReset: function () { ctxCache.at = 0; ctxCache.words = [] }, caretChar: caretChar, caretOffset: caretOffset, flatText: flatText }

    return module.exports
  },
})
