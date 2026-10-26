# 候选排序 × CHANGELOG 体例 · 参考与改点

写给要手改的维护者。两半：**一、二、三、四是候选排序**（要解决的问题是：候选太多没有截断、文件候选挤掉词候选、
宿主底层文件不该优先、显示名要用短形式），**五是 CHANGELOG 体例**。
每条都指到本仓的具体函数与行号，并给可对照的上游实现。

---

## 一、候选太多、没有相似度截断

**现状（读数）**：打 `de` 弹出 12 条，前四条是
`DeepSeek` / `example-proj/README.md` / `example-proj/documentation.md` / `example-proj/IMPLEMENTATION_SUMMARY…`，
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
于是 `example-proj/README.md` 在 `de` 里仅次于 `DeepSeek`。

**三种改法（可叠加，按见效速度排）**：

1. **剔根**（最彻底）：`workspaceRoots()` 只保留「当前会话 cwd」+ 配置里显式列出的根，harness 安装目录不进候选池。
2. **压分**（最小改动）：`contextScore` 里对这些片段给 0 或负分：`example-proj`、`deepseek-harness`、`node_modules`、`plugins/`、`.dsh/`。
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

---

## 六、英文侧怎么扩（`lib/en-lexicon.js`，2026-10-22 新增）

**问题**：`cjk-lexicon.js` 有「完整词义」闸（`isCompleteWord`：≥2 字且词典收录），英文侧没有对应物——
只有 `words.js` 的关键字表（约 1031 条），没有英文词，也没有「这个词是不是词」的判据。

**先分清一件事：英文不该照搬中文的「碎片清零」。**
中文单字/碎片不给候选是对的（中文靠输入法选词）；英文前缀**正是**补全的用法（`docum` → `document`），
清零等于把补全本身关掉。所以英文只做两件：① 补出以它为前缀的词；② 它本身已是完整词时给更高上下文分。

**接口（照 CJK 1:1 复制，便于以后互换数据源）**：

| 文件 | 导出 | 说明 |
|---|---|---|
| `lib/cjk-lexicon.js` | `CJK_LEXICON` / `lexiconMatches(p,cap)` / `isCompleteWord(p)` | 2-4 字，jieba 前 30000（MIT） |
| `lib/en-lexicon.js` | `EN_LEXICON` / `enMatches(p,cap)` / `isCompleteEnWord(p)` / `isWordPrefix(p)` | 关键字表 + 手写开发语境词，README 见 `EN_LEXICON_SOURCE` |

接入点：`lib/index.js` 的 `wordCandidates()` **末尾**（池子之后）。
放末尾是为了让 `words.js` 先登记出处——`delete` 这类词两处都有时，`src` 记 `words.js` 而不是词典（`selftest` 有一条就查这个）。

**三档扩法（按体积/精度选一档就够）**：

1. **T1 现状（已做）**：关键字表 + 手写常用词，**1237 词**，零新增依赖零新增许可证。
   读数：`docum` → `document`（第 1 条）、`dele` → `delete`、`inp` → `input`（出处仍是 `words.js`）。
2. **T2 接真词表**：`SCOWL`（公有领域）/ `wordfreq` / `an-array-of-english-words`。
   照 CJK 的生成脚本做法：只留 **3-12 字符纯小写**、按词频取前 2-3 万，生成 `lib/en-lexicon.js`，
   并把 `repo / license / file / kept` 写进 `EN_LEXICON_SOURCE` 与 `THIRD-PARTY.md`。
   体积按 30k 词 × 平均 7 字节 ≈ 250 KB（CJK 现在 384 KB，同一量级，可接受）。
3. **T3 领域词**：从本机代码与会话正文统计词频（TF），好处是 `dsh`、`lexical`、`keymap` 这类词自带；
   代价是要定时重建、且会随本机内容变化（同一份代码在不同机器上给出不同候选）。

**闸（gate）建议**（别一股脑进池）：

- 只在 prefix 匹配 `^[A-Za-z][A-Za-z-]{1,23}$` 时查（含 `/`、`_`、`.` 的 token 是路径/标识符，交给文件候选）；
- `enMatches` 长度 2 字符起（与客户端 `tok.length < 2` 一致）；
- 同一个词两处都有 → 保留先登记者，`seen` 已经做了这件事。

**验证判据**：`node test/server-routes.mjs` 的「英文前缀要出英文词候选」那条 —— `docum` 的第 1 条必须是
`document`（detail `英文词`），且它排在 `documentation.md` 这类文件前面；`zzzqx` 不许硬造词。

### T2 / T3 已落地（2026-10-22，0.9.27）

生成器 `tools/gen-lexicon.mjs` 一次产出两份数据（**都幂等，不要手改生成物**）：

```bash
node tools/gen-lexicon.mjs \
  --words <an-array-of-english-words 的 index.json> \
  --corpus lib --corpus docs --corpus ~/.dsh/本地配置 \
  --cap 30000 --domain-cap 1000
```

| 文件 | 内容 | 手改？ |
|---|---|---|
| `lib/en-common.js` | **手写**常用词 518 条（常用度先验） | ✅ 可以改，这是唯一该手改的词表 |
| `lib/en-lexicon.js` | 生成物：30,581 词（30k 词表 ∩ 语料排序）+ `EN_RANK` + `EN_COMMON` | ❌ 生成 |
| `lib/domain-words.js` | 生成物：66 个本机领域词（`dsh` / `gh-archive` / `deepseek-harness`） | ❌ 生成 |

**T2 的做法**：`an-array-of-english-words@2.0.0`（MIT，274,937 词）→ 只留 3-12 字符纯字母 → **用本机语料频次排序**取前 30k。
词表本身没有词频，单纯按长度排会让 `deled` 压过 `delete`；所以顺序那一半来自 T3 的语料统计。

**T3 的做法**：同一趟生成，从**文档语料**（`.md`/`.txt`）统计高频词，只收「词库里没有 + 不是任何词的前缀 + 不含下划线」的：
- 不含下划线 → 排除 `a_workspace` / `s_software` 这类路径；
- 不是任何词的前缀 → 排除 `docum` 这种碎片（它整串精确匹配会拿高分，反过来把 `document` 压下去，实测踩过）；
- 只取文档、不取源码 → 否则 `wordpos` / `charcode` / `selectionstart` 这些内部变量名会进候选池。

**排序（`lib/index.js`，0.9.27 起）**：

1. `enMatches` 三级排序：**手写常用词 > 语料名次 > 短者 > 字母序**；
2. 所有以 prefix 开头的词候选按三档给 `ctx`：**整词（且真是词）=460 / 常用词=440 / 其他=400**。
   整词加分只给 `isCompleteEnWord()` 为真的串 —— 否则 `docum` 这种非词串也会吃满分；
3. `rankCandidates` 末尾**词优先分区**：prefix 匹配 `^[A-Za-z][A-Za-z0-9-]{2,}$` 时，词整段排在文件前面
   （带连字符的 `gh-` / `dsh-` 也算），文件内部相对顺序不变。

**读数（服务端直跑 `internals.buildCandidates`）**：

```
dsh   -> dsh/本机词 | dsh-kit/本机词 | dsh-shim/本机词      ← 不再是 deepseek-harness 的文件
gh-   -> gh-archive/本机词 | gh-archive/README.md | …
docum -> document/英文词 | documents/英文词 | …
inp   -> input/html 标签 | inpour/英文词 | …
del   -> del/html 标签 | delete/JS 关键字 | …
文档  -> 文档管理/词典
```

### 0.9.29 的实际取舍（2026-10-22 亲手做了一遍，读数在此）

| 提议 | 结果 | 原因 |
|---|---|---|
| 相对分数截断 `score >= max*0.5` | **撤掉** | 与 `fuzzyScore` 语义冲突：VS Code 把负分的分散匹配（`abc` vs `axbxc`）也列在下面；50% 还会误删 `libsdk/auth.ts` 这类合法路径（单测直接照出来） |
| 上限 12 → 8 | **采用** | 配合下面的配额才安全 |
| 词优先"整段分区" | **改成配额**：词 ≤6、非词 ≥2 | 整段分区 + 上限 8 会把文件候选全饿死：`hel` 上只剩 `help/held/hele/…`，想选文件一条看不到 |
| `contextScore` 给 harness 目录压分 | **采用**，`-2000` | 实测 `de` 的前四条不再被 `example-proj/*.md` 占掉 |
| 展示层折叠 `dsh: <basename>` | **采用** | 只改显示，插入正文仍是完整路径 |

压噪声的最终三件套：**上限 8 + 类型配额（词≤6/非词≥2）+ harness 目录 -2000**。别再往"阈值"上想办法。

### 两条机制闸（0.9.29 起，机器判定）

```bash
npm run check      # 结构闸 + 重复机制闸 + 重构到期闸 + 发布闸，四个一起跑
npm test           # 前两闸 + 五支套件
```

- `tools/check-dup.mjs` —— **同一机制只留一套**：同名顶层函数（按浏览器/服务端半边分域，两侧各有一个宿主入口 `apply`，不算重复）、跨文件 12 行完全相同的代码块。
- `tools/check-refactor.mjs` —— **重构会到期**：距上次 `refactor:` 提交 > 40 条，或最近 40 条里 fix 占比 > 55%，直接红并给动作；阈值走环境变量 `MAX_SINCE_REFACTOR` / `MAX_FIX_RATIO`。
