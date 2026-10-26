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

