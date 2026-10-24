// Telemetry record builders.  The event names and property names match the
// built-in mod so dashboards and local debug output stay comparable.

import {
  CHECKS_KEPT,
  MS_PER_SECOND,
  PAGE_KINDS,
  PAGE_OUTCOMES,
  PROMPT_ORIGINS,
  PROPOSED_KINDS,
  RELEASE_BASE,
} from './constants.js'
import {
  answerChoice,
  clearCause,
  explainedDirection,
  explainedOutcome,
  leftBy,
  lineKind,
  offVia,
  choiceOf,
  proposedOutcome,
  tagOpener,
} from './parse.js'

export const markOf = (feature, kind, reason) =>
  kind === 'ok' ? { feature, kind } : { feature, kind, reason }

export const pageMark = (outcome) => {
  const kind = PAGE_KINDS[outcome]
  return kind ? markOf('learn_page', kind, outcome) : undefined
}

export const proposedMark = (record) => {
  const kind =
    record.outcome === 'none' && record.usage === null ? null : PROPOSED_KINDS[record.outcome]
  return kind ? markOf('you_should_know', kind, record.outcome) : undefined
}

export const forkUsage = (result) => ('usage' in result ? result.usage : null)

export const msToAnswerProp = (value) => (value === undefined ? {} : { ms_to_answer: value })

export const usageProps = (usage) => ({
  cache_read: usage?.cache_read_input_tokens ?? 0,
  cache_create: usage?.cache_creation_input_tokens ?? 0,
  output_tokens: usage?.output_tokens ?? 0,
})

export function versionMarkOf({ base, builtAt } = {}) {
  const match = RELEASE_BASE.exec(base ?? '')
  if (!match) return undefined
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined
  const built = Date.parse(builtAt ?? '')
  return {
    major,
    minor,
    patch,
    isDev: match[4] !== undefined,
    ...(Number.isFinite(built) && { builtAtS: Math.floor(built / MS_PER_SECOND) }),
  }
}

export const versionProps = (version) =>
  version === undefined
    ? {}
    : {
        version_major: version.major,
        version_minor: version.minor,
        version_patch: version.patch,
        version_is_dev: version.isDev,
        ...(version.builtAtS !== undefined && { built_at_s: version.builtAtS }),
      }

export function answered(record) {
  return {
    entry: {
      event: 'you_should_know_answered',
      props: {
        answer: answerChoice(record.answer),
        ...msToAnswerProp(record.msToAnswer),
        turn_in_progress: record.isTurnInProgress,
        offers_shown: record.offersShown,
        ...(record.iteration !== undefined && { iteration: record.iteration }),
        ...(record.promptOrigin !== undefined && { prompt_origin: choiceOf(record.promptOrigin, PROMPT_ORIGINS) }),
        ...(record.promptsSurvived !== undefined && { prompts_survived: record.promptsSurvived }),
        ...(record.leftBy !== undefined && { left_by: leftBy(record.leftBy) }),
        ...versionProps(record.version),
        ...(record.clearedBy !== undefined && { cleared_by: clearCause(record.clearedBy) }),
        ...(record.offVia !== undefined && { off_via: offVia(record.offVia) }),
        ...lineKind(record.line),
        ...tagOpener(record.tag),
      },
    },
  }
}


export function explained(record) {
  return {
    entry: {
      event: 'you_should_know_explained',
      props: {
        outcome: explainedOutcome(record.outcome),
        direction: explainedDirection(record.direction),
        latency_ms: record.latencyMs,
        ...usageProps(record.usage),
      },
    },
    mark: markOf('learn_explain', record.outcome === 'shown' ? 'ok' : 'bad', record.outcome),
  }
}

export function page(record) {
  return {
    entry: {
      event: 'learn_page',
      props: {
        outcome: choiceOf(record.outcome, PAGE_OUTCOMES),
        fork_ms: record.forkMs,
        total_ms: record.totalMs,
        ...usageProps(record.usage),
      },
    },
    mark: pageMark(record.outcome),
  }
}

export function proposed(record) {
  return {
    entry: {
      event: 'you_should_know_proposed',
      props: {
        outcome: proposedOutcome(record.outcome),
        ...tagOpener(record.tag),
        step: record.step,
        latency_ms: record.latencyMs,
        ...usageProps(record.usage),
        offers_shown: record.offersShown,
      },
    },
    mark: proposedMark(record),
  }
}

export function isCheck(value) {
  if (typeof value !== 'object' || value === null) return false
  return (
    Number.isFinite(value.number) &&
    Number.isFinite(value.step) &&
    Number.isFinite(value.latencyMs) &&
    Number.isFinite(value.at) &&
    typeof value.outcome === 'string' &&
    ['shown', 'none', 'parse_failed', 'deduped', 'stale', 'aborted', 'api_error', 'error'].includes(
      value.outcome,
    )
  )
}

export const checksOf = (value) => (Array.isArray(value) ? value.filter(isCheck).slice(-CHECKS_KEPT) : [])

export const checksWith = (checks, next) => [...checks, next].slice(-CHECKS_KEPT)

export function checkLineOf(check) {
  const seconds = (check.latencyMs / MS_PER_SECOND).toFixed(1)
  const time = new Date(check.at).toTimeString().slice(0, 8)
  return `debug \xB7 check ${check.number} \xB7 step ${check.step} \xB7 ${check.outcome} \xB7 ${seconds}s \xB7 ${time}`
}
