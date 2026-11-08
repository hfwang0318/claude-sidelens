#!/usr/bin/env node
// A structural control set from real sessions on this machine.
//
// A turn that claims nothing checkable must produce no finding.  That is not the
// same as "a clean turn produces no finding" — it is narrower — but it needs no
// human label, and it catches the failure mode that matters most for this
// verifier: inventing a claim out of prose.
//
//   node eval/real-controls.mjs [--limit N] [--dir ~/.claude/projects]

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { extractLedger, finalTextOf, messageOf } from '../lib/ledger.js'
import { claimSubjects, verifyClaims } from '../lib/verify.js'

const args = process.argv.slice(2)
const value = (flag, fallback) => {
  const at = args.indexOf(flag)
  return at === -1 ? fallback : args[at + 1]
}
const root = value('--dir', join(homedir(), '.claude/projects'))
const resolveValue = (path) => (path.startsWith('/') ? path : join(process.cwd(), path))
const limit = Number(value('--limit', '0')) || 0
const outDir = value('--out', '')
const keep = Number(value('--keep', '0')) || 0

const files = []
for (const project of await readdir(root, { withFileTypes: true }).catch(() => [])) {
  if (!project.isDirectory()) continue
  for (const name of await readdir(join(root, project.name)).catch(() => [])) {
    if (name.endsWith('.jsonl')) files.push(join(root, project.name, name))
  }
}

const turnsOf = (entries) => {
  const turns = []
  let current = { messages: [], request: '' }
  for (const entry of entries) {
    const message = messageOf(entry)
    if (message === null || !Array.isArray(message.content)) continue
    if (message.role === 'user' && message.content.some((block) => block.type === 'text')) {
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      if (text !== '') {
        if (current.messages.length > 0) turns.push(current)
        current = { messages: [], request: text }
      }
    }
    current.messages.push({ role: message.role, content: message.content })
  }
  if (current.messages.length > 0) turns.push(current)
  return turns
}

const cases = []
let scanned = 0
let withWork = 0
let claimed = 0
let fired = 0
let violated = 0
const examples = []
for (const file of files.sort()) {
  if (limit > 0 && scanned >= limit) break
  let lines
  try {
    lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '')
  } catch {
    continue
  }
  const entries = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      /* skip */
    }
  }
  for (const turn of turnsOf(entries)) {
    scanned += 1
    const ledger = extractLedger(turn.messages)
    if (ledger.counts.files === 0 && ledger.counts.commands === 0) continue
    withWork += 1
    const finalText = finalTextOf(turn.messages)
    if (finalText === '') continue
    if (outDir !== '' && (keep === 0 || cases.length < keep)) {
      cases.push({
        id: `${file.split('/').at(-1).replace('.jsonl', '')}-${scanned}`,
        request: turn.request,
        ledger,
        finalText,
        origin: 'real',
      })
    }
    const claims = claimSubjects(finalText)
    const findings = verifyClaims(finalText, ledger)
    if (claims.tests.length === 0 && claims.files.length === 0) {
      if (findings.length > 0) violated += 1
      continue
    }
    claimed += 1
    if (findings.length > 0) {
      fired += 1
      if (examples.length < 5) examples.push(`${findings[0].line} :: ${findings[0].evidence.slice(0, 70)}`)
    }
  }
}

if (outDir !== '') {
  const target = resolveValue(outDir)
  await mkdir(target, { recursive: true })
  for (const item of cases) await writeFile(`${target}/${item.id}.json`, JSON.stringify(item, null, 1))
  console.log(`wrote ${cases.length} real cases to ${target}`)
}
console.log(`files ${files.length}  turns ${scanned}  turns with work ${withWork}`)
console.log(`turns claiming nothing checkable: unmeasured  violations: ${violated}`)
console.log(`turns with a checkable claim: ${claimed}  fired: ${fired} (${claimed === 0 ? 'n/a' : ((fired / claimed) * 100).toFixed(1) + '%'})`)
for (const example of examples) console.log('  ', example)
