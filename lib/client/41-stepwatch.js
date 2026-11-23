// ── 模块：步骤观察（纯前端，不依赖任何宿主包）────────────────
// 做法：用 MutationObserver 看会话区新出现的块，按可见文字/类名归类成 read/edit/run/search，
// 记成一条最近步骤（环形缓冲，最多 20 条，只在内存里、不落盘、不上报）。
// 拿不到就什么都不做——宿主改版时丢的是「按步骤排序」这一层，不报错、不影响补全主干。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var STEP_LOG = []
    var STEP_LOG_MAX = 20

 /* 工具卡是「标签 + 参数」的短块；只认第一段是已知标签的，用户消息与瞬时状态不认。 */
    var STEP_LABELS = {
      '读取': 'read', '已读': 'read', 'Read': 'read', 'Read File': 'read',
      '编辑': 'edit', '写入': 'edit', '已编辑': 'edit', 'Edit': 'edit', 'Write': 'edit', 'NotebookEdit': 'edit',
      '查找文件': 'search', '搜索': 'search', '匹配': 'search', 'Grep': 'search', 'Glob': 'search', 'Search': 'search', 'Find': 'search',
      '运行': 'run', '执行': 'run', '命令': 'run', 'Bash': 'run', 'Shell': 'run', 'Run': 'run', 'Terminal': 'run'
    }
    function classifyStep(text) {
      var s = String(text || '').replace(/\s+/g, ' ').trim()
      if (!s || s.length > 60) return ''
      if (/思考|深度求索中|运行中|生成中/.test(s)) return ''
      if (/\d+\s*(分钟|小时|天)前?|刚刚|昨天|前天/.test(s)) return ''
      var head = s.split(/[\s·:：,，]/)[0]
      var kind = STEP_LABELS[head] || ''
      if (!kind) return ''
      return /失败|报错|error|failed|exited with/i.test(s) ? 'fail' : kind
    }

 /** 记一条步骤（同一类型连续重复只留最新一条）。 */
    function noteStep(kind, label) {
      if (!kind) return
      var last = STEP_LOG[STEP_LOG.length - 1]
      if (last && last.kind === kind && last.label === String(label || '').slice(0, 80)) return
      STEP_LOG.push({ kind: kind, label: String(label || '').slice(0, 80) })
      if (STEP_LOG.length > STEP_LOG_MAX) STEP_LOG.shift()
    }

    function lastStep() { return STEP_LOG.length ? STEP_LOG[STEP_LOG.length - 1] : null }

 /** 上一步之后最可能要做的事（按步骤类型给的固定建议，不是模型推断）。 */
    function suggestAfterStep(step) {
      if (!step) return []
      if (step.kind === 'edit') return ['跑一遍相关测试并贴读数', '看一下这次的 diff 有没有多余改动']
      if (step.kind === 'run') return ['把失败的命令与输出贴出来', '给最小复现步骤']
      if (step.kind === 'fail') return ['按报错定位到文件与函数', '写一条能复现的最小用例']
      if (step.kind === 'read') return ['在这个文件里做最小改动', '把关键段落摘出来再判断']
      if (step.kind === 'search') return ['读命中文件里最相关的一段', '把命中的位置列出来']
      return []
    }

 /** 观察会话区：只认「短块 + 能归类」的节点，别把整段回答误当步骤。 */
    function startStepWatch(doc) {
      if (!doc || typeof MutationObserver === 'undefined') return
      try {
        var mo = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var added = records[i].addedNodes || []
            for (var k = 0; k < added.length; k++) {
              var el = added[k]
              if (!el || el.nodeType !== 1) continue
              var id = el.id || ''
              if (id === 'dsh-cp-popup' || id === 'dsh-cp-ghost' || id === 'dsh-cp-sighint') continue
              if (el.closest && el.closest('nav,aside,[role="navigation"],[data-dsh-sidebar]')) continue
              var txt = (el.innerText || el.textContent || '').trim()
              if (!txt || txt.length > 200) continue
              var kind = classifyStep(txt)
              if (kind) noteStep(kind, txt)
            }
          }
        })
        mo.observe(doc.body, { childList: true, subtree: true })
      } catch (e) {}
    }
