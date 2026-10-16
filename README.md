# dsh-composer-pro

把 DSH 输入框（composer）的手感对齐 **VSCode**：打括号/引号自动配对、选中一段再打括号=环绕、
再打闭合符=跳过、退格删空对、补全弹层（`Ctrl+Space`，打满两个字母也自动弹）。
补全数据三类：**本文词**（草稿里出现过的标识符，VSCode word-based 口径，本地即时算）、
**各语言词表**（HTML 标签 / JS·Python·Java 关键字 / CSS 属性名，见 `lib/words.js`）、
**工作区文件路径**（深度 ≤3，跳过 node_modules）与 **settings 真源里配置的模型名**，外加几个常用代码片段。

## 键位（对照 VSCode）

| 操作 | 键 | 行为 |
|---|---|---|
| 自动配对 | `(` `[` `{` `"` `'` 反引号 | 光标前是路径/标识符字符时**不**配对（保护 `E:/path` 与 `call(` 场景） |
| 环绕选区 | 选中后打任意开括号 | `选区` → `(选区)`，选区保持选中 |
| 跳过闭合 | 光标右已是应得的闭符时再打它 | 不重复插，移过去 |
| 删空对 | 光标夹在 `()` 中间按 Backspace | 一次删两侧 |
| 补全 | 打满 2 个标识符字符自动弹；`Ctrl+Space` 手动 | 弹层：本文词优先，其后语言词表/文件/模型/片段，前缀 > 包含 > 子序列，≤12 条 |
| 接受 | **只有 `Tab`**（或鼠标点那一行） | **回车不吃弹层**：聊天框里回车必须发送——2026-10-16 维护者真机踩到「连按回车把候选一遍遍插进正文」（`i临时目录/attrib-index.dif临时目录/…` 那种滚雪球），改成接受只留 Tab |
| 关闭/选择 | `Esc` 关闭、`↑↓` 选择、`Shift+Enter` 换行 | 接受之后弹层**不会自己复开**（自己插入的文本不触发再次取数） |
| 触发式 | 行首或空白后打 `/`、`@` | 直接开补层（文件路径 / 模型名） |
| 语言提示 | 草稿里写围栏 ```js / ```python / ```html | 按该语言上词表；没写就上公共池（HTML 标签 + JS 关键字），所以聊天框里打 `inp` 也能补 `input` |

## 形态与边界

- 客户端半边是**纯 DOM**（不 require react，不引任何编辑器库），keydown 用**捕获阶段**先于
  Lexical 自己的键位；输入走 `document.execCommand('insertText')` / textarea 原生 setter，
  保证宿主 composer（Lexical contenteditable，0.1.6+ 带 `data-composer-input`）与老 textarea 形态都能进字。
- 服务端半边两个只读路由，全部过本机信任栅栏（loopback Host + Origin 同源，抄 better-sidebar/whale 同一套判据）：
  - `GET /dsh-composer-pro/words?prefix=&lang=` → 候选（语言词表 + 工作区文件 + 模型名 + 片段）；`lang` 认不出时只上公共池
  - `GET /dsh-composer-pro/config.json` → 配对表、键位、词表规模与**借用出处**（诊断用）
- 词表只有一个真源：`lib/words.js`（服务端读它；客户端不复制一份，避免两处漂移）。
- **候选匹配规则（2026-10-16 收紧，别再放宽）**：文件候选**只认「某个路径段以查询开头」**（`attrib` → `临时目录/attrib-index.diff`），
  段内中段匹配要查询 ≥3 字符，**纯子序列一概不给** —— 路径太长，子序列等于随机命中，会逼着人逐个核对别的文件
  （维护者原话「被迫核对以外的文件」）。子序列只留给词表/模型/片段这类短候选，且同样要 ≥3 字符。
- **缓存**：工作区文件索引与模型 id 各带 20s TTL（`filesCached` / `modelsCached`），
  以前每敲一个键都全盘走一遍（深 3 层、封顶 400），实测首次 23ms、命中缓存 0~1ms。
- **不做**：不改宿主 composer 的数据模型、不接管 Enter 发送、不注入样式以外的东西。
- **选区操作的两个硬约束（2026-10-16 真机扫出来的，改这块前先看）**：
  1. **不要用 `sel.modify(...)`** —— 宿主 composer 是 Lexical，真机上它不生效：配对后的光标、跳闭合、
     删空对、环绕选区还原、Tab 替换 token 会「值对、位置全错」。一律走「摊平字符偏移 + 显式 Range」
     （`flatText` / `caretOffset` / `setSelectionRange`）。
  2. **我们的 keydown 在捕获阶段，早于 Lexical 自己的处理** —— 插入后立刻改选区会被 Lexical 随后的渲染覆盖，
     contenteditable 这条路要用 `soon()` 推一拍再改。
- v1 计划（未实现，先记账）：`Alt+↑/↓` 移动行、`Ctrl+D` 复制行、`Ctrl+/` 注释切换 ——
  这三条要动 Lexical 文档模型，得走宿主编辑器 API 而不是 execCommand，别当成已有功能。

## 来源（按用户口径「照搬开源就写上来源」）

- **键位与交互设计**：对齐 Visual Studio Code（MIT, microsoft/vscode）。本包**未复制其任何源码**，
  只参照公开键位表与行为语义（word-boundary 抑制、surround、type-over closer、删除空对）；
  「本文词补全」参照 VSCode 的 word based suggestions 口径（标识符形状、按出现次数排），自实现。
- **补全词表数据**（`lib/words.js`，只借数据、不搬代码）：
  | 数据 | 项目 | 许可证 | commit |
  |---|---|---|---|
  | JS / Python / Java 关键字 | [microsoft/monaco-editor](https://github.com/microsoft/monaco-editor) | MIT | `f54d769` |
  | HTML 标签、全局属性 | [codemirror/lang-html](https://github.com/codemirror/lang-html) | MIT | `06eec80` |
  | CSS 伪类、at 规则 | [codemirror/lang-css](https://github.com/codemirror/lang-css) | MIT | `7b7835b` |
  | CSS 属性名 | [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data) | CC0-1.0 | `0416078` |

  抽取是静态的（正则取数组与对象键），没执行任何第三方代码；**许可证原文照录在 [THIRD-PARTY.md](THIRD-PARTY.md)**。
  运行时不依赖这些项目（词表已冻成本包里的静态数组）。
- **补全排序打分**（前缀>包含>子序列）：参照 VSCode IntelliSense 的 fuzz 排序惯例的简化版，自实现。
- 未使用 Monaco / CodeMirror / Lexical 组件库（宿主 composer 本身就是 Lexical，本件只做外围增强）。

## 安装 / 卸载 / 生效边界

```
dsh plugin --profile web add "<本地路径>"
dsh plugin --profile web remove dsh-composer-pro
```

**生效边界（2026-10-16 实测钉死）**：加/删插件行可当场激活（patchReload live），但**改服务端半边的代码
必须重启 `dsh web`** —— 实测改完 `lib/index.js` 后现场 `/config.json` 仍报旧版本号（ESM 已载入内存，不重读）。
浏览器半边是**每次请求现读磁盘**，改完刷新页面即可（本文词补全就是这么验的）。
自检：`npm test`（四支、35 项、0 网络）：`selftest.mjs` 数据层、`server-routes.mjs` 路由与信任栅栏、
`client-smoke.mjs` bundle 形状与纯逻辑、`client-behavior.mjs` 假 DOM 驱动真监听（配对/跳闭合/删空对/接受候选/自动弹）。
真机验收（headless 打真 composer，11 项）见 [test/REPORT-2026-10-16.md](test/REPORT-2026-10-16.md)。
