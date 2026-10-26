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

    function surroundSelection(ed, open, selTxt, close) {
      try {
        if (!isText(ed)) {
          var sel = window.getSelection()
          if (!sel || !sel.rangeCount) return
          var inner = String(selTxt || sel.toString() || '')
          var text = open + inner + close
 // 选区**后面还剩多少字**（只数文本节点，与 flatText 同口径）——决定闭符之后的光标落点
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
          if (!handled) insertText(ed, text)                  // 兜底：单行场景 execCommand 是好的
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
