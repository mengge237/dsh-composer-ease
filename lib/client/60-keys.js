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
      // （2026-10-19 一次反馈——发送就是这条的收尾点）
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
        /* 无条件 closePopup：即使浮层还没画出来（候选响应还在路上）也要把代数 +1，
          否则回车之后到达的响应照样会把它画出来 —— 2026-10-21 真机 3081 把 /words 延迟 900ms 后复现到的正是这一格。 */
        closePopup()
        return
      }
      // 与 dsh-composer-history 共存：它用 Ctrl+R 开反向搜索。我们的候选层开着时先把层收掉，
      // 避免两个面板叠在一起（我们**不拦**这个键，交给它处理）——2026-10-23 纸面对照后补。
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
      // 弹层优先：上下选必须先于 keyAction —— keyAction 对箭头返回空，放在它后面就永远走不到
      // （2026-10-22 的一次反馈）。
      if (popup.open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault()
        popup.index = (popup.index + (ev.key === 'ArrowDown' ? 1 : -1) + popup.items.length) % popup.items.length
        // 必须 force：renderPopup 的签名只含 items 与语言水印、不含 index，
        // 非 force 时同一个 sig 会早退 →「按了键但高亮不动」（使用中 2026-10-22 报的就是这个）。
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
      // 2026-10-16（一次反馈）：原来这里排除了 shift，
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
        // warn 模式：`"你好"` 这种已经框好的，再打同一个引号什么都不做（与 auto 的旧契约一致）
        if (quoteMode() !== 'auto' && isQuoteChar(open) && alreadyClosedBefore(before, open, close)) {
          ev.preventDefault(); return
        }
        // 空对里再打同一个引号 → 跳过（2026-10-22 真机：快速连打时上一键的光标复位还没落地，
        // 光标可能停在对子后面，于是又补一对变成三个）。按**文本形状**判，不看光标：
        // 整段就是一个空对，或光标正好夹在空对中间，都算「已经在空对里」。
        if (close === open && isQuoteChar(open) && quoteMode() === 'auto') {
          // 仅 auto 模式：连打竞态下光标可能停在对子后面，此时跳过而不是再补一对。
          // warn 模式不自动补对，连按必须逐个字面插入（2026-10-23）。
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
          // 拦住 Lexical：我们的监听是 capture 阶段，stopPropagation 之后它收不到这次按键，
          // 就不会"按自己的模型再插一遍"——真机 2026-10-22 实测：不拦时 418ms 贴入 `“abc”`、
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
          // 右边已经是这一对：跳过去，别再套一对（`“”` 中间再打 `“` 会变成一对套一对）
          var skipTo = caretPos(ed)
          if (skipTo >= 0) placeCaretVerified(ed, skipTo + 1, textOf(ed))   // 不插字，文本不变
        } else if (alreadyClosedBefore(before, open, close)) {
          ev.preventDefault()   // 这一下什么都不做，也必须拦住默认插入（否则测试/浏览器各插一个）
          // 光标正好停在一个**非空**既成对的闭符之后：这一下不该再加一个。
          // 使用中 2026-10-20 报的 `"你好""` 就是这条：选中文字打 `"` → 框成 `"你好"`（光标落在闭符之后），
          // 再打 `"` 又堆了一个。空对（`""`）不算，那是「连打引号写 ``` 围栏」的用法，见行为矩阵。
        } else if (before.slice(-1) === open
                   && isUnbalancedBefore(before, open, close)
                   && textOf(ed).length > before.length) {
          // 光标紧贴一个未闭合的开符、后面还有正文（`"|你好`）。
          // **旧实现把闭符 setCaret 到全文末尾** —— 这就是使用中 2026-10-23 报的
          // 「后引号出现在句子后面、不在我要的位置」。改成一律在光标处字面插入：
          // 用户在哪打就在哪落，闭合与否交给 lintQuotes 标红提示。
          var atHere = caretPos(ed)
          insertText(ed, open)
          if (atHere >= 0) { try { setSelectionRange(ed, atHere + 1, atHere + 1) } catch (e) {} }
        } else if (close === open && before.slice(-1) === open) {
          // 对称引号（" ' `）前面已经是同一个引号：只插一个，不再凑成一对。
          // VS Code 的引号规则；不补这条时连按引号会 2→4→6 成串（2026-10-16 的一次反馈）。
          insertText(ed, open)
        } else if (isUnbalancedBefore(before, open, close)) {
          // 更前面还有一个没闭合的开符（`"你好` 末尾再打 `"`、`“文字` 末尾再打 `“`）：
          // 这一下是在闭合它，不是再开一层 —— 只插一个字符。
          insertText(ed, open)
        } else if (shouldPair(before, caretChar(ed, +1), open)) {
          var basePair = textOf(ed), atPair = caretPos(ed)
          insertAtomic(ed, open + close)      // 原子插入：避免 Lexical 异步重写选区导致的竞态
          // 先同步落一次光标：异步观察者赶不上下一次按键（真机快速连打会变 4 个引号）
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
          // 「跳过闭符」判据吃掉（实测连按三下只得两个引号，2026-10-23）。
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
        // 引号且不该跳过时：必须字面插入，否则这一下被吞掉（实测连按三下只得两个引号，2026-10-23）。
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
          // （2026-10-20 取证：`（）`→`）`、`“”`→`”`，半角不受影响）。
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
