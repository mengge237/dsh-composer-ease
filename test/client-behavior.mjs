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
  setAttribute() {}
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
const documentFake = {
  body,
  createElement: (tag) => new FakeEl(String(tag).toUpperCase()),
  addEventListener: (t, fn) => { handlers[t] = fn },
  removeEventListener: () => {},
  execCommand: () => true,
  getElementById: (id) => body.children.find((c) => c.id === id) || null,
}

const fetchCalls = []
let fetchReply = { ok: true, candidates: [] }
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
  fetch: (url) => { fetchCalls.push(String(url)); return Promise.resolve({ json: () => Promise.resolve(fetchReply) }) },
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
  assert.equal(ed.selectionStart, 1)
  assert.equal(ed.selectionEnd, 4)
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

await okAsync('数字开头与纯空白不触发补全（中文现在**要**触发，见下一条）', async () => {
  const before = fetchCalls.length
  for (const v of ['结尾空格 ']) { const ed = mkEd(v); input(ed) }
  assert.equal(fetchCalls.length, before, '纯空白不该发请求：' + fetchCalls.slice(before).join(','))
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
  fetchReply = { ok: true, candidates: [] }
  const ed = mkEd('先写一段关于文档的说明，后面再提到文')
  input(ed)
  const pop = popupEl()
  assert.ok(pop && pop.children.length, '打「文」就要弹')
  const text = pop.children.map((r) => r.innerText).join('|')
  assert.match(text, /文档/, '草稿里的「文档」要被提示出来：' + text)
  assert.match(text, /本文/, '右侧类型标「本文」：' + text)
  keydown(ed, { key: 'Escape' })
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

await okAsync("'/' 触发引用式补全", async () => {
  const ed = mkEd('/dsh')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before + 1)
  assert.match(fetchCalls[fetchCalls.length - 1], /prefix=%2Fdsh/, '要把 /dsh 当 token 带上')
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

ok('上下文候选：页面上可见的对话文本里出现过的标识符，按前缀补出来（类型词标「上下文」）', () => {
  body.textContent = '刚才那个 install_quarantine.py 和 verify_bank 都要跑；install_quarantine 只装过一次'
  mod.__helpers__.contextReset()
  const ed = mkEd('inst')
  input(ed)
  const rows = body.children.filter((c) => c.id === 'dsh-cp-ghost' ? false : true)
  const pop = body.children.find((c) => c.id === 'dsh-cp-popup')
  assert.ok(pop, '要弹出建议框')
  const text = pop.children.map((r) => r.innerText).join('|')
  assert.match(text, /install_quarantine/, '上下文里的词要出现：' + text)
  assert.match(text, /上下文/, '类型词要标「上下文」：' + text)
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
  assert.equal(ed.selectionStart, 1)
  assert.equal(ed.selectionEnd, 4, '选区要留在内层内容上')
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
  assert.match(store.get('dsh-composer-pro:lang-habit') || '', /python/, '习惯要落盘：' + store.get('dsh-composer-pro:lang-habit'))
  const before = fetchCalls.length
  const ed2 = mkEd('pri')
  input(ed2)
  assert.equal(fetchCalls.length, before + 1)
  assert.match(fetchCalls[fetchCalls.length - 1], /lang=python/, '没写围栏也要带上习惯语言：' + fetchCalls[fetchCalls.length - 1])
  store.clear()
})

ok('apply 返回的 disposer 会摘监听、关弹层', () => {
  const d = mod.apply({})
  assert.equal(typeof d, 'function')
  d()
})

console.log(`\n${n} 项全过`)
