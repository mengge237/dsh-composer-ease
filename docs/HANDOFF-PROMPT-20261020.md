# 交接提示词（复制下面整段给新会话）

---

继续 `dsh-composer-ease`（「更便捷的输入框」）这条线。**只做这个插件，别的项目不用管。**

先读这两份，别跳过：
- `<本地路径>` —— 现状、验法、已排除的三条路、发布流程
- `<本地路径>` —— 84 项假 DOM 用例就是行为规格

现状：版本 **0.9.5**，公开仓 `mengge237-labs/dsh-composer-ease` 的 `master` = `86904cf`（含交接文档），
五支测试 **121 项全绿**（`selftest` 10 / `server-routes` 6 / `client-smoke` 11 / `client-behavior` 84 / `compliance` 10）。

**唯一开放缺陷**：真实 Lexical 里「前方有引号、中间中文、末尾再打引号」仍会多出一个引号。
`CE_PENDING=1 node test\client-behavior.mjs` 会红 3 条，那 3 条就是缺口清单。

已经被实测否掉的路，**不要重试**：
1. `keydown` 里读内容 —— Lexical 那一刻 DOM 是空的（`innerText` 只有 `\n`、`flatText=''`、`caret=0`）
2. `beforeinput` 里 `preventDefault()` + 自己插 —— Lexical 不理会取消，原生照样插入，结果双份
3. 靠 `input` 事件事后补闭符 —— 5 场里只有 1 场回调到，不可靠

继续的两条候选（先定一条再动手）：
- `MutationObserver` 观察 `[data-composer-input]` 子树，在「新增一个开符文本节点」后补闭符并重设 Range
- 自维护影子状态（文本 + 光标偏移，每次事件同步，读不到就沿用上一次），不依赖 DOM 时序

硬性要求：
- 验收一律真机：起 `dsh --profile demo --port 3081 --no-open`，用 Playwright 连 `http://127.0.0.1:3081/?token=…`（token 从启动日志正则取）；
  **不要用 3080 主宿主做破坏性验证，也不要重启它**。
- 五场真机全绿才提交：空框打引号 / 前方有引号+中文 / 框住普通文字 / Shift 连按 / 中文引号成对。
- 假 DOM 只能当逻辑单测，**不许**用它证明时序问题解决。
- 改 `lib/client.js` 后刷新页面即生效；改 `lib/index.js` 或加依赖要重启宿主（重启会中断会话，属于要我先点头的动作）。
- 提交按路径：公开仓 clone + robocopy `/MIR` + commit + push，推完用 `gh api .../commits/master` 核 sha 一致。

先做的事：跑一遍五支测试确认基线，然后把 `CE_PENDING=1` 的 3 条读完，选一条候选路线，先写失败用例再改实现。
