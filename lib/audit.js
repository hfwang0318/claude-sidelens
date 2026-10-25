// The audit layer: turn a request into checkable clauses, and turn a model
// reply into a verifiable finding.
//
// Everything here is a pure function.  The audit layer is an extension on top
// of the official "You should know" behaviour: it must not touch the official
// prompts, views, telemetry or cadence, so it lives in its own namespace and is
// off unless SIDELENS_AUDIT is set.

import { MAX_LINE_WIDTH } from './constants.js'

export const AUDIT_DIMENSIONS = ['coverage', 'claims', 'conflict']
export const AUDIT_KINDS = ['missing_clause', 'unsupported_claim', 'clause_conflict']
export const MAX_CLAUSES = 5
export const MIN_CLAUSE_CHARS = 6
export const MAX_HINT_CHARS = 120

const BULLET = /^\s*(?:[-*+\u2022]|\d+[.)]\s|\d+[.)]$)\s*/
const FENCE = /^\s*```/
const SENTENCE_END = /[.\u3002!\uFF01?\uFF1F;\uFF1B]+/
const ACKNOWLEDGEMENT =
  /^(?:ok|okay|k|thanks|thank you|continue|go on|carry on|\u597D\u7684|\u53EF\u4EE5|\u55EF|\u7EE7\u7EED|\u884C)$/i
const QUESTION_ONLY = /^[^.!?\u3002\uFF01\uFF1F]*[?\uFF1F]\s*$/

const collapse = (value) => value.replace(/[ \t\u3000]+/g, ' ').trim()

function joinable(line) {
  return line !== '' && !BULLET.test(line) && !FENCE.test(line)
}

// Split a sentence group into sentence-sized pieces.  A terminator only ends a
// sentence when what follows can start one: "calc.py" and "v1.2" stay whole,
// while Chinese punctuation ends a sentence with no space after it.
function sentencesOf(text) {
  const parts = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_END.test(text[index])) continue
    const next = text[index + 1] ?? ''
    if (next !== '' && !/\s/.test(next) && !/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(next)) continue
    parts.push(text.slice(start, index + 1))
    start = index + 1
  }
  if (start < text.length) parts.push(text.slice(start))
  return parts.map(collapse).filter((part) => part !== '')
}

// Turn one request into the clauses it promises.  Deliberately conservative:
// fewer, larger clauses beat many fragments, because a missed clause is a false
// alarm and a fragment is noise the auditor cannot judge.
export function splitClauses(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n')
  const pieces = []
  let fence = null

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (fence === null) {
        fence = [line]
        continue
      }
      fence.push(line)
      // A fenced block belongs to the sentence that introduced it.
      pieces.push({ text: fence.join('\n'), joinPrevious: true })
      fence = null
      continue
    }
    if (fence !== null) {
      fence.push(line)
      continue
    }
    if (line.trim() === '') continue
    for (const sentence of sentencesOf(line.replace(BULLET, ''))) {
      pieces.push({ text: sentence, joinPrevious: false })
    }
  }
  if (fence !== null) pieces.push({ text: fence.join('\n'), joinPrevious: true })

  const clauses = []
  for (const piece of pieces) {
    if (!piece.joinPrevious && ACKNOWLEDGEMENT.test(piece.text.replace(/[.!?\u3002\uFF01\uFF1F]+$/, ''))) {
      continue
    }
    if (piece.joinPrevious && clauses.length > 0) {
      clauses[clauses.length - 1] = collapse(`${clauses.at(-1)}\n${piece.text}`)
      continue
    }
    const previous = clauses.at(-1)
    if (previous !== undefined && previous.length < MIN_CLAUSE_CHARS) {
      clauses[clauses.length - 1] = collapse(`${previous} ${piece.text}`)
      continue
    }
    clauses.push(piece.text)
  }

  // One clause often carries two asks ("add a test and run it").  Keeping them
  // together makes a half-done clause look handled, so split on the conjunction
  // when both halves stand on their own.
  const split = []
  for (const clause of clauses.map((item) => collapse(item))) {
    const parts = clause.split(/\s+and\s+|\uFF0C\u5E76|\u5E76\u4E14/).map((part) => collapse(part))
    if (parts.length === 2 && parts.every((part) => part.length >= MIN_CLAUSE_CHARS)) split.push(...parts)
    else split.push(clause)
  }

  const kept = split
    .filter((clause) => clause.length >= MIN_CLAUSE_CHARS)
    .filter((clause) => !ACKNOWLEDGEMENT.test(clause.replace(/[.!?\u3002\uFF01\uFF1F]+$/, '')))

  return {
    clauses: kept.slice(0, MAX_CLAUSES).map((clause, index) => ({ id: index + 1, text: clause })),
    truncated: kept.length > MAX_CLAUSES,
  }
}

// A request that is only a question has nothing to cover, so the audit abstains
// rather than guessing at an unwritten requirement.
export const isQuestionOnly = (clauses) =>
  clauses.length === 0 || clauses.every(({ text }) => QUESTION_ONLY.test(text))

const dimensionEnabled = (value) => value === '1' || value === 'true' || value === 'on'

// The switches are read from the environment, so a session can turn one
// dimension on without touching the others.  SIDELENS_AUDIT is the master.
export function enabledDimensions(env) {
  const master = dimensionEnabled(env?.SIDELENS_AUDIT)
  // A per-dimension switch wins over the master, so one dimension can be turned
  // off without losing the rest, and one can be turned on without the master.
  const state = (name) => {
    const value = env?.[`SIDELENS_AUDIT_${name.toUpperCase()}`]
    return value === undefined ? undefined : dimensionEnabled(value)
  }
  return master
    ? AUDIT_DIMENSIONS.filter((name) => state(name) !== false)
    : AUDIT_DIMENSIONS.filter((name) => state(name) === true)
}

function clauseList(clauses) {
  if (clauses.length === 0) return '(the request states no checkable clause)'
  return clauses.map(({ id, text }) => `${id}. ${text}`).join('\n')
}

const TEST_WORD = /\btests?\b|测试|pytest|jest|vitest/i

// Claims worth checking are the sentences in the final message that name a test
// or a file the record touched.  Enumerating them in code is what lets the
// auditor answer one short line per item instead of writing a verdict.
export function assertionsOf(finalText, ledger) {
  const sentences = String(finalText ?? '')
    .split(/\n+|(?<=[.!?\u3002\uFF01\uFF1F])\s+/)
    .map((part) => part.replace(/^[#>*\s-]+/, '').trim())
    .filter((part) => part.length >= 8)
  const files = ledger?.files ?? []
  const out = []
  const seen = new Set()
  for (const sentence of sentences) {
    const text = sentence.length > 160 ? `${sentence.slice(0, 159)}\u2026` : sentence
    if (TEST_WORD.test(text) && !seen.has('test')) {
      seen.add('test')
      out.push({ id: `a${out.length + 1}`, kind: 'claim', subject: 'a test run', text })
      continue
    }
    const file = files.find(({ path }) => {
      const base = path.split('/').at(-1) ?? path
      return base.length > 2 && text.includes(base)
    })
    if (file !== undefined && !seen.has(file.path)) {
      seen.add(file.path)
      out.push({ id: `a${out.length + 1}`, kind: 'claim', subject: file.path, text })
    }
    if (out.length >= 4) break
  }
  return out
}

const itemLine = (item) => `${item.id}: ${item.text}`

// The same list drives the prompt and the parser, so a skipped item is visible.
export function auditItems({ clauses, assertions, dimensions }) {
  const asked = []
  if (dimensions.includes('coverage') || dimensions.includes('conflict')) {
    for (const clause of clauses) asked.push({ id: String(clause.id), kind: 'clause', text: clause.text })
  }
  if (dimensions.includes('claims')) for (const item of assertions) asked.push(item)
  return asked
}

export function buildAuditPrompt({ clauses, assertions, ledger, finalText, dimensions, language }) {
  const asked = auditItems({ clauses, assertions, dimensions })

  const rules = []
  if (dimensions.includes('coverage')) {
    rules.push('A clause is handled only when the record shows the work; a plan, a promise or a later claim is not work.')
  }
  if (dimensions.includes('claims')) {
    rules.push('A claim is unsupported when the record contradicts it, or contains no step that could have produced it.')
  }
  if (dimensions.includes('conflict')) {
    rules.push('Two clauses conflict only when they cannot both hold; say so on both lines and quote both.')
  }

  return [
    'You are auditing a finished turn. You are not the agent that did this work: you cannot act, you cannot read files, and nothing you write changes the work.',
    'Judge only against the two sections below. The conversation above is background; when it disagrees with these sections, these sections win.',
    '',
    'The request, as the person wrote it:',
    clauses.length === 0 ? '(no checkable clause)' : clauses.map((clause) => `${clause.id}. ${clause.text}`).join('\n'),
    '',
    'What the record shows was done (extracted mechanically; authoritative):',
    ledger,
    '',
    'The final message of the turn:',
    finalText === '' ? '(empty)' : finalText,
    '',
    'Answer every item below, one line each, in this order. Then one last line. Nothing else.',
    asked.map(itemLine).join('\n'),
    '',
    'Each answer line is `id: none`, `id: unclear`, `id: partly — <what is missing>`, or `id: <quotation from the record>`.',
    '- partly: the record covers some of this item and not the rest. Name what is missing.',
    '- none: nothing in the record handles this item.',
    '- unclear: the record does not let you tell. Never answer none just because you are unsure.',
    '- a quotation: copy the command, the path, or the line from the record that handles it.',
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
    '- Never invent a quotation. If it is not in the record, the answer is none or unclear.',
    '',
    'Last line:',
    `say: <one sentence in ${language ?? 'the language of the request'}, at most 30 words, naming the one thing the person should look at>`,
  ].join('\n')
}

const ITEM_LINE = /^\s*(a?\d+)\s*:\s*(.*)$/i
const SAY_LINE = /^\s*say\s*:\s*(.*)$/i

const trimTo = (value, limit) =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}\u2026`

// The format asks for `id: none`, but a model that sees a clause half done
// writes `id: <quotation> — but "run it": none`.  A gap marker anywhere on the
// line counts, and `partly` is accepted as the same signal.
const isNone = (value) =>
  /^(?:none|nothing)\b/i.test(value) ||
  /^partly\b/i.test(value) ||
  /(?:^|[\s:\uFF1A])none(?=$|[\s,.;:\u2014\uFF0C\u3002\uFF1B])/i.test(value)
const isUnclear = (value) => /^unclear\b/i.test(value)

// Words that carry no subject on their own: a clause and a summary share these
// even when they are about unrelated work.
const STOP_WORDS = new Set([
  'add', 'also', 'and', 'are', 'but', 'can', 'done', 'each', 'for', 'from', 'have', 'into', 'make',
  'must', 'not', 'please', 'should', 'sure', 'than', 'that', 'the', 'then', 'this', 'use', 'using',
  'when', 'will', 'with', 'write', 'your', 'run', 'after', 'before', 'same', 'only',
])

function subjectsOf(text) {
  const lowered = String(text ?? '').toLowerCase()
  const words = lowered
    .split(/[^a-z0-9_./-]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
  const cjk = lowered.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const bigrams = cjk.flatMap((run) => {
    const out = []
    for (let index = 0; index + 1 < run.length; index += 1) out.push(run.slice(index, index + 2))
    return out
  })
  return [...new Set([...words, ...bigrams])]
}

// A gap only counts when the turn also presented that work as done.  A clause
// nobody mentioned and no summary claimed is not a contradiction, it is just a
// detail the person did not spell out — and reporting those is what made the
// false-alarm rate 100%.
export function corroborated(clauseText, finalText) {
  const subjects = subjectsOf(clauseText)
  if (subjects.length === 0) return true
  const haystack = String(finalText ?? '').toLowerCase()
  return subjects.some((subject) => haystack.includes(subject))
}

// The verdict is computed here, not asked for.  A model that only has to answer
// one short line per item cannot hide behind a default of "none", and a reply
// that skips an item is visibly incomplete instead of silently empty.
export function parseAudit(text, asked = [], context = {}) {
  const items = []
  let say = ''
  for (const line of String(text ?? '').split('\n')) {
    const said = SAY_LINE.exec(line)
    if (said !== null) {
      say = trimTo(collapse(said[1]), MAX_LINE_WIDTH)
      continue
    }
    const match = ITEM_LINE.exec(line)
    if (match === null) continue
    const id = match[1].toLowerCase()
    const value = trimTo(collapse(match[2]), MAX_HINT_CHARS)
    if (value === '') continue
    items.push({ id, value })
  }
  if (items.length === 0) return { kind: 'unparsable' }
  if (asked.length > 0 && items.length < asked.length) {
    return { kind: 'incomplete', answered: items.length, asked: asked.length }
  }

  const of = (id) => items.find((item) => item.id === id)
  const claims = asked.filter((item) => item.kind === 'claim')
  const clauses = asked.filter((item) => item.kind === 'clause')

  const missingClaim = claims.find((item) => {
    const answer = of(item.id)
    return answer !== undefined && isNone(answer.value)
  })
  if (missingClaim !== undefined) {
    return {
      kind: 'finding',
      type: 'unsupported_claim',
      subject: missingClaim.subject,
      line: say !== '' ? say : `The record has no step behind the claim about ${missingClaim.subject}.`,
      evidence: items.filter((item) => !isNone(item.value) && !isUnclear(item.value)),
    }
  }

  const conflict = clauses.find((item) => {
    const answer = of(item.id)
    return answer !== undefined && /conflict/i.test(answer.value)
  })
  if (conflict !== undefined) {
    return {
      kind: 'finding',
      type: 'clause_conflict',
      subject: `clause ${conflict.id}`,
      line: say !== '' ? say : `Clause ${conflict.id} cannot be satisfied alongside another clause.`,
      evidence: items.filter((item) => !isNone(item.value) && !isUnclear(item.value)),
    }
  }

  const clauseText = (id) => context.clauses?.find((clause) => String(clause.id) === id)?.text ?? ''
  const missingClause = clauses.find((item) => {
    const answer = of(item.id)
    if (answer === undefined || !isNone(answer.value)) return false
    if (typeof context.finalText !== 'string') return true
    return corroborated(clauseText(item.id), context.finalText)
  })
  if (missingClause !== undefined) {
    return {
      kind: 'finding',
      type: 'missing_clause',
      subject: `clause ${missingClause.id}`,
      line: say !== '' ? say : `Clause ${missingClause.id} was never attempted.`,
      evidence: items.filter((item) => !isNone(item.value) && !isUnclear(item.value)),
    }
  }

  return { kind: 'none', items }
}
