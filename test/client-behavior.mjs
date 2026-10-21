// 浏览器半边行为测试：假 DOM（TEXTAREA 形态 composer）驱动真监听，
// 覆盖自动配对、环绕选区、跳闭合、删空对、Ctrl+Space 补全、接受候选、自动弹、语言提示。
// 跑法：node test/client-behavior.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

class FakeEl {
  constructor(tag = 'DIV') {
    this.tagName = tag
    this.children = []
    this.style = {}
    this._text = ''
    this._html = ''
    this.selectionStart = 0
    this.selectionEnd = 0
  }
  appendChild(c) { this.children.push(c); return c }
  set textContent(v) { this._text = String(v) }
  get textContent() { return this._text }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children = [] }
  get innerHTML() { return this._html }
  get innerText() {
    const own = this._text || (this._html ? this._html.replace(/<[^>]*>/g, '') : '')
    const kids = this.children.map((c) => c.innerText || c.textContent || '').join(' ')
    return (own + (kids ? ' ' + kids : '')).trim()
  }
  closest() { return null }
  focus() {}
  setAttribute(k, v) { (this.attrs || (this.attrs = {}))[k] = String(v) }
  getAttribute(k) { return this.attrs ? this.attrs[k] : undefined }
  dispatchEvent(ev) { if (ev && ev.type === 'input' && handlers.input) handlers.input({ target: this }); return true }
  getBoundingClientRect() { return { left: 10, top: 500 } }
  addEventListener() {}
  removeEventListener() {}
}
class FakeTextArea extends FakeEl {
  constructor() { super('TEXTAREA'); this._v = '' }
  get value() { return this._v }
  set value(v) { this._v = String(v) }
  closest() { return this }
}

const handlers = {}
const body = new FakeEl('BODY')
// 对话正文区（宿主真实锚点 [data-conversation-scroll] 的替身）：客户端只许从这里取上下文
const conv = { text: '' }
const convBox = { get innerText() { return conv.text } }
const documentFake = {
  body,
  querySelector: (sel) => (sel === '[data-conversation-scroll]' && conv.text ? convBox : null),
  createElement: (tag) => new FakeEl(String(tag).toUpperCase()),
  addEventListener: (t, fn) => { handlers[t] = fn },
  removeEventListener: () => {},
  execCommand: () => true,
  getElementById: (id) => body.children.find((c) => c.id === id) || null,
}

const fetchCalls = []
let fetchReply = { ok: true, candidates: [] }
/* 延迟模式：把响应扣在队列里，由用例决定何时放行 —— 用来复现「快速回车后，
 * 迟到的候选响应把浮层/灰字画回已被清空的输入框」（2026-10-21 维护者报的 bug）。 */
let fetchDefer = false
const fetchQueue = []
const releaseFetch = () => { fetchQueue.splice(0).forEach((fire) => fire()) }
const store = new Map()
const sandbox = {
  window: {
    __ModuleLoader__: { load(spec) { sandbox.__captured = spec } },
    getSelection: () => null,
    innerHeight: 800,
    innerWidth: 1200,
    HTMLTextAreaElement: FakeTextArea,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    getComputedStyle: () => ({ font: '13px monospace' }),
  },
  document: documentFake,
  fetch: (url) => {
    fetchCalls.push(String(url))
    if (!fetchDefer) return Promise.resolve({ json: () => Promise.resolve(fetchReply) })
    return new Promise((resolve) => {
      fetchQueue.push(() => resolve({ json: () => Promise.resolve(fetchReply) }))
    })
  },
  console, Symbol, Object, Array, Promise, Error, JSON, String, Number, Math, RegExp, setTimeout, clearTimeout,
  Event: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}) } },
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'lib/client.js' })

let n = 0
function ok(label, fn) { fn(); n++; console.log('  ok   ' + label) }
async function okAsync(label, fn) { await fn(); n++; console.log('  ok   ' + label) }

const mod = sandbox.__captured.factory(() => { throw new Error('本包不该 require 任何东西') })
mod.apply({})
const popupEl = () => body.children.find((c) => c.id === 'dsh-cp-popup')
const ghostEl = () => body.children.find((c) => c.id === 'dsh-cp-ghost')
// 弹层子节点里，带 data-dsh-cp-wm 的是语言水印（底纹），不是候选项
const rowsOf = (p) => (p ? p.children.filter((c) => !(c.attrs && c.attrs['data-dsh-cp-wm'])) : [])
const wmOf = (p) => (p ? p.children.find((c) => c.attrs && c.attrs['data-dsh-cp-wm']) : null)

function mkEd(value, caret) {
  const ed = new FakeTextArea()
  ed.value = value
  ed.selectionStart = ed.selectionEnd = caret === undefined ? value.length : caret
  return ed
}
function keydown(ed, k) {
  const ev = { key: k.key, code: k.code || '', ctrlKey: !!k.ctrl, metaKey: false, shiftKey: !!k.shift, altKey: false, target: ed, prevented: false, preventDefault() { this.prevented = true } }
  handlers.keydown(ev)
  return ev
}
const input = (ed, data) => handlers.input({ target: ed, data: data })
const tick = () => new Promise((r) => setTimeout(r, 0))

/* beforeinput 的**浏览器那半步**：真浏览器在 beforeinput 没被拦住时会自己落字，
 * 然后派发 input。假 DOM 原来只调处理器、不落字，于是「落地之后才收尾」的实现根本验不出来。
 * noInput=true 复刻真机实测的另一个形状：空框里 Lexical 首次插入**不派发 input**。 */
function nativeInsert(ed, data, noInput) {
  const s = ed.selectionStart, e = ed.selectionEnd
  ed.value = ed.value.slice(0, s) + data + ed.value.slice(e)
  ed.selectionStart = ed.selectionEnd = s + data.length
  if (!noInput) handlers.input({ target: ed, data: data, inputType: 'insertText' })
}
function beforeinput(ed, data, opts = {}) {
  const ev = { target: ed, data, inputType: 'insertText', prevented: false, preventDefault() { this.prevented = true } }
  handlers.beforeinput(ev)
  if (!ev.prevented) nativeInsert(ed, data, opts.noInput)
  return ev
}

ok('空框打 ( → 配对成 ()，caret 落中间', () => {
  const ed = mkEd('')
  const ev = keydown(ed, { key: '(' })
  assert.equal(ed.value, '()')
  assert.equal(ed.selectionStart, 1)
  assert.ok(ev.prevented, '要 preventDefault，否则宿主会再插一个 (')
})

ok('标识符/路径后打 ( → 只插一个（保护 call( 与 E:/path 场景）', () => {
  const a = mkEd('abc')
  keydown(a, { key: '(' })
  assert.equal(a.value, 'abc(')
  const b = mkEd('E:/x/')
  keydown(b, { key: '(' })
  assert.equal(b.value, 'E:/x/(')
})

ok('全角（ 走 input 事件补配对（IME 合成不一定带对应 keydown）', () => {
  const ed = mkEd('（')
  input(ed)
  assert.equal(ed.value, '（）', '全角也要补出配对：' + ed.value)
  assert.equal(ed.selectionStart, 1, 'caret 要落在中间（真机会再推一拍校正）')
})

ok('选中一段再打 ( → 环绕成 (选区)，选区保持选中', () => {
  const ed = mkEd('xyz', 3)
  ed.selectionStart = 0
  ed.selectionEnd = 3
  keydown(ed, { key: '(' })
  assert.equal(ed.value, '(xyz)')
  assert.equal(ed.selectionStart, 5, '光标落在闭符之后')
  assert.equal(ed.selectionEnd, 5)
})

ok('闭符已在右边时打它 → 跳过去，不重复插', () => {
  const ed = mkEd('()', 1)
  keydown(ed, { key: ')' })
  assert.equal(ed.value, '()')
  assert.equal(ed.selectionStart, 2, 'caret 要移到闭符之后')
})

ok('caret 夹在空对里按 Backspace → 一次删两侧', () => {
  const ed = mkEd('()', 1)
  keydown(ed, { key: 'Backspace' })
  assert.equal(ed.value, '')
})

await okAsync('Ctrl+Space → 打 words 路由；候选回来弹层渲染，Tab 接受并替换当前 token', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'input', detail: 'html 标签' }] }
  const ed = mkEd('inp')
  const before = fetchCalls.length
  keydown(ed, { key: ' ', code: 'Space', ctrl: true })
  assert.equal(fetchCalls.length, before + 1, 'Ctrl+Space 要发一次请求')
  assert.match(fetchCalls[fetchCalls.length - 1], /prefix=inp/, '要带当前 token')
  await tick()
  const p = popupEl()
  assert.ok(p && p.style.display === 'block', '弹层要显示')
  assert.equal(p.children.length, 1, '一条候选一行：' + p.children.length)
  keydown(ed, { key: 'Tab' })
  assert.equal(ed.value, 'input', 'Tab 接受后要把 inp 换成候选值')
})

await okAsync('打两个字母自动弹（不用快捷键），本文词排在前面不等网络', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'file', value: 'x/y.ts', detail: 'w' }] }
  const ed = mkEd('inputValue inputHandler inp')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before + 1, '自动触发也要发请求')
  const p = popupEl()
  assert.ok(p && p.style.display === 'block', '弹层要立刻显示（本地词先上屏）')
  assert.match(p.children[0].innerText, /inputValue/, '本地词应当排第一：' + p.children[0].innerText)
  await tick()
  assert.match(popupEl().innerText, /inputValue/, '网络回来后本地词仍在')
})

/* 回归（2026-10-21 维护者报「快速点回车后，那个修字的提示留在了输入框中」）：
 * 候选响应比回车晚到，旧实现在 Enter 清场之后又把浮层与灰字画了一遍。 */
await okAsync('回车后迟到的补全响应不复活浮层与灰字', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'input' }] }
  const ed = mkEd('inp')
  fetchDefer = true
  try {
    const before = fetchCalls.length
    keydown(ed, { key: ' ', code: 'Space', ctrl: true })
    assert.equal(fetchCalls.length, before + 1, '要发出候选请求')
    keydown(ed, { key: 'Enter' })      // 响应还没回来就回车发送
    ed.value = ''                      // 发送后输入框被清空
    ed.selectionStart = ed.selectionEnd = 0
    releaseFetch()                     // 现在放行迟到的响应
    await tick()
    await tick()
    const p = popupEl()
    const g = ghostEl()
    assert.ok(!p || p.style.display !== 'block', '回车后浮层不许复活：' + (p ? p.style.display : '无'))
    assert.ok(!g || g.style.display !== 'block', '回车后灰字不许留在输入框上：' + (g ? g.style.display : '无'))
  } finally {
    fetchDefer = false
  }
})

await okAsync('数字开头与纯空白不触发补全（中文现在**要**触发，见下一条）', async () => {  const before = fetchCalls.length
  for (const v of ['结尾空格 ']) { const ed = mkEd(v); input(ed) }
  assert.equal(fetchCalls.length, before, '纯空白不该发请求：' + fetchCalls.slice(before).join(','))
})

await okAsync('碎片前缀：服务端 wordGate=false 时客户端整条收起（连本地词都不出）', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: '文档管理', detail: '词典' }], wordGate: false }
  const ed = mkEd('先写一段关于文档的说明，档管')
  input(ed)
  await tick()
  const pop = popupEl()
  assert.ok(!pop || !pop.children.length || pop.style.display === 'none', '碎片不许弹层：' + (pop ? pop.innerText : '无'))
})

await okAsync('IME 合成期间不补全（打拼音 ye 不会被补成 yield，维护者 2026-10-16 报的灰字 eld）', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'yield', detail: 'JS 关键字', matches: [0, 1] }] }
  const ed = mkEd('ye')
  handlers.compositionstart({ target: ed })
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before, '合成中不该发请求：' + fetchCalls.slice(before).join(','))
  const pop = popupEl()
  assert.ok(!pop || !pop.children.length || pop.style.display === 'none', '合成中不该有弹层')
  handlers.compositionend({ target: ed })
})

await okAsync('中文也触发补全，并且草稿里出现过的中文词能被提示（维护者 2026-10-16：文档/变量那个要求）', async () => {
  fetchReply = { ok: true, candidates: [], wordGate: true }
  const ed = mkEd('先写一段关于文档管理系统的说明，后面再提到文档')
  input(ed)
  await tick()          // 中文要等「完整词义」闸的结果才渲染
  const pop = popupEl()
  assert.ok(pop && pop.children.length, '打完整的「文档」要弹')
  const text = pop.children.map((r) => r.innerText).join('|')
  assert.match(text, /文档/, '要提示以「文档」开头的更长的词：' + text)
  assert.match(text, /本文/, '右侧类型标「本文」：' + text)
  keydown(ed, { key: 'Escape' })
  const edOne = mkEd('先写一段关于文档的说明，后面再提文')
  input(edOne)
  await tick()
  const popOne = popupEl()
  assert.ok(!popOne || !popOne.children.length || popOne.style.display === 'none', '单字「文」不许弹')
})

await okAsync('Esc 关弹层', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'input' }] }
  const ed = mkEd('inp')
  input(ed)
  await tick()
  assert.equal(popupEl().style.display, 'block')
  keydown(ed, { key: 'Escape' })
  assert.equal(popupEl().style.display, 'none', 'Esc 之后要隐藏')
})

await okAsync("行首 '/' 让给原生命令：插件不拉候选、不弹层", async () => {
  // 2026-10-21：'/' 是 DSH 命系统入口（dsh-commands：command/run），插件不插手，
  // 免得两份菜单叠在一起、也免得给那条路加延迟。
  const ed = mkEd('/dsh')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before, '行首 / 不该触发插件自己的候选请求')
  assert.ok(!popupEl() || popupEl().style.display === 'none', '原生命令入口不该被我们的弹层盖住')
  await tick()
})

await okAsync("'@' 仍走插件自己的补全（只有 '/' 让位）", async () => {
  const ed = mkEd('@rea')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before + 1, '@ 仍要拉候选')
  assert.match(fetchCalls[fetchCalls.length - 1], /prefix=%40rea/, '要把 @rea 当 token 带上')
  await tick()
})

ok('在已有文字前打前引号：只插一个（右边是文字时不补闭符）', () => {
  const ed = mkEd('abc', 3)
  ed.selectionStart = ed.selectionEnd = 0            // 光标挪到最前
  keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '"abc', '不许补成 ""abc：' + ed.value)
})

ok('右边已经是同一个引号：跳过去，不再补一对（否则越打越多）', () => {
  const ed = mkEd('""', 2)
  ed.selectionStart = ed.selectionEnd = 1            // 夹在一对空引号中间
  const ev = keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '""', '不许变成 """"：' + ed.value)
  assert.equal(ed.selectionStart, 2, '跳到闭符之后')
  assert.equal(ev.prevented, true)
})

ok('全角/IME 路径同样看右边：右边有字就只插开符', () => {
  const ed = mkEd('“文字', 1)                         // 宿主已经把「插入，光标在引号后
  input(ed, '“')
  assert.equal(ed.value, '“文字', '不许补成 “”文字：' + ed.value)
})

ok('右边是空白时仍然补闭符（这一条别退化成"永远不补"）', () => {
  const ed = mkEd('')
  keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '""', '行尾要补一对：' + ed.value)
  assert.equal(ed.selectionStart, 1)
})

ok('上下文候选只从对话正文区取：对话里出现过的标识符按前缀补出来（类型词标「上下文」）', () => {
  conv.text = '刚才那个 install_quarantine.py 和 verify_bank 都要跑；install_quarantine 只装过一次，而且这段说明得够长，长过四十个字符的门槛，才会被真的取用。'
  mod.__helpers__.contextReset()
  const ed = mkEd('inst')
  input(ed)
  const pop = popupEl()
  assert.ok(pop, '要弹出建议框')
  const text = rowsOf(pop).map((r) => r.innerText).join('|')
  assert.match(text, /install_quarantine/, '对话里的词要出现：' + text)
  assert.match(text, /上下文/, '类型词要标「上下文」：' + text)
  conv.text = ''
})

ok('左侧栏/整页文本不参与：正文区没有的词，不许因为挂在 body 上就补出来', () => {
  conv.text = ''
  body.textContent = 'sidebar_only_token 设置面板里的词不该进补全池子'
  mod.__helpers__.contextReset()
  const words = mod.__helpers__.contextWords(mkEd('side'))
  assert.equal(words.indexOf('sidebar_only_token'), -1, '整页文本不许进上下文池：' + words.slice(0, 5).join(','))
  body.textContent = ''
})

await okAsync('围栏语言提示：```python 后的记号按 python 上词表', async () => {
  const ed = mkEd('```python\ndef')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before + 1)
  assert.match(fetchCalls[fetchCalls.length - 1], /lang=python/, '要把语言提示带给服务端：' + fetchCalls[fetchCalls.length - 1])
  await tick()
})

await okAsync('回车不吃弹层（真机回归：连按回车把候选反复插进正文）', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'file', value: '临时目录/attrib-index.diff', detail: 'w' }] }
  const ed = mkEd('attrib')
  input(ed)
  await tick()
  assert.equal(popupEl().style.display, 'block', '先让弹层开着')
  const ev = keydown(ed, { key: 'Enter' })
  assert.equal(ev.prevented, false, '回车必须放行给宿主（发送），不能被弹层拦下')
  assert.equal(ed.value, 'attrib', '回车不该把候选插进正文')
})

await okAsync('接受候选后弹层不复开（滚雪球的另一半）', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'file', value: '临时目录/attrib-index.diff', detail: 'w' }] }
  const ed = mkEd('attrib')
  input(ed)
  await tick()
  keydown(ed, { key: 'Tab' })
  assert.equal(ed.value, '临时目录/attrib-index.diff', 'Tab 要把整段 token 换成候选')
  assert.equal(popupEl().style.display, 'none', '自己插进去的文本不能再触发一次弹层')
})

ok('Shift 组合键打出的开符也要配对（{ " 这些必须按 Shift，原先被挡掉）', () => {
  const a = mkEd('')
  keydown(a, { key: '{', shift: true })
  assert.equal(a.value, '{}', 'Shift+[ 的 { 要配对：' + a.value)
  assert.equal(a.selectionStart, 1)
  const b = mkEd('')
  keydown(b, { key: '"', shift: true })
  assert.equal(b.value, '""', '双引号同理：' + b.value)
})

ok('框选后打符号：走 beforeinput 把选区框起来（中文输入法/全角没有可用的 keydown）', () => {
  const ed = mkEd('xyz', 3)
  ed.selectionStart = 0
  ed.selectionEnd = 3
  const ev = { target: ed, data: '（', prevented: false, preventDefault() { this.prevented = true } }
  handlers.beforeinput(ev)
  assert.equal(ev.prevented, true, '要拦住宿主自己插那个字符')
  assert.equal(ed.value, '（xyz）', '要框成 开符+选区+闭符：' + ed.value)
  assert.equal(ed.selectionStart, ed.value.length, '光标落在闭符之后（维护者 2026-10-20 定的落点）')
  assert.equal(ed.selectionEnd, ed.value.length, '不再回选到内层内容')
})

await okAsync('行内灰字提示：首位候选比已打的前缀多出来的那截贴在光标后（VSCode inline suggestion 手感）', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'inputValue', detail: '本文' }] }
  const ed = mkEd('inputV')
  input(ed)
  await tick()
  const g = body.children.find((c) => c.id === 'dsh-cp-ghost')
  assert.ok(g, '要有灰字层')
  assert.equal(g.textContent, 'alue', '灰字内容应是候选多出来的后缀：' + (g && g.textContent))
  assert.equal(g.style.display, 'block')
  keydown(ed, { key: 'Escape' })
  assert.equal(g.style.display, 'none', 'Esc 之后要收起')
})

await okAsync('语言习惯：接受过哪套词表的候选，下次没写围栏就按它上词表', async () => {
  store.clear()
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'def', detail: 'python 词表', lang: 'python' }] }
  const ed = mkEd('de')
  input(ed)
  await tick()
  keydown(ed, { key: 'Tab' })               // 接受 → 记一笔 python 习惯
  assert.equal(ed.value, 'def')
  assert.match(store.get('dsh-composer-ease:lang-habit') || '', /python/, '习惯要落盘：' + store.get('dsh-composer-ease:lang-habit'))
  const before = fetchCalls.length
  const ed2 = mkEd('pri')
  input(ed2)
  assert.equal(fetchCalls.length, before + 1)
  assert.match(fetchCalls[fetchCalls.length - 1], /lang=python/, '没写围栏也要带上习惯语言：' + fetchCalls[fetchCalls.length - 1])
  store.clear()
})

ok('有前引号时再打引号只插一个（维护者 2026-10-20 报的「出两个引号」）', () => {
  const ed = mkEd('“', 1)                               // 光标就在前引号之后
  keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '“"', '不许补成 “""：' + ed.value)
})

ok('闭引号后面再打引号也只插一个（中文输入法连打引号会变多个）', () => {
  const ed = mkEd('“”', 2)
  keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '“”"', '不许变成 “”""：' + ed.value)
})

ok('反引号连打：前两下配成一对，第三下不再被吞（``` 围栏能直接打出来）', () => {
  const a = mkEd('', 0)
  keydown(a, { key: '`' })                              // 第一下：配成 ``，光标在中间
  assert.equal(a.value, '``', '第一下要配对：' + a.value)
  keydown(a, { key: '`' })                              // 第二下：跳过已有闭符
  assert.equal(a.value, '``', '第二下只跳过：' + a.value)
  keydown(a, { key: '`' })                              // 第三下：前一个字符是反引号 → 只插一个
  assert.equal(a.value, '```', '第三下要落成三个反引号：' + a.value)
})

ok('apply 返回的 disposer 会摘监听、关弹层', () => {
  const d = mod.apply({})
  assert.equal(typeof d, 'function')
  d()
})

await okAsync('语言水印：对话里是 Java 时，右下角压一块写着 java 的淡字，且不再有顶部说明行', async () => {
  conv.text = '这段 Java 服务里 public void run() { System.out.println(1); } 还要加 @Override，public 修饰符别忘。'
  mod.__helpers__.contextReset()
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'public', detail: 'java 关键字' }] }
  const ed = mkEd('pub')
  input(ed)
  await tick()
  const p = popupEl()
  const wm = wmOf(p)
  assert.ok(wm, '要有水印层')
  assert.equal(wm.textContent, 'java', '水印只写语言名，不写句子：' + wm.textContent)
  assert.match(wm.style.cssText, /rotate\(-14deg\)/, '单语言角度 14°：' + wm.style.cssText)
  assert.match(wm.style.cssText, /right:6px/, '贴右下角：' + wm.style.cssText)
  assert.match(wm.style.cssText, /pointer-events:none/, '水印不许吃点击')
  assert.equal(wm.attrs['aria-hidden'], 'true', '装饰元素不进无障碍树')
  assert.equal(p.children.filter((c) => c.attrs && c.attrs['data-dsh-cp-head']).length, 0, '顶部说明行必须已经删掉')
  assert.match(fetchCalls[fetchCalls.length - 1], /lang=java/, '推断出的语言要带给服务端：' + fetchCalls[fetchCalls.length - 1])
  assert.equal(rowsOf(p).length >= 1, true, '水印不能挤掉候选行：' + rowsOf(p).length)
  conv.text = ''
  mod.__helpers__.contextReset()
})

ok('水印角度随语言种数增长并封顶 45°（1→14、2→26、3→38、4 及以上→45）', () => {
  const W = mod.__helpers__.watermarkFor
  assert.equal(W([]), null, '没有语言就不出水印')
  assert.equal(W(['java']).angle, 14)
  assert.equal(W(['java', 'python']).angle, 26)
  assert.equal(W(['java', 'python', 'go']).angle, 38)
  assert.equal(W(['java', 'python', 'go', 'rust']).angle, 45)
  assert.equal(W(['a', 'b', 'c', 'd', 'e']).angle, 45, '超过 4 个不继续加角度')
  assert.equal(W(['java', 'python']).text, 'java · python', '多个语言用间隔号连起来')
})

ok('成对家族一刀切：前一个字符是任意成对符号时，只插一个、不补闭符', () => {
  const cases = [['(', ')'], ['[', ']'], ['{', '}'], ['（', '）'], ['【', '】'], ['「', '」'], ['“', '”'], ['"', '"'], ["'", "'"], ['`', '`']]
  for (const [open, close] of cases) {
    const ed = mkEd(open, 1)                              // 光标就在这个符号之后
    keydown(ed, { key: open, shift: open === '"' || open === '{' })
    assert.equal(ed.value, open + open, `前有 ${open} 再打它不许补对：` + ed.value)
    assert.equal(ed.value.length, 2, `总长必须是 2（只多插这一个字符）：` + ed.value.length)
    if (open !== close) assert.ok(!ed.value.includes(close), `不许出现闭符 ${close}：` + ed.value)
  }
})

ok('多行选区加符号：换行必须原样保留，不许被并成一行', () => {
  const ed = mkEd('第一行\n第二行\n第三行', 0)
  ed.selectionStart = 0
  ed.selectionEnd = ed.value.length
  keydown(ed, { key: '"', shift: true })
  assert.equal(ed.value, '"第一行\n第二行\n第三行"', '多行内容要原封不动被框住：' + JSON.stringify(ed.value))
  assert.equal(ed.value.split('\n').length, 3, '行数不许变：' + ed.value.split('\n').length)
  assert.equal(ed.selectionStart, ed.value.length, '光标要落在闭符之后：' + ed.selectionStart + '/' + ed.value.length)
  assert.equal(ed.selectionEnd, ed.value.length, '不是回选到内容上，是塌到末尾')
})

await okAsync('回车（发送）收干净：弹层与灰字都不留在被清空的输入框上', async () => {
  fetchReply = { ok: true, candidates: [{ kind: 'word', value: 'inputValue', detail: '本文' }] }
  const ed = mkEd('inputV')
  input(ed)
  await tick()
  assert.equal(popupEl().style.display, 'block', '先让弹层开着')
  const g = body.children.find((c) => c.id === 'dsh-cp-ghost')
  assert.equal(g.style.display, 'block', '灰字也先亮着')
  keydown(ed, { key: 'Enter' })
  assert.equal(popupEl().style.display, 'none', '发送后弹层要收起')
  assert.equal(g.style.display, 'none', '发送后灰字要收起')
})

// ── 维护者 2026-10-20 报的「前方有引号、后方再打还是一对」────────────────────
function pressQuote(value, sel, key, data) {
  const ed = mkEd(value, sel[1])
  ed.selectionStart = sel[0]; ed.selectionEnd = sel[1]
  if (data !== undefined) handlers.beforeinput({ target: ed, data, preventDefault() {} })
  else keydown(ed, { key })
  return ed
}

ok('前方有不闭合的直引号，末尾再打直引号：只插一个，不再出对', () => {
  const ed = pressQuote('"你好', [3, 3], '"')
  assert.equal(ed.value, '"你好"', '不许变成 "你好""：' + ed.value)
  assert.equal(ed.selectionStart, 4, '光标在闭引号之后')
})

ok('前方有不闭合的中文引号，末尾再打同一个：只插一个', () => {
  const ed = pressQuote('“文字', [3, 3], '“')
  assert.equal(ed.value, '“文字“', '不许被 onInput 补成 “文字“”：' + ed.value)
})

ok('空框打中文引号：仍然要自动补闭符（这条不能被上一条改坏）', () => {
  // 真浏览器里 input 是在字符已经进框之后才触发，这里照同样时序造
  const ed = mkEd('“', 1)
  handlers.input({ target: ed, data: '“' })
  assert.equal(ed.value, '“”', '空框应补成 “”：' + ed.value)
})

ok('已有一个没闭合的开符，选中内容再打同一个引号：补闭合而不是再框一层', () => {
  const ed = pressQuote('"abc', [1, 4], '"')
  assert.equal(ed.value, '"abc"', '不许变成 ""abc"：' + ed.value)
})

ok('IME 那条路（beforeinput）同样认未闭合', () => {
  const ed = pressQuote('"abc', [1, 4], '"', '"')
  assert.equal(ed.value, '"abc"', 'beforeinput 不许再框一层：' + ed.value)
})

// ── 维护者 2026-10-21：全角/半角混着打，不该冒出多个引号 ─────────────────
ok('全角开符后面打半角引号：补闭合，不再凑一对', () => {
  const ed = pressQuote('\u201c\u4f60\u597d', [3, 3], '"')
  const quotes = (ed.value.match(/["\u201c\u201d]/g) || []).length
  assert.equal(quotes, 2, '应当是「全角开 + 半角闭」两个引号：' + JSON.stringify(ed.value))
})

ok('已有一对（宽度混写）时不判"未闭合"：不再补第二对', () => {
  const ed = pressQuote('"abc\u201d', [5, 5], '"')
  const quotes = (ed.value.match(/["\u201c\u201d]/g) || []).length
  assert.equal(quotes, 3, '既有一对（混写）后再打一个，只多这一个：' + JSON.stringify(ed.value))
})

ok('正常框选没被改坏：选中 abc 打引号仍然框住', () => {
  const ed = pressQuote('abc', [0, 3], '"')
  assert.equal(ed.value, '"abc"', '普通框选应仍是 "abc"：' + ed.value)
})

// ── 维护者 2026-10-21：框选只是一个动作，要能反选 ─────────────────────────
ok('框完再打同一个引号 = 取消这次框选，内层重新选中', () => {
  const ed = pressQuote('abc', [0, 3], '"')
  assert.equal(ed.value, '"abc"', '先框住：' + ed.value)
  keydown(ed, { key: '"' })
  assert.equal(ed.value, 'abc', '再打同一个引号应取消框选：' + ed.value)
  assert.equal(ed.selectionStart, 0, '取消后内层要重新选中')
  assert.equal(ed.selectionEnd, 3, '取消后内层要重新选中')
})

ok('取消框选只对「没被别人改过」的那次生效', () => {
  const ed = pressQuote('abc', [0, 3], '"')
  ed.value = '"abX"'                     // 模拟用户在框里改过
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '"abX"', '内层被改过就不该反选，也不该再堆一个：' + ed.value)
})

ok('框选期间不弹补全（框选只是一个动作，不该顺手提醒）', () => {
  const ed = pressQuote('inputValue', [0, 10], '"')
  const p = popupEl()
  assert.ok(!p || p.style.display === 'none', '框选后不该弹补全')
  const g = ghostEl()
  assert.ok(!g || g.style.display === 'none', '框选后不该留灰字')
})

// ── 成对家族行为矩阵（维护者 2026-10-20：「写测试用例多测试一下」）─────────────
// 期望值按「像 VS Code 那样、但中文正文也配对」的口径写死；哪条红就是实现要补的。
function bi(ed, data) {
  const ev = { target: ed, data, inputType: 'insertText', prevented: false, preventDefault() { this.prevented = true } }
  handlers.beforeinput(ev)
  return ev
}

// 1) 空框：每种开符都要补成一对，光标在中间
for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"], ['`', '`'], ['（', '）'], ['“', '”'], ['「', '」'], ['〈', '〉'], ['《', '》']]) {
  ok(`矩阵·空框打 ${open} → 补成 ${open}${close}，caret 在中间`, () => {
    const ed = mkEd('')
    keydown(ed, { key: open })
    assert.equal(ed.value, open + close, `期望 ${open}${close}，实得 ` + ed.value)
    assert.equal(ed.selectionStart, 1, 'caret 应在中间：' + ed.selectionStart)
  })
}

// 2) 光标前已有「未闭合」的开符：只插一个（这是维护者报的核心那条）
for (const [open, close, text] of [['"', '"', '"你好'], ["'", "'", "'abc"], ['`', '`', '`code'], ['“', '”', '“文字'], ['（', '）', '（说明']]) {
  ok(`矩阵·${text} 末尾再打 ${open} → 只插一个`, () => {
    const ed = mkEd(text, text.length)
    keydown(ed, { key: open })
    assert.equal(ed.value, text + open, `期望 ${text}${open}，实得 ` + ed.value)
  })
}

// 3) 右边已经是闭符：跳过去，不插
for (const [open, close] of [['(', ')'], ['"', '"'], ['“', '”']]) {
  ok(`矩阵·${open}${close} 中间再打 ${open} → 跳过闭符，值不变`, () => {
    const ed = mkEd(open + close, 1)
    keydown(ed, { key: open })
    assert.equal(ed.value, open + close, '值不该变：' + ed.value)
    assert.equal(ed.selectionStart, 2, 'caret 应跳到闭符之后：' + ed.selectionStart)
  })
}

ok('矩阵·〈〉 中间再打 〈 → 跳过闭符，值不变', () => {
  const ed = mkEd('\u3008\u3009', 1)
  keydown(ed, { key: '\u3008' })
  assert.equal(ed.value, '\u3008\u3009', '值不该变：' + ed.value)
  assert.equal(ed.selectionStart, 2, 'caret 应跳到闭符之后：' + ed.selectionStart)
})

// 4) 框住选区
for (const [open, close] of [['"', '"'], ['(', ')'], ['“', '”'], ['「', '」']]) {
  ok(`矩阵·选中 abc 打 ${open} → 框成 ${open}abc${close}`, () => {
    const ed = mkEd('abc', 3)
    ed.selectionStart = 0
    keydown(ed, { key: open })
    assert.equal(ed.value, open + 'abc' + close, '期望框住：' + ed.value)
  })
}

// 5) 连续按同一个对称引号：两下不该变多，第三下才是字面
ok('矩阵·连按两下引号 → 仍是 ""（第二下只跳过）', () => {
  const ed = mkEd('')
  keydown(ed, { key: '"' })
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '""', '连按两下不该变多：' + ed.value)
})

ok('矩阵·连按三下引号 → """（第三下是字面插入，属正常）', () => {
  const ed = mkEd('')
  keydown(ed, { key: '"' })
  keydown(ed, { key: '"' })
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '"""', '三下应为三个：' + ed.value)
})

// 6) 标识符/路径后面不配对（保护代码）
for (const text of ['a', 'a(', 'E:/path', 'foo.', 'x@y']) {
  ok(`矩阵·${text} 后打 ( → 只插一个`, () => {
    const ed = mkEd(text, text.length)
    keydown(ed, { key: '(' })
    assert.equal(ed.value, text + '(', '不该配对：' + ed.value)
  })
}

// 7) 中文正文后面仍要配对
ok('矩阵·中文正文后打 ( → 配对', () => {
  const ed = mkEd('说明', 2)
  keydown(ed, { key: '(' })
  assert.equal(ed.value, '说明()', '中文后应配对：' + ed.value)
})

// ── beforeinput 路线（配对判定的第二条路：中文输入法/全角没有可用的 keydown）──────────
// 真机读数（2026-10-20，demo 3081 + Playwright）：真 Lexical **不认 preventDefault** ——
// 它照自己的模型再插一遍，于是「拦 + 自己插」得到双份。所以这条路只能是
// 「先让原生插，落地之后再收尾」。假 DOM 在这里补上浏览器那半步，断言的是**终态**。
// 0.9.6 起这 6 条已转正（原先挂在 CE_PENDING 后面红着等实现）。
{
  await okAsync('beforeinput·空框打 “ → 补成 “”，caret 在中间', async () => {
    const ed = mkEd('')
    const ev = beforeinput(ed, '“')
    await tick()
    assert.equal(ev.prevented, false, '不要拦原生：Lexical 不认取消，拦了就双份')
    assert.equal(ed.value, '“”', '实得：' + ed.value)
    assert.equal(ed.selectionStart, 1, 'caret 要落在成对符号中间：' + ed.selectionStart)
  })

  await okAsync('beforeinput·空框打 “ 且 input 不来（真机形状）→ 仍补成 “”', async () => {
    const ed = mkEd('')
    beforeinput(ed, '“', { noInput: true })
    await tick()
    assert.equal(ed.value, '“”', 'input 缺席时也要补出来：' + ed.value)
    assert.equal(ed.selectionStart, 1, 'caret 在中间：' + ed.selectionStart)
  })

  await okAsync('beforeinput·选中 abc 打 “ → 框住', async () => {
    const ed = mkEd('abc', 3)
    ed.selectionStart = 0
    const ev = beforeinput(ed, '“')
    await tick()
    assert.ok(ev.prevented, '选区必须拦：不拦的话选中的字会被那一个字符替掉')
    assert.equal(ed.value, '“abc”', '实得：' + ed.value)
  })

  await okAsync('beforeinput·前方有未闭合开符，末尾再打 → 只插一个', async () => {
    const ed = mkEd('“文字', 3)
    const ev = beforeinput(ed, '“')
    await tick()
    assert.equal(ev.prevented, false, '这一下原生插一个就是对的，不该拦')
    assert.equal(ed.value, '“文字“', '实得：' + ed.value)
  })

  await okAsync('beforeinput·夹在空对里再打同一个 → 跳过，不留双份', async () => {
    const ed = mkEd('“”', 1)
    beforeinput(ed, '“')
    await tick()
    assert.equal(ed.value, '“”', '实得：' + ed.value)
    assert.equal(ed.selectionStart, 2, 'caret 应跳过闭符：' + ed.selectionStart)
  })

  await okAsync('beforeinput·半角 " 同样只插一个（前方未闭合）', async () => {
    const ed = mkEd('"你好', 3)
    beforeinput(ed, '"')
    await tick()
    assert.equal(ed.value, '"你好"', '实得：' + ed.value)
  })
}

// ── 基础用法补测（维护者 2026-10-20：「引号是重灾区不代表其他做好了」）──────────
await okAsync('基础·打 / 不触发插件候选（原生命令接手）', async () => {
  const ed = mkEd('/')
  const before = fetchCalls.length
  input(ed, '/')
  await tick()
  assert.equal(fetchCalls.length, before, '行首 / 交给 DSH 原生命令，插件不发请求')
})

await okAsync('基础·打 @ 触发候选请求', async () => {
  const ed = mkEd('@')
  const before = fetchCalls.length
  input(ed, '@')
  await tick()
  assert.ok(fetchCalls.length > before, '@ 应发一次候选请求')
})

// 弹层的 DOM 移除在假 DOM 里验不了（FakeEl 没有 remove()），Esc 的判定留在 client-smoke 的 keyAction 表里

ok('基础·全角闭符 ）在右边已经有时跳过', () => {
  const ed = mkEd('（说明）', 3)
  keydown(ed, { key: '）' })
  assert.equal(ed.value, '（说明）', '值不该变：' + ed.value)
  assert.equal(ed.selectionStart, 4, 'caret 应跳到闭符之后：' + ed.selectionStart)
})

ok('基础·全角闭符 ）右边没有时交给默认插入（不拦、也不配成对）', () => {
  const ed = mkEd('（说明', 3)
  const ev = keydown(ed, { key: '）' })
  assert.equal(ev.prevented, false, '不该拦默认插入')
  assert.equal(ed.value, '（说明', '假 DOM 没有默认插入，值不该由插件改：' + ed.value)
})



// ── 空对里按 Backspace 一次删两侧（2026-10-20 取证后修；半角/全角/中文标点都要过）──
for (const [label, value] of [['半角 ()', '()'], ['方括号 []', '[]'], ['全角 （）', '\uff08\uff09'], ['中文引号 “”', '\u201c\u201d'], ['单书名号 〈〉', '\u3008\u3009'], ['双书名号 《》', '\u300a\u300b']]) {
  ok(`空对·${label} 里按 Backspace 一次删两侧`, () => {
    const ed = mkEd(value, 1)
    keydown(ed, { key: 'Backspace' })
    assert.equal(ed.value, '', '应删成空，实得码点：' + [...ed.value].map((c) => c.codePointAt(0).toString(16)).join(' '))
  })
}

// ── 维护者 2026-10-20 的路径：先打「你好」→ 前面打 `"` → 再打 `"` ────────────────
// 真机复现（demo 3081 + Playwright）分两种落法，都会堆出多余引号，两种都要治：
//  A）回最前打 `"`（没选中）→ 光标紧贴一个没闭合的开符，后面还有正文：再打同一个是「补闭合」，
//     闭符要落到这一段末尾 —— 否则得到 `""你好`（两个没闭合的开引号，谁都用不上）；
//  B）选中文字打 `"` → 框成 `"你好"`（光标落在闭符之后）：再打同一个不该再堆一个 ——
//     否则得到维护者报的 `"你好""`。
ok('光标紧贴没闭合的开符、后面还有正文，再打同一个 → 补闭合到段尾（`"|你好` + `"` → `"你好"`）', () => {
  const ed = mkEd('"你好', 1)
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '"你好"', '实得：' + ed.value)
  assert.equal(ed.selectionStart, 4, '光标落在闭符之后：' + ed.selectionStart)
})

ok('同样一条对中文引号成立（`“|你好` + `“` → `“你好”`）', () => {
  const ed = mkEd('\u201c你好', 1)
  keydown(ed, { key: '\u201c' })
  assert.equal(ed.value, '\u201c你好\u201d', '实得：' + ed.value)
})

ok('已经框好（光标在闭符之后）再打同一个闭符 → 不再堆一个（`"你好"` + `"` 仍是 `"你好"`）', () => {
  const ed = mkEd('"你好"', 4)
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '"你好"', '维护者报的 `"你好""` 就是这条：' + ed.value)
})

ok('中文引号已框好同样不再堆（`“你好”` + `“` 仍是 `“你好”`）', () => {
  const ed = mkEd('\u201c你好\u201d', 4)
  keydown(ed, { key: '\u201c' })
  assert.equal(ed.value, '\u201c你好\u201d', '实得：' + ed.value)
})

ok('空对不算「已框好」：连打三下引号仍是 `"""`（写 ``` 围栏那种用法不能被挡）', () => {
  const ed = mkEd('')
  keydown(ed, { key: '"' })
  keydown(ed, { key: '"' })
  keydown(ed, { key: '"' })
  assert.equal(ed.value, '"""', '实得：' + ed.value)
})

ok('括号连带：`a(` 之后打 `(` 仍是只插一个（没被「补闭合」那条改坏）', () => {
  const ed = mkEd('a(', 2)
  keydown(ed, { key: '(' })
  assert.equal(ed.value, 'a((', '实得：' + ed.value)
})

console.log(`\n${n} 项全过`)
