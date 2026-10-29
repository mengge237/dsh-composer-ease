---
description: "给 DeepSeek Harness Web 输入框加一套 VS Code 手感：括号与引号成对、选中即环绕，以及由本文词 / 语言词表 / 工作区文件 / 模型名 / 片段喂出来的补全弹层；供 DSH 用户与输入框插件维护者阅读。"
kind: "package-reference"
---

# dsh-composer-ease

[English](README.md) | 中文

## 概述

`dsh-composer-ease` 是一个 DSH bundle 插件，把 Web 输入框的手感对齐 VS Code：括号与引号成对、选中一段再打开符就环绕、闭符跳过、空对一次删两侧，打满两个字符弹补全。浏览器半边是纯 DOM；服务端半边只有两条只读的本机路由，一个字节都不写。

![概览](docs/banner.svg)

## 目录

- [安装](#安装)
- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [边界与已知限制](docs/边界与实现.md)
- [开发与测试](#开发与测试)
- [来源与许可](#来源与许可)
- [开发说明](#开发说明)

## 安装

```bash
dsh plugin --profile web add https://github.com/mengge237/dsh-composer-ease
dsh plugin --profile web remove dsh-composer-ease
```

桌面端（Electron）用它自己的插件管理器装，`dsh plugin --profile desktop` 会被 CLI 拒绝。开发时：浏览器半边每次请求现读磁盘（刷新即生效），服务端半边要重启 `dsh web`。

## 使用本包

| 操作 | 键 / 触发 | 行为 |
|---|---|---|
| 自动配对 | `(` `[` `{` `"` `'` 反引号与全角家族 | 光标落在中间；光标前是路径/标识符字符、或右边紧跟文字时不配对 |
| 环绕选区 | 选中后打任意开符 | `内容` → `(内容)`；只支持单行选区（见边界） |
| 跳闭合 / 删空对 | 右边已是闭符 / 光标夹在 `()` 里按退格 | 不重复插；一次删两侧 |
| 补全 | 打满两个字符，或 `Ctrl+Space` | 弹层：本文词、语言词表、工作区文件、模型名、片段 |
| 接受 / 选择 | `Tab` 或点击 / `↑` `↓` | 回车仍是发送；`←` `→` `Home` `End` 只收弹层、挪光标 |
| 关闭 | `Esc` | `Shift+Enter` 仍是换行 |

补全跟着上下文走：写了代码围栏就上该语言词表；否则由草稿与可见对话投票，再退到你最近接受过候选的语言。

## 理解实现

- `lib/index.js` —— 服务端半边：`/dsh-composer-ease/words` 与 `/config.json`，都在本机信任栅栏之后；排序用 `lib/fuzzy.js`（VS Code 的 `fuzzyScore`，逐字取用）。
- `lib/client/*.js` —— 浏览器半边，九个片段由 `tools/build-client.mjs` 拼成 `lib/client.js`（宿主只认一个文件）。
- 中文候选只来自词典（`lib/cjk-lexicon.js`）：前缀在词表里匹配，词长由数据决定，不再写死一个长度上限。
- 弹层是纯 DOM、锚在光标上；从不碰宿主编辑器的数据模型。

## 边界与已知限制

逐条阅读见 [docs/边界与实现.md](docs/边界与实现.md)（多行包裹、插入限制、输入法行为、波浪线几何），每条都写了为什么。

## 开发与测试

```bash
npm run build          # 片段 → lib/client.js
npm test               # 五支离线套件，185 项，0 网络
npm run check:all      # 结构 / 重复 / 重构预算 / 文档 / 隐私 / 散文 / 副本
node test/real/matrix.mjs "http://127.0.0.1:3081/?token=…" 3 --verbose   # 真机矩阵，每轮 33 条
```

宿主 composer 是 Lexical：不认 `sel.modify(...)`、不认 `beforeinput` 的 `preventDefault`、`input` 事件不保证派发 —— 选区操作一律走「摊平偏移 + 显式 Range + 跨帧校验」。

## 来源与许可

- 交互设计参照 Visual Studio Code（MIT）；除 `lib/fuzzy.js` 逐字取用外没有复制源码（见 [THIRD-PARTY.md](THIRD-PARTY.md)）。
- 词表数据借用自 monaco-editor、codemirror/lang-html、codemirror/lang-css、MDN browser-compat-data 与 jieba 词典；每条的仓库、commit、取用文件与许可证原文都记在 THIRD-PARTY.md。
- 本插件自身：MIT（见 [LICENSE](LICENSE)）。

## 开发说明

- 只改 `lib/client/*.js`，然后 `npm run build`；不要手改 `lib/client.js`。
- 每条约定都有可执行判据放在 `tools/check-*.mjs`；CI 只负责把它们拉起来（`.github/workflows/checks.yml`，ubuntu + windows，`concurrency` 保证每分支只留最新一次）。
- 发版：改 `package.json` 版本 → CHANGELOG 写条目并回填 commit sha → `npm run check:all`。
