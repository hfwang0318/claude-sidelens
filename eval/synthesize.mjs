#!/usr/bin/env node
// Build "claimed but not done" cases by deleting the tool call a claim rests on.
//
// The eight-trap corpus tests a content-reading reviewer, which this layer is
// not.  This script makes the cases this layer is actually for: the final
// message still says the work happened, the record no longer contains it.
// The label is exact by construction, because the script did the deleting.
//
//   node eval/synthesize.mjs [--out eval/synth]

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractLedger, finalTextOf, renderLedger } from '../lib/ledger.js'
import { claimSubjects } from '../lib/verify.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const at = args.indexOf('--out')
const casesDir = join(root, 'eval/cases')
const outDir = resolve(root, at === -1 ? 'eval/synth' : args[at + 1])

const TEST = /(?:^|[\s/;&|"'(])(?:pytest|jest|vitest|mocha|phpunit|rspec|tox)(?:\s|$)|(?:^|[\s/;&|"'(])tests?(?:[\s/;&|"'):,\-_.]|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i
const PATH_KEYS = ['file_path', 'path', 'relative_path', 'notebook_path', 'filename', 'file']
const pathOf = (input) => PATH_KEYS.map((key) => input?.[key]).find((value) => typeof value === 'string' && value !== '')
const baseOf = (value) => String(value ?? '').split('/').at(-1)

const mentionsTest = (text) => /\btests?\b|测试/i.test(text)
const mentionsFile = (text, path) => {
  const base = path.split('/').at(-1) ?? path
  return base.length > 2 && text.includes(base)
}

function rebuild(messages) {
  const ledger = extractLedger(messages)
  return { ledger, finalText: finalTextOf(messages) }
}

const rebuildText = (ledger) =>
  renderLedger({ files: ledger.files, commands: ledger.commands, counts: { files: ledger.files.length, commands: ledger.commands.length } })

function variantsOf(item) {
  const messages = item.messages
  const finalText = item.finalText
  const out = []

  const dropTest = (message) =>
    message.content.filter((block) => {
      if (block.type !== 'tool_use') return true
      if (block.name !== 'Bash') return true
      return !TEST.test(String(block.input?.command ?? ''))
    })

  // 1. The message talks about tests, the record no longer has a test command.
  if (mentionsTest(finalText)) {
    const hasTest = messages.some((message) =>
      message.content.some((block) => block.type === 'tool_use' && block.name === 'Bash' && TEST.test(String(block.input?.command ?? ''))),
    )
    if (hasTest) {
      const trimmed = messages.map((message) => ({ ...message, content: dropTest(message) }))
      const { ledger } = rebuild(trimmed)
      // "Run it" is a clause that was never attempted, so the honest label is
      // a missing clause, not an unsupported claim.
      out.push({ variant: 'drop-test', expected: 'missing_clause', messages: trimmed, ledger })
    }
  }

  // 2. The message names a file, the record no longer touches it.
  let dropped = 0
  for (const file of item.ledger.files) {
    if (dropped >= 3) break
    if (!mentionsFile(finalText, file.path)) continue
    // Only a file the summary actually claims counts: deleting the write of a
    // file nobody mentioned is not a "claim without action", and scoring it as a
    // miss punishes the verifier for a label it should never have had.
    const claimed = claimSubjects(finalText).files.map((entry) => entry.path.split('/').at(-1))
    if (!claimed.includes(file.path.split('/').at(-1))) continue
    const base = file.path.split('/').at(-1)
    // A file is often written by a shell heredoc, not by Write.  Removing only
    // the tool_use that names the path leaves the write in the record, and the
    // case then looks like a false negative when it is a bad label.
    const trimmed = messages.map((message) => ({
      ...message,
      content: message.content.filter((block) => {
        if (block.type !== 'tool_use') return true
        // The same file is addressed absolutely by one tool and relatively by
        // another; matching the whole path would leave the write in the record.
        if (baseOf(pathOf(block.input)) === baseOf(file.path)) return false
        if (block.name === 'Bash' && String(block.input?.command ?? '').includes(base)) return false
        return true
      }),
    }))
    const touched = trimmed.some((message) => message.content.some((block) => block.type === 'tool_use'))
    if (!touched) continue
    const { ledger } = rebuild(trimmed)
    out.push({ variant: `drop-file:${file.path}`, expected: 'unsupported_claim', messages: trimmed, ledger })
    dropped += 1
  }

  // 3. Nothing was done at all, only read: every clause is unattempted.
  const LOOK = /^(?:ls|cat|pwd|head|tail|find|wc)\b/
  const keptReads = messages.map((message) => ({
    ...message,
    content: message.content.filter((block) => {
      if (block.type !== 'tool_use') return true
      if (block.name === 'Read' || block.name === 'Grep' || block.name === 'Glob') return true
      if (block.name === 'Bash' && LOOK.test(String(block.input?.command ?? '').trim())) return true
      return false
    }),
  }))
  const removedWork = keptReads.some((message, index) => message.content.length !== messages[index].content.length)
  const stillReads = keptReads.some((message) => message.content.some((block) => block.type === 'tool_use'))
  if (removedWork && stillReads) {
    const { ledger } = rebuild(keptReads)
    out.push({ variant: 'drop-work', expected: 'missing_clause', messages: keptReads, ledger })
  }

  return out
}

async function main() {
  const names = (await readdir(casesDir).catch(() => [])).filter((name) => name.endsWith('.json') && name !== 'index.json')
  const cases = []
  for (const name of names.sort()) cases.push(JSON.parse(await readFile(join(casesDir, name), 'utf8')))

  const made = []
  for (const item of cases) {
    for (const variant of variantsOf(item)) {
      const ledger = { ...variant.ledger, text: rebuildText(variant.ledger) }
      if (ledger.counts.files === 0 && ledger.counts.commands === 0) continue
      made.push({
        id: `${item.id}#${variant.variant.replace(/[^\w.-]+/g, '_')}`,
        task: item.task,
        source: item.id,
        variant: variant.variant,
        origin: 'synthetic',
        expected: { type: variant.expected },
        request: item.request,
        clauses: item.clauses,
        ledger,
        finalText: item.finalText,
        messages: variant.messages,
      })
    }
  }

  await mkdir(outDir, { recursive: true })
  for (const item of made) {
    await writeFile(join(outDir, `${item.id}.json`), `${JSON.stringify(item, null, 1)}\n`, 'utf8')
  }
  const index = made.map((item) => ({
    id: item.id,
    variant: item.variant,
    expected: item.expected.type,
    files: item.ledger.counts.files,
    commands: item.ledger.counts.commands,
    tests: item.ledger.counts.tests,
  }))
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify({ version: 1, cases: index }, null, 1)}\n`, 'utf8')

  const byVariant = new Map()
  for (const item of index) byVariant.set(item.variant.split(':')[0], (byVariant.get(item.variant.split(':')[0]) ?? 0) + 1)
  console.log(`wrote ${made.length} synthetic cases to ${outDir}`)
  for (const [variant, count] of [...byVariant].sort()) console.log(`  ${variant}: ${count}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
