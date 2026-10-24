#!/usr/bin/env node
// Generate (or check) the committed official parity fixture.
//
//   node scripts/parity/update.mjs            # write tests/parity/fixtures/official.json
//   node scripts/parity/update.mjs --check    # compare installed Claude Code vs the fixture

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOfficial, sha256, stableString } from './official.mjs'
import { installTreeRecorder, makeUI, normalizeTree, normalizeValue } from './tree.mjs'
import * as corpus from '../../tests/parity/corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const defaultOut = resolve(root, 'tests/parity/fixtures/official.mjs')

function parseArgs(argv) {
  const out = { check: false, output: defaultOut, binary: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') out.check = true
    else if (arg === '--out') out.output = resolve(argv[++index])
    else if (arg === '--binary') out.binary = resolve(argv[++index])
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return out
}

const noop = () => {}
const actionsForOffer = (off) => ({
  explain: noop,
  knew: noop,
  off: off ? noop : undefined,
  later: noop,
})
const actionsForExplained = { gotIt: noop, respond: noop, dismiss: noop }

function officialUI(official, surface) {
  return official.get('rowsTable')(surface, makeUI())
}

function aboutFor(official, testCase) {
  const surface = testCase.surface
  const copy = testCase.hideCopy
    ? []
    : official.get(surface === 'terminal' ? 'TERMINAL_COPY' : 'APP_COPY')
  return {
    isOpen: testCase.isOpen === true,
    surface,
    copy,
    budget:
      surface === 'terminal'
        ? { maxRows: testCase.maxRows ?? 24, bodyColumns: testCase.bodyColumns ?? 100 }
        : 'scrolls',
    onPress: noop,
  }
}

function buildFixture(official) {
  installTreeRecorder(official.sandbox)
  const fixture = {
    schemaVersion: 1,
    claudeCodeVersion: official.version,
    pluginName: official.pluginName,
    scan: normalizeValue(official.scan),
    constants: {},
    prompts: { propose: [], explain: [] },
    parse: { proposed: [], explanation: [] },
    text: { cells: [], wrap: [], truncate: [], names: [] },
    telemetry: { answered: [], explained: [], proposed: [], page: [], version: [] },
    state: {},
    ui: {
      offer: [],
      explained: [],
      aboutFit: [],
      aboutFrame: [],
      cardText: [],
      respondDraft: [],
      fitCards: [],
      choices: [],
    },
  }

  for (const name of [
    'CHECK_EVERY',
    'CLEAR_AFTER_PROMPTS',
    'ASKED_MS',
    'SEEN_MAX',
    'SESSIONS_MAX',
    'SHOWN_KEEP_MS',
    'LOOKS_TO_SKIP_MAX',
    'TYPED_PAST_FREE',
    'CARD_WIDTH',
    'CARD_INSET',
    'CHOICE_GAP',
    'KEY_TEXT',
    'WIDE_FROM',
    'STAR_CELLS',
    'WRAP_RESERVE_CELLS',
    'OFFER_MARGIN_ROWS',
    'FALLBACK_COLUMNS',
    'MAX_LINE_WIDTH',
    'MAX_CAPTION_LENGTH',
    'MAX_CARDS',
    'MAX_SKETCH_LINES',
    'MAX_SKETCH_WIDTH',
    'MAX_TITLE_WIDTH',
    'SLUG_MAX',
    'DEFAULT_TAG',
    'TAG_OPENERS',
    'ANSWERS',
    'PAGE_KINDS',
    'PROPOSED_KINDS',
    'UNANSWERED_OUTCOMES',
    'EXPLAINED_OUTCOMES',
    'EXPLAIN_DIRECTIONS',
    'CLEARED_BY',
    'LEFT_BY',
    'OFF_VIA',
    'PROMPT_ORIGINS',
    'OPENERS',
    'QUESTION_WORDS',
    'ASKED_WAYS',
    'DEBUG_ON_WORDS',
    'OWN_COMPOSER',
    'LEAD_INK',
    'TERMINAL_COPY',
    'APP_COPY',
  ]) {
    fixture.constants[name] = normalizeValue(official.get(name))
  }

  const proposePrompt = official.get('proposePrompt')
  for (const testCase of corpus.PROPOSE_CASES) {
    const text = proposePrompt(testCase.seen, testCase.known)
    fixture.prompts.propose.push({
      name: testCase.name,
      seen: testCase.seen,
      known: testCase.known,
      length: text.length,
      sha256: sha256(text),
      text,
    })
  }
  const explainPrompt = official.get('explainPrompt')
  for (const testCase of corpus.EXPLAIN_CASES) {
    const text = explainPrompt(testCase.topic, testCase.previous)
    fixture.prompts.explain.push({
      name: testCase.name,
      topic: testCase.topic,
      previous: testCase.previous,
      length: text.length,
      sha256: sha256(text),
      text,
    })
  }

  const parseProposedLine = official.get('parseProposedLine')
  for (const testCase of corpus.PROPOSAL_CASES) {
    fixture.parse.proposed.push({
      name: testCase.name,
      input: testCase.input,
      output: normalizeValue(parseProposedLine(testCase.input)),
    })
  }
  const parseExplanation = official.get('parseExplanation')
  for (const testCase of corpus.EXPLANATION_CASES) {
    fixture.parse.explanation.push({
      name: testCase.name,
      input: testCase.input,
      output: normalizeValue(parseExplanation(testCase.input)),
    })
  }

  const cellsAtMost = official.get('cellsAtMost')
  const wrapRows = official.get('wrapRows')
  const truncateAtWordBoundary = official.get('truncateAtWordBoundary')
  const truncateToCells = official.get('fitLine') // it() in the official module
  const lineCellsAtMost = official.get('lineCellsAtMost')
  const noteTopic = official.get('noteTopic')
  const cleanForDraft = official.get('cleanForDraft')
  for (const testCase of corpus.TEXT_CASES) {
    fixture.text.cells.push({
      name: testCase.name,
      value: testCase.value,
      cellsAtMost: cellsAtMost(testCase.value),
      lineCellsAtMost: lineCellsAtMost(testCase.value),
      noteTopic: noteTopic(testCase.value),
      cleanForDraft: cleanForDraft(testCase.value),
    })
    for (const width of corpus.WIDTH_CASES) {
      fixture.text.wrap.push({
        name: `${testCase.name}:${width.name}`,
        value: testCase.value,
        columns: width.columns,
        rows: wrapRows(testCase.value, width.columns),
      })
      fixture.text.truncate.push({
        name: `${testCase.name}:${width.name}`,
        value: testCase.value,
        length: width.columns,
        shorter: truncateAtWordBoundary(testCase.value, width.columns),
        cells: truncateToCells(testCase.value, width.columns),
      })
    }
  }

  const choicesRows = official.get('choicesRows')
  for (const testCase of corpus.CHOICES_CASES) {
    for (const width of corpus.WIDTH_CASES) {
      fixture.ui.choices.push({
        name: `${testCase.name}:${width.name}`,
        columns: width.columns,
        labels: testCase.labels,
        rows: choicesRows({ columns: width.columns, labels: testCase.labels }),
      })
    }
  }

  for (const testCase of corpus.ANSWERED_CASES) {
    fixture.telemetry.answered.push({
      name: testCase.name,
      record: normalizeValue(testCase.record),
      output: normalizeValue(official.get('answered')(testCase.record)),
    })
  }
  for (const testCase of corpus.EXPLAINED_CASES) {
    fixture.telemetry.explained.push({
      name: testCase.name,
      record: normalizeValue(testCase.record),
      output: normalizeValue(official.get('explained')(testCase.record)),
    })
  }
  for (const testCase of corpus.PROPOSED_CASES) {
    fixture.telemetry.proposed.push({
      name: testCase.name,
      record: normalizeValue(testCase.record),
      output: normalizeValue(official.get('proposed')(testCase.record)),
    })
  }
  for (const testCase of corpus.PAGE_CASES) {
    fixture.telemetry.page.push({
      name: testCase.name,
      record: normalizeValue(testCase.record),
      output: normalizeValue(official.get('page')(testCase.record)),
    })
  }
  for (const testCase of corpus.VERSION_CASES) {
    fixture.telemetry.version.push({
      name: testCase.name,
      version: testCase,
      mark: normalizeValue(official.get('versionMarkOf')(testCase)),
      props: normalizeValue(official.get('versionProps')(official.get('versionMarkOf')(testCase))),
    })
  }


  const state = {}
  state.rows = corpus.STATE_ROWS_CASES.map((testCase) => ({
    name: testCase.name,
    rows: normalizeValue(testCase.rows),
    next: normalizeValue(testCase.next),
    output: normalizeValue(official.get('withRow')(testCase.rows, testCase.next, 10_000)),
  }))
  state.kept = corpus.STATE_KEPT_CASES.map((testCase) => ({
    name: testCase.name,
    view: normalizeValue(testCase.view),
    prompts: testCase.prompts,
    output: normalizeValue(official.get('keptPastPrompt')(testCase.view, testCase.prompts)),
  }))
  state.band = corpus.STATE_BAND_CASES.map((testCase) => ({
    name: testCase.name,
    case: normalizeValue(testCase),
    output: official.get('isBandWatched')(testCase.surfaces, new Set(testCase.watched), testCase.bridged),
  }))
  state.aboutKeys = corpus.STATE_ABOUT_KEYS.map((testCase) => ({
    name: testCase.name,
    view: normalizeValue(testCase.view),
    output: official.get('aboutKeyOf')(testCase.view),
  }))
  state.iterations = corpus.STATE_ITERATIONS.map((testCase) => ({
    name: testCase.name,
    view: normalizeValue(testCase.view),
    output: normalizeValue(official.get('iterationOf')(testCase.view)),
  }))
  state.due = corpus.STATE_DUE.map((testCase) => ({
    name: testCase.name,
    case: normalizeValue(testCase),
    output: official.get('isOfferDue')(testCase.offeredTurn, testCase.turnId, testCase.ended),
  }))
  state.looks = corpus.STATE_LOOKS.map((testCase) => ({
    name: testCase.name,
    value: testCase.value,
    output: official.get('looksToSkipAfter')(testCase.value),
  }))
  state.same = corpus.STATE_SAME.map((testCase) => ({
    name: testCase.name,
    left: normalizeValue(testCase.left),
    right: normalizeValue(testCase.right),
    output: official.get('isSameShowing')(testCase.left, testCase.right),
  }))
  state.unattended = corpus.STATE_UNATTENDED.map((testCase) => ({
    name: testCase.name,
    view: normalizeValue(testCase.view),
    active: testCase.active,
    output: official.get('isUnattendedInFlight')(
      testCase.view,
      's1',
      new Set(testCase.active ? ['s1'] : []),
    ),
  }))
  state.rowsOf = corpus.STATE_ROWS_OF.map((testCase) => ({
    name: testCase.name,
    rows: normalizeValue(testCase.rows),
    output: normalizeValue(official.get('rowsOf')(testCase.rows)),
  }))
  state.opened = corpus.STATE_OPENED.map((testCase) => ({
    name: testCase.name,
    rows: normalizeValue(testCase.rows),
    output: normalizeValue(official.get('openRowsOf')(testCase.rows)),
  }))
  state.dropped = corpus.STATE_DROPPED.map((testCase) => ({
    name: testCase.name,
    before: normalizeValue(testCase.before),
    after: normalizeValue(testCase.after),
    output: normalizeValue(official.get('droppedOf')(testCase.before, testCase.after)),
  }))
  state.cleared = corpus.STATE_CLEARED.map((testCase) => ({
    name: testCase.name,
    rows: normalizeValue(testCase.rows),
    id: testCase.id,
    output: normalizeValue(official.get('withViewCleared')(testCase.rows, testCase.id)),
  }))
  state.counts = corpus.STATE_COUNTS.map((testCase) => ({
    name: testCase.name,
    value: testCase.value,
    output: official.get('storedCount')(testCase.value),
  }))
  state.strings = corpus.STATE_STRINGS.map((testCase) => ({
    name: testCase.name,
    value: normalizeValue(testCase.value),
    output: normalizeValue(official.get('stringLines')(testCase.value)),
  }))
  state.open = corpus.STATE_OPEN.map((testCase) => ({
    name: testCase.name,
    view: normalizeValue(testCase.view),
    output: official.get('isOpenView')(testCase.view),
  }))
  state.forget = corpus.STATE_FORGET.map((testCase) => {
    const watched = new Set(testCase.watched)
    official.get('forgetDetached')(watched, testCase.surfaces)
    return {
      name: testCase.name,
      case: normalizeValue(testCase),
      output: [...watched].sort(),
    }
  })
  state.revive = corpus.STATE_REVIVE.map((testCase) => {
    const set = new Set(testCase.set)
    official.get('revive')(set, testCase.id)
    return {
      name: testCase.name,
      case: normalizeValue(testCase),
      output: [...set].sort(),
    }
  })
  fixture.state = state

  const offerRow = official.get('offerRow')
  for (const testCase of corpus.UI_OFFER_CASES) {
    const about = aboutFor(official, testCase)
    const tree = offerRow(
      officialUI(official, testCase.surface),
      testCase.line,
      actionsForOffer(testCase.off),
      testCase.offArmed,
      about,
      testCase.tag,
    )
    fixture.ui.offer.push({
      name: testCase.name,
      case: normalizeValue(testCase),
      tree: normalizeTree(tree),
    })
  }

  const explainedRow = official.get('explainedRow')
  for (const testCase of corpus.UI_EXPLAINED_CASES) {
    const cards = official.get('fitCards')(parseExplanation(testCase.text), 100)
    const tree = explainedRow(
      officialUI(official, testCase.surface),
      'The build uses pnpm workspaces.',
      cards,
      testCase.actions ? actionsForExplained : null,
      'Heads up',
    )
    fixture.ui.explained.push({
      name: testCase.name,
      case: normalizeValue(testCase),
      cards: normalizeValue(cards),
      tree: normalizeTree(tree),
    })
  }

  const aboutFit = official.get('aboutFit')
  for (const testCase of corpus.ABOUT_FIT_CASES) {
    const about = aboutFor(official, testCase)
    const layout = {
      tag: testCase.tag,
      line: testCase.line,
      before: [
        { hotkey: '1', label: 'Learn more', onPress: noop },
        { hotkey: '2', label: 'Knew this already', onPress: noop },
      ],
      after: [{ hotkey: '0', label: 'Dismiss', onPress: noop, role: 'dismiss' }],
    }
    fixture.ui.aboutFit.push({
      name: testCase.name,
      case: normalizeValue(testCase),
      layout: normalizeValue(layout),
      output: normalizeValue(aboutFit(about, layout)),
    })
  }

  const aboutFrame = official.get('aboutFrame')
  for (const testCase of corpus.ABOUT_FRAME_CASES) {
    fixture.ui.aboutFrame.push({
      name: testCase.name,
      case: normalizeValue(testCase),
      output: normalizeValue(
        aboutFrame(
          testCase.ownsComposer,
          { maxRows: testCase.maxRows, bodyColumns: testCase.bodyColumns },
          testCase.hideCopy,
        ),
      ),
    })
  }

  for (const testCase of corpus.CARD_TEXT_CASES) {
    fixture.ui.cardText.push({
      name: testCase.name,
      card: normalizeValue(testCase.card),
      output: official.get('cardText')(testCase.card),
    })
  }

  for (const testCase of corpus.RESPOND_CASES) {
    const cards = testCase.cards ?? [corpus.CARD_CASES[0].card]
    fixture.ui.respondDraft.push({
      name: testCase.name,
      line: testCase.line,
      tag: testCase.tag,
      cards: normalizeValue(cards),
      output: official.get('respondDraft')(testCase.line, cards, testCase.tag),
    })
  }

  const fitCards = official.get('fitCards')
  for (const testCase of corpus.FIT_CARD_CASES) {
    fixture.ui.fitCards.push({
      name: testCase.name,
      cards: normalizeValue(testCase.cards),
      columns: testCase.columns,
      output: normalizeValue(fitCards(testCase.cards, testCase.columns)),
    })
  }

  return fixture
}

function firstDiff(a, b, path = '') {
  if (Object.is(a, b)) return undefined
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${path || '<root>'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return `${path || '<root>'}: array/non-array`
    }
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const diff = firstDiff(a[index], b[index], `${path}[${index}]`)
      if (diff) return diff
    }
    return undefined
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const diff = firstDiff(a[key], b[key], path ? `${path}.${key}` : key)
    if (diff) return diff
  }
  return undefined
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('usage: node scripts/parity/update.mjs [--check] [--out FILE] [--binary PATH]')
    return
  }
  const official = loadOfficial({ binary: args.binary })
  const fixture = buildFixture(official)
  const json = `export default ${JSON.stringify(fixture, null, 2)}\n`
  console.log(
    `official: Claude Code ${official.version} (${official.pluginName}) from ${official.binaryPath}`,
  )
  console.log(
    `cases: ${fixture.parse.proposed.length} proposals, ${fixture.parse.explanation.length} explanations, ` +
      `${fixture.ui.offer.length} offer trees, ${fixture.telemetry.answered.length} answered, ` +
      `${fixture.ui.aboutFit.length} about-fit`,
  )
  for (const prompt of [...fixture.prompts.propose, ...fixture.prompts.explain]) {
    console.log(`prompt ${prompt.name}: ${prompt.length} chars sha256=${prompt.sha256}`)
  }

  if (args.check) {
    let current
    try {
      const raw = readFileSync(args.output, 'utf8')
      current = JSON.parse(raw.replace(/^export default\s*/, '').replace(/;?\s*$/, ''))
    } catch (error) {
      console.error(`cannot read ${args.output}: ${error.message}`)
      process.exit(2)
    }
    if (stableString(current) === stableString(fixture)) {
      console.log(`parity fixture is current: ${args.output}`)
      return
    }
    const diff = firstDiff(current, fixture)
    console.error(`parity fixture is stale: ${args.output}`)
    if (diff) console.error(`first difference: ${diff}`)
    process.exit(1)
  }

  mkdirSync(dirname(args.output), { recursive: true })
  writeFileSync(args.output, json)
  console.log(`wrote ${args.output}`)
}

main()
