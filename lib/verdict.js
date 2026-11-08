// A verdict-shaped judgement, borrowed from modsmith's next-steps-supervisor.
//
// The audit layer asked "is any clause unattempted?" and answered yes on almost
// every turn: some detail is always unmet.  That template asks a different
// question — "did the work achieve the goal: yes, partly, or no?" — and treats an
// empty complaint list as clean.  This module is that shape, adapted to the
// evidence a sidelens turn actually has (a request and a tool-use ledger).

export const SOLVED = ['yes', 'partly', 'no']
export const MAX_ANSWER_CHARS = 4000

export function verdictPrompt({ request, ledger, finalText }) {
  const answer = String(finalText ?? '')
  return [
    'Pause the work. You are now a supervisor reviewing the conversation above, not continuing it.',
    'Do not call tools. Judge the most recent task against what the user originally asked for.',
    '',
    'The request, as the person wrote it:',
    request === '' ? '(empty)' : request,
    '',
    'What the record shows was done (extracted mechanically; authoritative):',
    ledger,
    ...(answer.trim() === ''
      ? []
      : [
          '',
          "The assistant's final reply to the user for this task (it may not appear above) was:",
          '<final-reply>',
          answer.length > MAX_ANSWER_CHARS ? `\u2026${answer.slice(-MAX_ANSWER_CHARS)}` : answer,
          '</final-reply>',
        ]),
    '',
    'Answer with one JSON object and nothing else:',
    '{"goal": string, "solved": "yes" | "partly" | "no", "gaps": string[], "shortcuts": string[], "needsApproval": string[]}',
    '',
    "- goal: the user's original goal for this task, in one sentence.",
    '- solved: did the work as it stands actually achieve that goal?',
    '- gaps: parts of the goal still not met.',
    '- shortcuts: where the work was lazy: verification skipped, tests not run, code stubbed or left TODO, a claim made without checking.',
    '- needsApproval: things done or proposed that the user should have approved first.',
    '',
    'Use empty arrays when there is nothing to say. Be specific and brief: each item under 20 words. Do not flatter.',
  ].join('\n')
}

const clip = (value, limit) => (value.length > limit ? `${value.slice(0, limit - 1)}\u2026` : value)

const strings = (value, max) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim() !== '')
        .slice(0, max)
        .map((item) => clip(item.trim(), 240))
    : []

// Models wrap JSON in fences or a sentence often enough that a strict parse
// would drop good verdicts; take the outermost braces and validate the shape.
export function parseVerdict(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const solved = SOLVED.find((value) => value === parsed.solved)
  if (solved === undefined) return null
  return {
    goal: typeof parsed.goal === 'string' ? clip(parsed.goal.trim(), 240) : '',
    solved,
    gaps: strings(parsed.gaps, 3),
    shortcuts: strings(parsed.shortcuts, 3),
    needsApproval: strings(parsed.needsApproval, 3),
  }
}

export const isClean = (verdict) =>
  verdict.solved === 'yes' &&
  verdict.gaps.length === 0 &&
  verdict.shortcuts.length === 0 &&
  verdict.needsApproval.length === 0
