#!/usr/bin/env node
// Unmodified control cases: the same turns, nothing deleted.  A finding on one of
// these is a false alarm, which is the number that decides whether the audit is
// worth showing at all.
//
//   node eval/controls.mjs [--out eval/control]

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const at = process.argv.indexOf('--out')
const outDir = resolve(root, at === -1 ? 'eval/control' : process.argv[at + 1])
const casesDir = join(root, 'eval/cases')

const names = (await readdir(casesDir)).filter((name) => name.endsWith('.json') && name !== 'index.json')
const cases = []
for (const name of names.sort()) {
  const item = JSON.parse(await readFile(join(casesDir, name), 'utf8'))
  cases.push({ ...item, id: `${item.id}#control`, origin: 'control', expected: { type: 'none' } })
}

await mkdir(outDir, { recursive: true })
for (const item of cases) {
  await writeFile(join(outDir, `${item.id}.json`), `${JSON.stringify(item, null, 1)}\n`, 'utf8')
}
await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify({ version: 1, cases: cases.map(({ id, task }) => ({ id, task, expected: 'none' })) }, null, 1)}\n`,
  'utf8',
)
console.log(`wrote ${cases.length} control cases to ${outDir}`)
