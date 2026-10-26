# 借鉴清单：VS Code 的 suggest 与 DSH 的管理做法

写于 2026-10-22（0.9.30）。两问：**输入框有没有跟进 VS Code 的做法**、**管理能不能借 DeepSeek harness 的**。
每条都给判据：对照源（上游文件）、我们现在的等价物、结论（已跟进 / 不适用 / 要补）。

---

## 一、VS Code 的 `editor.suggest.*`：44 个选项，我们跟了 8 个

对照源：`microsoft/vscode` → `src/vs/editor/common/config/editorOptions.ts`（本机取证：525,660 字节，44 个 `suggest.*` id）。
完整清单：`filterGraceful`、`filteredTypes`、`insertMode`、`localityBonus`、`matchOnWordStartOnly`、`preview`、
`selectionMode`、`shareSuggestSelections`、`snippetsPreventQuickSuggestions`、`show*` 一族（约 35 个，按类型开关）。

| VS Code 选项 | 语义 | 我们的等价物 | 结论 |
|---|---|---|---|
| `filterGraceful` | 先严格匹配、不够再放宽 | `fuzzyScore`（VS Code 同一套打分思路） | 已跟进 |
| `localityBonus` | 离光标近的候选优先 | `ctx` 分：当前工作区 +200、README 类 1000 | 已跟进（按目录而非光标） |
| `filteredTypes` / `show*` | 按候选类型开关 | `KIND_QUOTA`（词≤6、非词≥2）+ 类型图标/右侧类型词 | 部分跟进：有配额，没有用户开关 |
| `matchOnWordStartOnly` | 只按词首匹配 | **0.9.30 补**：`kind=word` 且前缀 ≥4 时必须词首匹配 | 已跟进（比默认更严，见下） |
| `insertMode` | 接受时覆盖 vs 插入 | 固定"覆盖当前 token"（`selectBack` + 插入） | 已跟进（聊天框只该覆盖） |
| `preview` | 预览插入效果 | 行内灰字（ghost） | 已跟进 |
| `selectionMode` | 弹层出现时是否预选一项 | 总是预选第 0 项，方向键改选中 | 已跟进（简化版） |
| `snippetsPreventQuickSuggestions` | 片段插入后不立刻再弹 | `suppressInput` 计数 | 已跟进 |
| `shareSuggestSelections` | 记住上次选的项 | `habitBump`（记语言词表，不记具体条目） | 未跟进：收益低 |
| `showClasses`/`showMethods`/`showInterfaces`/… 约 30 个 | LSP 语义类型 | —— | **不适用**：聊天框没有 LSP，我们只有 词/文件/模型/片段 四类 |

`matchOnWordStartOnly` 这条值得多说一句：VS Code 默认**关**（模糊优先），我按 4 字符为界开在"词"上，
理由是实测 `libr` 会给出 `libra`/`libri` 这类冷词而排掉 `library`——模糊在长前缀上只加噪声。
文件候选不受影响（仍走路径段前缀 + 模糊）。

## 二、输入框还缺什么（按价值排）

1. **片段占位符导航**：VS Code 的 snippet 有 `${1:name}`，Tab 在占位符间跳。我们的 `SNIPPETS` 只插纯文本。
   补法：`SNIPPETS` 里允许 `${n:文本}`，接受后把光标放到第一个占位符，Tab 依次跳；约 80 行，需要真机验。
2. **按类型的用户开关**：现在只能改 `KIND_QUOTA` 常量。补法是加两个 `/` 菜单项（同「严格配对/引号模式」的做法）。
3. **`shareSuggestSelections` 的简化版**：记住"上次按哪个类型接受"，同分时同类型优先。

## 三、DSH 的管理做法：借了 6 件

对照源：`E:/<本地目录>` 的
`.github/workflows/ci.yml`（35 KB）、`.github/ISSUE_TEMPLATE/*`、`.github/pull_request_template.md`、
`.editorconfig`（LF + final newline）、`package.json` 里 80 余个 `verify-*` 脚本与 `check:all` 聚合。

它的核心不是 CI 本身，而是**每条约定都有一个能跑的脚本**：`verify-md-links`、`verify-doc-budgets`、
`verify-third-party-notices`、`verify-package-invariants`……CI 只负责把它们拉起来。

| DSH 的做法 | 我们的落点 | 判据 |
|---|---|---|
| 每条约定一个 `check-*.mjs` | `tools/check-size.mjs`（结构）、`check-dup.mjs`（重复机制）、`check-refactor.mjs`（重构到期）、`check-docs.mjs`（文档）、`check-release.mjs`（发布） | `npm run check:all` 一条命令全跑 |
| `check:all` 聚合 | `npm run check` / `check:all` | 上面五闸 + `build --check` |
| CI 跑闸 | `.github/workflows/checks.yml`（ubuntu + windows 矩阵） | push/PR 触发，跑 check + build --check + docs + 五支套件 |
| issue / PR 模板 | `.github/ISSUE_TEMPLATE/{bug,feature}.md`、`pull_request_template.md` | 各自带"复现/预期/验收"或"变更/验证"段 |
| `.editorconfig` 管编辑器落盘 | `.editorconfig`（LF + final newline，并与 `.gitattributes` 分工） | 与 DSH 同一条判据 |
| 文档预算 | `check-docs.mjs`：README ≤400 行、docs ≤600 行、死链为红 | 现在 8 个文件全过 |

**没借的**（并说明为什么）：
- `pnpm` workspace + changesets：我们是单包、零运行时依赖，用不上多包编排；
- 80 余个 `verify-*`：绝大部分针对 monorepo（包不变式、翻译配对、文档图），我们没有那些结构；
- `dependabot`：本仓没有依赖可更。

## 四、下一步（按价值）

1. 片段占位符导航（第二节第 1 条）—— 唯一还算"输入边框内功能"的缺口；
2. 按类型开关进 `/` 菜单 —— 复用现成的设置项机制；
3. 把 `check-docs.mjs` 的行数预算按文件分开调（现在 docs 一律 600）。
