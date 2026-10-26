// ── 模块：语言判定与候选拉取 ────────────────────────────────
// docWords、语言投票与语言水印、fetchCandidates（本地词先上屏、网络回来再合并）。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    function docWords(text, token) {
      var t = String(token || '').toLowerCase()
      if (!t) return []
      var counts = {}, m
      // 英文标识符 + 连续汉字词（2~8 字）都收；普通长串再补一个 2 字前缀，
      // 这样「文档里的变量」里也能提出「文档」（维护者 2026-10-16 要的「像提示变量那样」）。
      var re = /[A-Za-z_][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]+/g
      var CJKONLY = /^[\u4e00-\u9fff]+$/
      while ((m = re.exec(String(text || ''))) !== null) {
        var w = m[0]
        if (w.toLowerCase() === t) continue
        counts[w] = (counts[w] || 0) + 1
        if (CJKONLY.test(w)) {
          // 中文没有空格分词：把每个连续汉字串拆成二元组/三元组，
          // 「先写一段关于文档的说明」里才能提出「文档」（草稿范围小，代价可忽略）。
          for (var ci = 0; ci + 2 <= w.length && ci < 400; ci++) {
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

    /** 语言投票：返回语言 + 票数 + 命中明细。
     *  同一份投票既决定「上哪张词表」，也决定弹层顶上那行出处（2026-10-19 维护者要求
     *  「编程语言要和上下文有关联、并让人看见依据」）。票数低于 2 一律判不定。 */
    var LANG_RULES = [
      ['python', /\b(def|import|from|elif|lambda|None|True|False|self)\b/g, 1],
      ['python', /\.py\b|\bpip\b|\bpytest\b|\bvenv\b/g, 2],
      ['javascript', /\b(const|let|var|function|=>|async|await|module\.exports|require)\b/g, 1],
      ['javascript', /\.(js|mjs|ts|tsx|json)\b|\bnpm\b|\bnode\b/g, 2],
      ['html', /<\/?[a-z][a-z0-9-]*\b|\bclass=|\bid=|<\/div>|\b<!doctype\b/gi, 2],
      ['css', /\b(color|display|margin|padding|font-size|background)\s*:|\{[^}]*:[^}]*\}/g, 1],
      ['java', /\b(public|private|protected|void|static|implements|extends|new|String)\b|@Override|System\.out|String\[\]/g, 1]
    ]
    function inferLangVote(text) {
      var t = String(text || '')
      if (!t) return { lang: '', top: 0, hits: {} }
      var score = {}, hits = {}
      for (var i = 0; i < LANG_RULES.length; i++) {
        var m = t.match(LANG_RULES[i][1])
        if (!m) continue
        score[LANG_RULES[i][0]] = (score[LANG_RULES[i][0]] || 0) + m.length * LANG_RULES[i][2]
        hits[LANG_RULES[i][0]] = (hits[LANG_RULES[i][0]] || 0) + m.length
      }
      var best = '', top = 0, ranking = []
      for (var k in score) {
        if (score[k] > top) { top = score[k]; best = k }
        if (score[k] >= 2) ranking.push({ lang: k, score: score[k] })
      }
      ranking.sort(function (a, b) { return b.score - a.score || (a.lang < b.lang ? -1 : 1) })
      return { lang: top >= 2 ? best : '', top: top, hits: hits, ranking: ranking }
    }

    /** 语言水印（维护者 2026-10-20 口径）：只写**语言名**，不写「据对话推断」这类句子；
     *  斜角随语言种数增长、封顶 45°（1→14°、2→26°、3→38°、4 及以上→45°）。没有语言就返回 null。 */
    function watermarkFor(langs) {
      var list = (langs || []).filter(Boolean).slice(0, 4)
      if (!list.length) return null
      return { text: list.join(' · '), angle: Math.min(45, 14 + 12 * (list.length - 1)) }
    }

    /** 从**上下文文本**（草稿 + 对话正文）推语言：围栏之外的第二条腿。 */
    function inferLang(text) { return inferLangVote(text).lang }

    function fetchCandidates(prefix, ed) {
      var draft = composerText(ed)
      var prefixList = [String(prefix || '')]
      if (/^[\u4e00-\u9fff]+$/.test(prefixList[0])) {
        for (var pl2 = 4; pl2 >= 2; pl2--) if (prefixList[0].length >= pl2) prefixList.push(prefixList[0].slice(-pl2))
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
      var ctxWords = contextWords(ed)
      // 投票用**对话原文**（不是去重后的词表）：词表是集合，`System.out` / `@Override` 这种
      // 带标点的语言指纹在切词时就被劈掉了，而且词频信息也丢了。原文截尾 4000 字够用。
      var ctxRaw = String(ctxCache.text || '').slice(-4000)
      // 语言优先级：围栏 → 上下文推断（草稿 + 对话正文）→ 习惯
      var vote = inferLangVote(draft + ' ' + ctxRaw)
      var lang = fenced || vote.lang || habitTop()
      // 语言水印（替代原来顶上那行「据对话推断 · java」）：只写语言名，斜排压在右下角。
      // 围栏时只报围栏那一个语言；否则报投票过线的语言，按票数从高到低，最多 4 个。
      var wmLangs = fenced ? [fenced]
        : (vote.ranking && vote.ranking.length ? vote.ranking.map(function (r) { return r.lang })
          : (lang ? [lang] : []))
      popup.wm = watermarkFor(wmLangs)
      // 上下文候选：对话里出现过的标识符按前缀补出来（跟上下文强关联的那一路）
      // 中文没有分词：整段汉字会被当成一个 token，所以按「1~4 字后缀」各试一次（长的优先），
      // 打「文」也能命中草稿里更早出现的「文档」（维护者 2026-10-16 的原话要求）。
      var p0 = String(prefix || '')
      var pfxList = [p0]
      if (/^[\u4e00-\u9fff]+$/.test(p0)) {
        for (var pl = 4; pl >= 2; pl--) if (p0.length >= pl) pfxList.push(p0.slice(-pl))
      }
      var ctxItems = []
      var seenLocal = {}
      local.forEach(function (i) { seenLocal[i.value.toLowerCase()] = 1 })
      ctxWords.forEach(function (w) {
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
      var cjkPrefix = /^[\u4e00-\u9fff]/.test(String(prefix || ''))
      // 中文要等服务端的「完整词义」闸：碎片连本地词都不许先上屏（否则会闪一下又不算数）
      if (first.length && !cjkPrefix) { popup.items = first; popup.index = 0; renderPopup(ed) }
      inflight++
      var seq = inflight
      var ep = popupEpoch        // 发请求时的代数：期间被关掉（回车发送/失焦/碎片闸）就作废这次响应
      fetch(ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&lang=' + encodeURIComponent(lang))
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (seq !== inflight) return // 后发先至的旧响应丢掉（补全弹层最怕错位）
          if (ep !== popupEpoch) return // 迟到的响应不许把已经收起来的浮层/灰字复活
          // 服务端判定这不是完整词义（碎片）→ 整条收起，连本地/上下文候选都不出
          if (d && d.wordGate === false) { closePopup(); return }
          var items = local.slice(), seen = {}
          local.forEach(function (i) { seen[i.value] = 1 })
          ctxItems.forEach(function (c) { if (!seen[c.value]) { seen[c.value] = 1; items.push(c) } })
          if (d && d.ok === true) (d.candidates || []).forEach(function (c) { if (c && !seen[c.value]) { seen[c.value] = 1; items.push(c) } })
          if (!items.length) { closePopup(); return }
          popup.items = items.slice(0, 12); popup.index = 0; renderPopup(ed); showGhost(ed, prefix)
        })
        .catch(function () { if (ep === popupEpoch && !first.length) closePopup() })
    }
