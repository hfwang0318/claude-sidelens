import { expect, test } from 'claude-code/testing'
import { isOffCommand, parseExplanation, parseProposedLine } from '../lib/parse.js'

test('learn: none declines without a tag or explanation', () => {
  expect(parseProposedLine('learn: none')).toEqual({ kind: 'none' })
})

test('a proposal carries its line, tag, and explanation', () => {
  const parsed = parseProposedLine(
    'learn: The build uses pnpm workspaces.\ntag: Heads up\nexplain:\n**Workspace build**\nUse pnpm from the root.',
  )
  expect(parsed).toEqual({
    kind: 'line',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    explanation: '**Workspace build**\nUse pnpm from the root.',
  })
})

test('an explanation becomes titled cards with a sketch', () => {
  const cards = parseExplanation(
    '**Workspace build**\nUse pnpm from the root.\n```\nrepo/\n  packages/\n```\nRun it once.',
  )
  expect(cards).toHaveLength(1)
  expect(cards[0].title).toBe('Workspace build')
  expect(cards[0].sketch).toEqual(['repo/', '  packages/'])
  expect(cards[0].caption).toContain('Run it once.')
})

test('the off command recognizes this plugin, with or without a marketplace', () => {
  expect(isOffCommand('/plugin disable sidelens')).toBe(true)
  expect(isOffCommand('/plugin disable sidelens@inline')).toBe(true)
  expect(isOffCommand('/plugin disable something-else')).toBe(false)
})
