// ── 模块：设置项（严格配对 / 引号模式 / 候选类型预设）──────────────────
// 从 70-input.js 拆出来的（加完候选类型预设后那个片段到 411 行，超结构闸的 400 上限）。
// 只放「存哪儿 + 怎么读 + 预设怎么切」，不碰事件处理。

    var PAIR_STRICT_KEY = 'dsh-composer-ease:pairStrict'
    function pairStrict() {
      try { return window.localStorage.getItem(PAIR_STRICT_KEY) === '1' } catch (e) { return false }
    }
    function setPairStrict(on) {
      try { window.localStorage.setItem(PAIR_STRICT_KEY, on ? '1' : '0') } catch (e) {}
    }

 /* 引号模式（）：'warn' = 不自动补闭引号，未闭合时标红提示（VS Code 的
 * 「标红而不是硬改」口径，默认）；'auto' = 老行为，打一个引号补一对。 */
 /* 候选类型开关（等价 VS Code `suggest.show*` 一族里插件有的四类）：
 * 存「关掉哪些」，默认全开；过滤在候选合并那一处做，索引/灰字/Tab 都跟着同一份列表。 */
    var KIND_KEY = 'dsh-composer-ease:kinds-off'
    var ALL_KINDS = [['word', '词'], ['file', '文件'], ['model', '模型'], ['snippet', '片段']]
    function kindsOff() {
      try { var a = JSON.parse(window.localStorage.getItem(KIND_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] }
    }
    function isKindOn(k) { return kindsOff().indexOf(k) < 0 }
    function toggleKind(k) {
      var off = kindsOff(), i = off.indexOf(k)
      if (i >= 0) off.splice(i, 1); else off.push(k)
      try { window.localStorage.setItem(KIND_KEY, JSON.stringify(off)) } catch (e) {}
    }

 /* 候选类型**预设**：不把四个开关摊成四行（`/` 菜单里太费），一行循环切换。
 * 组合仍是四个 kind 的开关，所以手改 localStorage 的 kinds-off 依然有效。 */
    var KIND_PRESETS = [
      { label: '全部', off: [] },
      { label: '无文件', off: ['file'] },
      { label: '只有词', off: ['file', 'snippet', 'model'] },
      { label: '全关', off: ['word', 'file', 'model', 'snippet'] },
    ]
    function kindPresetIndex() {
      var off = kindsOff().slice().sort().join(',')
      for (var i = 0; i < KIND_PRESETS.length; i++) {
        if (KIND_PRESETS[i].off.slice().sort().join(',') === off) return i
      }
      return -1          // 手工组合：不属于任何预设
    }
    function kindPresetLabel() {
      var i = kindPresetIndex()
      return i >= 0 ? KIND_PRESETS[i].label : '自定义'
    }
    function kindPresetDesc() {
      var i = kindPresetIndex()
      if (i < 0) return '自定义组合（' + ALL_KINDS.filter(function (k) { return isKindOn(k[0]) }).map(function (k) { return k[1] }).join('+') + '）'
      return i === 0 ? '词 + 文件 + 模型 + 片段 全开'
        : i === 1 ? '词 + 模型 + 片段（文件路径不进候选）'
        : i === 2 ? '只留词（词典 / 关键字 / 本机词）'
        : '四类全关（等于关掉补全）'
    }
    function kindPresetNextLabel() {
      var i = kindPresetIndex()
      return KIND_PRESETS[(i + 1) % KIND_PRESETS.length].label
    }
    function cycleKindPreset() {
      var next = KIND_PRESETS[(kindPresetIndex() + 1) % KIND_PRESETS.length]
      try { window.localStorage.setItem(KIND_KEY, JSON.stringify(next.off)) } catch (e) {}
    }

    var QUOTE_MODE_KEY = 'dsh-composer-ease:quoteMode'
    function quoteMode() {
      try { return window.localStorage.getItem(QUOTE_MODE_KEY) === 'auto' ? 'auto' : 'warn' } catch (e) { return 'warn' }
    }
    function setQuoteMode(m) {
      try { window.localStorage.setItem(QUOTE_MODE_KEY, m === 'auto' ? 'auto' : 'warn') } catch (e) {}
    }

 /* ── / 菜单：三行设置什么时候出、命令名怎么补 ───────────────────────
 * 宿主那侧只用子序列打分（dsh-web-frontend 里的 rankByName）：/comp 出 compact，
 * 但 /compot 这种错拼的子序列会断（整组只剩本插件那三行）。
 * 所以：① 三行也按 query 过滤，别在宿主那组消失后还赖在菜单里；
 * ② 错拼的兜底行由宿主的命令表来补（rescueRows），插件自己不解命令。 */
    function looseScore(query, text) {
      var q = String(query || '').toLowerCase(), t = String(text || '').toLowerCase()
      if (!q) return 0
      if (!t) return -1
      if (t.indexOf(q) === 0) return 1000 - Math.min(999, t.length - q.length)   // 前缀命中
      var at = t.indexOf(q)
      if (at > 0) return 800 - Math.min(799, at)                                  // 中段连续命中
      var ti = 0, hit = 0
      for (var qi = 0; qi < q.length; qi++) {
        var ch = q.charAt(qi)
        while (ti < t.length && t.charAt(ti) !== ch) ti++
        if (ti >= t.length) return -1                                             // 子序列也断：不命中
        ti++; hit++
      }
      return 400 + hit
    }
 /** 错拼容忍：正常命中一律不算（返回 -1），只有「跳过 ≤2 个查询字符、≤2 个目标字符」
 * 才给分数。实测 /compot → compact 恰好是跳 1 个查询字符（o）、2 个目标字符（a c）。 */
    function typoScore(query, text) {
      var q = String(query || '').toLowerCase(), t = String(text || '').toLowerCase()
      if (!q || !t || looseScore(q, t) >= 0) return -1
      var qi = 0, ti = 0, skipQ = 0, skipT = 0, hit = 0
      while (qi < q.length) {
        if (ti >= t.length) { skipQ += q.length - qi; break }
        if (q.charAt(qi) === t.charAt(ti)) { qi++; ti++; hit++; continue }
        var ahead = t.indexOf(q.charAt(qi), ti)
        if (ahead >= 0 && ahead - ti <= 2 && skipT + (ahead - ti) <= 2) { skipT += ahead - ti; ti = ahead; continue }
        skipQ++; qi++
        if (skipQ > 2) return -1
      }
      return hit >= 3 ? hit : -1
    }
 /** 三条设置行（定的口径：/ 菜单是操作入口不是设置面板，一行一条、点一下切一档）。 */
    function settingsRows() {
      var on = pairStrict()
      var qm = quoteMode()
      return [
        {
          name: '引号模式',
          label: qm === 'auto' ? '引号模式：自动补对' : '引号模式：标红提示',
          description: qm === 'auto'
            ? '当前：自动补对（打一个引号补一对；严格配对关时右侧有文字则只插一个）'
            : '当前：标红提示（默认；引号未闭合时输入框标红，不替你补）',
          hint: qm === 'auto' ? '点击改为标红提示' : '点击改为自动补对',
        },
        { name: '候选类型',
          label: '候选类型：' + kindPresetLabel(),
          description: '当前：' + kindPresetDesc(),
          hint: '点击切到：' + kindPresetNextLabel() },
        {
          name: '严格配对',
          label: '严格配对',
          description: on ? '当前：开（引号必须前后成对，混全角半角也算一对）' : '当前：关（默认，遇到已有引号就不再补对）',
          hint: on ? '点击关闭' : '点击开启',
        },
      ]
    }
 /** 取不到宿主命令表时的兜底：本机只有这三条内置命令（dsh-command-compact/goal/feedback）。 */
    var BUILTIN_COMMANDS = [['compact', '压缩上下文'], ['goal', '目标'], ['feedback', '反馈']]
 /** 错拼兜底行：宿主那份排名没排出来的命令，按「跳字」判据补一行（正常拼写不重复出）。 */
    function rescueRows(query, host) {
      var q = String(query || '')
      if (!q) return []
      var matched = {}
      var seen = host && host.matched ? host.matched : []
      for (var i = 0; i < seen.length; i++) if (seen[i] && seen[i].name) matched[seen[i].name] = 1
      var pool = (host && host.all && host.all.length) ? host.all : BUILTIN_COMMANDS.map(function (c) {
        return { name: c[0], label: c[1] }
      })
      var out = []
      for (var j = 0; j < pool.length; j++) {
        var r = pool[j]
        if (!r || !r.name || matched[r.name]) continue       // 宿主已经排出来的行不再重复
        var score = Math.max(typoScore(q, r.name), typoScore(q, r.label || ''))
        if (score < 0) continue
        out.push({
          name: r.name,
          label: '/' + r.name + (r.label ? '　' + r.label : ''),
          description: String(r.description || ''),
          hint: '错拼兜底',
          rescue: r.name,
        })
        if (out.length >= 3) break
      }
      return out
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

