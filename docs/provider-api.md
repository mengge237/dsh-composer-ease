# 给别的插件用的补全接口（Provider API v1）

本插件不自建生态壁垒：别家插件可以**往这里喂候选**，不需要改我们源码，也不需要占 `/`、`@`。

## 一、怎么拿到注册口

两条路，优先第一条：

1. cordis 服务：`ctx.inject(['composerEase'], (s) => { s.composerEase.register(spec) })`（本插件通过 `ctx.provide('composerEase', api)` 暴露）。
2. 兜底全局：`window.__DSH_COMPOSER_EASE__`（`{ version: 1, register, list }`）。

`register(spec)` **返回 disposer**；插件卸载时调用它即可摘除。`list()` 用来调试当前注册了哪些源。

## 二、spec 形状

```js
const dispose = api.register({
  id: 'my-plugin-symbols',        // 必填，唯一。列表里按它算来源名（src = provider:my-plugin-symbols）
  priority: 30,                   // 可选，默认 100；**小的先出**
  triggerChars: ['.', ':'],       // 可选；给了就只在这些字符触发时被问（不给＝每次补全都问）
  provide(ctx) {                  // 必填；可返回数组或 Promise<数组>
    // ctx = { prefix, ed, session }
    return [{ label: 'res.status', insertText: 'res.status', detail: 'HTTP', sortText: 'a1' }]
  }
})
```

候选字段：

| 字段 | 必填 | 用途 |
|---|---|---|
| `label` / `insertText`（或旧名 `value`） | 至少一个 | 显示与插入 |
| `detail` | 否 | 右侧说明；不填默认 provider id |
| `sortText` | 否 | 同一 provider 内排序键（VS Code 语义，默认取 value） |
| `filterText` | 否 | 过滤用文本（默认 null，即用 value） |
| `commitChars` | 否 | 接受后允许顺带提交的字符 |
| `kind` | 否 | 默认 `word` |

## 三、纪律（按实测定的）

- **不要抢入口**：`/` 是命令与技能的、`@` 是引用的。要触发就用 `triggerChars`（`. ` `(` `:` 这类）或干脆被动参与。
- **单源失败不影响别人**：某家 `provide` 抛错或超时，只丢它自己那份（实测：注册一个必抛的 provider，其余候选照常）。
- **别做重活**：`provide` 每次键击都可能被调用，网络请求请自带缓存与超时。
- **dispose 必须真摘**：调用 disposer 后，同一前缀不该再出现该源的候选（实测：`list()` 立刻少一条、弹层不再显示）。

## 四、实测记录（2026-11-02，demo 3081）

```
注册前 list(): ["builtin-context","builtin-local","builtin-server"]
注册 third-party-demo（priority 1）后：list() 含 third-party-demo；打 zzq → 弹层 display=block，行 "· zzqThirdParty"
调用 disposer 后：list() = ["builtin-context","builtin-local","builtin-server"]
再打 zzq → display=none（无候选，弹层收起）
```

## 五、内建源就是同一套契约

`builtin-context`（priority 5，本文/工作区取词）、`builtin-local`（12，本地词表）、`builtin-server`（80，服务端候选的缓存视图）——外部看到的与第三方注册的完全同构；服务端那一路不自己发请求，只把管线最近一次结果给外部调用方看。
