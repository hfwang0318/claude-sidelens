// sidelens: the "You should know" side agent for every model provider.
//
// This is a parity port of Claude Code 2.1.308's built-in
// cc-plugin-you-should-know mod.  The only intentional differences are:
//   * it is an ordinary plugin, so it has no first-party feature-flag gate;
//   * its own name is used in `$.state` and in the disable command.
//
// Everything else — the observer prompt, parse rules, check cadence, band
// layout, labels, hotkeys, store schema and telemetry — follows the built-in
// mod.  The side request uses `$.model.fork`, which runs on the session's
// model and credentials, so it works with third-party Anthropic-compatible
// providers exactly as it does with Anthropic models.

import {
  ASKED_MS,
  CHECK_EVERY,
  CLEAR_AFTER_PROMPTS,
  LOOKS_TO_SKIP_MAX,
  OFF_BOX_BUSY,
  OFF_COMMAND,
  RESPOND_BLOCKED,
  RESPOND_BOX_BUSY,
  RESPOND_NOT_FILLED,
  SEEN_MAX,
  UNANSWERED_OUTCOMES,
} from '../lib/constants.js'
import {
  aboutKeyOf,
  cleared,
  forgetDetached,
  forgetPrompts,
  hasOwnComposer,
  isBandShown,
  isBandWatched,
  isOfferDue,
  isOpenView,
  isOptIn,
  isSameShowing,
  isUnattendedInFlight,
  iterationOf,
  keptPastPrompt,
  leftOpen,
  looksToSkipAfter,
  openRowsOf,
  promptedAtTurnStart,
  revive,
  rowOf,
  droppedOf,
  storedCount,
  stringLines,
  withRow,
  withViewCleared,
} from '../lib/data.js'
import {
  isComposer,
  isOffCommand,
  parseExplanation,
  parseProposedLine,
  tagOf,
} from '../lib/parse.js'
import { explainPrompt, proposePrompt } from '../lib/prompts.js'
import {
  answered as answeredRecord,
  checksOf,
  checksWith,
  explained as explainedRecord,
  forkUsage,
  proposed as proposedRecord,
  versionMarkOf,
} from '../lib/telemetry.js'
import { fitCardsToColumns, isDebugOn } from '../lib/text.js'
import {
  aboutFrame,
  askedRow,
  debugRows,
  explainedAskedRow,
  explainedRow,
  explainingRow,
  failedRow,
  makingRow,
  offerRow,
  readyRow,
  respondDraft,
  withSurface,
} from '../lib/ui.js'

async function deliver($, record) {
  try {
    await $.telemetry.log(record.entry)
    if (record.mark) await $.telemetry.mark(record.mark)
  } catch {
    return
  }
}

async function promptHasText($, box, message) {
  const filled = box !== undefined && box.text.trim() !== ''
  if (filled) {
    $.ui.toast(message)
    $.ui.invalidate('ui.render')
  }
  return filled
}

async function aboutShown($, sessionId) {
  try {
    return (await $.state.get({ plugin: 'sidelens', key: 'aboutOpen', id: sessionId })).value
  } catch {
    return undefined
  }
}

async function toggleAbout($, { sid, key }) {
  try {
    const held = await $.state.get({ plugin: 'sidelens', key: 'aboutOpen', id: sid })
    const value = held.value === key ? '' : key
    await $.state.set({ plugin: 'sidelens', key: 'aboutOpen', id: sid }, value, {
      ifVersion: held.version,
    })
  } catch {
    return
  }
}

async function confirmOffRecord($, { sid, confirmed, isConfirmed }) {
  const sessions = await $.store.get('sessions')
  const row = rowOf(sessions, sid)
  const view = row?.view
  if (view?.kind !== 'off') return
  await $.store.set('sessions', withRow(sessions, { ...row, id: sid, view: undefined }))
  $.ui.invalidate('ui.render')
  if (isConfirmed) confirmed.add(sid)
  await deliver(
    $,
    cleared(view, {
      answer: isConfirmed ? 'off_confirmed' : 'off_abandoned',
      clearedBy: 'prompt',
      offersShown: stringLines(await $.store.get('seen').catch(() => undefined)).length,
      tag: tagOf(row?.tag ?? ''),
    }),
  )
}

async function settleOff($, state, { isConfirmed }) {
  try {
    const sid = await $.session.id()
    if (!isConfirmed) state.confirmed.delete(sid)
    const current = state.clearing.get(sid)
    if (current !== undefined) {
      await current
      return
    }
    const task = confirmOffRecord($, { sid, confirmed: state.confirmed, isConfirmed })
    state.clearing.set(sid, task)
    try {
      await task
    } finally {
      state.clearing.delete(sid)
    }
  } catch {
    return
  }
}

async function confirmOffCommand($, state) {
  await settleOff($, state, { isConfirmed: true })
  try {
    const sid = await $.session.id()
    if (state.confirmed.has(sid)) return
    state.confirmed.add(sid)
    await deliver(
      $,
      answeredRecord({
        answer: 'off_confirmed',
        offVia: 'typed',
        version: versionMarkOf(await $.session.version().catch(() => undefined)),
        msToAnswer: undefined,
        isTurnInProgress: false,
        offersShown: stringLines(await $.store.get('seen').catch(() => undefined)).length,
        line: undefined,
        tag: undefined,
      }),
    )
  } catch {
    return
  }
}

export function register(on) {
  const inFlight = new Map()
  const explaining = new Set()
  const askedTimers = new Map()
  const responding = new Set()
  const promptOrigins = new Map()
  const ended = new Set()
  const offState = { clearing: new Map(), confirmed: new Set() }
  const watched = new Set()
  const bridged = new Set()

  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin.kind
    if (isComposer(origin)) {
      void settleOff($, offState, { isConfirmed: isOffCommand(e.text) })
      try {
        if ((await $.session.surfaces()).length > 0) {
          const sid = await $.session.id()
          const count = (promptOrigins.get(sid)?.count ?? 0) + 1
          promptOrigins.set(sid, { origin, count })
          if (origin === 'bridge') bridged.add(sid)
          else bridged.delete(sid)
        }
      } catch {
        // The prompt still goes through; only the survival tally is lost.
      }
    }
    return next(e)
  })

  on('command.run', { command: 'plugin' }, async ($, e, next) => {
    if (isComposer(e.origin.kind) && isOffCommand(`/${e.command} ${e.args}`)) {
      await confirmOffCommand($, offState)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    async function rememberSeen() {
      return stringLines(await $.store.get('seen'))
    }

    async function sendLeftOpen(dropped, cause, offersShown) {
      await deliver($, leftOpen(dropped, cause, offersShown))
    }

    async function updateRow(sid, patch) {
      const sessions = await $.store.get('sessions')
      const nextRows = withRow(sessions, { ...(rowOf(sessions, sid) ?? { id: sid }), ...(patch ?? {}) })
      await $.store.set('sessions', nextRows)
      for (const dropped of openRowsOf(droppedOf(sessions, nextRows))) {
        await sendLeftOpen(
          dropped,
          'pushed_out',
          stringLines(await $.store.get('seen').catch(() => undefined)).length,
        )
      }
    }

    async function runStep(sid, surfaces) {
      revive(ended, sid)
      const origin = promptedAtTurnStart(promptOrigins, sid, e.index)
      if (e.index === 0) promptOrigins.delete(sid)
      const row = rowOf(await $.store.get('sessions'), sid)
      let view = row?.view ?? null

      if (isUnattendedInFlight(view, sid, explaining)) {
        const sessions = await $.store.get('sessions')
        const current = rowOf(sessions, sid)
        if (isUnattendedInFlight(current?.view, sid, explaining)) {
          await $.store.set(
            'sessions',
            withRow(sessions, { ...(current ?? { id: sid }), view: undefined }),
          )
          $.ui.invalidate('ui.render')
          view = null
        } else {
          view = current?.view ?? null
        }
      }

      const skip =
        !(e.index > 0 && e.index % CHECK_EVERY === 0) ||
        row?.offeredTurn === e.turnId ||
        view !== null ||
        !isBandWatched(surfaces, watched, bridged.has(sid))

      if (e.index === 0) {
        if (view?.kind === 'asked') {
          askedTimers.get(sid)?.cancel()
          askedTimers.delete(sid)
          await updateRow(sid, { view: undefined })
          $.ui.invalidate('ui.render')
        }
        if (isOpenView(view) && origin !== undefined) {
          const survived = storedCount(view.promptsSurvived) + origin.count
          const sessions = await $.store.get('sessions')
          const current = rowOf(sessions, sid)
          const currentView = current?.view
          if (!isSameShowing(currentView, view)) return
          const keep = currentView.kind === 'explained' || survived < CLEAR_AFTER_PROMPTS
          await $.store.set(
            'sessions',
            withRow(sessions, {
              ...(current ?? { id: sid }),
              view: keep ? keptPastPrompt(currentView, survived) : undefined,
            }),
          )
          if (keep) {
            if (currentView.kind === 'offer' && currentView.isOffArmed === true) {
              $.ui.invalidate('ui.render')
            }
            return
          }
          $.ui.invalidate('ui.render')
          const typed = storedCount(await $.store.get('typedPastInARow')) + 1
          await $.store.set('typedPastInARow', typed)
          await $.store.set('looksToSkip', looksToSkipAfter(typed))
          await deliver(
            $,
            answeredRecord({
              answer: 'ignored_submit',
              msToAnswer: currentView.shownAt === undefined ? undefined : Date.now() - currentView.shownAt,
              isTurnInProgress: false,
              offersShown: (await rememberSeen()).length,
              line: currentView.line,
              tag: tagOf(current?.tag ?? ''),
              iteration: iterationOf(currentView),
              promptOrigin: origin.origin,
              promptsSurvived: survived,
            }),
          )
        }
        return
      }

      if (skip) return

      let looksToSkip = Math.min(LOOKS_TO_SKIP_MAX, storedCount(await $.store.get('looksToSkip')))
      if (inFlight.has(sid)) return
      if (looksToSkip > 0) {
        await $.store.set('looksToSkip', looksToSkip - 1)
        return
      }

      async function accept(text, seen, known) {
        const parsed = parseProposedLine(text)
        if (parsed.kind !== 'line') {
          return { outcome: parsed.kind === 'none' ? 'none' : 'parse_failed', tag: undefined }
        }
        const tag = parsed.tag
        const key = parsed.line.toLowerCase().replace(/\.$/, '')
        if ([...seen, ...known].some((line) => line.toLowerCase().replace(/\.$/, '') === key)) {
          return { outcome: 'deduped', tag }
        }
        const sessions = await $.store.get('sessions')
        const current = rowOf(sessions, sid)
        if (!isOfferDue(current?.askedTurn, e.turnId, ended.has(sid))) {
          return { outcome: 'stale', tag }
        }
        await $.store.set('seen', [...seen, parsed.line].slice(-SEEN_MAX))
        await updateRow(sid, {
          offeredTurn: e.turnId,
          tag,
          view: {
            kind: 'offer',
            line: parsed.line,
            explanation: parsed.explanation,
            shownAt: Date.now(),
          },
        })
        forgetPrompts(promptOrigins, sid)
        $.ui.invalidate('ui.render')
        return { outcome: 'shown', tag }
      }

      async function check() {
        await updateRow(sid, { askedTurn: e.turnId })
        const seen = await rememberSeen()
        const known = stringLines(await $.store.get('known'))
        const debug = isDebugOn(
          await $.env.get('CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG').catch(() => undefined),
        )
        const startedAt = Date.now()
        let usage = null
        let outcome
        try {
          const result = await $.model.fork({ prompt: proposePrompt(seen, known) })
          usage = forkUsage(result)
          outcome = result.isAnswered
            ? await accept(result.text, seen, known)
            : { outcome: UNANSWERED_OUTCOMES[result.reason], tag: undefined }
        } catch {
          outcome = { outcome: 'error', tag: undefined }
        }
        const latencyMs = Date.now() - startedAt
        if (debug) {
          try {
            const current = rowOf(await $.store.get('sessions'), sid)
            const number = (current?.checked ?? 0) + 1
            await updateRow(sid, {
              checked: number,
              checks: checksWith(checksOf(current?.checks), {
                number,
                step: e.index,
                outcome: outcome.outcome,
                latencyMs,
                at: Date.now(),
              }),
            })
            $.ui.invalidate('ui.render')
          } catch {
            // Debug rows are best effort.
          }
        }
        return proposedRecord({
          ...outcome,
          step: e.index,
          latencyMs,
          usage,
          offersShown: (await rememberSeen()).length,
        })
      }

      inFlight.set(
        sid,
        check()
          .then((record) => deliver($, record))
          .catch(() => undefined)
          .finally(() => inFlight.delete(sid)),
      )
    }

    $.session
      .surfaces()
      .then(async (surfaces) => {
        if (surfaces.length === 0) return
        if (isBandShown(surfaces, watched)) {
          const sid = await $.session.id()
          await runStep(sid, surfaces)
        }
      })
      .catch(() => undefined)

    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ui = withSurface(e.surface, $.ui.resolve(e))
    const sid = await $.session.id()
    watched.add(e.surface)

    const entry = rowOf(await $.store.get('sessions'), sid)
    let view = entry?.view ?? null
    const tag = tagOf(entry?.tag ?? '')
    const debug = isDebugOn(await $.env.get('CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG').catch(() => undefined))
    const external = isOptIn(await $.env.get('USER_TYPE').catch(() => undefined))
    const checks = debug ? checksOf(entry?.checks) : []

    async function updateViewForRender(view) {
      const sessions = await $.store.get('sessions')
      const nextRows = withRow(sessions, { ...(rowOf(sessions, sid) ?? { id: sid }), view })
      await $.store.set('sessions', nextRows)
      for (const dropped of openRowsOf(droppedOf(sessions, nextRows))) {
        await deliver(
          $,
          leftOpen(
            dropped,
            'pushed_out',
            stringLines(await $.store.get('seen').catch(() => undefined)).length,
          ),
        )
      }
    }

    async function remember(line) {
      const known = stringLines(await $.store.get('known'))
      if (!known.some((topic) => topic.toLowerCase() === line.toLowerCase())) {
        await $.store.set('known', [...known, line].slice(-SEEN_MAX))
      }
    }

    async function clearView() {
      await updateViewForRender(undefined)
      $.ui.invalidate('ui.render')
    }

    async function knewThis(line) {
      try {
        await remember(line)
      } finally {
        await clearView()
      }
    }

    async function ask({ line, iteration }) {
      await updateViewForRender({ kind: 'asked', line, iteration, shownAt: Date.now() })
      $.ui.invalidate('ui.render')
      askedTimers.get(sid)?.cancel()
      askedTimers.set(
        sid,
        $.clock.after(ASKED_MS, () => {
          void timedOut()
        }),
      )
    }

    async function timedOut() {
      askedTimers.delete(sid)
      const current = rowOf(await $.store.get('sessions'), sid)?.view
      if (current?.kind !== 'asked') return
      await clearView()
      await answer('ignored_timeout', {
        line: current.line,
        shownAt: current.shownAt,
        iteration: iterationOf(current),
      })
    }

    async function fail(reason) {
      await updateViewForRender({ kind: 'failed', reason })
      $.ui.invalidate('ui.render')
    }

    async function answer(value, context, extra = {}) {
      if (value !== 'ignored_timeout') {
        try {
          if (storedCount(await $.store.get('typedPastInARow')) > 0) {
            await $.store.set('typedPastInARow', 0)
            await $.store.set('looksToSkip', 0)
          }
        } catch {
          // The counters are advisory.
        }
      }
      const seen = stringLines(await $.store.get('seen'))
      await deliver(
        $,
        answeredRecord({
          answer: value,
          msToAnswer: context.shownAt === undefined ? undefined : Date.now() - context.shownAt,
          isTurnInProgress: e.props.isWorking,
          offersShown: seen.length,
          line: context.line,
          tag,
          iteration: context.iteration,
          ...extra,
        }),
      )
    }

    async function armOff(currentView, context) {
      try {
        const sessions = await $.store.get('sessions')
        const live = rowOf(sessions, sid)?.view
        if (!isSameShowing(live, currentView) || live.kind !== 'offer') return
        if (live.isOffArmed === true) {
          await turnOff(live.line, context, 'offer')
          return
        }
        await $.store.set(
          'sessions',
          withRow(sessions, {
            ...(rowOf(sessions, sid) ?? { id: sid }),
            view: { ...live, isOffArmed: true },
          }),
        )
        $.ui.invalidate('ui.render')
      } catch {
        return
      }
    }

    async function turnOff(line, context, offVia) {
      let filled = false
      try {
        if (await promptHasText($, await $.prompt.read().catch(() => undefined), OFF_BOX_BUSY)) {
          return
        }
        await updateViewForRender({ kind: 'off', line, shownAt: Date.now() })
        $.ui.invalidate('ui.render')
        const version = versionMarkOf(await $.session.version().catch(() => undefined))
        void answer('turn_off', context, { version, offVia })
        filled = (
          await $.prompt.fill({ text: OFF_COMMAND, mode: 'replace' })
        ).isFilled
      } catch {
        // A refusal is handled below.
      }
      if (!filled) {
        void answer('off_failed', context)
        await fail('turn_off').catch(() => undefined)
      }
    }

    async function showExplanation(line, text, iteration) {
      await updateViewForRender({
        kind: 'explained',
        line,
        text,
        iteration,
        shownAt: Date.now(),
      })
      forgetPrompts(promptOrigins, sid)
      $.ui.invalidate('ui.render')
    }

    async function explain(line, direction, iteration) {
      explaining.add(sid)
      try {
        await updateViewForRender({ kind: 'explaining', line, iteration })
        $.ui.invalidate('ui.render')
        const startedAt = Date.now()
        const result = await $.model.fork({ prompt: explainPrompt(line, direction) }).catch(
          () => undefined,
        )
        const text = result?.isAnswered ? result.text.trim() : ''
        const parsed =
          result?.isAnswered === true && parseExplanation(text).length === 0 ? 'empty' : 'shown'
        const outcome = result?.isAnswered ? parsed : 'fork'
        const record = explainedRecord({
          outcome,
          direction: direction?.direction ?? 'first',
          latencyMs: Date.now() - startedAt,
          usage: result === undefined ? null : forkUsage(result),
        })
        const previous =
          direction !== undefined ? { text: direction.previous, iteration: iteration - 1 } : undefined
        const nextText = outcome === 'shown' ? { text, iteration } : previous
        if (nextText === undefined) await fail('explain')
        else await showExplanation(line, nextText.text, nextText.iteration)
        await deliver($, record)
      } finally {
        explaining.delete(sid)
      }
    }

    if (isUnattendedInFlight(view, sid, explaining)) {
      const sessions = await $.store.get('sessions')
      const current = rowOf(sessions, sid)
      if (isUnattendedInFlight(current?.view, sid, explaining)) {
        await $.store.set(
          'sessions',
          withRow(sessions, { ...(current ?? { id: sid }), view: undefined }),
        )
      }
      return next(e)
    }

    if (e.props.hasSurvey && view?.kind !== 'explained') return next(e)

    const aboutOpen = view?.kind === 'offer' ? await aboutShown($, sid) : undefined

    function renderView() {
      if (view === null) return null
      if (view.kind === 'making') return makingRow(ui)
      if (view.kind === 'ready') {
        let done = false
        const mark = (value) => () => {
          if (done) return
          done = true
          void answer(value, { line: view.line, shownAt: view.shownAt })
          void clearView()
        }
        return readyRow(ui, view.url, {
          helpful: mark('page_helpful'),
          notHelpful: mark('page_not_helpful'),
          unread: mark('page_unread'),
        })
      }
      if (view.kind === 'failed') return failedRow(ui, view.reason, () => void clearView())
      if (view.kind === 'explaining') return explainingRow(ui)
      if (view.kind === 'asked') {
        let done = false
        const finish = (run) => () => {
          if (done) return
          done = true
          askedTimers.get(sid)?.cancel()
          askedTimers.delete(sid)
          run()
        }
        const iteration = iterationOf(view)
        const recordThen = (value, after = clearView) =>
          finish(() => {
            void answer(value, { line: view.line, shownAt: view.shownAt, iteration })
            void after()
          })
        const knows = () => knewThis(view.line)
        if (iteration !== undefined) {
          return explainedAskedRow(ui, {
            helpful: recordThen('explained_helpful', knows),
            notUnderstood: recordThen('explained_not_understood'),
            dismiss: finish(() => void timedOut()),
          })
        }
        return askedRow(ui, {
          helpful: recordThen('helpful', knows),
          notRelevant: recordThen('not_relevant'),
          notUnderstood: recordThen('not_understood'),
          off:
            hasOwnComposer(e.surface)
              ? undefined
              : finish(() =>
                  void turnOff(
                    view.line,
                    { line: view.line, shownAt: view.shownAt },
                    'row',
                  ),
                ),
          dismiss: finish(() => void timedOut()),
        })
      }
      if (view.kind === 'off') return null

      const { line, shownAt } = view
      const iteration = iterationOf(view)
      let done = false
      const once = (value, after) => () => {
        if (done) return
        done = true
        void answer(value, { line, shownAt, iteration })
        void after()
      }
      if (view.kind === 'explained') {
        const cards = fitCardsToColumns(parseExplanation(view.text), e.props.bodyColumns)
        const context = { line, shownAt, iteration }
        async function chat() {
          if (responding.has(sid)) return
          responding.add(sid)
          try {
            const draft = respondDraft(line, cards, tag)
            if (await promptHasText($, await $.prompt.read().catch(() => undefined), RESPOND_BOX_BUSY)) {
              return
            }
            const filled = await $.prompt
              .fill({ text: `${draft}\n\n`, mode: 'replace' })
              .catch(() => undefined)
            if (filled?.isFilled === true) {
              await answer('respond', context)
              await knewThis(line)
              return
            }
            if (filled?.refusal !== 'no_composer') {
              $.ui.toast(filled?.refusal === 'dialog' ? RESPOND_BLOCKED : RESPOND_NOT_FILLED)
              $.ui.invalidate('ui.render')
              return
            }
            await answer('respond', context)
            await knewThis(line).catch(() => undefined)
            await $.prompt.submit({ text: draft }).catch(() => undefined)
          } finally {
            responding.delete(sid)
          }
        }
        return explainedRow(
          ui,
          line,
          cards,
          e.props.hasSurvey
            ? null
            : {
                gotIt: once('got_it', () => knewThis(line)),
                respond: () => {
                  if (!done) {
                    done = true
                    void chat()
                  }
                },
                dismiss: once('dismiss', () => ask({ line, iteration })),
              },
          tag,
        )
      }

      const ownsComposer = hasOwnComposer(e.surface) || external
      return offerRow(
        ui,
        line,
        {
          explain: once('yes_explain', () => {
            const explanation = view.explanation
            return explanation !== undefined && parseExplanation(explanation).length > 0
              ? showExplanation(line, explanation, 1)
              : explain(line, undefined, 1)
          }),
          knew: once('know_it', () => knewThis(line)),
          off: ownsComposer
            ? undefined
            : () => {
                if (!done) {
                  done = true
                  void armOff(view, { line, shownAt, iteration })
                }
              },
          later: once('not_now', () => ask({ line })),
        },
        view.isOffArmed === true,
        {
          isOpen: aboutOpen === aboutKeyOf(view),
          surface: e.surface,
          ...aboutFrame(hasOwnComposer(e.surface), e.props, external),
          onPress: () => {
            void toggleAbout($, { sid, key: aboutKeyOf(view) })
          },
        },
        tag,
      )
    }

    const tree = renderView()
    return checks.length > 0 && !e.props.hasSurvey ? debugRows(ui, checks, tree) : (tree ?? next(e))
  })

  on('session.detach', async ($, e, next) => {
    forgetDetached(watched, await $.session.surfaces())
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    ended.add(e.sessionId)
    bridged.delete(e.sessionId)
    try {
      const sessions = await $.store.get('sessions')
      const row = rowOf(sessions, e.sessionId)
      const view = row?.view
      if (isOpenView(view)) {
        await $.store.set('sessions', withViewCleared(sessions, e.sessionId))
        await deliver(
          $,
          leftOpen(
            { view, tag: row?.tag },
            'session_end',
            stringLines(await $.store.get('seen').catch(() => undefined)).length,
          ),
        )
      }
      if (view?.kind === 'off') {
        await $.store.set('sessions', withViewCleared(sessions, e.sessionId))
        await deliver(
          $,
          cleared(view, {
            answer: 'off_abandoned',
            clearedBy: 'session_end',
            offersShown: stringLines(await $.store.get('seen').catch(() => undefined)).length,
            tag: tagOf(row?.tag ?? ''),
          }),
        )
      }
    } catch {
      // Session teardown is best effort.
    }
    return next(e)
  })
}
