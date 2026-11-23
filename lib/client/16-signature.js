// ── 模块：签名提示 ──────────────────────────────────
// 光标在 foo( 里时按名字查符号表，把「name(参数)」画在光标处；查不到就什么都不做。

    var signatureHint = ''

 /* 括号的输入事件被配对压制，所以 keydown 那条路也补调一次。 */
    function maybeSignature(ed) {
      try { if (window.localStorage.getItem('dsh-composer-ease:debug') === '1') console.log('[sig] enter |' + textBeforeCaret(ed).slice(-16) + '|') } catch (eD) {}
      try {
        var before = textBeforeCaret(ed)
        var callMatch = before.match(/([A-Za-z_$][\w$]*)\s*\(\s*[^()]{0,60}$/)
        if (!callMatch) { if (signatureHint) { signatureHint = ''; hideHint() } return }
        var fnName = callMatch[1]
        if (fnName === signatureHint) return
        signatureHint = fnName
        signatureLookup(fnName).then(function (sig) {
          try { if (window.localStorage.getItem('dsh-composer-ease:debug') === '1') console.log('[sig] lookup ' + fnName + ' => ' + JSON.stringify(sig) + ' stale=' + (signatureHint !== fnName)) } catch (eL) {}
          if (signatureHint !== fnName) return
          if (!sig) { hideHint(); return }
          setTimeout(function () {
            try { if (window.localStorage.getItem('dsh-composer-ease:debug') === '1') console.log('[sig] show? sig=' + sig + ' popup=' + popup.open + ' stale=' + (signatureHint !== fnName)) } catch (eS2) {}
            if (signatureHint !== fnName) return
            var shown = sig.length > 48 ? sig.slice(0, 45).replace(/,\s*$/, '') + '…)' : sig
            showHint(ed, shown)
          }, 220)
        })
      } catch (e) {}
    }
