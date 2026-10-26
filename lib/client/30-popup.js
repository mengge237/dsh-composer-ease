// ── 模块：补全弹层 ────────────────────────────────
// 弹层 DOM、候选渲染与行样式、光标定位、类型图标、以及本文词（contextWords）的收集。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var popup = { root: null, items: [], index: 0, open: false, sig: '', wm: null }
    function ensurePopup() {
      if (popup.root) return popup.root
      // 同一页面可能被装了两份插件（本地路径 + GitHub 各一份）：复用已有的同一个元素，
      // 否则两套实例各画一个弹层，就成了「一个在输入框左上、一个在光标后」的两个框（维护者 2026-10-16 实测）。
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

    /** 只取**对话正文区**，不取整页（2026-10-19 改）。
     *  宿主给的锚点在 0.2.0-rc.2 的 dsh-client-ui-chat 里实测有两处：
     *  `[data-conversation-scroll]` 与 `[data-slot="conversation.chat.node"]`。
     *  为什么不读 document.body：左侧栏与设置面板里的词不是「对话内容」，算进候选既跑题，
     *  又会把弹层自己画出来的候选再喂回池子（自我喂养）。抓不到就回空串 —— 上层自然退回只看草稿，
     *  不抛错、不往宿主 DOM 里写任何东西。 */
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
     *  这是「提示内容跟上下文强关联」的来源：对话里出现过的词，打前缀就能补出来。2 秒缓存。 */
    var ctxCache = { text: '', words: [], at: 0 }
    function contextWords(ed) {
      try {
        var now = Date.now()
        if (now - ctxCache.at < 2000 && ctxCache.words.length) return ctxCache.words
        // 只吃对话正文（不裁剪：2026-10-16 实测用 split(草稿) 抠自己人时，
        // 「inst」是「install_quarantine」的子串，会把上下文里的词劈坏）。自己人的重复交给去重处理。
        var text = conversationText()
        var counts = {}, m
        // 汉字词也收（2~8 个连续汉字算一个词）：「文档」「变量」这类中文词不进池子，
        // 光靠英文标识符就永远补不出来（维护者 2026-10-16 指出）。
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
          counts[w] = (counts[w] || 0) + 1
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

    /** 显示层折叠（2026-10-22 维护者：「类似字样直接挑明 dsh 的全名就好」）：
     *  harness/依赖目录里的文件不展开长路径，只显示 `dsh: <文件名>`；其它类型原样。
     *  只影响**显示**，插进正文的仍是完整路径（it.value）。 */
    var HARNESS_LABEL = /(deepseek[-_]harness|dsh-(fixes|kit|shim|020rc2|017)|node_modules|(^|\/)plugins\/)/i
    function foldLabel(it) {
      var v = String(it.value || '')
      if (it.kind !== 'file' || !HARNESS_LABEL.test(v)) return v
      var base = v.slice(v.lastIndexOf('/') + 1)
      return 'dsh: ' + base
    }

    function renderPopup(anchor, force) {
      var d = ensurePopup()
      var sig = itemsSignature(popup.items) + '#' + (popup.wm ? popup.wm.text + popup.wm.angle : '')
      if (!force && popup.open && sig === popup.sig) return   // 列表没变就别重画：打字快时不再抖
      popup.sig = sig
      d.innerHTML = ''
      // 语言水印（2026-10-20 维护者定的口径）：不再在顶上写「据对话推断 · java」那种句子，
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
        // 类型信息一律在右侧，不会跑到候选名前面去（维护者 2026-10-16 提的排版问题）。
        row.innerHTML = '<span style="flex:0 0 auto;line-height:0">' + kindIcon(it) + '</span>' +
          '<span style="flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          (m ? boldHtml(label, m) : escapeHtml(label.length > 60 ? label.slice(0, 57) + '…' : label)) + '</span>' +
          '<span style="flex:0 0 auto;opacity:.4;font-size:11px;font-weight:400;margin-left:8px">' + escapeHtml(kindLabel(it)) + '</span>'
        // 选中态自己给一套看得见的样式：主题的 interactive-bg-hover 实测是 rgba(38,49,72,.06)，
        // 深色背景下等于没有（维护者 2026-10-22：上下键改了选中也看不出来）。
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;' +
          (i === popup.index ? SEL_STYLE : '')
        // 用**被点这一行**的下标接受：早先只读 popup.index（靠悬停更新），
        // 没有 hover 时点任何一行都等于接受第一条（2026-10-22 报「点击提示框没反应」）。
        row.onmousedown = function (ev) { ev.preventDefault(); popup.index = i; acceptCurrent() }
        // 悬停只换高亮：早先这里调 renderPopup 重建整层，鼠标一进去脚下的节点就被换掉，
        // mousedown 落不到稳定节点 → 「点击提示框没反应」（维护者 2026-10-22）。
        row.onmouseenter = function () {
          if (popup.index === i) return
          popup.index = i
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
    /* 行内提示（VSCode 的 inline suggestion 手感，维护者原话「可以在前面添加类似 abc 的提示」）：
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

    /* 「弹层代数」：每次 closePopup 就 +1。
     * 2026-10-21 维护者报「快速点回车后，那个修字提示留在输入框里」——
     * 真因是候选请求的 .then 在回车清场**之后**才回来，把浮层与灰字又画了一遍。
     * 发请求那一刻记下代数，响应回来对不上就直接丢弃，别去猜"还能不能画"。 */
    var popupEpoch = 0
    function closePopup() { popupEpoch++; if (popup.root) popup.root.style.display = 'none'; popup.open = false; popup.items = []; popup.sig = ''; lastSelText = ''; hideGhost() }
    var lastPrefix = null, inflight = 0

    /** 草稿里已有的单词（VSCode word based suggestions 的口径：标识符形状、长度≥3、按出现次数排）。 */
