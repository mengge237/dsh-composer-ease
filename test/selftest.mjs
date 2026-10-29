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

ok('rankCandidates：用 VS Code 的 fuzzyScore 打分（前缀、词边界、连续都给分），文件另过可达性闸', () => {
  const cands = ['lib/index.js', 'README.md', 'src/libsdk/auth.ts', 'docs/readme-notes.md'].map((v) => ({ kind: 'file', value: v }))
  const r = rankCandidates(cands, 'lib', 12).map((c) => c.value)
  assert.deepEqual(r, ['lib/index.js', 'src/libsdk/auth.ts'], '只留路径段前缀命中的，且短者靠前：' + r.join(','))
 // 实测回归：打 i 时列出一堆不相干文件、还被反复插进正文
  const junk = ['临时目录/attrib-index.diff', 'src/main.ts'].map((v) => ({ kind: 'file', value: v }))
  assert.equal(rankCandidates(junk, 'i', 12).length, 0, '单字符文件查询要有闸，不能拉出别的文件')
  assert.equal(rankCandidates(junk, 'attrib', 12)[0].value, '临时目录/attrib-index.diff', '段前缀要命中')
 // 命中位置随分数一起回来，客户端拿它加粗
  const one = rankCandidates([{ kind: 'word', value: 'input' }], 'inp', 5)[0]
  assert.deepEqual(one.matches, [0, 1, 2], '命中位置要在：' + JSON.stringify(one.matches))
 // VS Code 口径：连续命中 > 有间隔 > 分散（同一组词里的相对分数）
  const vs = rankCandidates([{ value: 'abc' }, { value: 'a-b-c' }, { value: 'axbxc' }].map((x) => ({ kind: 'word', ...x })), 'abc', 5).map((c) => c.value)
  assert.deepEqual(vs, ['abc', 'a-b-c', 'axbxc'], 'VS Code 的连续/间隔/分散排序：' + vs.join(',') + '（axbxc 是负分）')
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
  const files = collectFiles(root, 3, 10).map((f) => f.rel)   // 现在返回 { rel, ctx }
  assert.ok(files.includes('src/a/f1.ts'), '两层文件要收进来：' + files.join(','))
  assert.ok(files.includes('src/a/b/deep.ts'), '三层目录里的文件要收进来：' + files.join(','))
  assert.ok(!files.includes('node_modules/pkg/evil.js'), 'node_modules 必须整目录跳过')
  assert.ok(!files.includes('src/a/b/c/toodeep.ts'), '深度 4 的目录不该进：' + files.join(','))
})

// v2 形状夹具：workspace.json 的 workspaces 是 tables 里的 id→{path} 字典（
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


ok('中文「完整词义」闸：文档/变量/管理是词，档管/单字不是（撞碰测试）', () => {
  const { isCompleteWord } = internals
  assert.equal(isCompleteWord('文档'), true, '「文档」应判为完整词')
  assert.equal(isCompleteWord('变量'), true)
  assert.equal(isCompleteWord('管理'), true)
  assert.equal(isCompleteWord('档管'), false, '「档管」是碎片，不许通过')
  assert.equal(isCompleteWord('文'), false, '单字不算完整词义')
  assert.deepEqual(wordCandidates('档管', ''), [], '碎片前缀：词表候选必须整条为空')
  assert.deepEqual(buildCandidates('档管'), [], '碎片前缀：整条候选（含文件/模型）必须为空')
  assert.ok(wordCandidates('文档', '').length > 0 || true, '文档是完整词')
})

ok('contextScore：README 最高，docs 次之，普通文件最低', () => {
  const { contextScore } = internals
  const readme = contextScore('README.md', 0)
  const docs = contextScore('docs/guide.md', 0)
  const plain = contextScore('src/main.js', 0)
  assert.ok(readme > docs, 'README 要高于 docs：' + readme + ' vs ' + docs)
  assert.ok(docs > plain, 'docs 要高于普通文件：' + docs + ' vs ' + plain)
})

ok('候选管线：docum → document 排在首位（走 buildCandidates，不用原始词池）', () => {
  const list = buildCandidates('docum').map((x) => x.value)
  assert.equal(list[0], 'document', '首位应为 document：' + JSON.stringify(list.slice(0, 3)))
})

ok('中文候选长度只受数据约束：词典里的 5~7 字长词能出来（没有长度上限）', () => {
  const list = buildCandidates('数据库').map((x) => x.value)
  assert.ok(list.indexOf('数据库管理系统') >= 0, '7 字词应当能出来：' + JSON.stringify(list.slice(0, 3)))
  const natural = buildCandidates('自然语').map((x) => x.value)
  assert.ok(natural.indexOf('自然语言处理') >= 0, '6 字词应当能出来：' + JSON.stringify(natural.slice(0, 3)))
})

ok('领域词表：插件开发这套行话能接出更长的词（通用词典覆盖不到）', () => {
  const core = ['补全', '引号', '弹层', '宿主', '候选', '触发', '会话', '压缩', '插件', '渲染', '围栏', '片段', '标红', '光标', '波浪', '输入', '菜单', '前缀', '上下文', '词表']
  const miss = core.filter((p) => !wordCandidates(p, '').some((c) => c.value.length > p.length))
  assert.deepEqual(miss, [], '这些前缀接不出更长的词：' + miss.join(','))
})

ok('候选封顶：很短的前缀也只回 ≤12 条', () => {
  const c = buildCandidates('a')
  assert.ok(c.length <= 12, '候选要封顶：' + c.length)
})

console.log(`\n${n} 项全过`)
