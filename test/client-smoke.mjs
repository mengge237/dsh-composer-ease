// 浏览器半边的冒烟自检：假 window/document 跑一遍 bundle，验 loader 头、导出形状与纯逻辑判据。
// 跑法：node test/client-smoke.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
let captured = null
const sandbox = {
  window: { __ModuleLoader__: { load(spec) { captured = spec } }, getSelection: () => null, innerHeight: 800 },
  document: { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, execCommand: () => true },
  console, Symbol, Object, Array, Promise, Error, JSON, String, Number, Math, RegExp, Event: class {},
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'lib/client.js' })

let n = 0
function ok(label, fn) { fn(); n++; console.log('  ok   ' + label) }

ok('bundle 顶部注册了宿主 loader，id 与包名一致', () => {
  assert.ok(captured && captured.id === 'dsh-composer-ease')
  assert.equal(typeof captured.factory, 'function')
})

const mod = captured.factory(() => { throw new Error('本包不该 require 任何东西') })
ok('导出 apply/inject；不碰宿主 react', () => {
  assert.equal(typeof mod.apply, 'function')
 // 宿主输入触发服务必须声明（官方 dsh-client-ui-reference / -skill 同样做法），
 // 否则 apply 里 scope.inputTriggers 取不到，@ 那组注册不上。
  assert.deepEqual([...mod.inject], ['inputTriggers'])
})

const H = mod.__helpers__
ok('「/」那组排到最上面：order 0，先于内置「指令」1 与「技能」2', () => {
 // 严格配对放在技能下面找不到。宿主按 order 升序排，
 // 内置两组分别是 1 与 2，所以插件必须 < 1 才会出现在最上面。
  const srcs = H.buildTriggerSources()
  const slash = srcs.find(s => s.trigger === '/')
  const at = srcs.find(s => s.trigger === '@')
  assert.ok(slash && at, '两个触发源都要注册')
  assert.equal(slash.order, 0, '/ 组 order 必须是 0（< 内置的 1）')
  assert.ok(at.order > 0, '@ 组不该跟 / 抢第一位')
  assert.equal(typeof slash.candidates, 'function')
})
ok('严格配对开关：默认关，能写入也能读回', () => {
 // localStorage 在测试环境可能不存在；这里只断言「不抛错 + 默认 false」的契约
  const H2 = mod.__helpers__
  assert.equal(typeof H2.pairStrict, 'function')
  assert.equal(typeof H2.setPairStrict, 'function')
  assert.equal(H2.pairStrict(), false, '默认必须是关')
  H2.setPairStrict(true)
  assert.equal(typeof H2.pairStrict(), 'boolean')
})

ok('配对判据：光标前是路径/标识符字符就不自动配对（保护输入路径与函数调用场景）', () => {
  assert.equal(H.shouldPair('open E:/S_Software'), false, '结尾是标识符：像路径/词中，别配对')
  assert.equal(H.shouldPair('写一个'), true, '结尾是 CJK 字：该配对')
 // 改口径：成对家族前面的符号一律不补对（原来这里断言 false→改成 true 的那条已作废）
  assert.equal(H.shouldPair('call('), false, '光标已在 ( 后：只插一个，不再补成 (()')
  assert.equal(H.shouldPair('list['), false, '方括号同理：不补')
  assert.equal(H.shouldPair('“'), false, '中文前引号后：不补')
  assert.equal(H.shouldPair('path/'), false, '结尾 / 视作路径中：不配')
})
ok('配对判据看右边：右边紧跟文字时只插一个开符（使用中 2026-10-16 踩到「在文字前打前引号被补成一对」）', () => {
  assert.equal(H.shouldPair('', 'abc'), false, '右边是字母：只插前引号')
  assert.equal(H.shouldPair('', '文'), false, '右边是汉字：只插前引号')
  assert.equal(H.shouldPair('写一段', '文字'), false, '中文正文 + 右边有字：只插前引号')
  assert.equal(H.shouldPair('', ' '), true, '右边是空白：该补闭符')
  assert.equal(H.shouldPair('', ''), true, '行尾：该补闭符')
  assert.equal(H.shouldPair('', '）'), true, '右边是闭符：该补（VS Code 同款）')
})
ok('全角/中文成对符也在表里（中文输入法下的盲区，2026-10-16 补）', () => {
  for (const [o, c] of [['（', '）'], ['【', '】'], ['「', '」'], ['《', '》'], ['“', '”'], ['‘', '’']]) {
    assert.equal(H.PAIRS[o], c, o + ' 要配 ' + c)
    assert.equal(H.CLOSERS[c], o, c + ' 要能回指 ' + o)
    assert.equal(H.keyAction({ key: o }), 'pairopen', '全角开符也要走配对动作')
  }
})
ok('tokenBefore：取 caret 前 token', () => {
  assert.equal(H.tokenBefore('路径 src/comp'), 'src/comp')
  assert.equal(H.tokenBefore('@qwen3'), '@qwen3')
  assert.equal(H.tokenBefore('结束 '), '')
})
ok('keyAction：Ctrl+Space=complete / 弹层开时只有 Tab=accept / 回车一律放行 / Esc=dismiss', () => {
  assert.equal(H.keyAction({ key: ' ', code: 'Space', ctrl: true }), 'complete')
  assert.equal(H.keyAction({ key: 'Tab', __popupOpen: true }), 'accept')
  assert.equal(H.keyAction({ key: 'Enter', shift: true, __popupOpen: true }), null, 'Shift+Enter 要放行给宿主换行')
  assert.equal(H.keyAction({ key: 'Enter', __popupOpen: true }), null, '回车必须发送：弹层开着也不吃它（2026-10-16 真机回归）')
  assert.equal(H.keyAction({ key: 'Escape' }), 'dismiss')
  assert.equal(H.keyAction({ key: '(' }), 'pairopen')
  assert.equal(H.keyAction({ key: ')' }), 'pairclose')
})
ok('docWords：草稿里出现过的标识符按前缀补（VSCode word based suggestions 口径）', () => {
  const text = '把 inputValue 传给 inputHandler，inputValue 再读一次'
  const r = H.docWords(text, 'inp').map((c) => c.value)
  assert.ok(r.includes('inputValue') && r.includes('inputHandler'), '本文词要命中：' + r.join(','))
  assert.equal(r[0], 'inputValue', '出现次数多的排前面：' + r.join(','))
  assert.equal(H.docWords(text, 'zzz').length, 0, '不沾的不给')
  assert.equal(H.docWords('input', 'input').length, 0, '当前词自己不算候选')
})
ok('langHint：取草稿里最后一个围栏标记当语言提示', () => {
  assert.equal(H.langHint('随便写 ```js\nx'), 'js')
  assert.equal(H.langHint('```python\nx\n```\n再来 ```html'), 'html')
  assert.equal(H.langHint('没有围栏'), '')
})
ok('inferLang：没写围栏时按上下文推语言（使用中 2026-10-16 提「提示跟上下文不强关联」）', () => {
  assert.equal(H.inferLang('写个脚本，def main(): import os'), 'python', 'def/import 多 → python')
  assert.equal(H.inferLang('把 build.py 跑一遍，pip install 一下'), 'python', '.py + pip → python')
  assert.equal(H.inferLang('<div class="x">foo</div>'), 'html', '标签 → html')
  assert.equal(H.inferLang('这段 const a = await fetch(x)'), 'javascript', 'const/await → javascript')
  assert.equal(H.inferLang('今天天气不错'), '', '没有技术线索就回空（交给习惯/公共池）')
})
ok('apply 挂监听并返回 disposer（假 document 记数）', () => {
  let adds = 0, removes = 0
  sandbox.document.addEventListener = () => adds++
  sandbox.document.removeEventListener = () => removes++
  const dispose = mod.apply({})
  assert.equal(adds, 6)
  dispose()
  assert.equal(removes, 6)
})

console.log(`\n${n} 项全过`)
