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
    /** 该不该自动补闭符（VS Code 的那条规则）：
     *  ① 光标前是标识符/路径字符 → 不配（保护 `a(b`、`E:/path` 这类写法）；
     *  ② **光标右边紧跟字母/数字/汉字 → 不配，只插这一个开符** —— 正是「在一段已有文字前打前引号」
     *     的场景（维护者 2026-10-16 真机踩到：被补成一对，于是多出一个引号）；
     *  ③ 右边是空白、闭符、行尾才补。 */
    function shouldPair(before, after) {
      if (/[A-Za-z0-9_\u4e00-\u9fff]/.test(String(after || ''))) return false
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

    /** 上下文候选：把**页面上可见的对话文本**里的标识符挖出来（只读，不动宿主 DOM）。
     *  这是「提示内容跟上下文强关联」的来源：对话里出现过的词，打前缀就能补出来。2 秒缓存。 */
    var ctxCache = { text: '', words: [], at: 0 }
    function contextWords(ed) {
      try {
        var now = Date.now()
        if (now - ctxCache.at < 2000 && ctxCache.words.length) return ctxCache.words
        // 整页可见文本直接用（不裁剪：2026-10-16 实测用 split(草稿) 抠自己人时，
        // 「inst」是「install_quarantine」的子串，会把上下文里的词劈坏）。自己人的重复交给去重处理。
        var text = document.body && document.body.innerText ? String(document.body.innerText).slice(-12000) : ''
        var counts = {}, m
        // 汉字词也收（2~8 个连续汉字算一个词）：「文档」「变量」这类中文词不进池子，
        // 光靠英文标识符就永远补不出来（维护者 2026-10-16 指出）。
        var re = /[A-Za-z_][A-Za-z0-9_]{3,}|[\u4e00-\u9fff]{2,8}/g
        var CJK_STOP = { 我们: 1, 你们: 1, 他们: 1, 这个: 1, 那个: 1, 一个: 1, 什么: 1, 怎么: 1,
                         因为: 1, 所以: 1, 然后: 1, 如果: 1, 就是: 1, 可以: 1, 没有: 1, 已经: 1,
                         还是: 1, 但是: 1, 而且: 1, 现在: 1 }
        var STOP = { this: 1, that: 1, with: 1, from: 1, your: 1, have: 1, will: 1, that: 1, there: 1, their: 1, what: 1,
                     when: 1, then: 1, than: 1, they: 1, been: 1, were: 1, void: 1, true: 1, false: 1, null: 1 }
        while ((m = re.exec(text)) !== null) {
          var w = m[0]
          var low = w.toLowerCase()
          if (STOP[low] || CJK_STOP[w]) continue
          counts[w] = (counts[w] || 0) + 1
          if (/^[\u4e00-\u9fff]+$/.test(w)) {
            for (var gi = 0; gi + 2 <= w.length; gi++) {
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
        // 布局照 VS Code：左边类型图标、中间标签（命中字符加粗）、**右边**淡类型词——
        // 类型信息一律在右侧，不会跑到候选名前面去（维护者 2026-10-16 提的排版问题）。
        row.innerHTML = '<span style="flex:0 0 auto;line-height:0">' + kindIcon(it) + '</span>' +
          '<span style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (m ? boldHtml(label, m) : escapeHtml(label.length > 60 ? label.slice(0, 57) + '…' : label)) + '</span>' +
          '<span style="flex:0 0 auto;opacity:.4;font-size:11px;font-weight:400;margin-left:8px">' + escapeHtml(kindLabel(it)) + '</span>'
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;' +
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
      // 英文标识符 + 连续汉字词（2~8 字）都收；普通长串再补一个 2 字前缀，
      // 这样「文档里的变量」里也能提出「文档」（维护者 2026-10-16 要的「像提示变量那样」）。
      var re = /[A-Za-z_][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,8}/g
      var CJKONLY = /^[\u4e00-\u9fff]+$/
      while ((m = re.exec(String(text || ''))) !== null) {
        var w = m[0]
        if (w.toLowerCase() === t) continue
        counts[w] = (counts[w] || 0) + 1
        if (CJKONLY.test(w)) {
          // 中文没有空格分词：把每个连续汉字串拆成二元组/三元组，
          // 「先写一段关于文档的说明」里才能提出「文档」（草稿范围小，代价可忽略）。
          for (var ci = 0; ci + 2 <= w.length; ci++) {
            var g2 = w.slice(ci, ci + 2)
            if (g2 !== t) counts[g2] = (counts[g2] || 0) + 1
            if (ci + 3 <= w.length) {
              var g3 = w.slice(ci, ci + 3)
              if (g3 !== t) counts[g3] = (counts[g3] || 0) + 1
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

    /** 从**上下文文本**（草稿 + 页面上可见的对话）推语言：围栏之外的第二条腿。
     *  这是「提示内容跟上下文没有强关联」的补法——说到 python/def/.py 就不该再给 HTML 标签。 */
    function inferLang(text) {
      var t = String(text || '')
      if (!t) return ''
      var score = { python: 0, javascript: 0, html: 0, css: 0, java: 0 }
      var bump = function (lang, re, weight) {
        var m = t.match(re)
        if (m) score[lang] += (m.length) * (weight || 1)
      }
      bump('python', /\b(def|import|from|elif|lambda|None|True|False|self)\b/g, 1)
      bump('python', /\.py\b|\bpip\b|\bpytest\b|\bvenv\b/g, 2)
      bump('javascript', /\b(const|let|var|function|=>|async|await|module\.exports|require)\b/g, 1)
      bump('javascript', /\.(js|mjs|ts|tsx|json)\b|\bnpm\b|\bnode\b/g, 2)
      bump('html', /<\/?[a-z][a-z0-9-]*\b|\bclass=|\bid=|<\/div>|\b<!doctype\b/gi, 2)
      bump('css', /\b(color|display|margin|padding|font-size|background)\s*:|\{[^}]*:[^}]*\}/g, 1)
      bump('java', /\b(public|private|protected|void|new|class\s+\w+|System\.out)\b/g, 1)
      var best = '', top = 0
      for (var k in score) { if (score[k] > top) { top = score[k]; best = k } }
      return top >= 2 ? best : ''
    }

    function fetchCandidates(prefix, ed) {
      var draft = composerText(ed)
      var prefixList = [String(prefix || '')]
      if (/^[\u4e00-\u9fff]+$/.test(prefixList[0])) {
        for (var pl2 = prefixList[0].length - 1; pl2 >= 1; pl2--) prefixList.push(prefixList[0].slice(-pl2))
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
      // 语言优先级：围栏 → 上下文推断（草稿 + 页面对话）→ 习惯
      var lang = fenced || inferLang(draft + ' ' + contextWords(ed).join(' ')) || habitTop()
      // 上下文候选：对话里出现过的标识符按前缀补出来（跟上下文强关联的那一路）
      // 中文没有分词：整段汉字会被当成一个 token，所以按「1~4 字后缀」各试一次（长的优先），
      // 打「文」也能命中草稿里更早出现的「文档」（维护者 2026-10-16 的原话要求）。
      var p0 = String(prefix || '')
      var pfxList = [p0]
      if (/^[\u4e00-\u9fff]+$/.test(p0)) {
        for (var pl = p0.length - 1; pl >= 1; pl--) pfxList.push(p0.slice(-pl))
      }
      var ctxItems = []
      var seenLocal = {}
      local.forEach(function (i) { seenLocal[i.value.toLowerCase()] = 1 })
      contextWords(ed).forEach(function (w) {
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
      var first = local.concat(ctxItems)
      if (first.length) { popup.items = first; popup.index = 0; renderPopup(ed) }  // 本地与上下文先上屏，不等网络
      inflight++
      var seq = inflight
      fetch(ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&lang=' + encodeURIComponent(lang))
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (seq !== inflight) return // 后发先至的旧响应丢掉（补全弹层最怕错位）
          var items = local.slice(), seen = {}
          local.forEach(function (i) { seen[i.value] = 1 })
          ctxItems.forEach(function (c) { if (!seen[c.value]) { seen[c.value] = 1; items.push(c) } })
          if (d && d.ok === true) (d.candidates || []).forEach(function (c) { if (c && !seen[c.value]) { seen[c.value] = 1; items.push(c) } })
          if (!items.length) { closePopup(); return }
          popup.items = items.slice(0, 12); popup.index = 0; renderPopup(ed); showGhost(ed, prefix)
        })
        .catch(function () { if (!first.length) closePopup() })
    }
    var suppressInput = 0   // 我们自己插入文本后会派发 input；别让它回来又开一次弹层（连按即滚雪球）
    var caretEpoch = 0      // 每次按键 +1；延后的光标复位只认最后一次
    /** 延后复位光标：**只有最后一次调度有效**。2026-10-16 实测：快速连打引号时，
     *  多个延迟回调各自把光标拨回旧偏移，下一个引号就插在旧位置，于是引号成串。 */
    function deferCaretAt(ed, target) {
      if (target < 0) return
      var epoch = ++caretEpoch
      soon(function () { if (epoch === caretEpoch) setSelectionRange(ed, target, target) })
    }
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
      caretEpoch++            // 新按键作废上一键挂起的光标复位（否则旧回调会把光标拨回去）
      var k = { key: ev.key, code: ev.code, ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey,
                __popupOpen: popup.open, __collapsedFalse: !!(ev.target && ev.target === ed && selectedText(ed)),
                __nextIsCloser: caretChar(ed, +1) === ev.key }
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
      if (act === 'pairopen' && ev.repeat) {
        // 按住符号键的自动重复：只插一个字符，不再成对（否则越按越多）
        ev.preventDefault()
        insertText(ed, ev.key)
        return
      }
      if (act === 'pairopen' && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        var before = textBeforeCaret(ed)
        var open = ev.key, close = PAIRS[open]
        var selTxt = selectedText(ed)
        ev.preventDefault()
        if (selTxt) surroundSelection(ed, open, selTxt, close)   // 环绕选区（2026-10-16 修：选区还原到内层）
        else if (caretChar(ed, +1) === close) {
          // 右边已经是这一对：跳过去，别再套一对（`“”` 中间再打 `“` 会变成一对套一对）
          if (isText(ed)) moveCaret(ed, +1)
          else soon(function () { moveCaret(ed, +1) })
        } else if (close === open && before.slice(-1) === open) {
          // 对称引号（" ' `）前面已经是同一个引号：只插一个，不再凑成一对。
          // VS Code 的引号规则；不补这条时连按引号会 2→4→6 成串（维护者 2026-10-16 报的「多个引号」）。
          insertText(ed, open)
        } else if (shouldPair(before, caretChar(ed, +1))) {
          insertText(ed, open + close)
          // 立刻摆到中间：紧接着的下一个键必须看到正确的 caret（2026-10-16 实测竞态：
          // 原来只靠 soon() 延后摆位，快速连打两个引号时第二个键看不到右边已有闭符，就又多插了一对）
          moveCaret(ed, -1)
          if (!isText(ed)) {
            // 延后确认必须按**绝对位置**复位：再相对 -1 挪一次会把光标挪到开符之前（2026-10-16 实测）
            var keep = caretOffset(ed)
            deferCaretAt(ed, keep)
          }
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
      if (want && prev.charCodeAt(0) > 127 && caretChar(ed, +1) !== want && shouldPair(b0.slice(0, -1), caretChar(ed, +1))) {
        suppressInput++                                   // 自己插的闭符别再触发一轮
        insertText(ed, want)
        moveCaret(ed, -1)                                   // 同上：立刻摆位，别等一拍
        if (!isText(ed)) {
          var keep2 = caretOffset(ed)
          deferCaretAt(ed, keep2)
        }
        return
      }
      var before = textBeforeCaret(ed)
      lastComposer = ed
      var m = before.match(/(^|\s)([/@])([A-Za-z0-9_.\\/:,-]*)$/)
      if (m) { lastToken = m[2] + m[3]; fetchCandidates(lastToken, ed); return }
      var w = before.match(/([A-Za-z_][A-Za-z0-9_]{1,}|[\u4e00-\u9fff]{1,})$/)
      if (w) {
        var tok = w[1]
        // 汉字没有空格分词：整句会被当成一个 token，取最后 4 个字当前缀（够长又不至于永不命中）
        if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 4) tok = tok.slice(-4)
        lastToken = tok
        fetchCandidates(lastToken, ed)
        return
      }
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
      // 单例：同一页面被重复装载（HMR/重复注册）时，一次按键会被两套监听各处理一遍 → 引号/括号翻倍。
      if (typeof window !== 'undefined' && window.__DSH_COMPOSER_PRO_APPLIED__) {
        try { console.warn('[dsh-composer-pro] already applied, skip duplicate mount') } catch (e) {}
        return function () {}
      }
      if (typeof window !== 'undefined') window.__DSH_COMPOSER_PRO_APPLIED__ = true
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
        if (typeof window !== 'undefined') window.__DSH_COMPOSER_PRO_APPLIED__ = false
        closePopup()
      }
    }

    exports.apply = apply
    exports.inject = []
    exports.__helpers__ = { PAIRS: PAIRS, CLOSERS: CLOSERS, shouldPair: shouldPair, tokenBefore: tokenBefore, keyAction: keyAction, docWords: docWords, langHint: langHint, inferLang: inferLang, contextWords: contextWords, contextReset: function () { ctxCache.at = 0; ctxCache.words = [] }, caretChar: caretChar, caretOffset: caretOffset, flatText: flatText }
    return module.exports
  },
})
