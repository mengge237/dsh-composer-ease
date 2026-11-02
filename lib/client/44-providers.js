// ── 模块：候选来源注册（provider 契约）──────────────────
// 让别的插件往补全里喂候选：registerProvider({id, priority, triggerChars, provide})。
// 排序沿用 VS Code：priority 小的先；同一来源内按 sortText，再按 label。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var PROVIDERS = []

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
    function providerCandidates(prefix, triggerChar) {
      var p = String(prefix || '')
      var tc = triggerChar ? String(triggerChar) : p.charAt(0)
      var jobs = []
      for (var i = 0; i < PROVIDERS.length; i++) {
        var prov = PROVIDERS[i]
        if (prov.triggerChars && prov.triggerChars.indexOf(tc) < 0) continue
        jobs.push((function (pv) {
          try {
            return Promise.resolve(pv.provide({ prefix: p, triggerChar: triggerChar || '' }))
              .then(function (list) { return normalizeProviderItems(list, pv) })
              .catch(function () { return [] })
          } catch (e) { return Promise.resolve([]) }
        })(prov))
      }
      if (!jobs.length) return Promise.resolve([])
      return Promise.all(jobs).then(function (lists) {
        var all = []
        for (var k = 0; k < lists.length; k++) all = all.concat(lists[k])
        all.sort(function (a, b) { return (a.providerPriority - b.providerPriority) || (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0) })
        return all
      })
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
