// The AbovePrompt band.
//
// The tree shapes, labels, hotkeys, colours and fit rules are the built-in
// mod's.  Every element comes from `$.ui.resolve(e)`, so the same functions
// draw on the terminal and the desktop.

import {
  CARD_WIDTH,
  CHOICE_GAP,
  DEFAULT_TAG,
  OFF_COMMAND,
  STAR_CELLS,
  WATCHING,
  WHEN,
} from './constants.js'
import { checkLineOf } from './telemetry.js'
import { hasOwnComposer, leadInkOn } from './data.js'
import { parseExplanation } from './parse.js'
import {
  cleanForDraft,
  closedOfferRows,
  fitCardsToColumns,
  fittedCopy,
  noteTopic,
} from './text.js'

export function h(Component, props, ...children) {
  const next = { ...(props ?? {}) }
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return Component(next)
}

const SPAN_LOOKS = { bold: { bold: true }, code: { color: 'permission' } }

export function noteSpans(ui, spans, base = {}) {
  const { Text } = ui
  return spans
    .flatMap((span, index) => (index === 0 ? span : [{ text: ' ' }, ...span]))
    .map(({ text, look }) => h(Text, { ...(look === undefined ? base : SPAN_LOOKS[look]) }, text))
}

export const plainText = (spans) =>
  spans.map((span) => span.map((part) => part.text).join('')).join(' ')

export const leadInkOf = (ui) => ui.leadInk ?? { star: { color: 'suggestion' }, tag: { dimColor: true } }

function aboutCard(ui, copy) {
  const { Box, Text } = ui
  return h(
    Box,
    {
      position: 'absolute',
      bottom: 1,
      left: 0,
      display: 'none',
      hover: { display: 'flex' },
      flexDirection: 'column',
      borderStyle: 'round',
      borderDimColor: true,
      paddingX: 1,
      width: CARD_WIDTH,
    },
    h(Text, { wrap: 'wrap' }, noteSpans(ui, copy, {})),
  )
}

export const aboutChoice = (about) => ({
  hotkey: '3',
  label: about.isOpen ? 'Return to topic' : 'What is this',
  onPress: about.onPress,
  isDim: true,
})

const WATCHING_SPAN = [{ text: WATCHING }]
const WHEN_SPAN = [{ text: WHEN }]
const LEARN_SPANS = [{ text: 'Learn more', look: 'bold' }, { text: ' to get a deeper explanation and chat about it.' }]
const OFF_SPANS = [
  { text: 'Disable on this machine with ' },
  { text: OFF_COMMAND, look: 'code' },
  { text: '.' },
]
export const APP_COPY = [WATCHING_SPAN, WHEN_SPAN, LEARN_SPANS]
export const TERMINAL_COPY = [WATCHING_SPAN, WHEN_SPAN, LEARN_SPANS, OFF_SPANS]
export const ABOUT_TEXT = plainText(TERMINAL_COPY)

function offerHead(ui, { lead, body, surface, copy }) {
  const { Box, Text } = ui
  const desktop = surface === 'desktop'
  const hasCopy = copy.length > 0
  return desktop
    ? h(
        Box,
        { flexDirection: 'row', alignItems: 'flex-start' },
        h(Box, { key: 'about', flexShrink: 0 }, lead, hasCopy ? aboutCard(ui, copy) : undefined),
        h(Text, { wrap: 'wrap' }, body),
      )
    : h(Text, { wrap: 'wrap' }, lead, body)
}

export const ABOUT_CLOSED = {
  isOpen: false,
  surface: 'terminal',
  onPress: () => {},
  copy: TERMINAL_COPY,
  budget: 'scrolls',
}

export const STAR_TEXT = '\u2726'

export function lead(ui, tag) {
  const { Text } = ui
  const ink = leadInkOf(ui)
  return h(
    Text,
    null,
    h(Text, { ...ink.star }, STAR_TEXT),
    tag === undefined ? ' ' : h(Text, { ...ink.tag }, ' ', tag, ' \xB7 '),
  )
}

export function starColumn(ui, content) {
  const { Box, Text } = ui
  const ink = leadInkOf(ui)
  return h(
    Box,
    { flexDirection: 'row', alignItems: 'flex-start' },
    h(Box, { flexShrink: 0, width: STAR_CELLS }, h(Text, { ...ink.star }, STAR_TEXT)),
    content,
  )
}

export function starred(ui, tag, body) {
  const { Text } = ui
  const ink = leadInkOf(ui)
  return (ui.hasStarColumn ?? true)
    ? starColumn(
        ui,
        h(
          Text,
          { wrap: 'wrap' },
          tag === undefined ? '' : h(Text, { ...ink.tag }, tag, ' \xB7 '),
          body,
        ),
      )
    : h(Text, { wrap: 'wrap' }, lead(ui, tag), body)
}

export function choice(ui, { hotkey, label, onPress, isDim, role }) {
  const { Box, Button } = ui
  return h(
    Box,
    { marginRight: CHOICE_GAP },
    h(Button, { hotkey, plain: true, dimColor: isDim, role, onPress }, label),
  )
}

export function choicesRow(ui, choices) {
  const { Box } = ui
  return h(Box, { marginLeft: 2, flexWrap: 'wrap' }, choices.map((item) => choice(ui, item)))
}

export function dismissedLine(ui, choices, onDismiss) {
  const { Box, Text } = ui
  const hasStarColumn = ui.hasStarColumn ?? true
  const parts = [...choices, { hotkey: '0', label: 'Dismiss', onPress: onDismiss, role: 'dismiss' }].map(
    (item) => choice(ui, item),
  )
  return hasStarColumn
    ? h(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        starColumn(
          ui,
          h(
            Box,
            { flexWrap: 'wrap' },
            h(
              Box,
              { marginRight: CHOICE_GAP },
              h(Text, { dimColor: true, wrap: 'truncate-end' }, 'Dismissed.'),
            ),
            parts,
          ),
        ),
      )
    : h(
        Box,
        { marginTop: 1, flexWrap: 'wrap' },
        h(
          Box,
          { marginRight: CHOICE_GAP },
          h(Text, { wrap: 'truncate-end' }, lead(ui), h(Text, { dimColor: true }, 'Dismissed.')),
        ),
        parts,
      )
}

export function askedRow(ui, actions) {
  const off =
    actions.off !== undefined
      ? [{ hotkey: '4', label: 'Turn off suggestions', onPress: actions.off }]
      : []
  return dismissedLine(
    ui,
    [
      { hotkey: '1', label: 'That was helpful', onPress: actions.helpful },
      { hotkey: '2', label: 'Not relevant', onPress: actions.notRelevant },
      { hotkey: '3', label: "Couldn't understand", onPress: actions.notUnderstood },
      ...off,
    ],
    actions.dismiss,
  )
}

export const explainedAskedRow = (ui, actions) =>
  dismissedLine(
    ui,
    [
      { hotkey: '1', label: 'That was helpful', onPress: actions.helpful },
      { hotkey: '2', label: "Didn't understand", onPress: actions.notUnderstood },
    ],
    actions.dismiss,
  )

export function debugRows(ui, checks, content) {
  const { Box, Text } = ui
  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      checks.map((check) =>
        h(
          Box,
          null,
          h(Text, { ...leadInkOf(ui).star }, STAR_TEXT),
          h(Text, { wrap: 'truncate-end', dimColor: true }, ' ', checkLineOf(check)),
        ),
      ),
    ),
    content ?? '',
  )
}

export function stillRow(ui, text) {
  const { Box, Text } = ui
  return h(
    Box,
    { marginTop: 1 },
    h(Text, { ...leadInkOf(ui).star }, STAR_TEXT),
    h(Text, { wrap: 'truncate-end', dimColor: true }, ' ', text),
  )
}

export const explainingRow = (ui) => stillRow(ui, 'One moment\u2026')

export function failedRow(ui, reason, onDismiss) {
  const { Box, Text } = ui
  const publish = reason === 'publish'
  const blocked = reason === 'blocked'
  const explain = reason === 'explain'
  const turnOff = reason === 'turn_off'
  return h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { wrap: 'truncate-end' },
      lead(ui),
      publish
        ? "Couldn't publish that page"
        : blocked
          ? 'Not published (blocked by a permission setting)'
          : explain
            ? "Couldn't write that explanation"
            : turnOff
              ? "Couldn't turn suggestions off here. Use /plugin."
              : "Couldn't write that page",
      ' ',
      h(Text, { dimColor: true }, '\xB7'),
      ' ',
    ),
    choice(ui, { hotkey: '0', label: 'OK', onPress: onDismiss }),
  )
}

export const makingRow = (ui) =>
  stillRow(ui, 'Making your page (a minute or two) \xB7 Claude keeps working\u2026')

export const wayOutChoices = (onPress, isArmed) =>
  onPress === undefined
    ? []
    : [
        {
          hotkey: '4',
          label: isArmed ? 'Press again to disable' : 'Disable',
          onPress,
          isDim: true,
        },
      ]

export function offerRow(ui, ...[line, actions, offArmed, about = ABOUT_CLOSED, tag = DEFAULT_TAG]) {
  const { Box } = ui
  const leading = [
    { hotkey: '1', label: 'Learn more', onPress: actions.explain },
    { hotkey: '2', label: 'Knew this already', onPress: actions.knew },
  ]
  const trailing = [
    ...wayOutChoices(actions.off, offArmed),
    { hotkey: '0', label: 'Dismiss', onPress: actions.later, role: 'dismiss' },
  ]
  const fitted = aboutFit(about, { tag, line, before: leading, after: trailing })
  const head =
    fitted.note.length > 0
      ? { tag: undefined, body: noteSpans(ui, fitted.note, { dimColor: true }) }
      : { tag, body: line }
  const terminal = about.surface === 'terminal'
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    terminal ? starred(ui, head.tag, head.body) : offerHead(ui, { lead: lead(ui, head.tag), body: head.body, ...about }),
    choicesRow(ui, [...leading, ...fitted.choices, ...trailing]),
  )
}

export function readyRow(ui, url, actions) {
  const { Box, Text } = ui
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, { wrap: 'truncate-end' }, lead(ui), 'Learning page ready'),
    h(Box, { marginLeft: 2 }, h(Text, { dimColor: true, wrap: 'wrap' }, url)),
    choicesRow(ui, [
      { hotkey: '1', label: 'Helpful', onPress: actions.helpful },
      { hotkey: '2', label: 'Not helpful', onPress: actions.notHelpful },
      { hotkey: '3', label: "Didn't read", onPress: actions.unread },
    ]),
  )
}

export function withSurface(surface, ui) {
  const ownsComposer = hasOwnComposer(surface)
  const ink = leadInkOn(surface)
  return ownsComposer
    ? {
        ...ui,
        Button: ({ hotkey, plain, ...props }) => ui.Button(props),
        leadInk: ink,
        hasStarColumn: false,
      }
    : { ...ui, leadInk: ink, hasStarColumn: true }
}

export function aboutFrame(ownsComposer, { maxRows, bodyColumns }, hideCopy) {
  const copy = ownsComposer ? APP_COPY : TERMINAL_COPY
  return {
    copy: hideCopy ? [] : copy,
    budget: ownsComposer ? 'scrolls' : { maxRows, bodyColumns },
  }
}

export function aboutFit(about, layout) {
  const closed = aboutChoice(about)
  const opened = aboutChoice({ ...about, isOpen: true })
  const { budget } = about
  const scrolls = budget === 'scrolls'
  const copy = scrolls
    ? about.copy
    : fittedCopy({
        ...budget,
        copy: about.copy,
        labels: [...layout.before, opened, ...layout.after].map((item) => item.label),
      })
  const closedChoice = aboutChoice({ ...about, isOpen: false })
  const fits =
    scrolls ||
    closedOfferRows({
      columns: budget.bodyColumns,
      tag: layout.tag,
      line: layout.line,
      labels: [...layout.before, closedChoice, ...layout.after].map((item) => item.label),
    }) <= budget.maxRows
  const show = copy.length > 0 && fits
  return { note: about.isOpen && show ? copy : [], choices: show ? [closed] : [] }
}

export const cardText = (card) => {
  const sketch = card.sketch.length > 0 ? ['```', ...card.sketch, '```'].join('\n') : ''
  return [card.title === '' ? '' : `**${card.title}**`, card.lead, sketch, card.caption]
    .filter((part) => part !== '')
    .join('\n')
}

export function respondDraft(line, cards, tag) {
  const quote = [`${tag} \xB7 ${noteTopicText(line)}`, ...cards.map(cardText)]
    .join('\n\n')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
  return cleanForDraft(`Here is a note offered by a side agent:\n\n${quote}`)
}

function noteTopicText(value) {
  return noteTopic(value ?? '')
}

const MARKUP = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`|[\\`*_{}[<>#+\-=|~^$&:@]|(?<=[wW]{3})\./g
const STRUCTURAL = /[\\`*_{}[<>#+\-=|~^$&:@]|(?<=[wW]{3})\./g
const LIST_MARKER = /^(?:[-*+\u2022]|(\d+)([.)]))\s+/
const LEADING_NUMBER = /^(\d+)([.)])(?=\s|$)/
const HARD_BREAK = '  \n'

const literal = (value) =>
  value
    .trimStart()
    .replace(MARKUP, (match, bold, code) => {
      const isCode = code !== undefined
      const isBold = bold !== undefined
      const strong = `**${(bold ?? '').replace(STRUCTURAL, '\\$&')}**`
      return isCode ? match : isBold ? strong : `\\${match}`
    })
    .replace(LEADING_NUMBER, '$1\\$2')

function lineShape(line, previous) {
  const trimmed = line.trimStart()
  const match = LIST_MARKER.exec(trimmed)
  const text = literal(trimmed.slice(match?.[0].length ?? 0))
  const number = match?.[1]
  const ordinal = Number(number)
  const opensInPlace = `${(previous ?? ordinal - 1) + 1}.` === `${number}${match?.[2]}`
  if (match === null) return { kind: 'plain', text, canOpenInPlace: false }
  if (number === undefined) return { kind: 'bullet', text: `- ${text}`, canOpenInPlace: true }
  return opensInPlace
    ? { kind: 'ordered', text: `${ordinal}. ${text}`, canOpenInPlace: ordinal === 1, ordinal }
    : { kind: 'plain', text: `${number}\\${match[2]} ${text}`, canOpenInPlace: false }
}

function drawnLine(line, previous) {
  const shape = lineShape(line, previous?.ordinal)
  const plain = shape.kind === 'plain'
  const plainNext = plain && previous?.kind === 'plain'
  const sameKind = (!plain && shape.kind === previous?.kind) || shape.canOpenInPlace
  const gap = plainNext ? HARD_BREAK : sameKind ? '\n' : '\n\n'
  if (previous === undefined) return shape
  return { ...shape, text: `${gap}${shape.text}` }
}

function proseMarkdown(value, heading) {
  const title = heading === '' ? '' : `**${heading.replace(STRUCTURAL, '\\$&')}**`
  const initial = title !== '' ? [{ kind: 'plain', text: title, canOpenInPlace: false }] : []
  const body = value
    .split('\n')
    .filter((line) => line !== '')
    .reduce((lines, line) => [...lines, drawnLine(line, lines.at(-1))], initial)
    .map((line) => line.text)
    .join('')
  return body === '' ? '' : `${body}\n\n`
}

function prose(ui, value, heading) {
  const { Markdown } = ui
  const text = proseMarkdown(value, heading)
  return text === '' ? '' : h(Markdown, { text })
}

export function explainedRow(ui, ...[line, cards, actions, tag = DEFAULT_TAG]) {
  const { Box, Code } = ui
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Box, { flexDirection: 'column', marginBottom: 1 }, starred(ui, tag, line)),
    cards.map((card) => {
      const hasSketch = card.sketch.length > 0
      return h(
        Box,
        { flexDirection: 'column', marginBottom: 1, marginLeft: 2 },
        prose(ui, card.lead, card.title),
        hasSketch
          ? h(Code, {
              source: card.sketch.map((sketchLine) => (sketchLine === '' ? ' ' : sketchLine)).join('\n'),
              language: 'text',
              wrap: 'truncate-end',
            })
          : '',
        prose(ui, card.caption, ''),
      )
    }),
    actions === null
      ? ''
      : choicesRow(ui, [
          { hotkey: '1', label: 'Understood', onPress: actions.gotIt },
          { hotkey: '2', label: 'Chat in main session', onPress: actions.respond },
          { hotkey: '0', label: 'Dismiss', onPress: actions.dismiss, role: 'dismiss' },
        ]),
  )
}

export function renderCards(cards, columns) {
  return fitCardsToColumns(cards, columns)
}

export function renderExplanation(text, columns) {
  return renderCards(parseExplanation(text), columns)
}

