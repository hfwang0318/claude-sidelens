#!/usr/bin/env node
// Compare the static scan `claude plugin validate` reports for sidelens with the
// official module's scan manifest.  Run this alongside `parity:check`; the mod
// test runner itself cannot shell out.

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fixture from '../../tests/parity/fixtures/official.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

let output
try {
  output = execFileSync('claude', ['plugin', 'validate', '.'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
} catch (error) {
  output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
  console.error('claude plugin validate failed')
  console.error(output.trim())
  process.exit(2)
}

const hooksLine = output.match(/register\.js hooks:\s*(.+)/)?.[1] ?? ''
const hooks = hooksLine
  .split(',')
  .map((part) => part.trim().replace(/\{.*$/, ''))
  .filter(Boolean)
const callsLine = output.match(/calls:\s*(.+)/)?.[1] ?? ''
const calls = [...callsLine.matchAll(/\$\.\w+(?:\.\w+)?/g)].map((match) => match[0].slice(2))
const uniqueCalls = [...new Set(calls)]

const officialHooks = [...fixture.scan.hooks]
const officialCalls = [...fixture.scan.calls]

function compare(name, actual, expected) {
  const a = [...actual].sort()
  const b = [...expected].sort()
  if (a.length === b.length && a.every((value, index) => value === b[index])) {
    console.log(`parity ${name}: ok (${a.length})`)
    return true
  }
  console.error(`parity ${name}: mismatch`)
  console.error(`  sidelens: ${a.join(', ')}`)
  console.error(`  official: ${b.join(', ')}`)
  return false
}

const INTENTIONAL_EXTRA_CALLS = new Set(['settings.read'])

const hooksOk = compare('hooks', hooks, officialHooks)
const extraCalls = uniqueCalls.filter((call) => !officialCalls.includes(call))
const missingCalls = officialCalls.filter((call) => !uniqueCalls.includes(call))
const unexpectedCalls = extraCalls.filter((call) => !INTENTIONAL_EXTRA_CALLS.has(call))
const callsOk = missingCalls.length === 0 && unexpectedCalls.length === 0
if (callsOk) {
  console.log(
    `parity calls: ok (${uniqueCalls.length}; intentional extra: ${
      extraCalls.length === 0 ? 'none' : extraCalls.join(', ')
    })`,
  )
} else {
  console.error('parity calls: mismatch')
  if (missingCalls.length > 0) console.error(`  missing: ${missingCalls.join(', ')}`)
  if (unexpectedCalls.length > 0) console.error(`  unexpected: ${unexpectedCalls.join(', ')}`)
}
if (!hooksOk || !callsOk) process.exit(1)
