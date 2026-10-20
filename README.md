# 更便捷的输入框（dsh-composer-ease · DSH 输入框增强）

**[中文](README.md) · [English](README.en.md)**

![概览](docs/banner.svg)

![两镜头演示：围栏语言与对话上下文](docs/demo.gif)

*动图两镜头（真机录制，纯净 profile：只有官方插件 + 本插件）：① 新会话里写围栏 ` ```py ` 再打 `def` —— 弹层顶上标「本文围栏 · py」，给的是 Python 词表；② 对话里已经有 Java 代码时打 `pub` —— 顶上标「据对话推断 · java」，首条直接是 `public`。依据行就是「凭什么给这张词表」的答案。*

DSH 网页输入框的补全与编辑增强：括号引号自动配对，选中一段再打符号直接框住，光标右边已是闭符时再打它直接跳过，
退格删掉一对空括号；再给一个补全弹层——**草稿里出现过的词、各语言关键字与标签、工作区文件路径、settings 里配的模型名**，
打满两个字母自己弹，弹层顶上还有一行依据，写清「凭什么给这张词表」。

标准 DSH bundle 插件：一条命令安装、**不 require 任何第三方包**、**不写任何文件**、**不改宿主一行源码**，也不需要任何令牌。
浏览器半边是纯 DOM（不依赖 react、不引编辑器库），服务端半边只有两个只读路由。

## 装在哪、怎么装

| 你要装在哪 | 装法 | 注意 |
|---|---|---|
| **DSH Web（`dsh web`）** | `dsh plugin --profile web add https://github.com/mengge237/dsh-composer-ease` | 推荐。也可以装本地源码目录：`dsh plugin --profile web add "<本仓路径>/dsh-composer-ease"` |
| **官方桌面端（Electron）** | 用**桌面端自己的插件管理器**装 | 别用 `dsh plugin --profile desktop`（那条路被 Electron 独占，CLI 会拒绝）；桌面端会话里让 DSH 自己装 |
| **开发（改代码）** | 源码目录 + `file:` 装法 | 客户端半边**每次请求现读磁盘**，改完刷新页面即生效；**服务端半边（`lib/index.js`、`lib/words.js`）改完要重启 `dsh web`** |

卸载：`dsh plugin --profile web remove dsh-composer-ease`（不留任何数据文件，没有要清理的东西）。

## 特性

- **自动配对**：`(` `[` `{` `"` `'` 成对插入，光标落中间；全角 `（）`「」『』等同样处理（走 `beforeinput`，中文输入法也算）。前面是路径或标识符时不补，避免把 `call(` 变成 `call()`
- **框住选区**：选中一段再打符号，直接变成 `(选区内容)`，光标留在括号外
- **跳过闭符 / 删掉空对**：右边已是同一个闭符时再打它只移光标；`()` 中间退格一次删一对
- **补全弹层（四类候选）**：草稿里出现过的词、各语言关键字与标签、工作区文件路径、settings 里的模型名；打满两个标识符字符自动弹，`Tab` 接受、回车仍是发送
- **依据行**：弹层顶上写明这批候选凭什么来 —— 「据对话推断 · java」「本文围栏 · python」「历史习惯 · javascript」
- **行内灰字**：首位候选比已打前缀多出来的那截贴在光标后；失效时自动收起，不留空提示

## 键位

| 操作 | 按键 | 说明 |
|---|---|---|
| 自动配对 | `(` `[` `{` `"` `'` 及全角对应 | 前面是路径/标识符时不补；右边已有同款闭符时只移光标 |
| 框住选区 | 选中后打开符 | `选区` → `(选区)` |
| 跳过闭符 | 打对应闭符 | 不重复插入，直接跳过 |
| 删空对 | `()` 中间退格 | 一次删一对 |
| 安全补位 | 打满 2 个标识符字符 / `Ctrl+Space` | 候选来自草稿、词表、文件、模型、片段 |
| 接受 | **只有 `Tab`** | 回车保留为发送，不会误插 |
| 关闭 | `Esc` / `↑` `↓` | `Shift+Enter` 仍是换行 |

## 候选匹配规则

- **文件候选只认「某个路径段以查询开头」**：`attrib` → `临时目录/attrib-index.diff` 排第一；段内中段匹配要求查询 ≥3 个字符
- **不做松散模糊（纯子序列）**：路径本来就长，子序列几乎必中，等于「打一个字给你一堆别的文件」，会逼着人逐个核对
- 子序列只留给词表 / 模型 / 片段这类短候选，且查询至少 3 个字符

## 已知边界

- **服务端半边改代码要重启 `dsh web`**（ESM 已载入内存不重读）；客户端半边刷新页面即生效
- 语言词表的键位（如 `inp` → `input`）在**服务端**，因此首次装好或改完词表后，要重启一次才全线生效
- 只在 **0.2.0-rc.2** 的 web 与桌面端两个 profile 上实测过（宿主版本更新后请重跑自检）
- 老式 `textarea` 形态的输入框只有离线测试覆盖，真机上没样本
- **不改宿主 composer 的数据模型**：所以 `Alt+↑/↓` 移动行、`Ctrl+D` 复制行、`Ctrl+/` 注释切换这类要动 Lexical 文档模型的操作**没有做**，别当已有功能
- 补全只做「插入文本」，不做语义分析：它不知道你的代码里哪些符号可以用

## 目录结构

| 路径 | 用途 |
|---|---|
| `lib/index.js` | 服务端半边：两条只读路由（`/dsh-composer-ease/words`、`/config.json`）与本机信任栅栏 |
| `lib/client.js` | 浏览器半边：keydown 捕获层、配对与环绕、补全弹层（纯 DOM，无第三方依赖） |
| `lib/words.js` | 各语言词表（静态数组，出处与 commit 写在文件头） |
| `test/` | 五支测试 + 真机验收报告（`REPORT-2026-10-16.md`） |
| `docs/` | README 配图 |
| `THIRD-PARTY.md` | 借用数据的来源与**许可证原文** |
| `cordis.patch.yml` | DSH bundle 声明（`dsh.bundle.patch`） |

## 开发与测试

```bash
npm test        # 五支，61 项，0 网络：数据层 / 路由与信任栅栏 / bundle 形状 / 假 DOM 行为测试 / 许可与合规
```

- `test/selftest.mjs`：候选排序、模型 id 解析、文件收集封顶、workspace.json v2 形状、词表命中
- `test/server-routes.mjs`：路由形状、**本机信任栅栏**（非 loopback Host 与跨站 Origin 一律 403）、方法闸、`config.json` 载荷
- `test/client-smoke.mjs`：bundle 头与导出形状、键位判据、本文词与围栏识别
- `test/client-behavior.mjs`：**假 DOM 驱动真监听**——配对、环绕、跳闭合、删空对、Ctrl+Space 取数、Tab 接受替换、回车放行、接受后不复开
- `test/compliance.mjs`：**许可与条例自检（9 项）**——自家 MIT 署名、每个借用件在 THIRD-PARTY.md 里都有仓库+许可+钉住的 commit、
  MIT/CC0 原文照录、逐字搬来的代码带出处头（含「改了什么」）、运行时零第三方依赖、仓里没有密钥、版本号与更新日志对得上、
  登记表那侧 `npm` 键合法、**上游版权声明原样保留且排在我们的说明之前**。反向对照过：删掉台账里一行、把版本号改成 9.9.9，它都会红
- 真机验收（headless 打真 composer，11 项）：结果与复现命令见 [test/REPORT-2026-10-16.md](test/REPORT-2026-10-16.md)

改这块前先读 README 的「形态与边界」与语言词表文件头：宿主 composer 是 **Lexical**，它不认 `sel.modify(...)`，
选区操作必须走「摊平字符偏移 + 显式 Range」，且我们的监听在捕获阶段、早于宿主处理，插入后改选区要推一拍。

## 常见问题

- **打 `inp` 没出现 `input`？** 语言词表在服务端半边：装好之后（或改过词表之后）要重启一次 `dsh web`
- **为什么回车不接受候选？** 聊天框里回车是发送键；接受请用 `Tab`（0.2.2 起如此，之前回车也算接受，会连插候选）
- **选中一段再打括号没框住？** 0.3.0 起已修：半角走 keydown、全角与中文输入法走 beforeinput；若你用的是老版本，先升级
- **为什么不再给一堆不相关的文件？** 0.2.2 起文件候选只认路径段前缀；要更宽的匹配请直接用 `/` 或 `@` 触发
- **它会改我的文件吗？** 不会。只读工作区文件清单与 settings 真源，一个字节都不写
- **桌面端怎么装？** 桌面端是独立 profile，用桌面端自己的插件管理器装（`dsh plugin --profile desktop` 会被拒）

## 来源与许可

- **交互设计**参照 Visual Studio Code（MIT，microsoft/vscode）：word-boundary 抑制、surround、type-over closer、删除空对、
  word based suggestions 的排序口径——**未复制其源码**，只对齐行为语义
- **词表数据**借用自 monaco-editor、codemirror/lang-html、codemirror/lang-css、MDN browser-compat-data，
  每条都在 [THIRD-PARTY.md](THIRD-PARTY.md) 里写明了仓库、commit、取用文件与**许可证原文**；抽取是静态的，运行时不依赖这些项目
- 本插件自身：MIT（见 [LICENSE](LICENSE)）

---

[English README](README.en.md)
