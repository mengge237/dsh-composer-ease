// ── 模块：光标复位与接受 ────────────────────────────────
// placeCaretVerified / flushCaretFix / afterPairCheck / ensureCaretAt：插入后把光标放回该在的位置，以及 acceptCurrent。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var suppressInput = 0   // 我们自己插入文本后会派发 input；别让它回来又开一次弹层（连按即滚雪球）
    var caretEpoch = 0      // 每次按键 +1；延后的光标复位只认最后一次
    /* IME 合成中：拼音还没上屏，这时候的拉丁字母不是「输入内容」，不能触发补全。
     * 2026-10-16 使用中实测：打拼音 `ye` 时 JS 关键字 `yield` 被前缀命中，弹层＋灰字 `eld`
     * 盖在输入法候选窗旁边。VS Code 同样在 composition 期间不出建议。 */
    var composing = false
    /* 光标复位要**跨帧校验**：真机实测（2026-10-20，demo 3081）配对后只调一次 `setSelectionRange`
     * 会被 Lexical 随后的一次重渲染冲掉 —— 空框打 `"` 拿到 `""` 但 caret 停在 0（开符之前），
     * 于是接着打字打到引号外面、连按第三下也被当成「跳过闭符」吞掉。
     * 这里按绝对偏移写几次，每次都读回来确认；期间只要又按了键（caretEpoch 变）就立刻放手，
     * 不去跟用户抢光标。文本域是同步的，写一次就返回。 */
    /* 光标复位——**时机必须由 Lexical 的 DOM 变化来定，不能猜**。
     * 真机读数（2026-10-20，demo 3081，逐点采样）：我们自己插入的文本节点
     * 在 microtask / rAF / `setTimeout 0` 那一刻**都还不存在**（`textOf` 仍是空串），
     * 到 ~2ms 才出现；从那一刻起写光标就粘得住。
     * 所以：先用 MutationObserver 等「文本真的落地了」，再同步写一次。
     * 原来用盲定时器撒一串（0/16/48/110ms），两头都出错：
     *  ① 等不到 2ms 那一格 → 输入法上屏抢在前面，文字落到闭符**外面**（`""你好`，
     *     末尾再打就是使用中报的 `"你好""`）；
     *  ② 撒出去的长尾回调在用户已经打完字之后才开火 → 把光标拽回原位（读数 caret=1）。
     * 现在两条都堵掉：先等 mutation，再用**文本护栏**（`expect`）判断有没有人插手。 */
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
       * Lexical 的重渲染比我们的写入晚一拍（实测 ~2ms），只写一次会被它冲掉 ——
       * 那正是「空框打全角开符，配对后光标停在闭符之后」的读数来源。 */
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
     *  读到的状态可能是旧的（Lexical 重渲染的空窗），但结果不能跟着旧走 ——
     *  本该「只插一个」的，就把多出来的闭符撤掉。判据在真文本上成立时这个函数什么都不做
     *  （这正是正常路径），只在读到旧状态时才纠正。 */
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
     *  专门给"配对"这种紧跟下一键的场景用。 */
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
     *  配对那条路不能只信"预期偏移"——编辑器可能自己挪过光标（全角引号就是这种情况）。 */
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
     *  `expect` = 我们自己这一次插入完成后的**整段文本**；文本长度更短＝还没落地（继续等），
     *  内容对不上＝别人（用户/输入法）插手了（放手，绝不抢光标）。
     *  `then` = 落地后跑一次的复核。 */
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

    function acceptCurrent() {
      var it = popup.items[popup.index]
      var ed = lastComposer
      closePopup()
      if (!it || !ed) return
      if (it.lang) habitBump(it.lang, 2)     // 接受过哪套词表的候选，就算在用哪门语言
      // token 必须在**接受这一拍**现算：`lastToken` 是弹层触发时的快照，
      // 打字比弹层快时会过期（真机实测：打 console.log 只回删了 'log'，前面的 'console.' 留在原地）。
      var tok = tokenBefore(textBeforeCaret(ed)) || lastToken || ''
      var caret0 = caretPos(ed)
      var start0 = (caret0 >= 0 && tok) ? Math.max(0, caret0 - tok.length) : caret0
      if (tok) selectBack(ed, tok.length)
      var payload = String(it.kind === 'file' ? String(it.value).replace(/\\/g, '/') : it.value)
      var stops = []
      if (it.kind === 'snippet') {
        var ex = expandSnippet(payload)
        payload = ex.text
        stops = ex.stops
      }
      suppressInput++
      insertRich(ed, payload)      // 多行片段走 paste 通道，否则真 Lexical 会吃掉整条
      snippetStops = null
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

    /* 语言习惯：观察使用中实际在用什么语言（围栏标记、以及接受过哪套词表的候选），
     * 存本地，下一次没写围栏时就按习惯上词表 —— 使用中原话「通过观察用户操作习惯选择使用哪个语言」。 */
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
     * （造不出真实输入法的 composition 事件），所以把真机上那几个字段原样打出来。 */
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

