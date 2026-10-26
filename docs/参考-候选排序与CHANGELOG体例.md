# 候选排序 × CHANGELOG 体例 · 参考与改点

写给要手改的我方（2026-10-22）。两半：**一、二、三、四是候选排序**（对应「提示太多 / 没相似度截断 / 优先出 deepseek-harness 底层文件 / 想按 dsh 全名显示」），**五是 CHANGELOG**。
每条都指到本仓的具体函数与行号，并给可对照的上游实现（路径已核）。

---

## 一、候选太多、没有相似度截断

**现状（读数）**：打 `de` 弹出 12 条，前四条是
`DeepSeek` / `deepseek_harness_example/README.md` / `deepseek_harness_example/documentation.md` / `deepseek_harness_example/IMPLEMENTATION_SUMMARY…`，
第 5 条起才是 `del` / `delete` / `default` / `details` / `debugger`。也就是说**文件候选挤掉了词候选**，而且没有任何分数截断。

**改点（`lib/index.js`）**：

| 位置 | 现在做什么 | 建议 |
|---|---|---|
| `rankCandidates(cands, prefix, cap)` ≈ L157 | 只做 `slice(0, cap)`，cap=12 | 加「相对分数截断」：先算分，保留 `score >= max*0.5`，再取前 8 |
| `buildCandidates(prefix, lang)` ≈ L246 | 把词表/文件/模型/片段全塞进一个池 | 末尾加阈值 + 去重；`cap` 12 → 8 |
| `contextScore(...)` ≈ L60 | 顶层 README/CHANGELOG/AGENTS 给 1000 分 | 见第三节：harness 目录设 0 |
| `collectFiles(root, maxDepth, cap, bonus)` ≈ L97 | 遍历全根，cap 400 | 只留当前会话 cwd 与显式配置的根 |

**上游参考（已核文件存在）**：

- `microsoft/vscode` → `src/vs/base/common/filters.ts`：`fuzzyScore()` / `fuzzyScoreGraceful()`。
  分数是整数、且对「连续命中、词边界、大小写」给不同权重；**排序靠它，不靠布尔包含**。
- `microsoft/vscode` → `src/vs/editor/contrib/suggest/browser/suggestController.ts`：候选打开 / 过滤 / 接受的主流程。
- `microsoft/vscode` → `src/vs/editor/common/config/editorOptions.ts`：`editor.suggest.*` 一族。三条正好对应你提的问题：
  - **`localityBonus`**：离光标近的候选优先（同目录/同文件先上）。
  - **`filterGraceful`**：宽松匹配，先用严格、不够再放宽 —— 这就替代了「一股脑 fuzzy」。
  - **`suggest.showWords` / `showFiles` / `showMethods`**：**按类型整体关掉**某一类候选（想让文件别抢，就直接把 `showFiles` 关掉或降到只在该 cwd 内）。
- `microsoft/vscode` → `src/vs/editor/common/languages/languageConfiguration.ts`：`autoClosingPairs` 的 `notIn`（与本文件无关，列在这因为同一套「按上下文收窄」的思路）。

**建议先试的数值**（不要一次全上）：上限 **8 条**；截断线 `score >= max*0.5`；同值去重；类型优先级只在**同分**时生效（file > word > model > snippet）。

---

## 二、不要优先显示 deepseek-harness 的底层文件

**根因**：`workspaceRoots()` 把 harness 安装目录也当成候选根，而 `contextScore` 给顶层 `README*` 1000 分，
于是 `deepseek_harness_example/README.md` 在 `de` 里仅次于 `DeepSeek`。

**三种改法（可叠加，按见效速度排）**：

1. **剔根**（最彻底）：`workspaceRoots()` 只保留「当前会话 cwd」+ 配置里显式列出的根，harness 安装目录不进候选池。
2. **压分**（最小改动）：`contextScore` 里对这些片段给 0 或负分：`deepseek_harness_example`、`deepseek-harness`、`node_modules`、`plugins/`、`.dsh/`。
3. **展示层折叠**（你要的「挑明 DSH 全名」）：路径命中 `deepseek-harness|deepseek_harness|dsh-` 时，把标签渲染成
   `dsh: README.md`（前缀固定写 `dsh:`，不展开长路径）；右侧类型词照旧写「文件」。

**判据**：打 `de` 时前 8 条里 harness 内部文件 **≤ 1 条**，且那一条必须带 `dsh:` 前缀。

---

## 三、`de` 两字母就弹：这条**不改**

`tok.length < 2` 才收层（= 满 2 个字符自动弹），是你 2026-10-22 选的①。质量问题的解法在上面两节，不在提高阈值。

---

## 四、实施顺序（每步都能单独回滚）

1. `buildCandidates` 末尾加「阈值 + 8 条上限」→ 立刻见效，改动最小。
2. `contextScore` 里把 harness 相关目录压到 0。
3. `workspaceRoots()` 剔掉 harness 安装根。
4. 需要「同目录优先」时再加 `localityBonus`（同 `rel` 前缀 +0.2 倍分即可，别引入新的评分体系）。

每步跑：`node test/server-routes.mjs`（现有 7 条，含词典那条）+ 真机 3081 打 `de` 看前 8 条。

---

## 五、CHANGELOG 体例

**现状读数**：27.7 KB / 44 条版本条目 / **最长单行 1184 字符**；每条是一个巨型段落（①②③全塞进一行）；无分类小标题；无 `Unreleased` 段；括号与 sha 格式不统一（半角 `(2026-10-23)` 且缺 sha 曾让 `tools/check-release.mjs` 连续 RED 两次，2026-10-22 已按 `（2026-10-23，`f37be36`）` 补齐）。

**大厂口径**（三条，互相兼容）：

- **Keep a Changelog 1.1.0**：每个版本一节，节内固定分类 `Added / Changed / Deprecated / Removed / Fixed / Security`；条目是**一句话**、用户可见的变化才写；日期 ISO；顶部永远保留 `Unreleased`。
- **Conventional Commits**：提交信息 `type(scope): subject`，`type` 与上面分类一一对应，便于机器汇总。
- **semantic-release / changesets**：从提交或变更集中**生成** CHANGELOG，人手不写；版本号由变更类型推出（feat → minor、fix → patch）。

**建议采用（增量迁移，不重写历史）**：

```markdown
## [Unreleased]
### Added
- 常用文件名候选池（README.md / package.json / 本地配置 先入池）

## [0.9.25] - 2026-10-22 · `abc1234`
### Fixed
- 方向键改选中不重画（签名不含 index，非 force 时早退）
- 点击候选只认第一条（改用被点那一行的下标）
```

- **只有新条目按新体例写**；旧 44 条只做两件机械修正：半角括号 → 全角、补短 sha。不重排内容（重排没有信息增益，还会让 `git log -S` 对不上）。
- `tools/check-release.mjs` 现在只认「`（日期，`sha`）`」这一种形状，改体例时**要么继续满足它，要么同步改它**，别只改一边。
- 「为什么这么改」这类决策不进 CHANGELOG（那是给用户看的变化清单），写 `docs/DECISIONS.md`（ADR 一句话一条：背景 / 决定 / 影响）。
