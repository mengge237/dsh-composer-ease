// ── 模块：agent 步骤模板 ──────────────────────────────
// 给「对 agent 下指令」的输入框提供可复用步骤骨架（复现→定位→修→验→报）。
// 触发词命中且草稿较短时，把模板当片段候选排在最前；Tab 接受后按 ${n} 依次跳格。
// 模板是本仓自建，不来自第三方。
// 本文件是 lib/client.js 的片段，由 tools/build-client.mjs 按序拼回；不要直接改生成物 lib/client.js。

    var STEP_TEMPLATES = [
      {
        id: 'fix',
        title: '排查并修复',
        triggers: ['修复', '修一下', 'bug', '报错', '不生效', '跑不通', '实现', '新增', '添加', '改成', '重构', '优化', '迁移', '升级', '接入', '排查', '修好'],
        value: '先复现：\n${1:给出复现步骤或命令}\n再定位：\n${2:指出可疑文件与函数}\n然后修：\n${3:最小改动方案}\n最后验证：\n${4:跑哪条命令、看什么读数}'
      },
      {
        id: 'test',
        title: '补测试并跑绿',
        triggers: ['测试', '用例', '覆盖', '回归'],
        value: '给 ${1:目标模块} 补测试：\n1. 覆盖 ${2:主路径}\n2. 覆盖 ${3:边界与异常}\n3. 跑 ${4:npm test} 并贴出前后读数'
      },
      {
        id: 'review',
        title: '审查这段改动',
        triggers: ['审查', 'review', '把关'],
        value: '审查 ${1:改动范围}：\n① 行为是否与需求一致\n② 有没有遗漏的边界\n③ 有没有引入回归\n④ 必须改与可以不改的分界'
      },
      {
        id: 'release',
        title: '发版清单',
        triggers: ['发版', '发布', 'release'],
        value: '发版：\n① 真机复跑 ${1:矩阵}\n② npm pack 核对文件与体积\n③ 抬版本 + CHANGELOG（写提交 sha）\n④ push → workflow_dispatch → 核 latest 与 _npmUser'
      },
      {
        id: 'survey',
        title: '调研并给结论',
        triggers: ['调研', '对比', '选型', '有没有成熟'],
        value: '调研 ${1:主题}：\n① 列出 3 个成熟方案与出处\n② 按 ${2:维度} 对比\n③ 给出建议与不选的理由\n④ 标明哪些结论我没实测'
      },
      {
        id: 'explain',
        title: '解释这段代码',
        triggers: ['解释', '看懂', '为什么', '总结', '整理', '梳理'],
        value: '解释 ${1:文件或函数}：\n① 它解决什么问题\n② 关键数据流\n③ 容易踩的坑\n④ 改动它会影响谁'
      }
    ]

 /** 命中触发词 → 模板候选（kind=snippet，Tab 接受后按占位符跳格）；草稿超过 40 字不介入。 */
    function stepCandidatesFor(ed) {
      var draft = ed ? composerText(ed) : ''
      var d = String(draft || '')
      if (!d || d.length > 40) return null
      var hits = []
      for (var i = 0; i < STEP_TEMPLATES.length; i++) {
        var t = STEP_TEMPLATES[i]
        for (var k = 0; k < t.triggers.length; k++) {
          if (d.indexOf(t.triggers[k]) >= 0) {
            hits.push({ kind: 'snippet', value: t.value, label: t.title, detail: '步骤 ' + t.title, src: 'step' })
            break
          }
        }
      }
      return hits.length ? hits : null
    }

 /* 中文指令的开头字：只在这几个「常见起手」上给骨架，避免每打一个字都弹层。 */
    var STARTERS = {
      '请': ['fix', 'test', 'read'],
      '帮我': ['fix', 'review', 'test'],
      '先': ['fix', 'test', 'release'],
      '把': ['fix', 'test', 'review'],
      '看': ['review', 'explain'],
      '解释': ['explain'],
      '审查': ['review'],
      '调研': ['survey'],
      '发版': ['release'],
      '跑': ['test', 'fix'],
      '你': ['fix', 'review'],
      '这': ['review', 'fix'],
      '那': ['review'],
      '怎么': ['fix', 'explain'],
      '如何': ['fix', 'explain'],
      '为什么': ['explain'],
      '能不能': ['fix', 'test'],
      '给我': ['review', 'explain'],
      '帮我修': ['fix'],
      '帮我看': ['review', 'explain'],
      '先看': ['review'],
    }
 /** 起手字 → 骨架候选（最多 3 条）。draft 非空且不以起手字开头时返回 null。 */
    function starterCandidatesFor(text) {
      var draft = String(text || '').trim()
      if (!draft || draft.length > 8) return null
      var ids = null
      var keys = Object.keys(STARTERS)
      for (var i = 0; i < keys.length; i++) { if (draft.indexOf(keys[i]) === 0) { ids = STARTERS[keys[i]]; break } }
      if (!ids) return null
      var out = []
      for (var k = 0; k < ids.length && out.length < 3; k++) {
        for (var j = 0; j < STEP_TEMPLATES.length; j++) {
          if (STEP_TEMPLATES[j].id !== ids[k]) continue
          out.push({ kind: 'snippet', value: STEP_TEMPLATES[j].value, label: STEP_TEMPLATES[j].title, detail: '步骤 ' + STEP_TEMPLATES[j].title, src: 'starter' })
          break
        }
      }
      return out.length ? out : null
    }
    function starterCandidates(ed) { return starterCandidatesFor(ed ? composerText(ed) : '') }
