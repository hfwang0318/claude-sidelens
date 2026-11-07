import { expect, test } from 'claude-code/testing'
import { BACKLOG_TTL_MS, BACKLOG_TTL_PROMPTS } from '../lib/constants.js'
import { liveBacklog, withoutBacklogLine } from '../lib/data.js'
import { backlogLabel } from '../lib/ui.js'
import { OFFER, install, mountBand, settle, trigger } from './harness.js'

const item = (line: string, proposedAt: number, promptSeq = 0) => ({
  line,
  tag: 'Heads up',
  proposedAt,
  promptSeq,
})

const proposal = (line: string) => ({
  isAnswered: true,
  text: `learn: ${line}\ntag: Heads up\nexplain:\n**${line}**\nA short explanation.`,
  usage: OFFER.usage,
})

function sequence() {
  let call = 0
  return () => {
    call += 1
    return proposal(`Note ${call}.`)
  }
}

test('liveBacklog drops a note past the time or prompt bound', () => {
  const now = 1_000_000
  const row = {
    promptSeq: 5,
    backlog: [
      item('fresh', now - 1000, 4),
      item('old by time', now - BACKLOG_TTL_MS - 1, 5),
      item('old by prompts', now - 1000, 5 - BACKLOG_TTL_PROMPTS),
      { tag: 'Heads up', proposedAt: now },
    ],
  }
  expect(liveBacklog(row, now).map((entry: any) => entry.line)).toEqual(['fresh'])
})

test('withoutBacklogLine removes a matching topic', () => {
  const items = [item('The build uses pnpm.', 1), item('Another note.', 1)]
  expect(
    withoutBacklogLine(items, 'the build uses pnpm').map((entry: any) => entry.line),
  ).toEqual(['Another note.'])
})

test('backlogLabel marks a note as earlier', () => {
  expect(backlogLabel(30_000)).toBe('Earlier note \xB7 found just now')
  expect(backlogLabel(12 * 60_000)).toBe('Earlier note \xB7 found 12m ago')
  expect(backlogLabel(2 * 60 * 60_000)).toBe('Earlier note \xB7 found 2h ago')
})

test(
  'backlog queues a note while an explanation waits',
  { options: { backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    await trigger($, harness, { index: 6, turnId: 't2' })

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view.kind).toBe('explained')
    expect(row.backlog.map((entry: any) => entry.line)).toEqual(['Note 2.'])
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_backlog' && entry.props?.outcome === 'queued',
      ),
    ).toBe(true)
    // Queued is not shown: the official proposed event waits for the display.
    expect(
      harness.events.some(
        (entry) => entry.event === 'you_should_know_proposed' && entry.props?.queued === true,
      ),
    ).toBe(false)
    await ui.unmount()
  },
)

test(
  'handling the explanation pops the next earlier note',
  { options: { backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    await trigger($, harness, { index: 6, turnId: 't2' })
    await ui.press({ key: 'Understood' })
    await settle(300)

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view.kind).toBe('offer')
    expect(row.view.fromBacklog).toBe(true)
    expect(row.view.line).toBe('Note 2.')
    expect(row.backlog).toEqual([])
    expect(JSON.stringify(await ui.drawn())).toContain('Earlier note')
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_backlog' && entry.props?.outcome === 'shown',
      ),
    ).toBe(true)
    // The official proposed record appears only once the note is on screen.
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_proposed' &&
          entry.props?.queued === true &&
          entry.props?.outcome?.value === 'shown',
      ),
    ).toBe(true)

    // Opening an earlier note re-forks the explanation instead of reusing the
    // one captured when it was queued.
    const forks = harness.forks.length
    await ui.press({ key: 'Learn more' })
    await settle(300)
    expect(harness.forks).toHaveLength(forks + 1)
    expect(harness.forks.at(-1)?.prompt).toContain('The person watching you work said yes to')
    expect(JSON.stringify(await ui.drawn())).toContain('Earlier note')
    await ui.unmount()
  },
)

test(
  'the backlog stops at three notes',
  { options: { backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    for (const turnId of ['t2', 't3', 't4']) {
      await trigger($, harness, { index: 6, turnId })
    }

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.backlog).toHaveLength(3)
    const forks = harness.forks.length
    await trigger($, harness, { index: 6, turnId: 't5' })
    expect(harness.forks).toHaveLength(forks)
    await ui.unmount()
  },
)

test(
  'a queued note expires after the person moves on',
  { options: { backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    await trigger($, harness, { index: 6, turnId: 't2' })

    for (const turnId of ['t3', 't4', 't5', 't6']) {
      await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false })
      await settle(30)
      await trigger($, harness, { index: 0, turnId })
    }
    // Any step expires the queue; index 1 does not start a new check.
    await trigger($, harness, { index: 1, turnId: 't7' })

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.backlog).toEqual([])
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_backlog' && entry.props?.outcome === 'dropped_ttl',
      ),
    ).toBe(true)
    await ui.unmount()
  },
)

test(
  'typing past an offer drops the rest of the backlog',
  { options: { backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    await trigger($, harness, { index: 6, turnId: 't2' })
    await trigger($, harness, { index: 6, turnId: 't3' })
    await ui.press({ key: 'Understood' })
    await settle(300)
    expect(((harness.saved.get('sessions') as any[])[0].backlog ?? []).length).toBe(1)

    for (const text of ['next one', 'next two']) {
      await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
      await settle(30)
    }
    await trigger($, harness, { index: 0, turnId: 't4' })

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view).toBeUndefined()
    expect(row.backlog).toEqual([])
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_backlog' &&
          entry.props?.outcome === 'dropped_ignored',
      ),
    ).toBe(true)
    await ui.unmount()
  },
)

test(
  'backlog stays off while autoSend is on',
  { options: { autoSend: true, backlog: true } },
  async ($, on) => {
    const harness = install(on, { fork: sequence() })
    await trigger($, harness, { index: 6, turnId: 't1' })
    const ui = await mountBand($)
    await ui.press({ key: 'Learn more' })
    await settle(300)
    expect(harness.submits).toHaveLength(1)

    await trigger($, harness, { index: 6, turnId: 't2' })
    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view.kind).toBe('offer')
    expect(row.backlog ?? []).toEqual([])
    expect(harness.events.some((entry) => entry.event === 'you_should_know_backlog')).toBe(false)
    await ui.unmount()
  },
)
