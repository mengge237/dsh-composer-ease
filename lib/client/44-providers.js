// ── 模块：候选来源注册（provider 契约）──────────────────
// 让别的插件往补全里喂候选：registerProvider({id, priority, triggerChars, provide})。
// 排序沿用 VS Code：priority 小的先；同一来源内按 sortText，再按 label。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var PROVIDERS = []
 // 服务端候选的最近一次结果（按前缀）。builtin-server 只读这里，不自己发请求。
    var serverCache = {}
    function rememberServerItems(prefix, items) { try { serverCache[String(prefix || '')] = Array.isArray(items) ? items.slice() : [] } catch (e) {} }
    function serverCacheView(prefix) { try { return (serverCache[String(prefix || '')] || []).slice() } catch (e) { return [] } }

 /** 注册一个候选来源。返回 disposer；形状不对就返回空操作（调用方不必判断）。 */
    function registerProvider(spec) {
      var noop = function () {}
      if (!spec || !spec.id || typeof spec.provide !== 'function') return noop
      var row = {
        id: String(spec.id),
        priority: typeof spec.priority === 'number' ? spec.priority : 100,
        triggerChars: Array.isArray(spec.triggerChars) ? spec.triggerChars.slice() : null,
        provide: spec.provide,
      }
      PROVIDERS.push(row)
      PROVIDERS.sort(function (a, b) { return a.priority - b.priority })
      return function () {
        var i = PROVIDERS.indexOf(row)
        if (i >= 0) PROVIDERS.splice(i, 1)
      }
    }

 /** 把一家 provider 的返回值规整成候选（字段不全的丢掉，不抛）。 */
 /* 排序打分：前缀质量 × 来源权重 × 近期使用衰减，替掉「priority 字典序」那种拍脑袋兜底。
  * 各权重是形状参数：前缀命中占大头，来源只做次要修正，最近接受过的项获得时间衰减加成。 */
 /* 上下文预测：草稿里「上一个词 → 下一个词」的搭配，取出现次数最多的几个。
  * 只读草稿与本仓上下文缓存，不联网、不读历史会话内容，也不落盘。 */
    function predictNextWord(text, prev, limit) {
      var pv = String(prev || '').replace(/[.*+?^${}()|[\]\\]/g, '\\    var USAGE = {}')
      if (!pv) return []
      var re = new RegExp(pv + '[\\s，。、,.;:：\u3000]+([A-Za-z_][A-Za-z0-9_]{1,}|[\u4e00-\u9fff]{2,6})', 'g')
      var counts = {}, m, src = String(text || '')
      while ((m = re.exec(src)) !== null) {
        var w = m[1]
        if (w === prev) continue
        counts[w] = (counts[w] || 0) + 1
      }
      return Object.keys(counts)
        .sort(function (a, b) { return counts[b] - counts[a] || a.length - b.length })
        .slice(0, limit || 3)
    }
    var USAGE = {}                     // value 到最近一次被接受的时间（ms）
    var USAGE_HALF = 10 * 60 * 1000    // 半衰期十分钟
    function noteAccepted(value) { if (value) USAGE[String(value)] = Date.now() }
    function usageScore(value) {
      var at = USAGE[String(value || '')]
      if (!at) return 0
      var age = Date.now() - at
      if (age < 0) return 1
      return Math.pow(0.5, age / USAGE_HALF)
    }
    function isWordStart(text, at) {
      if (at <= 0) return true
      return /[^A-Za-z0-9_$]/.test(text.charAt(at - 1))
    }
 /** 前缀质量：1 前缀命中（大小写随意）；0.7 词首命中；0.45 词中命中；0.2 长前缀（≥4）只落在词中；0 没命中。
  * 长前缀降档是「只在词首匹配」的软化写法：不硬丢，只让它沉到后面。 */
    function matchQuality(prefix, text) {
      var p = String(prefix || '')
      var s = String(text || '')
      if (!p) return 0.5
      var at = s.indexOf(p)
      var relaxed = p.length >= 4            // 长前缀只在词首算命中，词中的降到最低档
      if (at < 0) {
        var lower = s.toLowerCase(), pl = p.toLowerCase(), lat = lower.indexOf(pl)
        if (lat < 0) return 0
        if (isWordStart(s, lat)) return 0.7
        return relaxed ? 0.2 : 0.45
      }
      if (at === 0) return 1
      if (isWordStart(s, at)) return 0.7
      return relaxed ? 0.2 : 0.45
    }
    function sourceWeight(priority) {
      var pr = typeof priority === 'number' ? priority : 100
      return 1 / (1 + pr / 50)
    }
 /** 两段放宽（VS Code 的 filterGraceful 口径）：先只看前缀与词首两档，
  * 只有这两档一个都没有时，才把「只落在词中」的那些放回来。词类候选才做这件事，
  * 文件、模型这类来源本来就该按路径/名字模糊命中，不参与收紧。 */
    function gracefulFilter(items, prefix) {
      var strict = 0, wordStart = 0, relaxed = 0, i
      for (i = 0; i < items.length; i++) {
        var it = items[i]
        if (it && it.src === 'pinyin') continue
        if (it.kind && it.kind !== 'word') continue
        var q = matchQuality(prefix, it.filterText || it.value || it.label)
        it.matchQ = q
        if (q >= 0.95) strict++
        else if (q >= 0.65) wordStart++
        else if (q > 0) relaxed++
      }
      if (!relaxed) return items
      if (!strict && !wordStart) return items
      var out = []
      for (i = 0; i < items.length; i++) {
        var k = items[i]
        if (k.kind && k.kind !== 'word') { out.push(k); continue }
        if ((k.matchQ || 0) >= 0.65) out.push(k)
      }
      return out
    }
    function scoreItem(item, prefix) {
 // 拼音候选：前缀是拉丁、值是汉字，普通匹配算不出分，按「整词命中」给固定分
      if (item && item.src === 'pinyin') return 0.75
      var q = matchQuality(prefix, item.filterText || item.value || item.label)
      if (q <= 0) return 0
      return 0.55 * q + 0.20 * sourceWeight(item.providerPriority) + 0.15 * usageScore(item.value) + 0.10 * (q >= 0.9 ? 1 : 0) + 0.02 * habitBoost(item.value)
    }
    function normalizeProviderItems(raw, provider) {
      var out = []
      if (!raw || !raw.length) return out
      for (var i = 0; i < raw.length; i++) {
        var it = raw[i]
        if (!it) continue
        var value = String(it.insertText != null ? it.insertText : (it.value != null ? it.value : it.label != null ? it.label : ''))
        if (!value) continue
        out.push({
          kind: it.kind || 'word',
          value: value,
          label: String(it.label != null ? it.label : value),
          detail: String(it.detail || provider.id),
          sortText: String(it.sortText != null ? it.sortText : value),
          filterText: it.filterText == null ? null : String(it.filterText),
          commitChars: it.commitChars || null,
          src: 'provider:' + provider.id,
          providerPriority: provider.priority,
        })
      }
      return out
    }

 /** 问所有 provider 要候选。任何一家失败/超时都只丢它自己那一份。
  * triggerChar 非空时按它筛（`.` `(` `:` 这类字符触发），否则按前缀首字符筛。 */
    function providerCandidates(prefix, triggerChar, ed) {
      var p = String(prefix || '')
      var tc = triggerChar ? String(triggerChar) : p.charAt(0)
      var jobs = []
      for (var i = 0; i < PROVIDERS.length; i++) {
        var prov = PROVIDERS[i]
        if (prov.triggerChars && prov.triggerChars.indexOf(tc) < 0) continue
        jobs.push((function (pv) {
          try {
            return Promise.resolve(pv.provide({ prefix: p, triggerChar: triggerChar || '', ed: ed }))
              .then(function (list) { return normalizeProviderItems(list, pv) })
              .catch(function () { return [] })
          } catch (e) { return Promise.resolve([]) }
        })(prov))
      }
      if (!jobs.length) return Promise.resolve([])
      return Promise.all(jobs).then(function (lists) {
        var all = []
        for (var k = 0; k < lists.length; k++) all = all.concat(lists[k])
        for (var s = 0; s < all.length; s++) all[s].score = scoreItem(all[s], p)
        all.sort(function (a, b) {
          return (b.score - a.score) || (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
        })
        return all
      })
    }


 /* 内建源：本地词（草稿里出现过的词）与上下文词。以前它们硬写在 fetchCandidates 里，
 * 现在抽成同一份实现并注册成 provider —— 外部调用方看到的内建源与管线用的是同一段代码。 */
    function builtinSources(prefix, ed) {
      var p = String(prefix || '')
      var list = [p]
      if (/^[\u4e00-\u9fff]+$/.test(p)) {
        for (var pl = 4; pl >= 2; pl--) if (p.length >= pl) list.push(p.slice(-pl))
      }
      var draft = ed ? composerText(ed) : ''
      var local = [], seenDraft = {}
 // 空前缀（Ctrl+Space 直接要候选）：按出现次数把草稿里的标识符端上来。
 // docWords 只做「前缀过滤」，空前缀它一律回空，于是这时只剩关键字可选。
      if (!p) {
        var counts = {}, mm, reId = /[A-Za-z_][A-Za-z0-9_]{2,}/g
        while ((mm = reId.exec(draft)) !== null) counts[mm[0]] = (counts[mm[0]] || 0) + 1
        var tops = Object.keys(counts).sort(function (a, b) {
          return counts[b] - counts[a] || a.length - b.length || (a < b ? -1 : 1)
        }).slice(0, 6)
        for (var ti = 0; ti < tops.length; ti++) {
          seenDraft[tops[ti].toLowerCase()] = 1
          local.push({ kind: 'word', value: tops[ti], detail: '本文', src: 'draft' })
        }
        var beforeNow = ed ? textBeforeCaret(ed) : ''
        var prevWord = (String(beforeNow || '').match(/([A-Za-z_][A-Za-z0-9_]{1,}|[\u4e00-\u9fff]{2,6})[\s]*$/) || [])[1] || ''
        var guesses = predictNextWord(draft, prevWord, 3)
        for (var gi = guesses.length - 1; gi >= 0; gi--) {
          if (seenDraft[guesses[gi].toLowerCase()]) continue
          local.unshift({ kind: 'word', value: guesses[gi], detail: '预测', src: 'predict' })
        }
        if (local.length) return { local: local, ctx: [] }
      }
      for (var di = 0; di < list.length; di++) {
        var batch = docWords(draft, list[di])
        for (var bi = 0; bi < batch.length; bi++) {
          var key = String(batch[bi].value || '').toLowerCase()
          if (seenDraft[key]) continue
          seenDraft[key] = 1
          local.push(batch[bi])
        }
        if (local.length >= 6) break
      }
      var ctx = []
      if (ed && typeof contextWords === 'function') {
        var words = contextWords(ed) || []
        for (var wi = 0; wi < words.length && ctx.length < 5; wi++) {
          var w = String(words[wi] || '')
          var lw = w.toLowerCase()
          if (!lw || seenDraft[lw]) continue
          for (var qi = 0; qi < list.length; qi++) {
            var q = String(list[qi]).toLowerCase()
            if (!q || lw === q || lw.indexOf(q) !== 0) continue
            seenDraft[lw] = 1
            var pos = []
            for (var k = 0; k < q.length; k++) pos.push(k)
            ctx.push({ kind: 'word', value: w, detail: '上下文', src: 'context', matches: pos })
            break
          }
        }
      }
      return { local: local, ctx: ctx }
    }

 /** 把内建源登记成 provider（外部插件看到的就是这三家 + 他们自己注册的）。 */
    function registerBuiltinProviders() {
      var d1 = registerProvider({
        id: 'builtin-context', priority: 5,
        provide: function (c) { return builtinSources(c && c.prefix, c && c.ed).ctx },
      })
      var d2 = registerProvider({
        id: 'builtin-local', priority: 12,
        provide: function (c) { return builtinSources(c && c.prefix, c && c.ed).local },
      })
      // 服务端那一路也作为 provider 暴露，但走**缓存视图**：管线自己有 seq/epoch 两道防错位闸，
      // provider 不再自行发请求，只把管线最近一次的结果给外部调用方（避免同前缀双请求）。
      var d3 = registerProvider({ id: 'builtin-server', priority: 80, provide: function (c) { return serverCacheView(String((c && c.prefix) || '')) } })
      return function () { d1(); d2(); d3() }
    }

 /** 把注册口交出去：优先 cordis 服务，退 window。返回 api 便于测试。 */
    function exposeProviderApi(ctx) {
      var api = {
        version: 1,
        register: registerProvider,
        list: function () { return PROVIDERS.map(function (x) { return { id: x.id, priority: x.priority, triggerChars: x.triggerChars } }) },
      }
      try { if (ctx && typeof ctx.provide === 'function') ctx.provide('composerEase', api) } catch (e) {}
      try { if (typeof window !== 'undefined') window.__DSH_COMPOSER_EASE__ = api } catch (e) {}
      return api
    }
