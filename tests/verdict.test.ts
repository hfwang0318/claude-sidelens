import { expect, test } from 'claude-code/testing'
import { isClean, parseVerdict, verdictPrompt } from '../lib/verdict.js'

test('a clean verdict needs solved yes and no complaints', () => {
  const clean = { solved: 'yes', gaps: [], shortcuts: [], needsApproval: [] }
  expect(isClean(clean)).toBe(true)
  expect(isClean({ ...clean, solved: 'partly' })).toBe(false)
  expect(isClean({ ...clean, gaps: ['x'] })).toBe(false)
})

test('a fenced or chatty reply still parses', () => {
  const json = '{"goal":"add retry","solved":"partly","gaps":["429"],"shortcuts":[],"needsApproval":[]}'
  expect(parseVerdict(`Here you go:\n\`\`\`json\n${json}\n\`\`\``)?.solved).toBe('partly')
  expect(parseVerdict(`noise ${json} tail`)?.gaps).toEqual(['429'])
})

test('an unusable reply is dropped instead of guessed', () => {
  expect(parseVerdict('audit: none')).toBeNull()
  expect(parseVerdict('{"solved":"maybe"}')).toBeNull()
  expect(parseVerdict('{"solved":"yes",')).toBeNull()
})

test('lists are clipped and bounded', () => {
  const long = 'x'.repeat(400)
  const parsed = parseVerdict(
    JSON.stringify({ solved: 'no', gaps: [long, 'b', 'c', 'd'], shortcuts: ['  ', 'ok'], needsApproval: [] }),
  )
  expect(parsed?.gaps).toHaveLength(3)
  expect(parsed?.gaps[0].length).toBeLessThanOrEqual(240)
  expect(parsed?.shortcuts).toEqual(['ok'])
})

test('the prompt carries the request, the record and the final reply', () => {
  const prompt = verdictPrompt({
    request: 'add a retry',
    ledger: 'files (1):\n- client.ts edit x1',
    finalText: 'Done, tests pass.',
  })
  expect(prompt).toContain('add a retry')
  expect(prompt).toContain('client.ts edit x1')
  expect(prompt).toContain('<final-reply>')
  expect(prompt).toContain('"solved": "yes" | "partly" | "no"')
})
