// Locate, extract, and evaluate the official You should know module that is
// compiled into a Claude Code binary.  This is a development/update-time tool;
// the committed fixture is what CI and `claude plugin test` consume.

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

const MODULE_HEADER = Buffer.from('// @bun @bytecode\n// Claude Code is a Beta product')
const PLUGIN_MARKER = Buffer.from('as proposePrompt')

export function findClaudeBinary(explicit) {
  if (explicit) return realpathSync(explicit)
  if (process.env.CLAUDE_CODE_BIN) return realpathSync(process.env.CLAUDE_CODE_BIN)
  const command = process.platform === 'win32' ? 'where' : 'which'
  const found = execFileSync(command, ['claude'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  if (!found) throw new Error('could not find `claude`; pass --binary or set CLAUDE_CODE_BIN')
  return realpathSync(found)
}

export function extractOfficialPluginModule(binaryPath) {
  const buffer = readFileSync(binaryPath)
  const markerAt = buffer.indexOf(PLUGIN_MARKER)
  if (markerAt === -1) {
    throw new Error(
      'could not find the You should know module in this Claude Code binary; ' +
        'the packaging layout may have changed',
    )
  }
  const start = buffer.lastIndexOf(MODULE_HEADER, markerAt)
  if (start === -1) throw new Error('could not find the module header before the plugin module')
  const end = buffer.indexOf(MODULE_HEADER, markerAt)
  let source = buffer.subarray(start, end === -1 ? buffer.length : end).toString('utf8')
  source = source.replace(/\0+$/u, '')
  const version = /^\/\/ Version: (\S+)/m.exec(source)?.[1] ?? 'unknown'
  const pluginName = /"([^"]*you-should-know[^"]*)"/.exec(source)?.[1] ?? 'cc-plugin-you-should-know'
  return { source, version, pluginName, binaryPath }
}

export function evaluateOfficialModule({ source, version, pluginName }) {
  const exportMatch = /export\s*\{([\s\S]*?)\}\s*;?\s*$/.exec(source)
  if (!exportMatch) throw new Error('could not find the module export table')
  const exportToLocal = new Map()
  for (const entry of exportMatch[1].split(',')) {
    const text = entry.trim()
    if (text === '') continue
    const [local, exported] = text.split(/\s+as\s+/)
    exportToLocal.set(exported ?? local, local)
  }

  const bodyStart = /var\s+\w+\s*=\s*x\(function\(/.exec(source)
  if (!bodyStart) throw new Error('could not find the module body start')
  let body = source.slice(bodyStart.index, exportMatch.index)
  body = body.replace(/import\.meta/g, '({})')

  const sandbox = {
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    x(factory) {
      const module = { exports: {} }
      factory(undefined, module)
      return module.exports
    },
    Hr(target, all) {
      for (const key of Object.keys(all)) {
        target[key] = typeof all[key] === 'function' ? all[key]() : all[key]
      }
    },
    h: null,
  }
  // The plugin module imports two values at top level.  Read their local names
  // from the semantic export table so a minified rename between releases does
  // not break this loader.
  const pluginNameLocal = exportToLocal.get('PLUGIN_NAME')
  if (pluginNameLocal !== undefined) sandbox[pluginNameLocal] = pluginName
  const spinnerLocal = exportToLocal.get('SPINNER_TIP')
  if (spinnerLocal !== undefined) sandbox[spinnerLocal] = {}
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(body, sandbox, { filename: `official-youshouldknow-${version}.js` })

  const get = (name) => {
    const local = exportToLocal.get(name)
    if (local === undefined) throw new Error(`official module does not export ${name}`)
    return sandbox[local]
  }
  let scan
  for (const value of Object.values(sandbox)) {
    if (value && typeof value === 'object' && value.scan && Array.isArray(value.scan.hooks)) {
      scan = value.scan
      break
    }
  }
  return { sandbox, exportToLocal, get, scan, version }
}

export function loadOfficial({ binary } = {}) {
  const binaryPath = findClaudeBinary(binary)
  const module = extractOfficialPluginModule(binaryPath)
  return { ...evaluateOfficialModule(module), ...module, binaryPath }
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key])
    return out
  }
  return value
}

export function stableString(value) {
  return JSON.stringify(stable(value))
}
