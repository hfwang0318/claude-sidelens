import { expect, test } from 'claude-code/testing'
import {
  assertionsOf,
  corroborated,
  auditItems,
  buildAuditPrompt,
  enabledDimensions,
  isQuestionOnly,
  parseAudit,
  splitClauses,
} from '../lib/audit.js'
import { exitCodeOf, extractLedger, finalTextOf } from '../lib/ledger.js'

const turn = (blocks) => ({ role: 'assistant', content: blocks })

test('clauses come from bullets, sentences and chinese punctuation', () => {
  const split = splitClauses(
    [
      '- add a retry to the uploader',
      '- keep the existing timeout behaviour',
      '',
      'Also rename the flag. The docs need the new name.',
    ].join('\n'),
  )
  expect(split.clauses.map((clause) => clause.text)).toEqual([
    'add a retry to the uploader',
    'keep the existing timeout behaviour',
    'Also rename the flag.',
    'The docs need the new name.',
  ])
  expect(split.clauses.map((clause) => clause.id)).toEqual([1, 2, 3, 4])
  expect(split.truncated).toBe(false)

  const chinese = splitClauses('把上传加重试。保留原来的超时行为。')
  expect(chinese.clauses.map((clause) => clause.text)).toEqual([
    '把上传加重试。',
    '保留原来的超时行为。',
  ])
})

test('fenced code stays inside one clause and acknowledgements are dropped', () => {
  const split = splitClauses(
    ['write this file:', '```', 'a = 1', 'b = 2', '```', 'ok', 'thanks'].join('\n'),
  )
  expect(split.clauses).toHaveLength(1)
  expect(split.clauses[0].text).toContain('a = 1')
  expect(split.clauses[0].text).toContain('b = 2')
})

test('clauses are capped and the cap is reported', () => {
  const split = splitClauses(
    ['one task here', 'two task here', 'three task here', 'four task here', 'five task here', 'six task here'].join(
      '\n',
    ),
  )
  expect(split.clauses).toHaveLength(5)
  expect(split.truncated).toBe(true)
})

test('a question alone is not a checkable request', () => {
  expect(isQuestionOnly([])).toBe(true)
  expect(isQuestionOnly(splitClauses('why is the build failing?').clauses)).toBe(true)
  expect(isQuestionOnly(splitClauses('fix the build').clauses)).toBe(false)
})

test('dimensions are off unless switched on, and can be switched on one at a time', () => {
  expect(enabledDimensions({})).toEqual([])
  expect(enabledDimensions({ SIDELENS_AUDIT: '0' })).toEqual([])
  expect(enabledDimensions({ SIDELENS_AUDIT: '1' })).toEqual(['coverage', 'claims', 'conflict'])
  expect(enabledDimensions({ SIDELENS_AUDIT: '1', SIDELENS_AUDIT_CLAIMS: '0' })).toEqual([
    'coverage',
    'conflict',
  ])
  expect(enabledDimensions({ SIDELENS_AUDIT_COVERAGE: 'on' })).toEqual(['coverage'])
})

test('the prompt lists every asked item and asks for one line each', () => {
  const clauses = [{ id: 1, text: 'add a retry' }]
  const assertions = assertionsOf('Done. I ran the tests and they pass.', { files: [] })
  const dimensions = ['coverage', 'claims']
  const asked = auditItems({ clauses, assertions, dimensions })
  const prompt = buildAuditPrompt({
    clauses,
    assertions,
    ledger: 'files (0):\nnone',
    finalText: 'Done. I ran the tests and they pass.',
    dimensions,
    language: 'Chinese',
  })
  expect(asked.map((item) => item.id)).toEqual(['1', 'a1'])
  expect(prompt).toContain('1: add a retry')
  expect(prompt).toContain('a1: I ran the tests')
  expect(prompt).toContain('say: <one sentence in Chinese')
})

test('a claim answered none becomes an unsupported finding', () => {
  const clauses = [{ id: 1, text: 'add a retry' }]
  const assertions = assertionsOf('Done. I ran the tests.', { files: [] })
  const asked = auditItems({ clauses, assertions, dimensions: ['coverage', 'claims'] })
  const parsed = parseAudit('1: uploader.js retry\na1: none\nsay: No test was run.', asked)
  expect(parsed.kind).toBe('finding')
  expect(parsed.type).toBe('unsupported_claim')
  expect(parsed.line).toBe('No test was run.')
  expect(parsed.evidence.map((item) => item.id)).toEqual(['1'])
})

test('a gap only counts when the summary presented that work as done', () => {
  const clauses = [{ id: 1, text: 'add a retry to the uploader' }, { id: 2, text: 'keep the old timeout behaviour' }]
  const asked = auditItems({ clauses, assertions: [], dimensions: ['coverage'] })

  // The summary talks about the retry, so clause 1 missing is a contradiction.
  const contradicted = parseAudit('1: none\n2: uploader.js timeout\nsay: The retry is missing.', asked, {
    clauses,
    finalText: 'Added the retry and kept the timeout.',
  })
  expect(contradicted.type).toBe('missing_clause')
  expect(contradicted.subject).toBe('clause 1')

  // Nothing anywhere mentions the retry: a detail, not a contradiction.
  const quiet = parseAudit('1: none\n2: notes.md written\nsay: x', asked, {
    clauses,
    finalText: 'Notes are in notes.md.',
  })
  expect(quiet.kind).toBe('none')

  expect(corroborated('add a retry', 'added the retry')).toBe(true)
  expect(corroborated('add a retry', 'notes written')).toBe(false)

  const short = parseAudit('1: none\nsay: x', asked)
  expect(short.kind).toBe('incomplete')
})

test('all items answered with quotations is none, and unclear never counts as a finding', () => {
  const clauses = [{ id: 1, text: 'add a retry' }]
  const asked = auditItems({ clauses, assertions: [], dimensions: ['coverage'] })
  expect(parseAudit('1: uploader.js retry', asked).kind).toBe('none')
  expect(parseAudit('1: unclear', asked).kind).toBe('none')
})

test('the ledger records edits, writes, commands and test exit codes', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'fix the total' }] },
    turn([
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'calc.py' } },
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'calc.py', new_string: 'return sum(xs)' } },
      { type: 'tool_use', id: 't3', name: 'Write', input: { file_path: 'NOTES.md', content: '# Notes\nfixed' } },
      { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'python test_calc.py' } },
    ]),
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'def total(xs): ...' },
        { type: 'tool_result', tool_use_id: 't4', content: 'FAILED\nExit code 1' },
      ],
    },
    turn([{ type: 'text', text: 'Fixed. Tests pass.' }]),
  ]
  const ledger = extractLedger(messages)
  expect(ledger.counts.files).toBe(2)
  expect(ledger.counts.tests).toBe(1)
  expect(ledger.counts.failedTests).toBe(1)
  expect(ledger.commands[0].exit).toBe(1)
  expect(ledger.text).toContain('calc.py  edit x1  return sum(xs)')
  expect(ledger.text).toContain('NOTES.md  write  # Notes (+2 lines)')
  expect(ledger.text).toContain('python test_calc.py  -> exit 1  (test)')
  expect(finalTextOf(messages)).toBe('Fixed. Tests pass.')
})

test('exit codes are read from the shapes tools actually print', () => {
  expect(exitCodeOf('Exit code: 2')).toBe(2)
  expect(exitCodeOf('command exited with code 127')).toBe(127)
  expect(exitCodeOf('all good')).toBeNull()
})
