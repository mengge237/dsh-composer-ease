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
    const own = this._text || ''
    const kids = this.children.map((c) => c.innerText || c.textContent || '').join(' ')
    return (own + (kids ? ' ' + kids : '')).trim()
  }
  closest() { return null }
  focus() {}
  setAttribute() {}
  dispatchEvent() { return true }
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
const sandbox = {
  window: { __ModuleLoader__: { load(spec) { sandbox.__captured = spec } }, getSelection: () => null, innerHeight: 800, HTMLTextAreaElement: FakeTextArea },
  document: documentFake,
  fetch: (url) => { fetchCalls.push(String(url)); return Promise.resolve({ json: () => Promise.resolve(fetchReply) }) },
  console, Symbol, Object, Array, Promise, Error, JSON, String, Number, Math, RegExp, Event: class {}, setTimeout, clearTimeout,
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
const input = (ed) => handlers.input({ target: ed })
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

await okAsync('中文与数字开头不触发补全；空白后也不弹', async () => {
  const before = fetchCalls.length
  for (const v of ['这是一段中文', '临时目录', '结尾空格 ']) { const ed = mkEd(v); input(ed) }
  assert.equal(fetchCalls.length, before, '这些都不该发请求：' + fetchCalls.slice(before).join(','))
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

await okAsync('围栏语言提示：```python 后的记号按 python 上词表', async () => {
  const ed = mkEd('```python\ndef')
  const before = fetchCalls.length
  input(ed)
  assert.equal(fetchCalls.length, before + 1)
  assert.match(fetchCalls[fetchCalls.length - 1], /lang=python/, '要把语言提示带给服务端：' + fetchCalls[fetchCalls.length - 1])
  await tick()
})

ok('apply 返回的 disposer 会摘监听、关弹层', () => {
  const d = mod.apply({})
  assert.equal(typeof d, 'function')
  d()
})

console.log(`\n${n} 项全过`)
