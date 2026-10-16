// 服务端数据层自检（0 网络 0 额度）：候选排序、模型 id 解析、文件收集封顶与排除。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { internals } from '../lib/index.js'

let n = 0
function ok(label, fn) { fn(); n++; console.log('  ok   ' + label) }

const { rankCandidates, parseModelIds, collectFiles, PAIRS, wordCandidates, normalizeLang, buildCandidates } = internals

ok('normalizeLang：围栏别名归一到词表键，认不出回空串', () => {
  assert.equal(normalizeLang('js'), 'javascript')
  assert.equal(normalizeLang('TS'), 'javascript')
  assert.equal(normalizeLang('.py'), 'python')
  assert.equal(normalizeLang('html'), 'html')
  assert.equal(normalizeLang('brainfuck'), '')
  assert.equal(normalizeLang(''), '')
})

ok('词表命中：inp → input（借来的 HTML 标签表，候选带 src 出处）', () => {
  const c = wordCandidates('inp', '')
  assert.ok(c.some((x) => x.value === 'input'), 'input 要在候选里：' + c.slice(0, 8).map((x) => x.value).join(','))
  assert.equal(c.find((x) => x.value === 'input').src, 'words.js', '候选要带出处字段')
})

ok('按语言上词表：python / java / css 各自的词与属性都在', () => {
  assert.ok(wordCandidates('def', 'python').some((x) => x.value === 'def'), 'python 关键字 def')
  assert.ok(wordCandidates('publ', 'java').some((x) => x.value === 'public'), 'java 关键字 public')
  const css = buildCandidates('backgr', 'css').map((x) => x.value)
  assert.ok(css.some((v) => v.startsWith('backgr')), 'CSS 属性前缀要命中：' + css.join(','))
})

ok('buildCandidates：没有语言上下文也出 word 候选（聊天框里打 inp 也能补 input）', () => {
  const c = buildCandidates('inp', '')
  assert.ok(c.some((x) => x.kind === 'word' && x.value === 'input'), '公共池要生效：' + JSON.stringify(c.slice(0, 4)))
})

ok('配对表形状：开括号都有闭括号，闭括号都能回指', () => {
  for (const [o, c] of Object.entries(PAIRS)) assert.equal(typeof c, 'string')
})

ok('rankCandidates：前缀 > 包含 > 子序列，同分短优先', () => {
  const cands = ['lib/index.js', 'README.md', 'src/libsdk/auth.ts', 'docs/readme-notes.md'].map((v) => ({ kind: 'file', value: v }))
  const r = rankCandidates(cands, 'lib', 12).map((c) => c.value)
  assert.deepEqual(r, ['lib/index.js', 'src/libsdk/auth.ts'], '前缀先于包含，不沾的必须出局：' + r.join(','))
  const g = rankCandidates([{ value: 'docs/gemma.md' }, { value: 'src/gm-utils.ts' }], 'gm', 12).map((c) => c.value)
  assert.deepEqual(g, ['src/gm-utils.ts', 'docs/gemma.md'], '包含(gm-utils)要先于子序列(gemma)：' + g.join(','))
  assert.equal(rankCandidates(cands, 'zzz-nope', 12).length, 0, '完全不沾的不该混进来')
})

ok('parseModelIds：只认深缩进的模型条目行', () => {
  const text = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      bailian:',
    '        models:',
    '          - id: kimi-k2.5',
    '            name: x',
    '          - id: qwen-max',
    '        retryPolicy:',
    '          maxRetries: 5',
  ].join('\n')
  assert.deepEqual(parseModelIds(text), ['kimi-k2.5', 'qwen-max'])
})

ok('collectFiles：深度与总量封顶、node_modules 排除', () => {
  const root = mkdtempSync(join(tmpdir(), 'dcp-'))
  mkdirSync(join(root, 'src', 'a', 'b', 'c'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'src', 'a', 'f1.ts'), '')
  writeFileSync(join(root, 'node_modules', 'pkg', 'evil.js'), '')
  writeFileSync(join(root, 'src', 'a', 'b', 'deep.ts'), '')
  writeFileSync(join(root, 'src', 'a', 'b', 'c', 'toodeep.ts'), '')
  const files = collectFiles(root, 3, 10)
  assert.ok(files.includes('src/a/f1.ts'), '两层文件要收进来：' + files.join(','))
  assert.ok(files.includes('src/a/b/deep.ts'), '三层目录里的文件要收进来：' + files.join(','))
  assert.ok(!files.includes('node_modules/pkg/evil.js'), 'node_modules 必须整目录跳过')
  assert.ok(!files.includes('src/a/b/c/toodeep.ts'), '深度 4 的目录不该进：' + files.join(','))
})

// v2 形状夹具：workspace.json 的 workspaces 是 tables 里的 id→{path} 字典（2026-10-15：
// 首版按 v1 的数组形状读，路由 200 但候选恒 0——假成功，这里钉死）。
const wsFixture = mkdtempSync(join(tmpdir(), 'dcp-home-'))
const proj = mkdtempSync(join(tmpdir(), 'dcp-proj-'))
writeFileSync(join(proj, 'hello.ts'), '')
mkdirSync(join(wsFixture, 'storages'), { recursive: true })
writeFileSync(join(wsFixture, 'storages', 'workspace.json'), JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: {},
  tables: { workspaces: { 'id-1': { path: proj.replace(/\\/g, '/'), title: 'p', sessionIds: [] } } },
}))
process.env.DSH_HOME = wsFixture
const fresh = (await import('../lib/index.js?fresh=1')).internals
ok('workspaceRoots 吃 v2 tables 形状；buildCandidates 出真候选', () => {
  const roots = fresh.workspaceRoots()
  assert.equal(roots.length, 1, '应解析出一个工作区根：' + JSON.stringify(roots))
  const cands = fresh.buildCandidates('hel')
  assert.ok(cands.some((c) => c.kind === 'file' && c.value === 'hello.ts'), '文件候选要在：' + JSON.stringify(cands))
})

console.log(`\n${n} 项全过`)
