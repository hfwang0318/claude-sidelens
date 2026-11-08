#!/usr/bin/env node
// Score the verdict-shaped judgement (borrowed from modsmith) on both corpora.
//
//   ANTHROPIC_AUTH_TOKEN=… SIDELENS_EVAL_MODEL=glm-5.3 node eval/verdict-eval.mjs \
//     --cases eval/control
//
// Reports how often it refuses to say "clean", which is the number that decides
// whether the band is usable at all.

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isClean, parseVerdict, verdictPrompt } from '../lib/verdict.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const value = (flag, fallback) => {
  const at = args.indexOf(flag)
  return at === -1 ? fallback : args[at + 1]
}
const casesDir = resolve(root, value('--cases', 'eval/control'))
const limit = Number(value('--limit', '0')) || 0
const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')
const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? ''
const model = value('--model', process.env.SIDELENS_EVAL_MODEL ?? 'claude-sonnet-4-5')

async function ask(prompt) {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey === '' ? {} : { 'x-api-key': apiKey }),
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.message ?? ''}`)
  return (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

const names = (await readdir(casesDir)).filter((n) => n.endsWith('.json') && n !== 'index.json').sort()
const cases = []
for (const name of names) {
  cases.push(JSON.parse(await readFile(join(casesDir, name), 'utf8')))
  if (limit > 0 && cases.length >= limit) break
}

const rows = []
for (const item of cases) {
  const prompt = verdictPrompt({
    request: item.request,
    ledger: item.ledger.text,
    finalText: item.finalText,
  })
  let verdict = null
  let error = ''
  try {
    verdict = parseVerdict(await ask(prompt))
    if (verdict === null) error = 'unparsable'
  } catch (cause) {
    error = String(cause.message ?? cause)
  }
  rows.push({ id: item.id, verdict, error })
  const mark = verdict === null ? `ERR ${error}` : isClean(verdict) ? 'clean' : `flagged ${verdict.solved}${verdict.gaps.length ? ` gaps=${verdict.gaps.length}` : ''}${verdict.shortcuts.length ? ` shortcuts=${verdict.shortcuts.length}` : ''}`
  console.log(`${item.id}  ${mark}`)
}

const flagged = rows.filter((row) => row.verdict !== null && !isClean(row.verdict)).length
const unparsable = rows.filter((row) => row.verdict === null).length
const pct = (a, b) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`)
console.log('')
console.log(`cases ${rows.length}  flagged ${flagged} (${pct(flagged, rows.length)})  unparsable ${unparsable} (${pct(unparsable, rows.length)})`)
const partly = rows.filter((row) => row.verdict?.solved === 'partly').length
const no = rows.filter((row) => row.verdict?.solved === 'no').length
console.log(`solved: yes ${rows.filter((r) => r.verdict?.solved === 'yes').length}  partly ${partly}  no ${no}`)
