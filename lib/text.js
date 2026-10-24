// String and terminal-width helpers.
//
// Behaviour matches Claude Code 2.1.308's built-in "You should know" mod.

import {
  DEBUG_ON_WORDS,
  MAX_LINE_WIDTH,
  NARROW_BOUNDS,
  OFFER_MARGIN_ROWS,
  STAR_CELLS,
  WIDE_FROM,
  WRAP_RESERVE_CELLS,
} from './constants.js'

export const isDebugOn = (value) =>
  value !== undefined && DEBUG_ON_WORDS.includes(value.trim().toLowerCase())

export const debugFlagOf = (promise) => promise.then(isDebugOn).catch(() => false)

export const isExternalUser = (value) => value === 'external'

export function stripControlSequences(value) {
  const ansi = new RegExp(
    String.raw`[\u001B\u009B][[\]()#;?]*` +
      String.raw`(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*` +
      String.raw`|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?` +
      String.raw`(?:\u0007|\u001B\u005C|\u009C))` +
      String.raw`|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))`,
    'g',
  )
  return value
    .replace(/\p{Cs}/gu, '')
    .replace(ansi, '')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
}

export const cleanOneLine = (value) =>
  value
    .replace(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export function sliceCodePointsHead(value, length) {
  if (length <= 0) return ''
  return value.length <= length ? value : value.slice(0, length).replace(/[\uD800-\uDBFF]$/, '')
}

export function truncateAtWordBoundary(value, length) {
  if (value.length <= length) return value
  const head = sliceCodePointsHead(value, length - 1)
  const boundary = head.search(/\s\S*$/)
  const word = boundary !== -1 ? head.slice(0, boundary).trimEnd() : ''
  return `${word.length > length / 2 ? word : head.trimEnd()}\u2026`
}

export const proseOf = (value) =>
  value
    .split('\n')
    .map((line) => cleanOneLine(line))
    .filter((line) => line !== '')
    .join('\n')

export function glyphWidth(codePoint) {
  const { hangulJamo, punctuation, arrows, shapes, mediumSmallSquares } = NARROW_BOUNDS
  return codePoint < hangulJamo ||
    (codePoint >= punctuation.first && codePoint <= punctuation.last) ||
    (codePoint >= arrows.first && codePoint <= arrows.last) ||
    (codePoint >= shapes.first &&
      codePoint <= shapes.last &&
      codePoint !== mediumSmallSquares.white &&
      codePoint !== mediumSmallSquares.black)
    ? 1
    : 2
}

export function lineCellsAtMost(value) {
  let cells = 0
  for (const character of value) cells += glyphWidth(character.codePointAt(0) ?? 0)
  return cells
}

export function truncateToCells(value, columns) {
  if (lineCellsAtMost(value) <= columns) return value
  let cells = 0
  let head = ''
  for (const character of value) {
    cells += glyphWidth(character.codePointAt(0) ?? 0)
    if (cells > columns - 1) return `${head}\u2026`
    head += character
  }
  return head
}

export function cellsAtMost(value) {
  let cells = 0
  for (const character of value) cells += (character.codePointAt(0) ?? 0) >= WIDE_FROM ? 2 : 1
  return cells
}

export function wrapRows(line, columns) {
  const width = Math.max(columns - WRAP_RESERVE_CELLS, 1)
  let rows = 0
  let used = 0
  for (const word of line.split(' ').filter((part) => part !== '')) {
    const cells = cellsAtMost(word)
    if (used === 0 || used + 1 + cells > width) {
      rows += Math.ceil(Math.max(cells, 1) / width)
      used = cells % width === 0 ? width : cells % width
    } else {
      used += 1 + cells
    }
  }
  return rows
}

export function choicesRows({ columns, labels }) {
  const width = Math.max(columns, 1)
  let rows = 1
  let used = 0
  for (const label of labels) {
    const text = `0: ${label}`
    const cells = cellsAtMost(text) + 3
    const wraps = used > 0 && used + cells > width
    const tooWide = cells > width
    const height = tooWide ? wrapRows(text, width - 3) : 1
    const start = wraps ? 0 : used
    rows += (wraps ? 1 : 0) + height - 1
    used = tooWide ? width : start + cells
  }
  return rows
}

export const headedRows = (note, layout) =>
  OFFER_MARGIN_ROWS + wrapRows(note, layout.columns - STAR_CELLS) + choicesRows({
    ...layout,
    columns: layout.columns - 2,
  })

export const closedOfferRows = (offer) => headedRows(`${offer.tag} \xB7 ${offer.line}`, offer)

export const offerRows = (offer) => headedRows(offer.note, offer)

export function fittedCopy(layout) {
  const fits = (count) =>
    offerRows({
      ...layout,
      columns: layout.bodyColumns,
      note: layout.copy.slice(0, count)
        .map((part) => part.map((span) => span.text).join(''))
        .join(' '),
    }) <= layout.maxRows
  return layout.copy.slice(
    0,
    layout.copy
      .map((_, index) => layout.copy.length - index)
      .find(fits) ?? 0,
  )
}

export function fitCardsToColumns(cards, columns) {
  const width = Number.isFinite(columns) ? columns : 80
  return cards.map((card) => ({
    ...card,
    title: truncateToCells(card.title, Math.max(width - 2, 1)),
    sketch: card.sketch.map((line) => truncateToCells(line, Math.max(width - 2, 1))),
  }))
}

export function pageHtml(html) {
  const titleAt = html.search(/<title[\s>]/i)
  if (titleAt === -1) return null
  const fromTitle = html.slice(titleAt).replace(/```[a-z]*\s*$/i, '').trim()
  const closeAt = fromTitle.search(/<\/title>/i)
  if (closeAt === -1) return null
  const afterTitle = closeAt + 8
  return `${fromTitle.slice(0, afterTitle)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap">${fromTitle.slice(afterTitle)}`
}

export const slugOf = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'page'

export function urlOf(result) {
  const target = result?.result
  const url = typeof target === 'object' && target !== null ? target.url : undefined
  return typeof url === 'string' ? url : undefined
}

export const noteTopic = (value) =>
  sliceCodePointsHead(
    cleanOneLine(stripControlSequences(typeof value === 'string' ? value : '')),
    MAX_LINE_WIDTH,
  )

export const foldAtMentions = (value) =>
  value.replace(/(^|[\s\u3002\u3001\uFF1F\uFF01])@(?!\s)/g, '$1\uFF20')

export const foldReferencePlaceholders = (value) =>
  value.replace(
    new RegExp(
      String.raw`\[(Pasted text|Image|\.\.\.Truncated text|\u2726 Team setup guide) #(\d+)` +
        String.raw`(?: \+\d+ lines)?(\.)*\]`,
      'g',
    ),
    (match) => `\uFF3B${match.slice(1)}`,
  )

export const splitDirectiveKeywords = (value) =>
  value.replace(/(ultra)(code|plan|review|think)/gi, '$1-$2')

export const withoutInvisible = (value) =>
  value
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '\uFFFD',
    )
    .replace(
      new RegExp(
        String.raw`(?<!\p{Extended_Pictographic})` +
          String.raw`(?<![#*0-9](?=\uFE0F\u20E3))[\uFE0E\uFE0F]` +
          String.raw`|[^\P{Default_Ignorable_Code_Point}\uFE0E\uFE0F]` +
          String.raw`|[\u{1107F}\u{16FE4}]`,
        'gu',
      ),
      '',
    )

export const cleanForDraft = (value) =>
  splitDirectiveKeywords(foldReferencePlaceholders(foldAtMentions(withoutInvisible(value))))
