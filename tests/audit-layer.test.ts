import { expect, test } from 'claude-code/testing'
import { install, mountBand, settle, trigger } from './harness.js'

const AUDIT = {
  isAnswered: true,
  text: 'audit: The edit is recorded but nothing shows the test passing.\nkind: unsupported_claim\nclauses:\n- 1 none\n- 2 calc.py edit',
  usage: { input_tokens: 1, output_tokens: 1 },
}

const WORKED = (e: any) => ({
  turnId: e.turnId,
  index: e.index,
  answer: 'Done. The tests pass.',
  toolUses: [
    { name: 'Edit', input: { file_path: 'calc.py', new_string: 'return sum(xs)' } },
    { name: 'Bash', input: { command: 'python test_calc.py' } },
  ],
  stopReason: 'end_turn',
  usage: null,
})

async function submit($: any, text: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' } })
  await settle(40)
}

test('the audit stays off unless its switch is on', async ($, on) => {
  const harness = install(on, { step: WORKED, fork: () => AUDIT })
  await trigger($, harness, { index: 6 })
  await submit($, 'carry on')
  expect(harness.forks.filter((request) => request.prompt.includes('You are auditing'))).toHaveLength(0)
})

// The positive path cannot be asserted through this harness: the mock and the
// plugin both register `turn.step`, and which one the plugin's `next(e)` reaches
// depends on tier order, not on the plugin.  It is verified against a real
// engine instead (see docs/AUDIT.md).  What is asserted here is the inert path.
test('the audit switch alone never forks a second time on the official path', async ($, on) => {
  const harness = install(on, { step: WORKED, env: { SIDELENS_AUDIT: '1' }, fork: () => AUDIT })
  await submit($, 'Fix the total and run the test.')
  await trigger($, harness, { index: 6 })
  await submit($, 'next')
  expect(harness.forks.filter((request) => request.prompt.includes('You are auditing'))).toHaveLength(0)
})

test('a turn that changed nothing is not audited', async ($, on) => {
  const harness = install(on, {
    step: (e: any) => ({ turnId: e.turnId, index: e.index, answer: 'It turns the cache on.', toolUses: [] }),
    env: { SIDELENS_AUDIT: '1' },
    fork: () => AUDIT,
  })
  await trigger($, harness, { index: 6 })
  await submit($, 'thanks')
  expect(harness.forks.filter((request) => request.prompt.includes('You are auditing'))).toHaveLength(0)
})
