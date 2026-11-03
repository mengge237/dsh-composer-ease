// ── 模块：原生落字收尾 ────────────────────────────────
// flushBeforeFix：宿主把那个字符插进去之后，按 pendingFix 记的动作补/删/换算，幂等重试。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

        var pendingFix = null

 /** 原生那一个字符落地之后收尾。**幂等**：实测上 `input` 有时来有时不来，
 * onInput 那条补闭符的路和这里会撞在一起 —— 谁先到都只补一次（落地后先读有没有闭符）。 */
    function flushBeforeFix() {
      var p = pendingFix
      if (!p) return
      pendingFix = null
      try {
        var ed = p.ed, now = textOf(ed)
        dbg('flush', { ed: ed, action: p.action, before: now })
        if (p.action === 'surround') {
          var ladder = [0, 16, 48, 110, 220], k = 0
          var tick = function () {
            try {
              var nw = textOf(ed)
              if (nw.slice(p.off, p.off + 2) === p.open + p.open) { suppressInput++; deleteAt(ed, p.off); nw = textOf(ed) }
              var afterClose = p.off + 1 + p.selTxt.length + 1
              // 落在**闭符之前**：框住一句后接着打字属于「在引号内续写」，落到闭符后面就跑到引号外
              if (nw.charAt(afterClose - 1) === p.close) { setCaret(ed, afterClose - 1); placeCaretVerified(ed, afterClose - 1, nw); return }
            } catch (e) {}
            if (++k < ladder.length) { try { setTimeout(tick, ladder[k]) } catch (e) {} }
          }
          tick()
          return
        }
        if (p.action === 'convertClose') {
 // 全角闭符换成半角：删掉落地那个全角字符，再插半角那个，光标停在它之后
          var ladderX = [0, 16, 48, 110, 220, 360], kx = 0
          var tickX = function () {
            try {
              var cur = textOf(ed)
              if (cur.charAt(p.off) === p.open) {
                setCaret(ed, p.off + 1)
                suppressInput += 2         // 一次删除 + 一次插入，各派发一个 input（多算会漏到下一键）
                backspaceOnce(ed)          // 删除只认合成 Backspace（execCommand('delete') 在这条路上不落地）
                setCaret(ed, p.off)
                insertText(ed, p.close)
                placeCaretVerified(ed, p.off + 1, cur.slice(0, p.off) + p.close + cur.slice(p.off + 1))
                ensureCaretAt(ed, p.off + 1)
                return
              }
            } catch (e) {}
            if (++kx < ladderX.length) { try { setTimeout(tickX, ladderX[kx]) } catch (e) {} }
          }
          tickX()
          return
        }
        if (p.action === 'convert') {
          var ladderC = [0, 16, 48, 110, 220, 360], kc = 0
          var pairTxt = p.open + p.close
          var tickC = function () {
            try {
              var cur = textOf(ed)
              if (FULL_TO_HALF_OPEN[cur.charAt(p.off)]) {
                backspaceOnce(ed)
                setCaret(ed, p.off)
                suppressInput++
                insertText(ed, pairTxt)
                placeCaretVerified(ed, p.off + 1, cur.slice(0, p.off) + pairTxt + cur.slice(p.off + 1))
 // 光标必须停在两符之间：宿主随后会把 caret 挪到对子之后，后面打的字就跑到括号外面
                ensureCaretAt(ed, p.off + 1)
                return
              }
            } catch (e) {}
            if (++kc < ladderC.length) { try { setTimeout(tickC, ladderC[kc]) } catch (e) {} }
          }
          tickC()
          return
        }
        if (p.action === 'mirror') {
          if (now.charAt(p.off) !== p.close) return                 // 原生没落字：不猜位置
          if (now.charAt(p.off - 1) === p.open) return               // 前面已经有开符
          suppressInput++
          setCaret(ed, p.off)
          insertText(ed, p.open)
          placeCaretVerified(ed, p.off + 1, now.slice(0, p.off) + p.open + now.slice(p.off))
          ensureCaretAt(ed, p.off + 1)
          return
        }
        if (p.action === 'skip') {
          if (now.length === p.len) { placeCaretVerified(ed, Math.min(p.off + 1, now.length), now); return }
          if (now.charAt(p.off) !== p.open) return
          suppressInput++
          deleteAt(ed, p.off)
          var afterDel = textOf(ed)
          placeCaretVerified(ed, Math.min(p.off + 1, afterDel.length), afterDel)
          return
        }
        if (now.charAt(p.off) !== p.open) return
        if (now.charAt(p.off + 1) === p.close) { placeCaretVerified(ed, p.off + 1, now); return }
        suppressInput++
        setCaret(ed, p.off + 1)
        insertText(ed, p.close)
        try { setSelectionRange(ed, p.off + 1, p.off + 1) } catch (e) {}
        placeCaretVerified(ed, p.off + 1, now.slice(0, p.off + 1) + p.close + now.slice(p.off + 1),
          afterPairCheck(ed, p.open, p.close, p.off))
        ensureCaretAt(ed, p.off + 1)
      } catch (e) {}
    }
