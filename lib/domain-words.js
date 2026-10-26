// dsh-composer-ease —— 本机领域词（T3：代码与文档里高频、但英文词表里没有的词）
// 本文件由 tools/gen-lexicon.mjs 生成，**不要手改**（改了就下次生成即被覆盖）。
// 重新生成：node tools/gen-lexicon.mjs --words <词表> --corpus lib docs --cap 30000 --domain-cap 1000
// 出处与许可证见 EN_LEXICON_SOURCE / DOMAIN_WORDS_SOURCE 与本仓 THIRD-PARTY.md

export const DOMAIN_WORDS = ["dsh", "json", "gh-archive", "mjs", "jsonl", "deepseek-harness", "github", "dsh-fixes", "ps1", "http", "changelog", "bailian-free-auto", "sha256", "dsh-composer-ease", "plugins", "zstd", "npm", "mtime", "session-compaction-handoff", "cmd", "local-kb", "silent-first", "mengge237", "beforeinput", "oninput", "deepseek", "contextscore", "cwd", "microsoft", "vscode", "cjk", "bailian", "tokenplan", "ls-remote", "cs-drill", "goproxy", "cordis", "txt", "powershell", "ttlmin", "levelmax", "client-behavior", "real-regress", "server-routes", "workspaceroots", "unreleased", "en-lexicon", "yaml", "qwen3-max", "glm-5", "dsh-local-runbook", "dsh-kit", "dsh-shim", "dsh-020rc2", "golangci-lint", "start-process", "deepseek-ai", "yml", "job-hunter", "csv", "dns", "dns-bridge", "lenovo", "cjs", "dsh-accel-keep", "wscript"]

export const DOMAIN_WORDS_SOURCE = {
  what: '从本机语料统计的高频词（TF），只收词表里没有的',
  roots: ["lib","docs","<本地路径>"],
  kept: DOMAIN_WORDS.length,
  note: '生成式数据：换机器或换语料后会变，因此不写死出处，只记本机根目录与条数。',
}
