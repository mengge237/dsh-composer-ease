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
 // 全角括号改半角（默认关）：中文输入法会把 ( 合成 （，有人要的就是 ASCII 的 ()。
 // 关＝尊重输入法打出来的字符（中文正文里 （） 才是正确标点）。
    var FW_HALF_KEY = 'dsh-composer-ease:fullwidthHalf'
 // 词典兜底（VS Code editor.suggest.showWords 的同位开关）：关掉后只用本文/工作区取词
    var SHOW_WORDS_KEY = 'dsh-composer-ease:showWords'
 // 免弹层行内建议（VS Code editor.inlineSuggest.enabled 的同位开关）
    var INLINE_KEY = 'dsh-composer-ease:inlineSuggest'
 // 默认关：行内建议会改变「弹不弹菜单」的手感，先让用户自己开（菜单里一行「行内建议」）
    function inlineOn() {
      try { return window.localStorage.getItem(INLINE_KEY) === '1' } catch (e) { return false }
    }
    function setInlineOn(on) {
      try { window.localStorage.setItem(INLINE_KEY, on ? '1' : '0') } catch (e) {}
    }

    function wordsOn() {
      try { return window.localStorage.getItem(SHOW_WORDS_KEY) !== '0' } catch (e) { return true }
    }
    function setWordsOn(on) {
      try { window.localStorage.setItem(SHOW_WORDS_KEY, on ? '1' : '0') } catch (e) {}
    }
 // 默认开：中文态打 ( 出来的 （ 直接换成半角 ()（一次反馈：括号会输出成（））。
 // 想按中文标点写正文的，在 / 菜单关掉即可。
    function fwHalf() {
      try { return window.localStorage.getItem(FW_HALF_KEY) !== '0' } catch (e) { return true }
    }
    function setFwHalf(on) {
      try { window.localStorage.setItem(FW_HALF_KEY, on ? '1' : '0') } catch (e) {}
    }
 // 默认 auto：没有选区、前方也没有未闭合引号时，单独打一个引号就该得到一对。
 // 标红模式退成显式开关（/ 菜单里切），不再默认关掉配对。
    function quoteMode() {
      try { return window.localStorage.getItem(QUOTE_MODE_KEY) === 'warn' ? 'warn' : 'auto' } catch (e) { return 'auto' }
    }
    function setQuoteMode(m) {
      try { window.localStorage.setItem(QUOTE_MODE_KEY, m === 'auto' ? 'auto' : 'warn') } catch (e) {}
    }
 // ── 设置版本：默认值改过之后，旧默认值不能一直粘在用户身上 ──────────────
 // 实测：旧版默认是「标红提示」，那些用户 localStorage 里存着 warn，升级后打引号
 // 仍然不配对，看上去像插件没修好。换默认值时清掉该格，显式选择从这一版重新记。
    var SCHEMA_KEY = 'dsh-composer-ease:schema'
    var SCHEMA_NOW = '2'
    function settingsKeys() { return [PAIR_STRICT_KEY, KIND_KEY, QUOTE_MODE_KEY, FW_HALF_KEY] }
    function migrateSettings() {
      try {
        if (window.localStorage.getItem(SCHEMA_KEY) === SCHEMA_NOW) return
        window.localStorage.removeItem(QUOTE_MODE_KEY)
        window.localStorage.setItem(SCHEMA_KEY, SCHEMA_NOW)
      } catch (e) {}
    }
    function resetSettings() {
      try {
        for (var i = 0; i < settingsKeys().length; i++) window.localStorage.removeItem(settingsKeys()[i])
        window.localStorage.setItem(SCHEMA_KEY, SCHEMA_NOW)
      } catch (e) {}
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
 /* "/" 菜单只留一行「严格配对」：设置类入口搬到设置页（settings.general.item），
 * 触发位是命令与技能的地盘，不再堆设置行。 */
    function slashRows() {
      var all = settingsRows()
      for (var i = 0; i < all.length; i++) if (all[i] && all[i].name === '严格配对') return [all[i]]
      return []
    }

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
          name: '全角括号',
          label: '全角括号：' + (fwHalf() ? '打成半角 ()' : '保持全角（）'),
          description: fwHalf()
            ? '当前：输入法打 （ 得到半角 ()（写正文想要中文标点就关掉这一项）'
            : '当前：保持输入法给的字符（中文正文里 （） 是正确标点）',
          hint: fwHalf() ? '点击改为保持全角' : '点击改为打成半角 ()',
        },
        {
          name: '重置插件设置',
          label: '重置插件设置',
          description: '把本插件存下的选择（引号模式 / 候选类型 / 严格配对）清回默认',
          hint: '点击立即重置',
        },
        {
          name: '行内建议',
          label: '行内建议：' + (inlineOn() ? '开' : '关'),
          description: inlineOn()
            ? '当前：开（上下文取到的词直接贴灰字，Tab 接受；这一档已知边角：菜单可能到下一键才彻底收干净）'
            : '当前：关（一律弹菜单；打开后只对「本文里写过的词」生效）',
          hint: inlineOn() ? '点击关掉行内建议' : '点击打开行内建议',
        },
        {
          name: '词典兜底',
          label: '词典兜底：' + (wordsOn() ? '开' : '关'),
          description: wordsOn()
            ? '当前：开（本文里没有可补的词时，才回落到词典/语言词表）'
            : '当前：关（只用本文草稿取词；词典与语言词表不参与）',
          hint: wordsOn() ? '点击关掉词典兜底' : '点击打开词典兜底',
        },
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
    function rescueRows(query, host, leading) {
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
 // 与宿主同一条位置判据：带输入提示的命令只在行首列（行内打 / 时不列）
        if (!leading && r.hint) continue
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
      var url = ROUTE_WORDS + '?prefix=' + encodeURIComponent(prefix || '') + '&words=' + (wordsOn() ? '1' : '0') + '&lang='
      return fetch(url).then(function (r) { return r.json() }).then(function (d) {
        return d ? (Array.isArray(d.candidates) ? d.candidates : (Array.isArray(d.items) ? d.items : [])) : []
      }).catch(function () { return [] })
    }

