# 扩展点盘点（2026-11-02）

目的：在不和其它插件抢槽位的前提下继续扩展，全部依据本机已装包的实测读数，不靠猜。

## 一、输入区官方的三个注册源（/ 与 @ 谁在管）

| 官方包 | 触发字符 | order | 说明 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-commands` | `/` | 1 | 斜杠命令（command/run、command/done） |
| `@deepseek-ai/dsh-client-ui-skill` | `/` | 2 | 技能 |
| `@deepseek-ai/dsh-client-ui-reference` | `@` | 30 | 文件与会话引用 |
| **本插件** | `/` | **0** | 设置四行 + 错拼兜底行 |
| **本插件** | `@` | **50** | 文件与模型名 |

读数来自各包 `lib/client.js` 里的 `trigger:` / `order:` 字面量。结论：同一触发字符允许多个源并按 `order` 升序排；**同一个 trigger 下 `name` 必须唯一**（重名会抛）。

## 二、官方 source 的完整钩子面（我们只用了一半）

| 钩子 | 官方语义 | 我们现在 | 冲突风险 | 建议 |
|---|---|---|---|---|
| `candidates(session, req)` | 按 query 返回行 | 已用 | 无 | — |
| `onPick(pick)` | 选择后由消费方落字 | 已用 | 无 | — |
| `header` | 组上方面包屑，每次命中重算 | **未用** | 无（纯加法） | **可加**：把「引号模式 / 严格配对 / 全角括号」当前状态做成面包屑，替代多行设置 |
| `drill: true` | 行可下钻，二次路由 `action:'drill'` | **未用** | 无 | **可加**：`/` → 设置 → 三档引号模式，把 5 行压成 1 行，少挤占共享菜单 |
| `matchSpace` / `matchEnter` | 空格/回车裁决，按注册序，首个非 undefined 生效 | **未用** | 中：抢回车会与「回车＝发送」契约冲突 | 保持不实现（我们已用 keydown 保证发送） |
| `matchClaim` | 恢复持久化的命令 chip | **未用** | 无 | 暂不需要（我们不持久 chip） |
| `openReference(session, ref)` | 打开草稿引用而不提交 | **未用** | 无 | 可加：`@` 选中文件时先开草稿 |
| `subscribeLexicon` | 词表变更后重新拉候选 | **未用** | 无 | 可加：服务端词表重载后主动通知，避免用户重启 |

## 三、表面层：我们的弹层 vs 官方 overlay

官方把菜单视图注册进 `conversation.input.overlay`（SlotMap，list 类，会话作用域），材质、键盘路由、aria 都由宿主统一。我们的候选弹层是自绘 fixed div（`#dsh-cp-popup`）。

- **风险**：两份浮层同时存在时，z-index / 焦点 / Esc 归属容易打架（我们已经靠「`/`、`@` 出现时先关自己的层」规避）。
- **建议（中期）**：把候选层改成同一套 overlay 槽位注册，材质与键盘行为跟宿主一致；短期先保持自绘，但把「同一时刻只允许一个浮层」固化成判据（已在 onInput/onKeyDown 里）。

## 四、可加 / 会撞 / 需避让（结论）

- **可加（低风险，纯官方钩子）**：`header` 面包屑、`drill` 下钻、`openReference`、`subscribeLexicon`。
- **会撞（不要碰）**：`matchSpace`/`matchEnter`（回车必须发送）、在 `/` 下注册与官方命令同名的 `name`、替宿主执行命令（错拼兜底只补文字，不解命令）。
- **需避让**：`/` 组排在 0（最前）会让官方「指令/技能」下沉；若维护者反馈菜单太挤，应把自己的设置行改成 `drill` 子树而不是继续加行。

## 五、建议顺序

1. `/` 设置行改 `drill` 子树（5 行 → 1 行），顺带把 `header` 用起来显示当前状态；
2. `@` 加 `openReference`（草稿引用）；
3. 词表变更走 `subscribeLexicon`；
4. 候选层迁到 `conversation.input.overlay`（改动最大，单独一版）。
