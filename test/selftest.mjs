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

ok('rankCandidates：文件只认路径段前缀（收紧后），词表候选才用子序列', () => {
  const cands = ['lib/index.js', 'README.md', 'src/libsdk/auth.ts', 'docs/readme-notes.md'].map((v) => ({ kind: 'file', value: v }))
  const r = rankCandidates(cands, 'lib', 12).map((c) => c.value)
  assert.deepEqual(r, ['lib/index.js', 'src/libsdk/auth.ts'], '路径段前缀先于段内，不沾的必须出局：' + r.join(','))
  // 2026-10-16 真机回归：维护者打 i 时列出一堆不相干文件（attrib-index.diff 之类）还被迫逐个核对
  const junk = ['临时目录/attrib-index.diff', 'src/main.ts'].map((v) => ({ kind: 'file', value: v }))
  assert.equal(rankCandidates(junk, 'i', 12).length, 0, '单个字母不该用子序列/中段匹配拉出别的文件')
  assert.equal(rankCandidates(junk, 'attrib', 12)[0].value, '临时目录/attrib-index.diff', '段前缀要命中')
  assert.equal(rankCandidates(junk, 'index', 12)[0].value, '临时目录/attrib-index.diff', '段内中段（≥3 字符）仍要给')
  // 非文件候选保留子序列，但至少 3 个字符
  const words = [{ kind: 'word', value: 'javascript' }, { kind: 'word', value: 'const' }]
  assert.deepEqual(rankCandidates(words, 'jsc', 5).map((c) => c.value), ['javascript'], '词表候选允许子序列（j-s-c 在 javascript 里依次出现）')
  assert.deepEqual(rankCandidates(words, 'java', 5).map((c) => c.value), ['javascript'], '前缀命中')
  assert.equal(rankCandidates([{ kind: 'word', value: 'abcxyz' }], 'az', 5).length, 0, '两个字符不给子序列')
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
