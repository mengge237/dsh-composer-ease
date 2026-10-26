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
     * 在模块层引用它们，运行时抛 ReferenceError 被 try 吞掉，红线永远不出现（2026-10-23 修）。 */
    var quoteLintTimer = null

    /** 「未闭合引号」计数：**撇号不算**——`let's` / `don't` 里的 ' 与 ’ 被词字符夹着，
     *  那是英文所有格，不是引号（维护者 2026-10-22：从没打引号也会冒出标红）。 */
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
      try {
        if (bad) {
          box.setAttribute('data-dce-quote-warn', '1')
          box.setAttribute('data-dce-quote-hint', ' 引号/反引号未闭合')
          if (box.setAttribute) box.setAttribute('title', '引号/反引号未闭合')
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
      // 2026-10-20：`“文字` 末尾再打 `“` 时，上一行插入的是「闭合」而不是「开启」，
      // 这里若还去补 `”` 就会变成 `“文字“”`（维护者报的「前方有引号、后方还出一对」）。
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
      var m = before.match(/(^|\s)([/@])([A-Za-z0-9_.\\/:,-]*)$/)
      if (m) {
        // '/' 是 DSH 原生命令入口（dsh-commands：command/run、command/done）：
        // 插件不插手，免得两份菜单叠在一起、也免得给那条路加延迟（维护者 2026-10-21 要求融合而不是抢）。
        if (m[2] === '/') { if (popup.open) closePopup(); return }
        lastToken = m[2] + m[3]; fetchCandidates(lastToken, ed); return
      }
      var w = before.match(/([A-Za-z_][A-Za-z0-9_]{1,}|[\u4e00-\u9fff]{1,})$/)
      if (w) {
        var tok = w[1]
        // 汉字没有空格分词：整句会被当成一个 token，取最后 4 个字当前缀（够长又不至于永不命中）
        if (/^[\u4e00-\u9fff]+$/.test(tok)) {
          // 中文至少要 2 个字才算「完整词义」，单字不提示（维护者 2026-10-16 要求）
          if (tok.length < 2) { if (popup.open) closePopup(); return }
          if (tok.length > 4) tok = tok.slice(-4)
        }
        lastToken = tok
        fetchCandidates(lastToken, ed)
        return
      }
      if (popup.open) closePopup()
    }
    /* 框选 + 打符号（维护者原话「选中然后 shift 加符号框住」）：
     * keydown 那条路对半角好使；**中文输入法/全角没有可用的 keydown**，所以再挂一条 beforeinput。
     * 2026-10-20 真机取证（demo 3081 + Playwright）把两条老假设推翻了：
     *  ① keydown 里读 DOM **不是**空的 —— 探针读数 `text='\"你好' caret=3` 都对，影子状态不需要；
     *  ② `preventDefault()` **拦不住 Lexical**：它照自己的模型再插一遍，于是「拦 + 自己插」出双份。
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
          // （真机读数：选中 abc 打 “ → `““abc”`）。所以框完之后把多出来的那一个删掉。
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
    /** 原生那一个字符落地之后收尾。**幂等**：真机上 `input` 有时来有时不来，
     *  onInput 那条补闭符的路和这里会撞在一起 —— 谁先到都只补一次（落地后先读有没有闭符）。 */
    function flushBeforeFix() {
      var p = pendingFix
      if (!p) return
      pendingFix = null
      try {
        var ed = p.ed, now = textOf(ed)
        if (p.action === 'surround') {
          // 粘贴那一下是 Lexical 自己异步落的（真机读数：soon 那一拍还只有原生那个开符），
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
     * 位置、上下选、插入与撤销都由宿主负责。我们只提供 candidates 与 onPick，
     * 不再自己画弹层、也不再跟宿主抢触发字符。 */
    /* 「严格配对」开关（维护者 2026-10-21 要求：普通情况不必那么严，需要时可开）。
     * 存在 localStorage，默认 false；由 '/' 菜单里我们那组的第一条切换。 */
    var PAIR_STRICT_KEY = 'dsh-composer-ease:pairStrict'
    function pairStrict() {
      try { return window.localStorage.getItem(PAIR_STRICT_KEY) === '1' } catch (e) { return false }
    }
    function setPairStrict(on) {
      try { window.localStorage.setItem(PAIR_STRICT_KEY, on ? '1' : '0') } catch (e) {}
    }

    /* 引号模式（维护者 2026-10-23 要求）：'warn' = 不自动补闭引号，未闭合时标红提示（VS Code 的
     * 「标红而不是硬改」口径，默认）；'auto' = 老行为，打一个引号补一对。 */
    var QUOTE_MODE_KEY = 'dsh-composer-ease:quoteMode'
    function quoteMode() {
      try { return window.localStorage.getItem(QUOTE_MODE_KEY) === 'auto' ? 'auto' : 'warn' } catch (e) { return 'warn' }
    }
    function setQuoteMode(m) {
      try { window.localStorage.setItem(QUOTE_MODE_KEY, m === 'auto' ? 'auto' : 'warn') } catch (e) {}
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

    function buildTriggerSources() {
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
        // （维护者 2026-10-22 报「位置太下面」）。开关类要放最上面，一打开菜单就看得到。
        order: 0,
        showGroupTitle: true,
        candidates: function () {
          var on = pairStrict()
          var qm = quoteMode()
          return Promise.resolve([
            {
              name: '引号模式',
              label: qm === 'auto' ? '引号模式：自动补对' : '引号模式：标红提示',
              description: qm === 'auto'
                ? '当前：自动补对（打一个引号补一对；严格配对关时右侧有文字则只插一个）'
                : '当前：标红提示（默认；引号未闭合时输入框标红，不替你补）',
              hint: qm === 'auto' ? '点击改为标红提示' : '点击改为自动补对',
            },
            {
              name: '严格配对',
              label: '严格配对',
              description: on ? '当前：开（引号必须前后成对，混全角半角也算一对）' : '当前：关（默认，遇到已有引号就不再补对）',
              hint: on ? '点击关闭' : '点击开启',
            },
          ])
        },
        onPick: function (pick) {
          if (String(pick.candidate.name) === '引号模式') setQuoteMode(quoteMode() === 'auto' ? 'warn' : 'auto')
          if (String(pick.candidate.name) === '严格配对') setPairStrict(!pairStrict())
          return { text: '' }        // 清掉输入框里的 '/'，不插入任何文字
        },
      }
      return [fileSource, slashSource]
    }

