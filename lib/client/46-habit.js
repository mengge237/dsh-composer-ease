// ── 模块：习惯学习 ────────────────────────────────────
// rememberWord / habitBoost：把「用户接受过的候选」按次数记下来，跨会话存在 localStorage。
// 只在 apply() 那一刻读一次存储（打分路径里不再碰 localStorage），避免每次排序都摸存储。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var HABIT_KEY = 'dsh-composer-ease:habit'
    var habitMap = {}
    var habitLoaded = false
    var habitSaveTimer = null

    function loadHabit() {
      if (habitLoaded) return
      habitLoaded = true
      try {
        var raw = window.localStorage.getItem(HABIT_KEY)
        var j = raw ? JSON.parse(raw) : null
        if (j && typeof j === 'object') {
          for (var k in j) if (Object.prototype.hasOwnProperty.call(j, k)) habitMap[k] = Number(j[k]) || 0
        }
      } catch (e) {}
    }

    function saveHabitSoon() {
      if (habitSaveTimer) return
      try {
        habitSaveTimer = setTimeout(function () {
          habitSaveTimer = null
          try { window.localStorage.setItem(HABIT_KEY, JSON.stringify(habitMap)) } catch (e) {}
        }, 400)
      } catch (e) {}
    }

 /** 记一次「这个词被接受过」。只记短词（≤24 字），避免把整段文本写进存档。 */
    function rememberWord(value) {
      var k = String(value == null ? '' : value)
      if (!k || k.length > 24) return
      loadHabit()
      habitMap[k] = (habitMap[k] || 0) + 1
      saveHabitSoon()
    }

 /** 习惯分：0~1，按次数做对数压缩（点 6 次封顶），用作同分时的先后。 */
    function habitBoost(value) {
      loadHabit()
      var n = habitMap[String(value == null ? '' : value)] || 0
      if (!n) return 0
      return Math.min(1, Math.log(1 + n) / Math.log(6))
    }
