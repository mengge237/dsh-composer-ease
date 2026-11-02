// ── 模块：设置页座位 ────────────────────────────────
// 五个开关从 "/" 菜单搬到设置页（settings.general.item），不再占高频触发位。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

 /* 执行一行设置（与 "/" 菜单里的动作同一份实现，避免两处各写一遍）。 */
    function runSettingRow(name) {
      if (name === '引号模式') setQuoteMode(quoteMode() === 'auto' ? 'warn' : 'auto')
      else if (name === '候选类型') cycleKindPreset()
      else if (name === '全角括号') setFwHalf(!fwHalf())
      else if (name === '严格配对') setPairStrict(!pairStrict())
      else if (name === '词典兜底') setWordsOn(!wordsOn())
      else if (name === '行内建议') setInlineOn(!inlineOn())
      else if (name === '重置插件设置') resetSettings()
    }

 /** 注册设置页那一行。拿不到 slots 服务就返回 false，调用方据此保留 "/" 里的兜底入口。 */
    function mountSettingsSeat(ctx) {
      var mark = function (v) { try { window.__DSE_SETTINGS_SEAT__ = v } catch (e) {} }
      try {
        if (!ctx || typeof ctx.inject !== 'function') { mark('no-inject'); return false }
        ctx.inject(['slots'], function (scope) {
          try {
            var slots = scope && scope.slots
            if (!slots || typeof slots.inject !== 'function') { mark('no-slots'); return }
            slots.inject('settings.general.item', function () {
              return slots.register({ name: 'settings.general.item', id: 'composer-ease', order: 60 }, SettingsSeatRow)
            })
            mark('ok')
          } catch (e) { mark('reg-err:' + (e && e.message)) }
        })
        return true
      } catch (e) { mark('err:' + (e && e.message)); return false }
    }

 /** 一行设置：五个开关平铺，用宿主全局的 React 画，不引任何依赖；点一下就地刷新。 */
    function SettingsSeatRow() {
      var R = (typeof React !== 'undefined' && React) || (typeof window !== 'undefined' && window.React)
      if (!R || !R.createElement) return null
      var st = R.useState(0)
      var bump = st[1]
      var rows = settingsRows().filter(function (r) { return r && r.name })
      return R.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
        R.createElement('span', { style: { fontWeight: 600 } }, '便捷输入框'),
        rows.map(function (r, i) {
          return R.createElement('button', {
            key: r.name,
            type: 'button',
            title: r.description || '',
            onClick: function () { try { runSettingRow(r.name) } catch (e) {} bump(function (n) { return n + 1 }) },
            style: { padding: '4px 10px', borderRadius: '999px', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', font: 'inherit' }
          }, r.label || r.name, i >= 0 ? '' : '')
        })
      )
    }
