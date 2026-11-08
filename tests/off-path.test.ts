import { expect, test } from 'claude-code/testing'
import { OFFER, install, settle, trigger } from './harness.js'

const NONE = { isAnswered: true, text: 'learn: none', usage: OFFER.usage }

test(
  'all capability switches off keep the official six-step path',
  { options: { autoSend: false, backlog: false, checkCadence: 'fixed' } },
  async ($, on) => {
    const harness = install(on, { fork: () => NONE })

    // The first check is step 6, not step 0 or any step before it.
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await trigger($, harness, { index, turnId: 't1' })
    }
    expect(harness.forks).toHaveLength(0)

    await trigger($, harness, { index: 6, turnId: 't1' })
    expect(harness.forks).toHaveLength(1)
    await trigger($, harness, { index: 11, turnId: 't1' })
    expect(harness.forks).toHaveLength(1)
    await trigger($, harness, { index: 12, turnId: 't1' })
    expect(harness.forks).toHaveLength(2)
    await trigger($, harness, { index: 18, turnId: 't1' })
    expect(harness.forks).toHaveLength(3)

    // A person's prompt must not create backlog state when the feature is off.
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false })
    await settle(50)
    await trigger($, harness, { index: 0, turnId: 't2' })

    const row = (harness.saved.get('sessions') as any[])[0]
    expect(row.backlog).toBeUndefined()
    expect(row.promptSeq).toBeUndefined()

    // No backlog event and no project-only telemetry properties.
    expect(
      harness.events.some((entry: any) => entry.event === 'you_should_know_backlog'),
    ).toBe(false)
    for (const entry of harness.events) {
      expect(entry.props?.queued).toBeUndefined()
      expect(entry.props?.trigger).toBeUndefined()
      expect(entry.props?.pass).toBeUndefined()
    }
  },
)
