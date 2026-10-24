import { expect, test } from 'claude-code/testing'
import { OFFER, install, mountBand, settle, trigger } from './harness.js'

test('a third-party model fork produces an offer in the AbovePrompt band', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)

  const sessions = harness.saved.get('sessions') as any[]
  expect(sessions?.[0]?.view?.kind).toBe('offer')
  expect(sessions?.[0]?.view?.line).toBe('The build uses pnpm workspaces.')
  expect(sessions?.[0]?.tag).toBe('Heads up')
  expect(harness.forks).toHaveLength(1)
  // The plugin sends only a prompt. The engine supplies the session's model,
  // so a zhipu/GLM session works without any provider-specific branch.
  expect(Object.keys(harness.forks[0])).toEqual(['prompt'])
  expect(harness.forks[0].prompt).toContain('You are a helpful observer')
  expect(harness.events.some((entry) => entry.event === 'you_should_know_proposed')).toBe(true)

  const ui = await mountBand($)
  expect(JSON.stringify(await ui.drawn())).toContain('The build uses pnpm workspaces.')
  expect(await ui.find({ key: 'Learn more' })).toBeDefined()
  expect(await ui.find({ key: 'Knew this already' })).toBeDefined()
  await ui.press({ key: 'Learn more' })
  await settle(300)
  expect(await ui.find({ key: 'Chat in main session' })).toBeDefined()
  await ui.unmount()
})

test('checks every sixth step and dedupes the same proposal', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })

  for (let index = 0; index <= 6; index += 1) {
    await trigger($, harness, { index, turnId: 't1' })
  }
  expect(harness.forks).toHaveLength(1)
  expect((harness.saved.get('seen') as string[]).length).toBe(1)

  // Dismissing a proposal clears its row; the next sixth step checks again.
  harness.saved.set('sessions', [{ id: 's1' }])
  await trigger($, harness, { index: 12, turnId: 't2' })
  expect(harness.forks).toHaveLength(2)
  expect((harness.saved.get('seen') as string[]).length).toBe(1)
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_proposed' &&
        entry.props?.outcome?.value === 'deduped',
    ),
  ).toBe(true)
})

test('subagent steps do not start a check', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness, { index: 6, agentId: 'a1' })
  expect(harness.forks).toHaveLength(0)
})

test('knew this already clears the band and remembers the topic', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($)
  await ui.press({ key: 'Knew this already' })
  await settle(250)

  expect((harness.saved.get('sessions') as any[])[0].view).toBeUndefined()
  expect(harness.saved.get('known')).toEqual(['The build uses pnpm workspaces.'])
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('dismiss asks for feedback and the 20-second timeout clears it', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($)
  await ui.press({ key: 'Dismiss' })
  await settle(100)

  expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('asked')
  expect(await ui.find({ key: 'That was helpful' })).toBeDefined()

  await harness.clock.advance(20_000)
  await settle(100)
  expect((harness.saved.get('sessions') as any[])[0].view).toBeUndefined()
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_answered' &&
        entry.props?.answer?.value === 'ignored_timeout',
    ),
  ).toBe(true)
})

test('turning suggestions off arms once and fills the plugin command', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($)

  await ui.press({ key: 'Disable' })
  await settle(150)
  expect(await ui.find({ key: 'Press again to disable' })).toBeDefined()

  await ui.press({ key: 'Press again to disable' })
  await settle(200)
  expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('off')
  expect(harness.fills).toContain('/plugin disable sidelens')
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_answered' &&
        entry.props?.answer?.value === 'turn_off',
    ),
  ).toBe(true)
})

test('two prompts clear an unanswered offer and raise the skip count', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)

  for (const text of ['next one', 'next two']) {
    await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    await settle(50)
  }
  await trigger($, harness, { index: 0, turnId: 't2' })

  expect((harness.saved.get('sessions') as any[])[0].view).toBeUndefined()
  expect(harness.saved.get('typedPastInARow')).toBe(1)
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_answered' &&
        entry.props?.answer?.value === 'ignored_submit',
    ),
  ).toBe(true)
})

test('Learn more fetches an explanation when the reply carried none', async ($, on) => {
  let calls = 0
  const harness = install(on, {
    fork: () => {
      calls += 1
      if (calls === 1) {
        return {
          isAnswered: true,
          text: 'learn: The build uses pnpm workspaces.\ntag: Heads up\n',
          usage: OFFER.usage,
        }
      }
      return {
        isAnswered: true,
        text: '**Workspace build**\nUse pnpm from the repository root.',
        usage: OFFER.usage,
      }
    },
  })
  await trigger($, harness)
  const ui = await mountBand($)
  await ui.press({ key: 'Learn more' })
  await settle(350)

  expect(harness.forks).toHaveLength(2)
  expect(harness.forks[1].prompt).toContain('The person watching you work said yes to')
  expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('explained')
  expect(await ui.find({ key: 'Understood' })).toBeDefined()
})

test('the desktop band uses native buttons and hides the star column', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($, 'desktop')
  const button = await ui.find({ key: 'Learn more' })
  expect(button).toBeDefined()
  expect(button?.props?.hotkey).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('"width":2')
})


test('Chat in main session fills a quoted draft and clears the offer', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($)
  await ui.press({ key: 'Learn more' })
  await settle(300)
  await ui.press({ key: 'Chat in main session' })
  await settle(300)

  expect(harness.fills).toHaveLength(1)
  expect(harness.fills[0]).toContain('Here is a note offered by a side agent:')
  expect(harness.fills[0]).toContain('> Heads up \xB7 The build uses pnpm workspaces.')
  expect((harness.saved.get('sessions') as any[])[0].view).toBeUndefined()
  expect(harness.saved.get('known')).toEqual(['The build uses pnpm workspaces.'])
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_answered' &&
        entry.props?.answer?.value === 'respond',
    ),
  ).toBe(true)
})


test('Turn off suggestions on the feedback row turns suggestions off at once', async ($, on) => {
  const harness = install(on, { fork: () => OFFER })
  await trigger($, harness)
  const ui = await mountBand($)
  await ui.press({ key: 'Dismiss' })
  await settle(120)
  await ui.press({ key: 'Turn off suggestions' })
  await settle(220)

  expect((harness.saved.get('sessions') as any[])[0].view.kind).toBe('off')
  expect(harness.fills).toContain('/plugin disable sidelens')
  expect(
    harness.events.some(
      (entry) =>
        entry.event === 'you_should_know_answered' &&
        entry.props?.answer?.value === 'turn_off',
    ),
  ).toBe(true)
})

test('sidelens yields while the official You should know mod is enabled', async ($, on) => {
  const harness = install(on, {
    fork: () => OFFER,
    enabledPlugins: { 'cc-plugin-you-should-know@builtin': true },
  })
  harness.saved.set('sessions', [
    { id: 's1', view: { kind: 'offer', line: 'A stale offer.', shownAt: 1 } },
  ])

  await trigger($, harness, { index: 0, turnId: 't1' })
  expect(harness.forks).toHaveLength(0)
  expect((harness.saved.get('sessions') as any[])[0].view).toBeUndefined()

  const ui = await mountBand($)
  expect(JSON.stringify(await ui.drawn())).toContain('engine')
})

test('official plugin aliases also suspend sidelens', async ($, on) => {
  const harness = install(on, {
    fork: () => OFFER,
    enabledPlugins: { 'you-should-know@builtin': true },
  })
  await trigger($, harness)
  expect(harness.forks).toHaveLength(0)
})
