#!/usr/bin/env node
// Offline evaluation for the audit layer.
//
//   node eval/run.mjs --dry                     # build every prompt, no model call
//   node eval/run.mjs --mode package --reps 1   # cheap: evidence package only
//   node eval/run.mjs --mode fork    --reps 1   # faithful: whole transcript + prompt
//
// Reads the cases `eval/from-supervisor.mjs` wrote, calls an Anthropic-compatible
// endpoint, parses each reply with the same parser the plugin uses, and reports
// precision, recall and the evidence-verifiability rate.
//
// Nothing here runs inside Claude Code: the audit is one request, so measuring it
// does not need a session.

import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_DIMENSIONS, assertionsOf, auditItems, buildAuditPrompt, parseAudit } from '../lib/audit.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = process.argv.slice(2)
const value = (flag, fallback) => {
  const at = args.indexOf(flag)
  return at === -1 ? fallback : args[at + 1]
}
const flag = (name) => args.includes(name)

const mode = value('--mode', 'package')
const reps = Math.max(1, Number(value('--reps', '1')) || 1)
const limit = Number(value('--limit', '0')) || 0
const only = value('--only', '')
const dry = flag('--dry')
const quiet = flag('--quiet')
const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')
const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? ''
const model = value('--model', process.env.SIDELENS_EVAL_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5')
const maxTokens = Number(value('--max-tokens', '400')) || 400
const via = value('--via', 'api')
const cliTimeoutMs = Number(value('--timeout-ms', '240000')) || 240000
const casesDir = resolve(root, value('--cases', 'eval/cases'))
const dimensions = value('--dimensions', AUDIT_DIMENSIONS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter((name) => AUDIT_DIMENSIONS.includes(name))

const normalise = (value) =>
  value
    .toLowerCase()
    .replace(/[`*_"'\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// A finding's quotation is verifiable when the text it cites actually appears in
// what the auditor was given.  This is the one quality number that needs no
// human and no judge.
function verifiable(finding, haystack) {
  if (finding.evidence === undefined || finding.evidence.length === 0) return false
  const quoted = finding.evidence
    .map(({ value }) => value)
    .filter((note) => !/^(?:none|unclear|n\/a)\b/i.test(note))
  if (quoted.length === 0) return false
  return quoted.some((note) => {
    const needle = normalise(note)
    if (needle.length < 4) return false
    return haystack.includes(needle) || haystack.includes(needle.slice(0, Math.max(4, needle.length - 8)))
  })
}

function partsFor(item) {
  const assertions = assertionsOf(item.finalText, item.ledger)
  return {
    assertions,
    asked: auditItems({ clauses: item.clauses, assertions, dimensions }),
    prompt: buildAuditPrompt({
      clauses: item.clauses,
      assertions,
      ledger: item.ledger.text,
      finalText: item.finalText,
      dimensions,
      language: 'the language of the request',
    }),
  }
}

// `--via claude` sends the prompt through the local `claude -p` CLI, which uses
// the session's own credentials and system prompt — closer to a real fork than a
// bare API call, and usable when no API key is exported.
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`claude timed out after ${cliTimeoutMs} ms`))
    }, cliTimeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ text: out, usage: null })
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`))
    })
    child.stdin.end(prompt)
  })
}

async function callModel(messages) {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey === '' ? {} : { 'x-api-key': apiKey }),
    },
    // Reasoning models spend the whole output budget thinking and return no
    // text at all; the audit answer is short and needs no reasoning tokens.
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      thinking: { type: 'disabled' },
      messages,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${response.status} ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`)
  }
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  return { text, usage: body.usage ?? null }
}

async function loadCases() {
  const names = (await readdir(casesDir).catch(() => [])).filter((name) => name.endsWith('.json') && name !== 'index.json')
  const cases = []
  for (const name of names.sort()) {
    const item = JSON.parse(await readFile(join(casesDir, name), 'utf8'))
    if (only !== '' && item.task !== only) continue
    cases.push(item)
    if (limit > 0 && cases.length >= limit) break
  }
  return cases
}

function messagesFor(item, prompt) {
  if (mode === 'fork') {
    return [...item.messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: prompt }]
  }
  return [{ role: 'user', content: prompt }]
}

function tally(rows) {
  const labels = rows.filter((row) => row.expected !== null)
  const unlabeled = rows.filter((row) => row.expected === null)
  const found = rows.filter((row) => row.result.kind === 'finding')
  const truePositives = found.filter((row) => row.expected !== null && row.result.type === row.expected.type)
  const wrongType = found.filter((row) => row.expected !== null && row.result.type !== row.expected.type)
  const falseAlarms = unlabeled.filter((row) => row.result.kind === 'finding')
  const hits = rows.filter((row) => row.expected !== null && row.result.kind === 'finding' && row.result.type === row.expected.type)
  const verified = found.filter((row) => row.verified)
  return {
    runs: rows.length,
    labeled: labels.length,
    unlabeled: unlabeled.length,
    findings: found.length,
    truePositives: truePositives.length,
    wrongType: wrongType.length,
    falseAlarms: falseAlarms.length,
    unlabeledFindings: falseAlarms.length,
    misses: labels.length - hits.length,
    unparsable: rows.filter((row) => row.result.kind === 'unparsable').length,
    unverified: rows.filter((row) => row.result.kind === 'unverified').length,
    none: rows.filter((row) => row.result.kind === 'none').length,
    // Precision is measured only where a label exists.  Findings on unlabeled
    // tasks are reported separately and reviewed by hand, never scored.
    // Detection and typing are scored separately: the same defect can honestly
    // be reported under either dimension, so a wrong `kind` is not a miss.
    detected: labels.length === 0 ? null : (labels.length - hits.length) / labels.length,
    typeMatch: truePositives.length + wrongType.length === 0 ? null : truePositives.length / (truePositives.length + wrongType.length),
    falseAlarmRate: unlabeled.length === 0 ? null : falseAlarms.length / unlabeled.length,
    precision: truePositives.length + wrongType.length === 0 ? null : truePositives.length / (truePositives.length + wrongType.length),
    recall: labels.length === 0 ? null : hits.length / labels.length,
    evidenceRate: found.length === 0 ? null : verified.length / found.length,
  }
}

async function main() {
  const cases = await loadCases()
  if (cases.length === 0) {
    console.error(`no cases in ${casesDir}; run "node eval/from-supervisor.mjs" first`)
    process.exit(2)
  }

  const rows = []
  for (const item of cases) {
    const { prompt, asked } = partsFor(item)
    if (dry) {
      rows.push({
        id: item.id,
        task: item.task,
        expected: item.expected,
        promptChars: prompt.length,
        messages: messagesFor(item, prompt).length,
        result: { kind: 'dry' },
        verified: false,
      })
      continue
    }
    const haystack = normalise(`${item.ledger.text}\n${item.clauses.map((clause) => clause.text).join('\n')}`)
    for (let rep = 0; rep < reps; rep += 1) {
      let result
      let raw = ''
      let usage = null
      try {
        const ask = async () =>
          via === 'claude' ? await callClaude(prompt) : await callModel(messagesFor(item, prompt))
        let answer = await ask()
        raw = answer.text
        usage = answer.usage
        result = parseAudit(raw, asked, { clauses: item.clauses, finalText: item.finalText })
        // The format holds about five times in six on a third-party model; one
        // retry removes most of that without hiding a real failure.
        if (result.kind === 'unparsable') {
          answer = await ask()
          raw = answer.text
          usage = answer.usage ?? usage
          result = parseAudit(raw, asked, { clauses: item.clauses, finalText: item.finalText })
          result.retried = true
        }
      } catch (error) {
        result = { kind: 'error', message: String(error.message ?? error) }
      }
      const row = {
        id: item.id,
        task: item.task,
        rep,
        expected: item.expected,
        result,
        verified: result.kind === 'finding' ? verifiable(result, haystack) : false,
        usage,
      }
      rows.push(row)
      if (!quiet) {
        const mark = result.kind === 'finding' ? `${result.type}${row.verified ? '' : ' (unverified)'}` : result.kind
        console.log(`${item.id} #${rep}  ${mark}${result.line === undefined ? '' : `  ${result.line.slice(0, 70)}`}`)
      }
    }
  }

  const summary = tally(rows)
  const outDir = join(root, 'eval/report', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'results.json'),
    `${JSON.stringify({ version: 1, mode, model, reps, dimensions, summary, rows }, null, 1)}\n`,
    'utf8',
  )

  const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)
  const lines = [
    `# Audit eval`,
    '',
    `- mode: \`${mode}\`  via: \`${via}\`  model: \`${model}\`  reps: ${reps}  dimensions: ${dimensions.join(', ')}`,
    `- cases: ${cases.length}, runs: ${summary.runs}`,
    '',
    '| metric | value |',
    '| --- | --- |',
    `| detected (any kind) | ${pct(summary.detected)} |`,
    `| correct kind | ${pct(summary.typeMatch)} |`,
    `| false alarms on controls | ${pct(summary.falseAlarmRate)} |`,
    `| evidence verifiable | ${pct(summary.evidenceRate)} |`,
    `| findings on unlabeled tasks | ${summary.unlabeledFindings} |`,
    `| unparsable | ${summary.unparsable} |`,
    `| unverified (dropped) | ${summary.unverified} |`,
    '',
  ]
  if (!dry) for (const row of rows) {
    if (row.result.kind === 'finding') {
      lines.push(`- \`${row.id}\` **${row.result.type}** — ${row.result.line}`)
    }
  }
  await writeFile(join(outDir, 'report.md'), `${lines.join('\n')}\n`, 'utf8')

  console.log('')
  console.log(`precision ${pct(summary.precision)}  recall ${pct(summary.recall)}  evidence ${pct(summary.evidenceRate)}`)
  console.log(`report: ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
