// Session-row and view helpers shared by the hooks.

import {
  LEAD_INK,
  OWN_COMPOSER,
  SESSIONS_MAX,
  SHOWN_KEEP_MS,
  TYPED_PAST_FREE,
  LOOKS_TO_SKIP_MAX,
} from './constants.js'
import { answered } from './telemetry.js'
import { tagOf } from './parse.js'

export const storedCount = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

export const stringLines = (value) =>
  Array.isArray(value) ? value.filter((line) => typeof line === 'string') : []

export const viewOf = (value) => {
  if (typeof value !== 'object' || value === null) return null
  return ['offer', 'explaining', 'explained', 'asked', 'making', 'ready', 'failed', 'off'].includes(
    value.kind,
  )
    ? value
    : null
}

export const isOpenView = (value) =>
  value?.kind === 'offer' || value?.kind === 'explained'

export const isSameShowing = (left, right) =>
  isOpenView(left) && left.kind === right.kind && left.shownAt === right.shownAt

export function iterationOf(view) {
  switch (view.kind) {
    case 'explained':
      return storedCount(view.iteration)
    case 'asked':
      return view.iteration === undefined ? undefined : storedCount(view.iteration)
    case 'offer':
      return undefined
    default:
      return undefined
  }
}

export const keptPastPrompt = (view, prompts) =>
  view.kind === 'offer'
    ? { ...view, promptsSurvived: prompts, isOffArmed: false }
    : { ...view, promptsSurvived: prompts }

export const looksToSkipAfter = (value) =>
  value <= TYPED_PAST_FREE ? 0 : Math.min(LOOKS_TO_SKIP_MAX, 2 ** (value - TYPED_PAST_FREE - 1))

export const hasOwnComposer = (surface) =>
  !Object.hasOwn(OWN_COMPOSER, surface) || OWN_COMPOSER[surface]

export const isOptIn = (userType) => userType === 'external'

export const leadInkOn = (surface) => (Object.hasOwn(LEAD_INK, surface) ? LEAD_INK[surface] : LEAD_INK.terminal)

export const aboutKeyOf = ({ line, shownAt }) => `${shownAt ?? 'unstamped'} ${line}`

export const promptedAtTurnStart = (origins, sessionId, index) =>
  index === 0 ? origins.get(sessionId) : undefined

export const isOfferDue = (offeredTurn, turnId, ended) => offeredTurn === turnId && !ended

export const isUnattendedInFlight = (view, sessionId, active) =>
  (view?.kind === 'explaining' || view?.kind === 'making') && !active.has(sessionId)

export const isBandShown = (surfaces, watched) =>
  surfaces.some((surface) => surface === 'terminal' || watched.has(surface))

export function isBandWatched(surfaces, watched, bridged) {
  const visible = bridged ? surfaces.filter((surface) => surface !== 'terminal') : surfaces
  return isBandShown(visible, watched)
}

export const isPersonPrompt = (kind) => kind === 'composer' || kind === 'bridge'

export function rowsOf(value) {
  if (!Array.isArray(value)) return []
  return value.filter((row) => {
    if (typeof row !== 'object' || row === null) return false
    return typeof row.id === 'string' && (row.view === undefined || viewOf(row.view) !== null)
  })
}

export const rowOf = (rows, id) => rowsOf(rows).find((row) => row.id === id)

export function withRow(rows, next, now = Date.now()) {
  const rest = rowsOf(rows).filter((row) => row.id !== next.id)
  const overflow = 1 + rest.length - SESSIONS_MAX
  if (overflow <= 0) return [next, ...rest]
  const open = ({ view }) =>
    isOpenView(view) && view.shownAt !== undefined && now - view.shownAt < SHOWN_KEEP_MS
  const reversed = rest.toReversed()
  const drop = new Set([...reversed.filter((row) => !open(row)), ...reversed.filter(open)].slice(0, overflow))
  return [next, ...rest.filter((row) => !drop.has(row))]
}

export const withViewCleared = (rows, id) =>
  rowsOf(rows).map((row) => (row.id === id ? { ...row, view: undefined } : row))

export const droppedOf = (before, after) =>
  rowsOf(before).filter((row) => !after.some((next) => next.id === row.id))

export const openRowsOf = (rows) =>
  rows.flatMap(({ view, tag }) => (isOpenView(view) ? [{ view, tag }] : []))

export const forgetPrompts = (origins, sessionId) => {
  origins.delete(sessionId)
}

export function forgetDetached(watched, surfaces) {
  for (const surface of watched) if (!surfaces.includes(surface)) watched.delete(surface)
}

export const revive = (set, sessionId) => {
  set.delete(sessionId)
}

export function leftOpen({ view, tag }, cause, offersShown) {
  return answered({
    answer: 'left_open',
    leftBy: cause,
    msToAnswer: view.shownAt === undefined ? undefined : Date.now() - view.shownAt,
    isTurnInProgress: false,
    offersShown,
    line: view.line,
    tag: tagOf(tag ?? ''),
    iteration: iterationOf(view),
    promptsSurvived: storedCount(view.promptsSurvived),
  })
}

export function cleared(view, { answer, clearedBy, offersShown, tag }) {
  return answered({
    answer,
    clearedBy,
    msToAnswer: view.shownAt === undefined ? undefined : Date.now() - view.shownAt,
    isTurnInProgress: false,
    offersShown,
    line: view.line,
    tag,
  })
}
