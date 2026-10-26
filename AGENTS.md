# AGENTS.md

给在本仓工作的 agent 的最短约定。规矩的可执行版本在 `CONTRIBUTING.md` 的表里，这里只写"别踩什么"。

## 动手前

- 读 `package.json` 的 scripts：`check:all` 是总闸，`npm test` 是行为套件。
- 宿主目录是本仓的 **junction**（`npm run link:host` 可重建）：改完不需要"同步到宿主"，
  但 `lib/index.js`（服务端半边）改动要重启 `dsh web` 才装载，客户端半边刷新页面即可。

## 不许

- 不许把日期、第一人称、对话原话、踩坑故事写进代码注释（`npm run check:prose` 会红）。
- 不许把本机绝对路径、用户目录、私人规则文件写进任何被提交的文件（`npm run check:privacy` 会红）。
- 不许 `git add -A` / `git commit -a`；按路径提交。
- 不许为了让闸变绿而调高阈值：散文闸、隐私闸、体积闸的上限只许往下调。
- 不许手工改 `lib/client.js`：它是 `lib/client/*.js` 的拼接产物，改片段后跑 `npm run build`。

## 收尾

一次改动收尾时跑：`npm run check:all && npm test`。发版见 `CONTRIBUTING.md` 的两段式。
