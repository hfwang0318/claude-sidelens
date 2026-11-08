import { expect, test } from 'claude-code/testing'
import { isTurnEnd } from '../lib/data.js'
import { OFFER, install, mountBand, settle, trigger } from './harness.js'

const proposal = (line: string) => ({
  isAnswered: true,
  text: `learn: ${line}\ntag: Heads up\nexplain:\n**${line}**\nA short explanation.`,
  usage: OFFER.usage,
})

const stepOf =
  (stop: (index: number) => string) =>
  (e: any) => ({
    turnId: e.turnId,
    index: e.index,
    answer: '',
    toolUses: [],
    stopReason: stop(e.index),
    usage: null,
  })

test('isTurnEnd only accepts reasons that finish the turn', () => {
  expect(isTurnEnd('end_turn')).toBe(true)
  expect(isTurnEnd('max_tokens')).toBe(true)
  expect(isTurnEnd('stop_sequence')).toBe(true)
  expect(isTurnEnd('refusal')).toBe(true)
  expect(isTurnEnd('tool_use')).toBe(false)
  expect(isTurnEnd('pause_turn')).toBe(false)
  expect(isTurnEnd('compaction')).toBe(false)
  expect(isTurnEnd(null)).toBe(false)
})

test(
  'turnEnd checks a one-step turn when it finishes',
  { options: { checkCadence: 'turnEnd' } },
  async ($, on) => {
    const harness = install(on, { fork: () => OFFER })
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(40)

    expect(harness.forks).toHaveLength(1)
    expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('offer')
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_proposed' && entry.props?.trigger === 'turnEnd',
      ),
    ).toBe(true)
  },
)

test(
  'turnEnd waits for a step that finishes the turn',
  { options: { checkCadence: 'turnEnd' } },
  async ($, on) => {
    const harness = install(on, {
      fork: () => OFFER,
      step: stepOf((index) => (index >= 12 ? 'end_turn' : 'tool_use')),
    })
    await trigger($, harness, { index: 6, turnId: 't1' })
    await settle(40)
    expect(harness.forks).toHaveLength(0)

    await trigger($, harness, { index: 12, turnId: 't1' })
    await settle(40)
    expect(harness.forks).toHaveLength(1)
    expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('offer')
  },
)

test('the fixed cadence still ignores a one-step turn', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness, { index: 0, turnId: 't1' })
  await settle(40)
  expect(harness.forks).toHaveLength(0)
})

test(
  'autoSend wins over turnEnd so the plugin cannot chain its own turns',
  { options: { autoSend: true, checkCadence: 'turnEnd' } },
  async ($, on) => {
    const harness = install(on, { fork: () => OFFER })
    // A one-step turn would be checked by turnEnd alone; with autoSend on the
    // cadence stays fixed, so it is not checked.
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(40)
    expect(harness.forks).toHaveLength(0)
    expect(harness.submits).toHaveLength(0)
  },
)

test(
  'turnEnd drains a completed turn into the backlog',
  { options: { checkCadence: 'turnEnd', backlog: true } },
  async ($, on) => {
    let call = 0
    const harness = install(on, {
      fork: () => {
        call += 1
        if (call === 1) return proposal('Note 1.')
        if (call === 2) return proposal('Note 2.')
        return { isAnswered: true, text: 'learn: none', usage: OFFER.usage }
      },
    })
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(100)

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view.kind).toBe('offer')
    expect(row.view.line).toBe('Note 1.')
    expect(row.backlog.map((entry: any) => entry.line)).toEqual(['Note 2.'])
    expect(harness.forks).toHaveLength(3)

    // The extra note is labeled as another note, not as an earlier one, and
    // its deferred official proposed record carries the drain pass.
    const ui = await mountBand($)
    await ui.press({ key: 'Knew this already' })
    await settle(100)
    expect(JSON.stringify(await ui.drawn())).toContain('Another note')
    expect(
      harness.events.some(
        (entry) =>
          entry.event === 'you_should_know_proposed' &&
          entry.props?.queued === true &&
          entry.props?.pass === 2,
      ),
    ).toBe(true)
    await ui.unmount()
  },
)

test(
  'drain shows a queued note when the first panel was closed early',
  { options: { checkCadence: 'turnEnd', backlog: true } },
  async ($, on) => {
    let harness: ReturnType<typeof install>
    let call = 0
    harness = install(on, {
      fork: () => {
        call += 1
        if (call === 1) return proposal('Note 1.')
        if (call === 2) {
          // Simulate the person closing the first panel while this pass runs.
          const rows = (harness.saved.get('sessions') ?? []) as any[]
          harness.saved.set(
            'sessions',
            rows.map((row) => ({ ...row, view: undefined })),
          )
          return proposal('Note 2.')
        }
        return { isAnswered: true, text: 'learn: none', usage: OFFER.usage }
      },
    })
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(120)

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.view.kind).toBe('offer')
    expect(row.view.line).toBe('Note 2.')
    expect(row.view.fromDrain).toBe(true)
    expect(row.backlog ?? []).toEqual([])
  },
)

test(
  'a turn that ends during a drain is checked once the lock clears',
  { options: { checkCadence: 'turnEnd', backlog: true } },
  async ($, on) => {
    let calls = 0
    let releasePass2: () => void = () => {}
    let pass2Started: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releasePass2 = resolve
    })
    const started = new Promise<void>((resolve) => {
      pass2Started = resolve
    })
    let pass2Finished: () => void = () => {}
    const pass2Done = new Promise<void>((resolve) => {
      pass2Finished = resolve
    })
    const none = () => ({ isAnswered: true, text: 'learn: none', usage: OFFER.usage })
    const harness = install(on, {
      fork: async () => {
        calls += 1
        if (calls === 1) return proposal('Note 1.')
        if (calls === 2) {
          pass2Started()
          await gate
          pass2Finished()
          return none()
        }
        if (calls === 3) return proposal('Note 2.')
        return none()
      },
    })
    // An explained panel lets checks run while it waits.
    harness.saved.set('sessions', [
      {
        id: 's1',
        view: {
          kind: 'explained',
          line: 'Open note.',
          text: '**Open**\nBody.',
          iteration: 1,
          shownAt: 1,
        },
      },
    ])

    await trigger($, harness, { index: 0, turnId: 't1' })
    await started

    // This turn ends while t1's drain pass still holds the lock.
    await trigger($, harness, { index: 0, turnId: 't2' })
    releasePass2()
    await pass2Done
    await settle(120)

    // t1: Note 1, then none. t2 is retried after the lock clears:
    // Note 2, then none.
    expect(calls).toBe(4)
    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.backlog.map((entry: any) => entry.line)).toEqual(['Note 1.', 'Note 2.'])
  },
)

test(
  'turnEnd stops draining when the first check finds nothing',
  { options: { checkCadence: 'turnEnd', backlog: true } },
  async ($, on) => {
    const harness = install(on, {
      fork: () => ({ isAnswered: true, text: 'learn: none', usage: OFFER.usage }),
    })
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(100)
    expect(harness.forks).toHaveLength(1)
  },
)

test(
  'turnEnd keeps to one note without the backlog',
  { options: { checkCadence: 'turnEnd' } },
  async ($, on) => {
    let call = 0
    const harness = install(on, {
      fork: () => {
        call += 1
        return call === 1 ? proposal('Note 1.') : proposal('Note 2.')
      },
    })
    await trigger($, harness, { index: 0, turnId: 't1' })
    await settle(100)
    expect(harness.forks).toHaveLength(1)
    expect(harness.saved.get('sessions') as any[]).toHaveLength(1)
  },
)
