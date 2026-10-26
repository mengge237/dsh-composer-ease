// dsh-composer-ease —— 英文常用词表 + 「完整英文词」判据（对齐 cjk-lexicon.js 的接口）。
//
// 为什么要有这一件：中文侧靠 `isCompleteWord()` 把「文档」与「档管」这类碎片分开，
// 英文侧一直没有对应物 —— 只有 words.js 的关键字表，没有英文词，也没有「这个词是不是一个词」的判据。
//
// 与中文的关键差别（别照搬中文的「碎片清零」）：
//   中文：单字/碎片**不给**候选（给了也是噪声，因为中文靠输入法选词）。
//   英文：前缀**正是**补全的用法（`docum` → `document`），所以英文不做清零，
//         只做两件事：① 补出以它为前缀的词；② 「它本身已经是一个完整的词」时加分、排前面。
//
// 数据来源（零新增依赖、零新增许可证）：
//   - words.js 里已有的关键字表（LANG_WORDS / HTML_ATTRS / CSS_* / COMMON_WORDS）全部并入；
//   - 另加一小撮开发语境里最常用的英文词（见下面 CURATED，都是自己手写的，没有外部来源）。
// 想扩到真正的英文词表（SCOWL / wordfreq / an-array-of-english-words）时，照 CJK 那套做法：
// 生成脚本 + 只留 3-12 字符 + 按词频前 N，并把 repo / license / file / kept 写进
// `EN_LEXICON_SOURCE` 与 THIRD-PARTY.md，别把整本词典直接塞进仓库。

import { LANG_WORDS, HTML_ATTRS, CSS_PSEUDO, CSS_AT_RULES, COMMON_WORDS } from './words.js'

/** 手写的开发语境常用词（不是外部词表，因此不产生许可证义务）。 */
const CURATED = [
  'about', 'above', 'accept', 'access', 'across', 'action', 'active', 'actual', 'add', 'added',
  'after', 'again', 'against', 'agent', 'agree', 'allow', 'already', 'always', 'answer', 'any',
  'appear', 'apply', 'argue', 'argument', 'around', 'assume', 'attach', 'available', 'avoid', 'back',
  'base', 'basic', 'because', 'become', 'before', 'begin', 'behind', 'belong', 'below', 'best',
  'better', 'between', 'block', 'body', 'both', 'break', 'bring', 'build', 'built', 'cache',
  'call', 'came', 'cannot', 'case', 'cause', 'center', 'certain', 'change', 'check', 'choose',
  'class', 'clean', 'clear', 'click', 'client', 'close', 'code', 'collect', 'come', 'command',
  'comment', 'common', 'complete', 'config', 'confirm', 'connect', 'consider', 'contain', 'content', 'context',
  'control', 'convert', 'copy', 'correct', 'could', 'count', 'cover', 'create', 'current', 'custom',
  'data', 'debug', 'decide', 'default', 'delete', 'depend', 'deploy', 'describe', 'detail', 'detect',
  'device', 'differ', 'direct', 'disable', 'display', 'document', 'done', 'double', 'down', 'drop',
  'each', 'early', 'edit', 'effect', 'either', 'element', 'empty', 'enable', 'end', 'enough',
  'enter', 'entry', 'error', 'even', 'event', 'every', 'exact', 'example', 'except', 'exist',
  'expect', 'explain', 'export', 'extend', 'extra', 'fail', 'false', 'fetch', 'field', 'figure',
  'file', 'fill', 'filter', 'final', 'find', 'first', 'fixed', 'flag', 'follow', 'force',
  'form', 'format', 'found', 'frame', 'free', 'from', 'full', 'function', 'general', 'generate',
  'given', 'global', 'good', 'group', 'grow', 'handle', 'have', 'header', 'help', 'here',
  'hidden', 'hide', 'high', 'highlight', 'hold', 'hook', 'host', 'however', 'idea', 'ignore',
  'image', 'import', 'index', 'info', 'init', 'inline', 'input', 'insert', 'inside', 'install',
  'instance', 'instead', 'item', 'join', 'just', 'keep', 'key', 'kind', 'known', 'label',
  'large', 'last', 'later', 'launch', 'layer', 'layout', 'leave', 'left', 'length', 'less',
  'level', 'light', 'like', 'limit', 'line', 'link', 'list', 'live', 'load', 'local',
  'lock', 'log', 'logic', 'look', 'loop', 'lower', 'main', 'make', 'manage', 'many',
  'mark', 'match', 'matter', 'maybe', 'mean', 'measure', 'merge', 'message', 'method', 'middle',
  'might', 'mode', 'model', 'modify', 'more', 'most', 'mount', 'move', 'much', 'must',
  'name', 'need', 'never', 'next', 'node', 'none', 'normal', 'note', 'notice', 'null',
  'number', 'object', 'offer', 'offset', 'often', 'once', 'only', 'open', 'option', 'order',
  'other', 'output', 'over', 'owner', 'pack', 'page', 'pair', 'param', 'parent', 'parse',
  'part', 'pass', 'path', 'pattern', 'pause', 'people', 'perform', 'pick', 'place', 'plan',
  'please', 'point', 'popup', 'position', 'possible', 'power', 'prefix', 'prepare', 'present', 'press',
  'prevent', 'previous', 'print', 'problem', 'process', 'produce', 'project', 'promise', 'proper', 'property',
  'protect', 'provide', 'public', 'pull', 'push', 'put', 'query', 'quick', 'quite', 'raise',
  'range', 'rate', 'read', 'ready', 'real', 'reason', 'receive', 'record', 'reduce', 'refer',
  'refresh', 'register', 'reload', 'remain', 'remove', 'render', 'repeat', 'replace', 'reply', 'report',
  'request', 'require', 'reset', 'resolve', 'resource', 'response', 'rest', 'result', 'resume', 'retry',
  'return', 'review', 'right', 'role', 'root', 'round', 'route', 'rule', 'run', 'safe',
  'same', 'save', 'scale', 'scan', 'schedule', 'scope', 'screen', 'script', 'scroll', 'search',
  'second', 'section', 'select', 'send', 'separate', 'serialize', 'server', 'service', 'session', 'set',
  'setting', 'setup', 'several', 'share', 'shift', 'short', 'should', 'show', 'side', 'signal',
  'simple', 'since', 'single', 'size', 'skip', 'slice', 'slide', 'slow', 'small', 'some',
  'sort', 'source', 'space', 'span', 'spec', 'split', 'stack', 'start', 'state', 'static',
  'stay', 'step', 'still', 'stop', 'store', 'string', 'strip', 'style', 'submit', 'such',
  'support', 'sure', 'switch', 'sync', 'system', 'table', 'take', 'talk', 'target', 'task',
  'tell', 'template', 'test', 'text', 'than', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'thing', 'think', 'this', 'those', 'though', 'three', 'through', 'throw',
  'time', 'title', 'toggle', 'token', 'tool', 'top', 'total', 'touch', 'trace', 'track',
  'transform', 'tree', 'trigger', 'trim', 'true', 'try', 'turn', 'type', 'under', 'until',
  'update', 'upload', 'upper', 'usage', 'use', 'user', 'valid', 'value', 'variable', 'verify',
  'version', 'very', 'view', 'virtual', 'visible', 'visit', 'wait', 'walk', 'want', 'watch',
  'weak', 'well', 'were', 'what', 'when', 'where', 'whether', 'which', 'while', 'white',
  'whole', 'wide', 'will', 'window', 'with', 'within', 'without', 'word', 'work', 'world',
  'would', 'wrap', 'write', 'wrong', 'year', 'yield', 'your', 'zero',
]

/** 词表：关键字表 + 手写常用词，统一小写；只留 2-24 字符的纯字母词。 */
export const EN_LEXICON = new Set(
  [...CURATED,
   ...Object.values(LANG_WORDS).flat(),
   HTML_ATTRS, CSS_PSEUDO, CSS_AT_RULES, COMMON_WORDS]
    .map((w) => String(w || '').toLowerCase())
    .filter((w) => /^[a-z][a-z-]{1,23}$/.test(w)),
)

/** 以 prefix 开头的英文词（前缀匹配）。短的排前面 —— 补全的目标通常是把词打完，不是找最长的那个。 */
export function enMatches(prefix, cap) {
  const p = String(prefix || '').toLowerCase()
  if (p.length < 2) return []
  const out = []
  for (const w of EN_LEXICON) {
    if (w.length > p.length && w.startsWith(p)) out.push(w)
  }
  out.sort((a, b) => (a.length - b.length) || (a < b ? -1 : 1))
  return out.slice(0, cap || 8)
}

/** prefix 本身是不是一个完整的英文词（用来给「已经打完的词」加分，**不做清零闸**）。 */
export function isCompleteEnWord(prefix) {
  const p = String(prefix || '').toLowerCase()
  return p.length >= 2 && EN_LEXICON.has(p)
}

/** prefix 是不是某个英文词的真前缀（用来判断「还差几个字母就成词」）。 */
export function isWordPrefix(prefix) {
  const p = String(prefix || '').toLowerCase()
  if (p.length < 2) return false
  for (const w of EN_LEXICON) if (w.length > p.length && w.startsWith(p)) return true
  return false
}

export const EN_LEXICON_SOURCE = {
  built: 'words.js 关键字表 + 手写常用词（本仓自有，无外部来源）',
  license: 'none',
  size: EN_LEXICON.size,
  note: '要换成真正的英文词表（SCOWL / wordfreq / an-array-of-english-words）时，照 cjk-lexicon.js 生成脚本的做法，只留 3-12 字符、按词频前 N，并把 repo/license/file/kept 记进这里与 THIRD-PARTY.md。',
}

export function enLexiconSize() { return EN_LEXICON.size }
