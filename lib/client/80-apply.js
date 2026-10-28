// ── 模块：装载与卸载 ────────────────────────────────
// apply：单例守卫、输入触发源注册、七个事件监听与卸载。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function apply(ctx) {
 // 单例：同一页面被重复装载（HMR/重复注册）时，一次按键会被两套监听各处理一遍 → 引号/括号翻倍。
      if (typeof window !== 'undefined' && window.__DSH_COMPOSER_PRO_APPLIED__) {
        try { console.warn('[dsh-composer-ease] already applied, skip duplicate mount') } catch (e) {}
        return function () {}
      }
      if (typeof window !== 'undefined') window.__DSH_COMPOSER_PRO_APPLIED__ = true
      try {
        var strays = document.querySelectorAll('#dsh-cp-popup, #dsh-cp-ghost')
        for (var si = 0; si < strays.length; si++) strays[si].parentNode && strays[si].parentNode.removeChild(strays[si])
      } catch (e) {}
 /* 宿主输入触发源：照官方用法 ctx.inject([...], scope => …) —— 注入后的服务在 scope 上。
 * 前提：package.json 的 dsh.client.inject 与 exports.inject 都要声明 inputTriggers
 *（实测：只在其中一处声明时，apply 里取到的是 undefined）。 */
      var unwatchTriggers = []
      try { if (typeof window !== 'undefined') window.__DSE_TRIGGER_SOURCES__ = 0 } catch (e) {}
      var mountSources = function (svc) {
        if (!svc || typeof svc.registerSource !== 'function') return
        buildTriggerSources(ctx).forEach(function (src) {
          try {
            var off = svc.registerSource(src)
            unwatchTriggers.push(off)
            try { window.__DSE_TRIGGER_SOURCES__ = (window.__DSE_TRIGGER_SOURCES__ || 0) + 1 } catch (e) {}
          } catch (e) {
            try { console.warn('[dsh-composer-ease] registerSource 失败:', src.name, e && e.message) } catch (e2) {}
          }
        })
      }
      try {
        if (ctx && typeof ctx.inject === 'function') {
          ctx.inject(['inputTriggers'], function (scope) { mountSources(scope && scope.inputTriggers) })
        } else {
          mountSources((ctx && typeof ctx.get === 'function') ? ctx.get('inputTriggers') : null)
        }
      } catch (e) {
        try { console.warn('[dsh-composer-ease] 触发源注册异常:', e && e.message) } catch (e2) {}
      }
      var d = document
      d.addEventListener('keydown', onKeyDown, true)   // capture：先于 Lexical 自己的键位
      d.addEventListener('beforeinput', onBeforeInput, true)
 // ── 引号未闭合的标红提示（VS Code 的 squiggle 口径，不阻断输入）──────────
      if (document.getElementById && !document.getElementById('dce-quote-style')) {
        var st = document.createElement('style')
        st.id = 'dce-quote-style'
 // 波浪线不再画在框底：那条线离文字约 27px，看着像给整个框描边，与「这个词有问题」无关。
 // 现在由 paintQuoteWarn() 用覆盖层逐行画在**文字框底边**上；这里只留行内提示文字。
        st.textContent = '[data-dce-quote-warn="1"]::after{content:attr(data-dce-quote-hint);color:#e5534b;font-size:12px}'
        try { document.head && document.head.appendChild(st) } catch (e) {}
      }
      d.addEventListener('input', onInput, true)
      d.addEventListener('focusout', onBlurOut, true)
      d.addEventListener('compositionstart', onCompositionStart, true)
      d.addEventListener('compositionend', onCompositionEnd, true)
      return function () {
        d.removeEventListener('keydown', onKeyDown, true)
        d.removeEventListener('beforeinput', onBeforeInput, true)
        d.removeEventListener('input', onInput, true)
        d.removeEventListener('focusout', onBlurOut, true)
        d.removeEventListener('compositionstart', onCompositionStart, true)
        d.removeEventListener('compositionend', onCompositionEnd, true)
        for (var ui = 0; ui < unwatchTriggers.length; ui++) { try { unwatchTriggers[ui]() } catch (e) {} }
        if (typeof window !== 'undefined') { window.__DSH_COMPOSER_PRO_APPLIED__ = false; window.__DSE_TRIGGER_SOURCES__ = 0 }
        closePopup()
      }
    }

    exports.apply = apply
    exports.inject = ['inputTriggers']   // 宿主输入触发服务：不声明则 scope 里拿不到（官方用法同）
    exports.__helpers__ = { pairStrict: pairStrict, setPairStrict: setPairStrict, repairWrapDup: repairWrapDup, unclosedQuoteCount: unclosedQuoteCount, expandSnippet: expandSnippet, isKindOn: isKindOn, toggleKind: toggleKind, kindPresetLabel: kindPresetLabel, cycleKindPreset: cycleKindPreset, quoteMode: quoteMode, setQuoteMode: setQuoteMode, lintQuotes: lintQuotes, quoteCount: quoteCount, buildTriggerSources: buildTriggerSources, settingsRows: settingsRows, looseScore: looseScore, typoScore: typoScore, rescueRows: rescueRows, inCommentLine: inCommentLine, PAIRS: PAIRS, PAIRED_CHAR: PAIRED_CHAR, CLOSERS: CLOSERS, shouldPair: shouldPair, tokenBefore: tokenBefore, keyAction: keyAction, docWords: docWords, langHint: langHint, inferLang: inferLang, inferLangVote: inferLangVote, watermarkFor: watermarkFor, conversationText: conversationText, contextWords: contextWords, contextReset: function () { ctxCache.at = 0; ctxCache.words = [] }, caretChar: caretChar, caretOffset: caretOffset, flatText: flatText }
