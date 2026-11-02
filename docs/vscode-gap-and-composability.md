# 对照 VS Code 的差距与可组合性设计（2026-11-02）

前提：本文只写**能在本机读数里点名**的东西。VS Code 侧读数取自本机
`…/Microsoft VS Code/2c33b50b16/resources/app/out/vs/workbench/workbench.desktop.main.js`（下列关键字命中数即为证据）。

## 一、VS Code 真实存在、而我们没有的机制

| VS Code 机制 | 本机命中 | 我们现状 | 差距性质 |
|---|---|---|---|
| `wordBasedSuggestions`（当前文档 / 匹配文档 / 全文档） | 3 | **无**：候选主源是 jieba 通用词表 + 少量文件/模型名 | **架构错位**：VS Code 的「词」来自**你正在写的语料**，我们的「词」来自日常汉语 |
| `editor.suggest.showWords` | 1 | 无对应开关 | 用户没法关掉词典干扰 |
| `snippetSuggestions` / `editor.suggest.showSnippets` | 2 / 1 | 有片段，但没有「优先级：片段先于词」这条语义 | 顺序不对 |
| `triggerCharacters` | 19 | 只有 `/` 与 `@` 两个宿主触发位 | 缺「按字符触发」（如 `.` `(` `:`） |
| `commitCharacters` | 4 | 无 | 接受候选时不能用 `.` `(` 之类顺带提交并继续 |
| `suggest.selectionMode` | 4 | 无（我们固定插入/替换 token） | 选区场景下「插入 vs 替换」不可选 |
| `inlineSuggest`（灰字补全） | 20 | 有灰字预览，但只在弹层打开时显示 | 没有「免弹层的行内建议」 |
| provider 并发 / `sortText` / `filterText` | — | 单源串行拉取，无排序键 | 多源会互相盖住 |

## 二、为什么"词典核对"这条路是错的（按开发者语言行为判）

- VS Code 的默认词建议是 **`wordBasedSuggestions`**：从当前文档、匹配文档或全工作区取词——也就是说它的"词典"是**你此刻的代码库**，天然贴合开发者语料。
- 我们用的是 jieba 通用汉语词表（约 3 万词）+ 手写领域词：命中"文档""临时目录"这类日常词很准，但在 `useEffect`、`res.status`、`ctx.inject` 这类**真正需要补全**的位置基本无效；反过来它会在中文闲聊里塞进一堆无关键字。
- 结论：**词典只配当兜底**（用户明确要求/什么都没有时）。主源应改成"从会话草稿 + 工作区 + 当前文件上下文取词"，与 VS Code 的 `wordBasedSuggestions` 同构。

## 三、可组合性：把自己变成 provider，而不是独占入口

现状问题：本插件自绘弹层 + 自建候选管线，别的插件无法喂候选，也无法复用我们的补全；我们也不能消费别人的。

设计（三层，从下到上）：

1. **provider 契约**（新增，纯函数式）：
   ```
   registerProvider({ id, priority, triggerChars?, provide(ctx) -> Promise<Item[]> })
   Item = { label, insertText, detail?, sortText?, filterText?, kind, commitChars? }
   ```
   渲染层按 `sortText` 稳定排序、`filterText` 过滤、`commitChars` 附带提交，全部沿用 VS Code 语义。
2. **暴露面**：优先 cordis 服务（`inject: ['composerEase']`），取不到时退 `window.__DSH_COMPOSER_EASE__`，并把注册句柄返回给调用方做 dispose。
3. **我们自己也降级为一个 provider**（priority 最低）：词典/文件/模型都走同一契约，别再无接口地塞进渲染层。宿主 `/`、`@` 触发位保持现状（只留严格配对一行），不与官方源抢。

## 三之二、当前落地边界（2026-11-02）

- **已 provider 化**：`builtin-context`（上下文词，priority 5）、`builtin-local`（草稿本地词，priority 12）；管线通过 `builtinSources(prefix, ed)` 复用同一段实现，所以外部调用方看到的内建源与管线用的是同一份代码。
- **已 provider 化（缓存视图）**：服务端那一路（词典 / 文件 / 模型）注册为 `builtin-server`（priority 80），但只把管线最近一次结果按前缀给出来，**不自行发请求**——管线的 `seq/inflight`、`popupEpoch` 两道防错位闸保持原样。刻意不把取数挪进 promise 链：那样做实测会把 `Ctrl+Space` 的弹层弄丢。
- ~~尚未 provider 化：服务端那一路~~（已按上面的缓存视图收口）。它带着 `wordGate`（"这是不是完整词义"的闸）与 `lang` 两个管线专属参数，且必须在首屏之后异步回来；改成 provider 需要把这两个参数经 ctx 传下去并回填 gate，本轮试过一半、因改动落在热路径且 diff 过大而回滚（保留在 `a607a38` 之后的状态）。
- 结论：**外部 provider 已经可插**（`window.__DSH_COMPOSER_EASE__.register`），内建源 2/3 已统一到同一契约；剩下那一路是显式记账的边界，不是遗忘。

## 四、分阶段与验收

- **P0（先做，风险最低）**：加 `wordBasedSuggestions` 同构的「会话草稿 + 当前文件上下文」取词，并把词典降为兜底；开关沿用 `showWords` 语义。
- **P1**：provider 契约 + 暴露注册口；本插件三个内建源改走契约；加 `sortText/filterText/commitChars`。
- **P2**：`triggerChars`（`.` `(` `:`）与「免弹层行内建议」；再评估把渲染层迁 `conversation.input.overlay`。

验收判据（沿用本仓既有纪律）：真机矩阵新增用例（多源同时命中时的排序、commitChars 提交后继续打字、provider 异常不影响其它源），且**同页连跑 40+ 用例**；离线套件补 provider 契约的形状断言。
