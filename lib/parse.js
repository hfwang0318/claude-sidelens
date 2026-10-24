// Parsing helpers for the side agent's reply and the /plugin off command.

import {
  ANSWERS,
  CLEARED_BY,
  ENDS_A_SENTENCE,
  ENDS_WITH_QUESTION,
  EXPLAINED_OUTCOMES,
  EXPLAIN_DIRECTIONS,
  EXPLAIN_LABEL,
  HEADS_UP,
  INLINE_TAG,
  LEARN_LABEL,
  LEFT_BY,
  MAX_CAPTION_LENGTH,
  MAX_CARDS,
  MAX_LINE_WIDTH,
  MAX_SKETCH_LINES,
  MAX_SKETCH_WIDTH,
  MAX_TITLE_WIDTH,
  OFF_VIA,
  OPENERS,
  PLUGIN_NAME,
  PROPOSED_KINDS,
  PROPOSED_OUTCOMES,
  QUESTION_WORDS,
  TAG_LABEL,
  TAG_OPENERS,
  TITLE_LINE,
  DEFAULT_TAG,
  FENCE_LINE,
  WRAPPING_QUOTES,
} from './constants.js'
import { cleanOneLine, sliceCodePointsHead, stripControlSequences, truncateAtWordBoundary } from './text.js'

export const isDeclined = (value) =>
  value === '' || /^none\s*(?:[.!?()[\]:;,-]|$)/i.test(value)

export const withoutTrailingPeriod = (value) => value.replace(/\.+$/, '')

export function unquoted(value) {
  const trimmed = withoutTrailingPeriod(value.trim())
  const wraps = WRAPPING_QUOTES.some(
    ([open, close]) =>
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      !trimmed.slice(1, -1).includes(close),
  )
  return wraps ? withoutTrailingPeriod(trimmed.slice(1, -1).trim()) : trimmed
}

export const openingOf = (value) => unquoted(unquoted(value).replace(INLINE_TAG, ''))

export const tagOf = (value) => (HEADS_UP.test(value) ? 'Heads up' : DEFAULT_TAG)

export const tagOpener = (value) => ({
  opener: choiceOf(value === undefined ? 'none' : TAG_OPENERS[value], [
    ...Object.values(TAG_OPENERS),
    'none',
  ]),
})

export const choiceOf = (value, options) => ({ value, of: options })

function emptyCard() {
  return { title: '', lead: '', sketch: [], caption: '' }
}

export function parseExplanation(text) {
  const cards = []
  let card = emptyCard()
  let inSketch = false
  let sawFence = false

  function flush() {
    card.lead = truncateAtWordBoundary(proseOfText(card.lead), MAX_CAPTION_LENGTH)
    card.caption = truncateAtWordBoundary(proseOfText(card.caption), MAX_CAPTION_LENGTH)
    if (card.title || card.lead || card.sketch.length > 0 || card.caption) cards.push(card)
    card = emptyCard()
  }

  for (const rawLine of text.split('\n')) {
    const line = stripControlSequences(rawLine).replace(/\s+$/, '')
    if (FENCE_LINE.test(line.trim())) {
      if (!inSketch && sawFence) flush()
      inSketch = !inSketch
      sawFence = true
      continue
    }
    if (inSketch) {
      if (card.sketch.length < MAX_SKETCH_LINES) {
        card.sketch = [...card.sketch, sliceCodePointsHead(line, MAX_SKETCH_WIDTH)]
      }
      continue
    }
    const title = TITLE_LINE.exec(line.trim())
    if (title) {
      flush()
      sawFence = false
      card.title = sliceCodePointsHead(cleanOneLine(title[1] ?? title[2] ?? ''), MAX_TITLE_WIDTH)
      continue
    }
    const field = card.sketch.length === 0 && !sawFence ? 'lead' : 'caption'
    card[field] += `\n${line}`
  }
  flush()
  return cards.slice(0, MAX_CARDS)
}

function proseOfText(value) {
  return value
    .split('\n')
    .map((line) => cleanOneLine(line))
    .filter((line) => line !== '')
    .join('\n')
}

export function parseProposedLine(text) {
  const lines = text.split('\n')
  const cleaned = lines.map((line) => stripControlSequences(line).trimStart())
  const learnAt = cleaned.findIndex((line) => LEARN_LABEL.test(line.replace(/^[-*\u2022]\s+/, '')))
  const explainAt = cleaned
    .slice(learnAt + 1)
    .findIndex((line) => EXPLAIN_LABEL.test(line))
  const hasBoth = learnAt !== -1 && explainAt !== -1
  const explainLine = hasBoth ? learnAt + 1 + explainAt : -1
  const explanation = [
    (cleaned[explainLine] ?? '').replace(EXPLAIN_LABEL, ''),
    ...lines.slice(explainLine + 1),
  ]
    .join('\n')
    .trim()
  const withExplanation = hasBoth && explanation ? explanation : undefined
  const head = (hasBoth ? lines.slice(0, explainLine) : lines).map((line) =>
    cleanOneLine(stripControlSequences(line)).replace(/^[-*\u2022]\s+/, ''),
  )
  const tagLine = head.find((line) => TAG_LABEL.test(line)) ?? ''
  const tag = tagOf(tagLine.replace(TAG_LABEL, ''))

  for (const [index, line] of head.entries()) {
    if (!LEARN_LABEL.test(line)) continue
    let proposal = line.replace(LEARN_LABEL, '').trim()
    if (isDeclined(openingOf(proposal))) return { kind: 'none' }
    for (const nextLine of head.slice(index + 1)) {
      if (nextLine === '' || LEARN_LABEL.test(nextLine) || TAG_LABEL.test(nextLine) || ENDS_WITH_QUESTION.test(proposal)) break
      proposal += ` ${nextLine}`
    }
    const quoted = unquoted(proposal)
    const inline = INLINE_TAG.exec(quoted)
    const lineText = inline === null ? quoted : unquoted(quoted.slice(0, inline.index))
    const sentence = ENDS_A_SENTENCE.test(lineText) ? lineText : `${lineText}.`
    const opener = tagLine === '' && inline !== null ? tagOf(inline?.[1] ?? '') : tag
    if (sentence.length <= MAX_LINE_WIDTH) {
      return { kind: 'line', line: sentence, tag: opener, explanation: withExplanation }
    }
  }
  return { kind: 'unparsable' }
}

export function lineKind(line) {
  const tokens = (line ?? '').toLowerCase().split(/[^a-z0-9']+/)
  const head = tokens[0] ?? ''
  const verb = OPENERS.some((word) => word === head) ? head : 'other'
  const asks = tokens.findLast((token) => QUESTION_WORDS.some((word) => word === token))
  return {
    verb: choiceOf(verb, [...OPENERS, 'other']),
    asks: choiceOf(asks ?? 'none', [...QUESTION_WORDS, 'none']),
  }
}

export const clearCause = (cause) => choiceOf(cause, CLEARED_BY)
export const leftBy = (cause) => choiceOf(cause, LEFT_BY)
export const offVia = (cause) => choiceOf(cause, OFF_VIA)
export const answerChoice = (value) => choiceOf(value, ANSWERS)
export const explainedOutcome = (value) => choiceOf(value, EXPLAINED_OUTCOMES)
export const explainedDirection = (value) => choiceOf(value, EXPLAIN_DIRECTIONS)
export const proposedOutcome = (value) => choiceOf(value, PROPOSED_OUTCOMES)
export const proposedKind = (value) => PROPOSED_KINDS[value]

export function isOffCommand(text) {
  const [command, verb, target] = text.trim().split(/\s+/)
  return (
    command === '/plugin' &&
    verb === 'disable' &&
    (target === PLUGIN_NAME || (typeof target === 'string' && target.startsWith(`${PLUGIN_NAME}@`)))
  )
}

export const isComposer = (kind) => kind === 'composer' || kind === 'bridge'
