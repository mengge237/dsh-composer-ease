// dsh-composer-ease —— 浏览器半边：键位层 + 补全弹层。
// 形态：宿主模块图里的一个 bundle（照 dsh-skill-meter / dsh-model-priority 的头尾抄结构），
// 不 require 任何第三方包（动态包里也只拿得到宿主 react，本件用不到）。
// 行为参照 VSCode（MIT）：自动配对、环绕选区、输入闭合符跳过、删除空对、Ctrl+Space 补全。
// **未复制 VSCode 源码**，只对齐交互；出处见 README 的「来源」节。
// 补全两类（加第 2 类）：
// 1) 本文词（VSCode 的 word based suggestions 口径）：草稿里出现过的标识符，本地即时算，不等网络；
// 2) 语言词表：HTML 标签 / JS·Python·Java 关键字 / CSS 属性名，服务端 lib/words.js 供，
// 数据借自 monaco-editor、codemirror、MDN BCD（均为宽松许可，源地址与 commit 见 words.js 头部与 THIRD-PARTY.md）。
// 触发：'/' 与 '@'，以及**打满两个标识符字符就自动弹**（VSCode 手感）；Tab/Enter 接受、Esc 关、上下选。
window.__ModuleLoader__.load({
  id: 'dsh-composer-ease',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

