// Mechanical extraction of what a turn actually did.
//
// The auditor never sees the files.  It sees a patch log: tool inputs that name
// a path and carry the old and new text, plus tool results that carry a status.
// Rebuilding a file from that is where a model fails silently, so we do the
// rebuilding in code and hand the auditor a ledger it can only read, not guess.

export const MAX_LEDGER_FILES = 40
export const MAX_LEDGER_COMMANDS = 20
export const MAX_COMMAND_CHARS = 160
export const MAX_EXCERPT_CHARS = 180

// Edits do not always come from Edit: an MCP server such as serena replaces
// symbols with its own tool.  The ledger reads the tool name and the path key
// rather than a fixed list of tools, so a different toolchain still shows up.
const PATH_KEYS = ['file_path', 'path', 'relative_path', 'notebook_path', 'filename', 'file']
const pathOf = (input) => {
  for (const key of PATH_KEYS) {
    if (typeof input?.[key] === 'string' && input[key] !== '') return input[key]
  }
  return null
}
const opOf = (name) =>
  /write|create|save|append/i.test(name)
    ? 'write'
    : /edit|replace|patch|insert|update|rename/i.test(name)
      ? 'edit'
      : /read|view|find|search|grep|glob|list|symbol|overview|instruction/i.test(name)
        ? 'read'
        : null

const TEST_COMMAND =
  /(?:^|[\s/;&|"'(])(?:pytest|jest|vitest|mocha|phpunit|rspec|unittest|tox)(?:\s|$)|(?:^|[\s/;&|"'(])tests?(?:[\s/;&|"'):,\-_.]|$)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|(?:go|cargo|make|gradle|mvn)\s+test\b|node\s+--test\b/i
const EXIT_CODE = [
  /exit code:?\s*(\d+)/i,
  /exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?(\d+)/i,
  /\bstatus:?\s*(\d+)\b/i,
]

const firstLine = (value) =>
  String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''

const collapse = (value) => value.replace(/\s+/g, ' ').trim()

// Long commands are quoted by their head and tail: the middle of a heredoc is
// never what makes a command a test or a failure.
const shorten = (value, limit) =>
  value.length <= limit ? value : `${value.slice(0, limit - 62).trimEnd()}\u2026${value.slice(-55)}`

// Accepts both the shape `$.session.messages()` returns and the stream-json
// events a recorded run stores, because the eval replays the latter.
export function messageOf(entry) {
  if (entry === null || typeof entry !== 'object') return null
  if (entry.message !== null && typeof entry.message === 'object') return entry.message
  if (typeof entry.role === 'string' && entry.content !== undefined) return entry
  return null
}

function blocksOf(message) {
  if (message === null) return []
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }]
  return Array.isArray(message.content) ? message.content : []
}

const resultText = (block) => {
  if (typeof block.content === 'string') return block.content
  if (!Array.isArray(block.content)) return ''
  return block.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
}

export function exitCodeOf(text) {
  for (const pattern of EXIT_CODE) {
    const match = pattern.exec(text)
    if (match !== null) return Number(match[1])
  }
  return null
}

function hintOf(block, op) {
  const body = String(
    block.input?.content ?? block.input?.new_string ?? block.input?.new_source ?? block.input?.new_text ?? '',
  )
  if (op === 'write') {
    const lines = body === '' ? 0 : body.split('\n').length
    return `${firstLine(body)} (+${lines} lines)`
  }
  const patch =
    body !== ''
      ? body
      : (block.input?.edits?.[0]?.new_string ??
        block.input?.new_str ??
        block.input?.new_content ??
        block.input?.replacement ??
        '')
  return firstLine(patch)
}

export function extractLedger(messages) {
  const files = new Map()
  const commands = []
  const pending = new Map()
  let steps = 0

  for (const entry of Array.isArray(messages) ? messages : []) {
    const message = messageOf(entry)
    const blocks = blocksOf(message)
    if (blocks.length === 0) continue
    if (message.role === 'assistant') steps += 1

    for (const block of blocks) {
      if (block?.type === 'tool_use') {
        pending.set(block.id, { block, path: pathOf(block.input), op: opOf(block.name) })
        const path = pathOf(block.input)
        if (path !== null) {
          const op = opOf(block.name)
          if (op !== null) {
            const held = files.get(path) ?? { path, ops: [], hints: [], count: 0 }
            if (!held.ops.includes(op)) held.ops.push(op)
            if (op !== 'read') {
              held.count += 1
              const hint = hintOf(block, op)
              if (hint !== '' && held.hints.length < 2 && !held.hints.includes(hint)) held.hints.push(hint)
            }
            files.set(path, held)
          }
        }
        if (block.name === 'Bash' && typeof block.input?.command === 'string') {
          const command = collapse(block.input.command)
          commands.push({
            id: block.id,
            command: shorten(command, MAX_COMMAND_CHARS),
            test: TEST_COMMAND.test(command),
            exit: null,
          })
        }
        continue
      }
      if (block?.type === 'tool_result') {
        const use = pending.get(block.tool_use_id)
        pending.delete(block.tool_use_id)
        if (use === undefined) continue
        const text = resultText(block)
        if (use.block.name === 'Bash') {
          const target = commands.findLast((item) => item.id === use.block.id)
          if (target !== undefined) target.exit = exitCodeOf(text)
          continue
        }
        // A read leaves the only evidence of what the file said.  A short
        // excerpt of it is what lets an auditor see an empty test body without
        // handing it the whole transcript.
        const held = use.path === null ? undefined : files.get(use.path)
        if (use.op === 'read' && held !== undefined && held.excerpt === undefined) {
          const plain = collapse(text)
          // Structured tool output is not file content; skip it rather than
          // paste JSON into the evidence.
          if (plain !== '' && !/^[[{]/.test(plain)) held.excerpt = plain.slice(0, MAX_EXCERPT_CHARS)
        }
      }
    }
  }

  const keptFiles = [...files.values()].slice(0, MAX_LEDGER_FILES)
  const keptCommands = commands.slice(-MAX_LEDGER_COMMANDS)
  const tests = commands.filter((item) => item.test)
  return {
    files: keptFiles,
    commands: keptCommands,
    counts: {
      steps,
      files: files.size,
      edits: keptFiles.filter((file) => file.ops.includes('edit')).length,
      writes: keptFiles.filter((file) => file.ops.includes('write')).length,
      commands: commands.length,
      tests: tests.length,
      failedTests: tests.filter((item) => item.exit !== null && item.exit !== 0).length,
    },
    text: renderLedger({ files: keptFiles, commands: keptCommands, counts: { files: files.size, commands: commands.length } }),
  }
}

export function renderLedger({ files, commands, counts }) {
  const lines = []
  if (files.length === 0) lines.push('files: none')
  else {
    lines.push(`files (${counts.files}):`)
    for (const file of files) {
      const ops = file.ops.includes('edit') ? `edit x${file.count}` : file.ops.join('+')
      const hint = file.hints.length === 0 ? '' : `  ${file.hints.join(' / ')}`
      const excerpt = file.excerpt === undefined ? '' : `
    read: ${file.excerpt}`
      lines.push(`- ${file.path}  ${ops}${hint}${excerpt}`)
    }
  }
  if (commands.length === 0) lines.push('commands: none')
  else {
    lines.push(`commands (${counts.commands}):`)
    for (const item of commands) {
      const status = item.exit === null ? 'no exit code recorded' : item.exit === 0 ? 'exit 0' : `exit ${item.exit}`
      lines.push(`- ${item.command}  -> ${status}${item.test ? '  (test)' : ''}`)
    }
  }
  return lines.join('\n')
}

// The request is the first user message that carries text; tool results also
// arrive as user messages, so they are skipped.
export function requestOf(messages) {
  for (const entry of Array.isArray(messages) ? messages : []) {
    const message = messageOf(entry)
    if (message?.role !== 'user') continue
    const text = blocksOf(message)
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text.trim())
      .filter((part) => part !== '')
      .join('\n')
    if (text !== '') return text
  }
  return ''
}

export function finalTextOf(messages) {
  const all = Array.isArray(messages) ? messages : []
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const message = messageOf(all[index])
    if (message?.role !== 'assistant') continue
    const text = blocksOf(message)
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text.trim())
      .filter((part) => part !== '')
      .join('\n\n')
    if (text !== '') return text
  }
  return ''
}
