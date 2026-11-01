// ── 模块：输入法合成层 ────────────────────────────────
// compositionstart / compositionend：记下会被浏览器吃掉的选区，上屏之后按快照还原。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var imeSnap = null
    function onCompositionStart(ev) {
      var ed = composerOf(ev.target)
      if (!ed) return
      composing = true
      caretEpoch++            // 输入法接管：作废我们自己挂起的光标复位，别跟它抢
      closePopup()            // 连灰字一起收起来（hideGhost 在 closePopup 里）
 // 这一拍之后选区就没了：框选要用的起点内层只能现在记（repairImeSurround 用）
      var selTxt = selectedText(ed)
      imeSnap = selTxt ? { ed: ed, start: Math.max(0, textBeforeCaret(ed).length - selTxt.length), inner: selTxt } : null
    }
    function onCompositionEnd(ev) {
      var ed = composerOf(ev.target)
      if (!ed) return
      composing = false
      var snap = imeSnap
      imeSnap = null
      if (snap && snap.ed === ed) { try { repairImeSurround(snap) } catch (e) {} }
 // 上屏后按新内容重新判一次（中文词补全走这条路）
      try { onInput({ target: ev.target }) } catch (e) {}
    }

