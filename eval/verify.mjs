#!/usr/bin/env node
// Score the mechanical verifier against both corpora.  No model call, no cost.
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyClaims } from '../lib/verify.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

async function load(dir) {
  const names = (await readdir(join(root, dir))).filter((n) => n.endsWith('.json') && n !== 'index.json')
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(root, dir, n), 'utf8'))))
}

const synth = await load('eval/synth')
const control = await load('eval/control')

const hit = (item) => verifyClaims(item.finalText, item.ledger).length > 0

const synthHits = synth.filter(hit).length
const controlHits = control.filter(hit).length
const kinds = {}
for (const item of synth) {
  for (const f of verifyClaims(item.finalText, item.ledger)) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1
}

const pct = (value) => `${(value * 100).toFixed(1)}%`
console.log(`synth   ${synth.length} cases  detected ${synthHits} (${pct(synthHits / synth.length)})`)
console.log(`control ${control.length} cases  false alarms ${controlHits} (${pct(controlHits / control.length)})`)
console.log('findings by kind:', kinds)
for (const item of control.filter(hit).slice(0, 5)) {
  console.log('  FP', item.id, '|', verifyClaims(item.finalText, item.ledger)[0].line)
}
