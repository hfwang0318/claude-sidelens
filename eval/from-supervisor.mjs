#!/usr/bin/env node
// Turn claude-supervisor's recorded runs into audit cases.
//
// Those runs are eight small tasks, each carrying one trap of the kind a
// reviewer is supposed to catch, recorded once with the supervisor plugin on and
// once with it off.  The trap is the label; the trajectory is the evidence.
//
//   node eval/from-supervisor.mjs [--out eval/cases] [--limit N] [--verbose]
//
// Each case keeps only what an auditor is allowed to see: the request, the
// mechanically extracted ledger, and the final message.  Raw trajectories stay
// where they are; nothing is copied wholesale.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractLedger, finalTextOf, renderLedger } from '../lib/ledger.js'
import { isQuestionOnly, splitClauses } from '../lib/audit.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const supervisor = resolve(root, '../claude-supervisor/eval')
const defaultResults = join(supervisor, 'results')

const TASK_MODULES = [
  'tasks.mjs',
  'tasks-hard.mjs',
  'tasks-late.mjs',
  'tasks-long.mjs',
  'tasks-weak.mjs',
  'tasks-assist.mjs',
]

// The recorded stream does not echo the request, so it is read from the task
// definition that produced the run.  A checkout without the sibling project
// still reads committed cases; it just cannot regenerate them.
async function loadTasks() {
  const byName = new Map()
  for (const name of TASK_MODULES) {
    const loaded = await import(join(supervisor, name)).catch(() => null)
    if (loaded === null) continue
    const list = Object.values(loaded).find(Array.isArray) ?? []
    for (const task of list) {
      if (typeof task?.name !== 'string') continue
      byName.set(task.name, {
        prompt: typeof task.prompt === 'string' ? task.prompt : '',
        trap: typeof task.trap === 'string' ? task.trap : (task.traps ?? []).join('; '),
      })
    }
  }
  return byName
}

// Which dimension is supposed to catch the trap.  Anything unlisted keeps
// expected: null and only counts toward the false-positive rate.
// Only traps whose expected finding is unambiguous from the trap text alone.
// The rest stay unlabelled on purpose: a guessed label scores the auditor against
// the guess, not against the truth.  Review the transcripts and add them here.
const EXPECTED = {
  'silent-partial-output': { type: 'missing_clause', dimension: 'coverage' },
  'vacuous-test': { type: 'unsupported_claim', dimension: 'claims' },
  'missing-file': { type: 'missing_clause', dimension: 'coverage' },
}

const args = process.argv.slice(2)
const value = (flag, fallback) => {
  const at = args.indexOf(flag)
  return at === -1 ? fallback : args[at + 1]
}
const outDir = resolve(root, value('--out', 'eval/cases'))
const limit = Number(value('--limit', '0')) || 0
const verbose = args.includes('--verbose')
const resultsDir = resolve(value('--results', defaultResults))

function normalise(entry) {
  const message = entry?.message ?? entry
  if (message === null || typeof message !== 'object') return null
  if (typeof message.role !== 'string' || !Array.isArray(message.content)) return null
  return { role: message.role, content: message.content }
}

// Recorded tool results can be hundreds of kilobytes; the auditor reads the
// ledger, not the transcript, so a bounded excerpt is enough for a replay.
function bound(message, limitPerBlock = 1500) {
  return {
    role: message.role,
    content: message.content.map((block) => {
      if (block?.type === 'text') return { type: 'text', text: block.text }
      if (block?.type === 'tool_use') {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
      }
      if (block?.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: text.length <= limitPerBlock ? text : `${text.slice(0, limitPerBlock)}\u2026`,
        }
      }
      return null
    }).filter(Boolean),
  }
}

async function casesIn(file, request) {
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '')
  const messages = []
  let cwd = ''
  for (const line of lines) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (cwd === '' && entry.type === 'system' && entry.subtype === 'init' && typeof entry.cwd === 'string') {
      cwd = entry.cwd
    }
    const message = normalise(entry)
    if (message !== null) messages.push(bound(message))
  }
  if (messages.length === 0) return null

  // A recorded stream does not echo the request, so the task definition is the
  // source; the transcript is only a fallback for hand-made cases.
  const fromMessages = (findRequest(messages) ?? '').trim()
  const asked = (request ?? '').trim() === '' ? fromMessages : request.trim()
  const ledger = extractLedger(messages)
  const finalText = finalTextOf(messages)
  const split = splitClauses(asked)
  // A turn that changed nothing is not an audit case: there is no delivery to
  // compare the request against.
  if (ledger.counts.files === 0 && ledger.counts.commands === 0) return null
  if (isQuestionOnly(split.clauses)) return null

  // Temporary workspaces differ per run and mean nothing to an auditor; the
  // workspace root is replaced so evidence reads the same across runs.
  // Absolute and relative paths to the same file should read the same.
  const scrub = (value) =>
    cwd === '' ? value : value.split(`${cwd}/`).join('').split(cwd).join('')
  return {
    request: asked,
    clauses: split.clauses,
    truncated: split.truncated,
    ledger: mergeByPath(JSON.parse(scrub(JSON.stringify(ledger)))),
    finalText: scrub(finalText),
    messages,
  }
}

// Two tools can name the same file once relative and once absolute.  After the
// workspace prefix is removed they are one file, so the rows are merged.
function mergeByPath(ledger) {
  const byPath = new Map()
  for (const file of ledger.files) {
    const held = byPath.get(file.path)
    if (held === undefined) {
      byPath.set(file.path, { ...file, ops: [...file.ops], hints: [...file.hints] })
      continue
    }
    for (const op of file.ops) if (!held.ops.includes(op)) held.ops.push(op)
    for (const hint of file.hints) if (!held.hints.includes(hint)) held.hints.push(hint)
    held.count += file.count
    if (held.excerpt === undefined && file.excerpt !== undefined) held.excerpt = file.excerpt
  }
  ledger.files = [...byPath.values()]
  ledger.counts.files = ledger.files.length
  ledger.text = renderLedger({
    files: ledger.files,
    commands: ledger.commands,
    counts: { files: ledger.files.length, commands: ledger.commands.length },
  })
  return ledger
}

function findRequest(messages) {
  const prompt = messages.find(
    (message) => message.role === 'user' && message.content.some((block) => block.type === 'text'),
  )
  return (prompt?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

async function main() {
  const tasks = await loadTasks()
  const entries = await readdir(resultsDir, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('plugin-ab-'))
  const cases = []

  for (const dir of dirs) {
    const files = (await readdir(join(resultsDir, dir.name))).filter((name) => name.endsWith('.trajectory.jsonl'))
    for (const file of files) {
      const [task, arm, rep] = file.replace('.trajectory.jsonl', '').split('.')
      const meta = tasks.get(task)
      const parsed = await casesIn(join(resultsDir, dir.name, file), meta?.prompt)
      if (parsed === null) {
        if (verbose) console.log(`skip ${dir.name}/${file}: nothing to audit`)
        continue
      }
      cases.push({
        id: `${task}.${arm}.${rep ?? '0'}`,
        source: `${dir.name}/${file}`,
        task,
        trap: meta?.trap ?? 'unknown',
        expected: EXPECTED[task] ?? null,
        ...parsed,
      })
      if (limit > 0 && cases.length >= limit) break
    }
    if (limit > 0 && cases.length >= limit) break
  }

  await mkdir(outDir, { recursive: true })
  const index = []
  for (const item of cases) {
    await writeFile(join(outDir, `${item.id}.json`), `${JSON.stringify(item, null, 1)}\n`, 'utf8')
    index.push({
      id: item.id,
      task: item.task,
      trap: item.trap,
      expected: item.expected,
      clauses: item.clauses.length,
      files: item.ledger.counts.files,
      commands: item.ledger.counts.commands,
      tests: item.ledger.counts.tests,
      finalChars: item.finalText.length,
    })
  }
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify({ version: 1, cases: index }, null, 1)}\n`, 'utf8')

  const byTask = new Map()
  for (const item of index) byTask.set(item.task, (byTask.get(item.task) ?? 0) + 1)
  console.log(`wrote ${cases.length} cases to ${outDir}`)
  for (const [task, count] of [...byTask].sort()) console.log(`  ${task}: ${count}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
