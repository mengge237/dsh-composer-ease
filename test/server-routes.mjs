// 服务端半边端到端：拿假 ctx（假 webServer）把两条路由真跑一遍，验信任栅栏、方法闸、载荷形状与词表命中。
// 跑法：node test/server-routes.mjs
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

let n = 0
function ok(label, fn) { fn(); n++; console.log('  ok   ' + label) }

const routes = []
const ctx = { webServer: { register(r) { routes.push(r); return () => {} } }, effect(fn) { fn() } }
apply(ctx)

function call(path, { method = 'GET', host = '127.0.0.1:3080', origin } = {}) {
  const route = routes.find((r) => r.path === path.split('?')[0])
  if (!route) throw new Error('no route for ' + path)
  const out = { code: 0, headers: null, body: null }
  const res = { writeHead(c, h) { out.code = c; out.headers = h }, end(b) { out.body = b } }
  const req = { method, url: path, headers: { host, ...(origin ? { origin } : {}) } }
  route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(out.body) } catch {}
  return { ...out, json: parsed }
}

ok('注册了两条路由，路径与 kind 符合预期', () => {
  const paths = routes.map((r) => r.path).sort()
  assert.deepEqual(paths, ['/dsh-composer-ease/config.json', '/dsh-composer-ease/words'])
  assert.ok(routes.every((r) => r.kind === 'exact'))
})

ok('信任栅栏：loopback 放行，非本机 Host / 跨站 Origin 一律 403', () => {
  assert.equal(call('/dsh-composer-ease/config.json', { origin: 'http://127.0.0.1:3080' }).code, 200)
  assert.equal(call('/dsh-composer-ease/config.json', { host: 'localhost:3080' }).code, 200)
  assert.equal(call('/dsh-composer-ease/config.json', { host: '10.0.0.5:3080' }).code, 403, '非 loopback Host 必须拒')
  assert.equal(call('/dsh-composer-ease/config.json', { origin: 'http://evil.example' }).code, 403, '跨站 Origin 必须拒')
  assert.equal(call('/dsh-composer-ease/config.json', { origin: 'not-a-url' }).code, 403, '坏 Origin 也要拒')
})

ok('方法闸：POST 回 405，GET 回 200', () => {
  assert.equal(call('/dsh-composer-ease/config.json', { method: 'POST' }).code, 405)
  assert.equal(call('/dsh-composer-ease/words?prefix=in', { method: 'POST' }).code, 405)
})

ok('config.json：版本、词表规模与**借用出处**都在，响应不带缓存', () => {
  const r = call('/dsh-composer-ease/config.json')
  assert.equal(r.code, 200)
  assert.equal(r.json.version, '0.2.0')
  assert.ok(r.json.wordStats && typeof r.json.wordStats.html === 'number', '词表规模要在：' + JSON.stringify(r.json.wordStats))
  assert.ok(r.json.wordStats.html >= 100, 'html 标签数应上百：' + r.json.wordStats.html)
  assert.ok(r.json.wordStats.css >= 500, 'CSS 属性数应上百：' + r.json.wordStats.css)
  assert.ok(Array.isArray(r.json.sources) && r.json.sources.length >= 4, '出处要有 4 条以上')
  for (const s of r.json.sources) {
    assert.ok(/^https:\/\/github\.com\//.test(s.repo), '出处必须是仓库地址：' + s.repo)
    assert.ok(s.license && s.commit && s.what, '出处要带许可证、commit、取用内容：' + JSON.stringify(s))
  }
  assert.match(r.headers['Cache-Control'], /no-store/, '补全数据不该被缓存')
})

ok('words 路由：inp → input（公共池），lang 认得出就上该语言词表', () => {
  const a = call('/dsh-composer-ease/words?prefix=inp')
  assert.equal(a.code, 200)
  assert.equal(a.json.lang, '', '没给 lang 时如实回空串')
  assert.ok(a.json.candidates.some((c) => c.value === 'input'), '公共池要能补 input：' + JSON.stringify(a.json.candidates.slice(0, 5)))
  const b = call('/dsh-composer-ease/words?prefix=def&lang=python')
  assert.equal(b.json.lang, 'python', '别名要归一')
  assert.ok(b.json.candidates.some((c) => c.value === 'def'), 'python 词表要命中 def')
  const c = call('/dsh-composer-ease/words?prefix=backgr&lang=css')
  assert.ok(c.json.candidates.some((v) => v.value.startsWith('backgr')), 'CSS 属性前缀要命中')
  const d = call('/dsh-composer-ease/words?prefix=inp&lang=nosuchlang')
  assert.equal(d.json.lang, '', '认不出的语言按空串回，但仍上公共池')
  assert.ok(d.json.candidates.some((x) => x.value === 'input'))
})

ok('words 路由：没给 prefix 也给候选（列表封顶 ≤12），坏 URL 不炸', () => {
  const a = call('/dsh-composer-ease/words')
  assert.equal(a.code, 200)
  assert.ok(a.json.candidates.length <= 12, '候选要封顶：' + a.json.candidates.length)
  assert.ok(a.json.candidates.length > 0, '空前缀也该有候选（公共池 + 文件/模型）')
})

console.log(`\n${n} 项全过`)
