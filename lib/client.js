// dsh-composer-pro —— 浏览器半边：键位层 + 补全弹层。
// 形态：宿主模块图里的一个 bundle（照 dsh-skill-meter / dsh-model-priority 的头尾抄结构），
// 不 require 任何第三方包（动态包里也只拿得到宿主 react，本件用不到）。
// 行为参照 VSCode（MIT）：自动配对、环绕选区、输入闭合符跳过、删除空对、Ctrl+Space 补全。
// **未复制 VSCode 源码**，只对齐交互；出处见 README 的「来源」节。
// 补全两类（2026-10-16 加第 2 类）：
//   1) 本文词（VSCode 的 word based suggestions 口径）：草稿里出现过的标识符，本地即时算，不等网络；
//   2) 语言词表：HTML 标签 / JS·Python·Java 关键字 / CSS 属性名，服务端 lib/words.js 供，
//      数据借自 monaco-editor、codemirror、MDN BCD（均为宽松许可，源地址与 commit 见 words.js 头部与 THIRD-PARTY.md）。
// 触发：'/' 与 '@'，以及**打满两个标识符字符就自动弹**（VSCode 手感）；Tab/Enter 接受、Esc 关、上下选。
window.__ModuleLoader__.load({
  id: 'dsh-composer-pro',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var ROUTE_WORDS = '/dsh-composer-pro/words'
    // 2026-10-16 加全角/中文成对符：维护者实测「输入（ 只出（」——中文输入法下原来完全没有配对。
    // 全角走 input 事件那条补配对（IME 合成的字符不一定有对应的 keydown）。
    var PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', "'": "'",
                  '（': '）', '【': '】', '「': '」', '《': '》', '“': '”', '‘': '’' }
    var CLOSERS = { ')': '(', ']': '[', '}': '{', '`': '`', '"': '"', "'": "'",
                    '）': '（', '】': '【', '」': '「', '》': '《', '”': '“', '’': '‘' }

    // ── 纯逻辑（selftest 直接喂）───────────────────────────────────────────
    /** 该不该自动配对：光标前是标识符/路径字符时别配对（保护 a(b 之外的路径、命名）。 */
    function shouldPair(before) {
      var last = before.slice(-1)
      if (/[\u4e00-\u9fff]$/.test(last)) return true      // 中文正文后面当然要配对
      return !/[A-Za-z0-9_./\\@#-]$/.test(last)
    }
    /** 取 caret 前的当前 token（补全用）：文件/标识符字符集，遇空白或换行截断。 */
    function tokenBefore(text) {
      var m = String(text || '').match(/([A-Za-z0-9_./@:,-]*)$/)
      return m ? m[1] : ''
    }
    /** 键位决策表：返回动作名，selftest 与真实监听共用判据。 */
    function keyAction(k) {
      if (k.ctrl && k.code === 'Space') return 'complete'
      if (k.key === 'Escape') return 'dismiss'
      // 2026-10-16（维护者真机踩到）：聊天框里**回车必须发送**，不能被补全弹层吃掉。
      // 原来 Enter 也算接受，弹层开着时连按回车就把候选一遍遍插进正文（打出
      // "i临时目录/attrib-index.dif临时目录/attrib-index.dif…" 那种滚雪球）。接受只留 Tab。
      if (k.__popupOpen && k.key === 'Tab') return 'accept'
      if (k.key === 'Backspace' && !k.__collapsedFalse) return 'pairbackspace'
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
    function moveCaret(ed, delta) {
      try {
        if (isText(ed)) { ed.selectionStart = ed.selectionEnd = Math.max(0, ed.selectionStart + delta); return }
        var off = caretOffset(ed)
        if (off >= 0) setSelectionRange(ed, off + delta, off + delta)
      } catch (e) {}
    }
    function selectBack(ed, n) { // 把 caret 前 n 个字符变成选区（补全替换 token 用）
      try {
        if (isText(ed)) { ed.selectionStart = Math.max(0, ed.selectionStart - n); return }
        var off = caretOffset(ed)
        if (off >= 0) setSelectionRange(ed, Math.max(0, off - n), off)
      } catch (e) {}
    }
    /** 环绕选区：插入 open+内容+close 之后，把选区精确还原到**内层内容**上（VSCode 手感）。 */
    function surroundSelection(ed, open, selTxt, close) {
      try {
        insertText(ed, open + selTxt + close)
        if (isText(ed)) {
          var end = ed.selectionStart - close.length           // 闭符之前
          ed.selectionStart = Math.max(0, end - selTxt.length) // 内层起点
          ed.selectionEnd = end
          return
        }
        var restore = function () {
          var off = caretOffset(ed)
          var innerEnd = (off >= 0 ? off : flatText(ed).length) - close.length
          setSelectionRange(ed, Math.max(0, innerEnd - selTxt.length), innerEnd)
        }
        if (isText(ed)) restore()
        else soon(restore)   // 同上：等 Lexical 落定
      } catch (e) {}
    }

    // 弹层：一个 fixed div，数据来自 words 路由
    var popup = { root: null, items: [], index: 0, open: false, sig: '' }
    function ensurePopup() {
      if (popup.root) return popup.root
      var d = document.createElement('div')
      d.id = 'dsh-cp-popup'
      d.setAttribute('data-dsh-plugin', 'dsh-composer-pro')
      d.style.cssText = 'position:fixed;z-index:2147480000;display:none;overflow-y:auto;overflow-x:hidden;' +
        'border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;' +
        'background:var(--dsw-alias-bg-layer-2,#1e1e1e);color:var(--dsw-alias-label-primary,inherit);' +
        'font:var(--dsw-font-xs,12.5px)/1.6 ui-monospace,Consolas,monospace;box-shadow:0 8px 24px rgba(0,0,0,.35)'
      document.body.appendChild(d)
      popup.root = d
      return d
    }
    /** 光标（caret）位置：弹层锚在光标上，而不是输入框左边缘 —— 否则一行长文时弹层会盖住半个视野。
     *  只读地量，不往宿主 DOM 里塞临时节点（那会扰动 Lexical）。 */
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

    function renderPopup(anchor, force) {
      var d = ensurePopup()
      var sig = itemsSignature(popup.items)
      if (!force && popup.open && sig === popup.sig) return   // 列表没变就别重画：打字快时不再抖
      popup.sig = sig
      d.innerHTML = ''
      popup.items.forEach(function (it, i) {
        var row = document.createElement('div')
        var label = String(it.value)
        var m = (it.matches && it.matches.length) ? it.matches : null
        row.innerHTML = m ? boldHtml(label, m) : escapeHtml(label.length > 60 ? label.slice(0, 57) + '…' : label)
        var tag = document.createElement('span')
        tag.textContent = ' ' + kindLabel(it)
        tag.style.cssText = 'opacity:.4;font-size:11px;font-weight:400'
        row.appendChild(tag)
        row.style.cssText = 'padding:3px 10px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
          (i === popup.index ? 'background:var(--dsw-alias-interactive-bg-hover,#2a2d33)' : '')
        row.onmousedown = function (ev) { ev.preventDefault(); acceptCurrent() }
        row.onmouseenter = function () { popup.index = i; renderPopup(anchor, true) }
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
    /* 行内提示（VSCode 的 inline suggestion 手感，维护者原话「可以在前面添加类似 abc 的提示」）：
     * 首位候选比已打的前缀多出来的那截，用灰字贴在光标后面；不往宿主 DOM 里插节点，只浮一个 div。 */
    var ghost = { el: null }
    function ensureGhost() {
      if (ghost.el) return ghost.el
      var d = document.createElement('div')
      d.id = 'dsh-cp-ghost'
      d.setAttribute('data-dsh-plugin', 'dsh-composer-pro')
      d.style.cssText = 'position:fixed;z-index:2147479999;display:none;pointer-events:none;white-space:pre;' +
        'color:var(--dsw-alias-label-secondary,rgba(165,175,190,.8));opacity:.8'
      document.body.appendChild(d)
      ghost.el = d
      return d
    }
    function hideGhost() { if (ghost.el) ghost.el.style.display = 'none' }
    function showGhost(ed, token) {
      try {
        var top = popup.items[0]
        var v = top ? String(top.value || '') : ''
        var t = String(token || '')
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

    function closePopup() { if (popup.root) popup.root.style.display = 'none'; popup.open = false; popup.items = []; popup.sig = ''; lastSelText = ''; hideGhost() }
    var lastPrefix = null, inflight = 0

    /** 草稿里已有的单词（VSCode word based suggestions 的口径：标识符形状、长度≥3、按出现次数排）。 */
    function docWords(text, token) {
      var t = String(token || '').toLowerCase()
      if (!t) return []
      var counts = {}, m
      var re = /[A-Za-z_][A-Za-z0-9_]{2,}/g
      while ((m = re.exec(String(text || ''))) !== null) {
        var w = m[0]
        if (w.toLowerCase() === t) continue
        counts[w] = (counts[w] || 0) + 1
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

    function fetchCandidates(prefix, ed) {
      var local = docWords(composerText(ed), prefix)
      var fenced = langHint(composerText(ed))
      if (fenced) habitBump(fenced, 1)
      var lang = fenced || habitTop()      // 没写围栏时按习惯用哪套词表
      if (local.length) { popup.items = local; popup.index = 0; renderPopup(ed) }  // 本地词先上屏，不等网络
      inflight++
      var seq = inflight
      fetch(ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&lang=' + encodeURIComponent(lang))
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (seq !== inflight) return // 后发先至的旧响应丢掉（补全弹层最怕错位）
          var items = local.slice(), seen = {}
          local.forEach(function (i) { seen[i.value] = 1 })
          if (d && d.ok === true) (d.candidates || []).forEach(function (c) { if (c && !seen[c.value]) { seen[c.value] = 1; items.push(c) } })
          if (!items.length) { closePopup(); return }
          popup.items = items.slice(0, 12); popup.index = 0; renderPopup(ed); showGhost(ed, prefix)
        })
        .catch(function () { if (!local.length) closePopup() })
    }
    var suppressInput = 0   // 我们自己插入文本后会派发 input；别让它回来又开一次弹层（连按即滚雪球）
    function acceptCurrent() {
      var it = popup.items[popup.index]
      var ed = lastComposer
      closePopup()
      if (!it || !ed) return
      if (it.lang) habitBump(it.lang, 2)     // 接受过哪套词表的候选，就算在用哪门语言
      var tok = lastToken || ''
      if (tok) selectBack(ed, tok.length)
      suppressInput++
      insertText(ed, it.kind === 'file' ? it.value.replace(/\\/g, '/') : it.value)
    }

    var lastComposer = null, lastToken = '', lastSelText = ''

    /* 语言习惯：观察维护者实际在用什么语言（围栏标记、以及接受过哪套词表的候选），
     * 存本地，下一次没写围栏时就按习惯上词表 —— 维护者原话「通过观察用户操作习惯选择使用哪个语言」。 */
    var HABIT_KEY = 'dsh-composer-pro:lang-habit'
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

    function onKeyDown(ev) {
      var ed = composerOf(ev.target)
      if (!ed) { if (popup.open) closePopup(); return }
      lastComposer = ed
      var k = { key: ev.key, code: ev.code, ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey,
                __popupOpen: popup.open, __collapsedFalse: !!(ev.target && ev.target === ed && selectedText(ed)) }
      // 记下这一键按下时的选区：IME/全角那条路 keydown 拿不到字符，靠 input 事件回头补框选
      lastSelText = selectedText(ed)
      var act = keyAction(k)
      if (!act) return
      // 弹层优先：Tab/Enter 接受、Esc 关闭、上下选
      if (popup.open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault()
        popup.index = (popup.index + (ev.key === 'ArrowDown' ? 1 : -1) + popup.items.length) % popup.items.length
        renderPopup(ed); return
      }
      if (act === 'dismiss') { if (popup.open) { ev.preventDefault(); closePopup() } return }
      if (act === 'accept' && popup.open) { ev.preventDefault(); acceptCurrent(); return }
      if (act === 'complete') {
        ev.preventDefault()
        lastToken = tokenBefore(textBeforeCaret(ed))
        fetchCandidates(lastToken, ed)
        return
      }
      // 2026-10-16（维护者反馈「选中后 shift+符号框不起来」）：原来这里排除了 shift，
      // 于是 `{` `"` 这类要按 Shift 才打出来的开符、以及中文输入法 Shift+9 的「（」全都不配对。
      // 配对动作只对开符触发，Shift 不影响判断，放开它。
      if (act === 'pairopen' && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        var before = textBeforeCaret(ed)
        var open = ev.key, close = PAIRS[open]
        var selTxt = selectedText(ed)
        ev.preventDefault()
        if (selTxt) surroundSelection(ed, open, selTxt, close)   // 环绕选区（2026-10-16 修：选区还原到内层）
        else if (shouldPair(before)) {
          insertText(ed, open + close)
          if (isText(ed)) moveCaret(ed, -1)
          else soon(function () { moveCaret(ed, -1) })   // 等 Lexical 落定再摆光标
        } else insertText(ed, open)
        return
      }
      if (act === 'pairclose') {
        var expect = CLOSERS[ev.key]
        if (!selectedText(ed) && caretChar(ed, +1) === ev.key && PAIRS[expect] === ev.key) {
          // 后面就是应得的闭合符：跳过而不是再插一个（反引号对称，同判据成立）
          ev.preventDefault()
          if (isText(ed)) moveCaret(ed, +1)
          else soon(function () { moveCaret(ed, +1) })
          return
        }
        return
      }
      if (act === 'pairbackspace' && !selectedText(ed)) {
        var prev = caretChar(ed, -1), next = caretChar(ed, +1)
        if (PAIRS[prev] === next) { // 光标正好夹在空对里：一次删掉两侧（VSCode 同款）
          ev.preventDefault()
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

    function onInput(ev) { // 三种触发：'/' 与 '@'（引用/模型）、打标识符两个字母起自动弹（VSCode 手感）
      var ed = composerOf(ev.target)
      if (!ed) return
      if (suppressInput > 0) { suppressInput--; return }   // 这是接受候选时自己插的，别再弹
      lastSelText = ''
      // 全角/中文成对符走这条：IME 合成的字符不一定带对应 keydown，keydown 那条路抓不到。
      var b0 = textBeforeCaret(ed)
      var prev = b0.slice(-1)
      var want = PAIRS[prev]
      if (want && prev.charCodeAt(0) > 127 && caretChar(ed, +1) !== want && shouldPair(b0.slice(0, -1))) {
        suppressInput++                                   // 自己插的闭符别再触发一轮
        insertText(ed, want)
        if (isText(ed)) moveCaret(ed, -1)
        else soon(function () { moveCaret(ed, -1) })
        return
      }
      var before = textBeforeCaret(ed)
      lastComposer = ed
      var m = before.match(/(^|\s)([/@])([A-Za-z0-9_.\\/:,-]*)$/)
      if (m) { lastToken = m[2] + m[3]; fetchCandidates(lastToken, ed); return }
      var w = before.match(/([A-Za-z_][A-Za-z0-9_]{1,})$/)
      if (w) { lastToken = w[1]; fetchCandidates(lastToken, ed); return }
      if (popup.open) closePopup()
    }
    /* 框选 + 打符号（维护者原话「选中然后 shift 加符号框住」）：
     * keydown 那条路对半角好使；**中文输入法/全角没有可用的 keydown**，所以再挂一条 beforeinput ——
     * 它在 DOM 变更前触发且可取消，能拿到真正要插入的字符，这时候选区还在。
     * （input 事件太晚：宿主已经把选区替换成那个字符了，只剩「（）」没有内容。） */
    function onBeforeInput(ev) {
      try {
        var ed = composerOf(ev.target)
        if (!ed || suppressInput > 0) return
        var data = ev && typeof ev.data === 'string' ? ev.data : ''
        if (data.length !== 1 || !PAIRS[data]) return
        var selTxt = selectedText(ed)
        if (!selTxt) return
        ev.preventDefault()
        surroundSelection(ed, data, selTxt, PAIRS[data])
      } catch (e) {}
    }

    function onBlurOut(ev) {
      var ed = composerOf(ev.relatedTarget)
      if (!ed && popup.open) closePopup()
    }

    function apply(ctx) {
      var d = document
      d.addEventListener('keydown', onKeyDown, true)   // capture：先于 Lexical 自己的键位
      d.addEventListener('beforeinput', onBeforeInput, true)
      d.addEventListener('input', onInput, true)
      d.addEventListener('focusout', onBlurOut, true)
      return function () {
        d.removeEventListener('keydown', onKeyDown, true)
        d.removeEventListener('beforeinput', onBeforeInput, true)
        d.removeEventListener('input', onInput, true)
        d.removeEventListener('focusout', onBlurOut, true)
        closePopup()
      }
    }

    exports.apply = apply
    exports.inject = []
    exports.__helpers__ = { PAIRS: PAIRS, CLOSERS: CLOSERS, shouldPair: shouldPair, tokenBefore: tokenBefore, keyAction: keyAction, docWords: docWords, langHint: langHint }
    return module.exports
  },
})
