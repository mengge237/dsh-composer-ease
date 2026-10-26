# 贡献与工程契约

本仓的规范一律"配一条可运行的检查"，不靠自觉。改代码前先读这张表：每行左边是规矩，右边是执行它的命令。

| 契约 | 执行它 |
|---|---|
| 片段 ≤400 行、手写文件 ≤600 行、`lib/client.js` 必须等于片段拼接结果 | `npm run check:size` / `npm run build -- --check` |
| 同名定义不许跨半边重复、12 行以上重复块不许跨文件 | `npm run check:dup` |
| 距上次重构太久或修比例过高就要重构 | `npm run check:refactor` |
| 文档相对链接必须存在、README ≤400 行、docs ≤600 行 | `npm run check:docs` |
| CHANGELOG 每条带日期 + 提交 sha，版本号与首条一致 | `npm run check`（含 `check:release`） |
| 公开仓不许出现对话原话、本机绝对路径、私人规则文件 | `npm run check:privacy` |
| 注释只写"为什么"，不写日期/第一人称/踩坑故事；文件头 ≤25 行、正文注释块 ≤8 行、单行 ≤120 字符 | `npm run check:prose` |
| 宿主目录与本仓是同一份（junction），不一致要报 | `npm run check:copies` |
| 行为与不变量的用例 | `npm test` |
| 以上全部 | `npm run check:all` |

## 提交与发布

- 提交信息用 Conventional Commits：`feat(作用域): 摘要`、`fix(...)`、`docs(...)`、`refactor(...)`、`chore(...)`、`test(...)`。
- 一次提交一件事；按路径提交（`git add -- <paths>`），**不要** `git add -A`。
- 发版两段式：先提交代码，拿到 sha 后把 CHANGELOG 条目里的占位换成该 sha，再提交一次。
- 版本号只在 `package.json` 与 `CHANGELOG.md` 首条出现，两处必须一致。

## 注释口径（`check:prose` 的阈值不是拍的）

实测 deepseek-harness 401 个源文件、3210 个注释块：块长中位数 2 行、p75=5、p90=8、p95=11；注释行均长 51 字符。
所以本仓取 **正文注释块 ≤8 行、文件头 ≤25 行、单行 ≤120 字符**。日期、第一人称、踩坑故事属于 CHANGELOG，
不进代码注释。`lib/fuzzy.js` 是 vendored 上游代码：**注释、许可证头、缩进一律照原样保留**，任何批量改写（含脱敏脚本）都要先排除它。

## 多人协作尚未启用

本仓目前单人维护：不做 CODEOWNERS、不做 review 流程要求、不做多语言 README 对照表。
出现第二个维护者时再补这几项，并把 `check:privacy` 升级为"提交前钩子"。
