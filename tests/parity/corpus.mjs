// Inputs shared by the official fixture generator and the parity tests.

const LONG_LINE =
  'The main agent chose to add prompt caching to multi-turn /ask, but it could end up being ' +
  'more expensive for the user because one-off questions pay 1.25x to save and never read it back.'

export const PROPOSE_CASES = [
  { name: 'empty', seen: [], known: [] },
  {
    name: 'seen-and-known',
    seen: ['The build uses pnpm workspaces.', 'Orders DB encryption uses extra CPU.'],
    known: ['The API is rate limited to 60 requests per minute.'],
  },
  {
    name: 'many',
    seen: Array.from({ length: 8 }, (_, index) => `Seen topic number ${index + 1}.`),
    known: Array.from({ length: 6 }, (_, index) => `Known topic number ${index + 1}.`),
  },
]

export const EXPLAIN_CASES = [
  { name: 'first', topic: 'The build uses pnpm workspaces.', previous: undefined },
  {
    name: 'simpler',
    topic: 'The build uses pnpm workspaces.',
    previous: { direction: 'simpler_words', previous: 'Workspaces share one lockfile.' },
  },
  {
    name: 'less',
    topic: 'The build uses pnpm workspaces.',
    previous: { direction: 'less_detail', previous: 'Workspaces share one lockfile.' },
  },
  {
    name: 'more',
    topic: 'The build uses pnpm workspaces.',
    previous: { direction: 'more_detail', previous: 'Workspaces share one lockfile.' },
  },
]

export const PROPOSAL_CASES = [
  { name: 'none', input: 'learn: none' },
  { name: 'none-period', input: 'learn: none.' },
  { name: 'none-paren', input: 'learn: none (nothing worth interrupting for)' },
  { name: 'plain', input: 'learn: The build uses pnpm workspaces.' },
  {
    name: 'full',
    input:
      'learn: The build uses pnpm workspaces.\ntag: Heads up\nexplain:\n' +
      '**Workspace build**\nUse pnpm from the repository root.',
  },
  { name: 'inline-tag', input: 'learn: This deletes the backup before verifying it. tag: Heads up' },
  { name: 'quoted', input: 'learn: "The build uses pnpm workspaces."\ntag: You should know' },
  { name: 'question', input: 'learn: Is this safe to run?\ntag: Heads up' },
  { name: 'long', input: `learn: ${LONG_LINE}\ntag: Heads up` },
  { name: 'bullet', input: '- learn: The build uses pnpm workspaces.\ntag: Heads up' },
  { name: 'fenced', input: 'learn: The build uses pnpm workspaces.\nexplain:\n```\nrepo/\n```' },
  {
    name: 'multi-card',
    input:
      'learn: The build uses pnpm workspaces.\ntag: You should know\nexplain:\n' +
      '**Workspace build**\nOne lockfile.\n\n**Install once**\nRun pnpm install at the root.',
  },
  { name: 'empty', input: '' },
  { name: 'garbage', input: 'hello world' },
  {
    name: 'crlf',
    input: 'learn: The build uses pnpm workspaces.\r\ntag: Heads up\r\nexplain:\r\n**Workspace build**\r\nUse pnpm.',
  },
  { name: 'heading-tag', input: 'learn: The build uses pnpm workspaces.\n## Heads up' },
]

export const EXPLANATION_CASES = [
  { name: 'empty', input: '' },
  { name: 'title', input: '**Workspace build**' },
  { name: 'title-and-lead', input: '**Workspace build**\nUse pnpm from the root.' },
  {
    name: 'bullets',
    input: '**Workspace build**\n\n* One lockfile.\n* One install.\n* One version.',
  },
  {
    name: 'sketch',
    input: '**Workspace build**\nUse pnpm from the root.\n```\nrepo/\n  packages/\n```\nRun it once.',
  },
  {
    name: 'multi-card',
    input:
      '**Workspace build**\nOne lockfile.\n\n**Install once**\nRun pnpm install at the root.',
  },
  { name: 'heading', input: '# Workspace build\nUse pnpm from the root.' },
  {
    name: 'long-caption',
    input: `**Workspace build**\n${'A long paragraph. '.repeat(300)}`,
  },
  { name: 'ansi', input: '\u001B[31m**Workspace build**\u001B[0m\nUse pnpm.\u0000\u0007' },
  { name: 'crlf', input: '**Workspace build**\r\nUse pnpm from the root.\r\n' },
  { name: 'ordered', input: '**Workspace build**\n1. Install\n2. Build\n3. Test' },
]

export const TEXT_CASES = [
  { name: 'empty', value: '' },
  { name: 'ascii', value: 'The build uses pnpm workspaces.' },
  { name: 'cjk', value: '构建使用 pnpm workspaces。' },
  { name: 'emoji', value: 'Ship it 👩‍💻 with a ✨.' },
  { name: 'long-word', value: 'x'.repeat(300) },
  { name: 'spaces', value: '  a   b  ' },
  { name: 'ansi', value: '\u001B[31mred\u001B[0m' },
  { name: 'controls', value: 'a\u0000b\u0007c\u2028d\u2029e' },
  { name: 'newlines', value: 'line one\nline two\n\nline four' },
  { name: 'combining', value: 'e\u0301 and 👍🏽' },
]

export const WIDTH_CASES = [
  { name: 'narrow', columns: 10 },
  { name: 'normal', columns: 40 },
  { name: 'wide', columns: 100 },
  { name: 'tiny', columns: 1 },
]

export const CHOICES_CASES = [
  { name: 'short', labels: ['Learn more', 'Knew this already', 'Dismiss'] },
  {
    name: 'long',
    labels: ['Learn more', 'Knew this already', 'What is this', 'Disable', 'Dismiss'],
  },
  {
    name: 'very-long',
    labels: ['A very long label that has to wrap in a narrow band and keep going', 'Dismiss'],
  },
]

export const CARD_CASES = [
  {
    name: 'plain',
    card: {
      title: 'Workspace build',
      lead: 'Use pnpm from the root.',
      sketch: [],
      caption: '',
    },
  },
  {
    name: 'with-sketch',
    card: {
      title: 'Workspace build',
      lead: 'Use pnpm from the root.',
      sketch: ['repo/', '  packages/'],
      caption: 'Run it once.',
    },
  },
  {
    name: 'long',
    card: {
      title: 'A very long title that must be truncated to the band width',
      lead: 'A long lead. '.repeat(20),
      sketch: ['x'.repeat(200)],
      caption: 'A long caption. '.repeat(20),
    },
  },
]

export const RESPOND_CASES = [
  { name: 'plain', line: 'The build uses pnpm workspaces.', tag: 'Heads up' },
  {
    name: 'sketch',
    line: 'The build uses pnpm workspaces.',
    tag: 'You should know',
    cards: [CARD_CASES[1].card],
  },
]

export const ANSWERED_CASES = [
  {
    name: 'minimal',
    record: {
      answer: 'helpful',
      msToAnswer: 1200,
      isTurnInProgress: true,
      offersShown: 2,
      line: 'Is this safe to run?',
      tag: 'Heads up',
    },
  },
  {
    name: 'full',
    record: {
      answer: 'left_open',
      msToAnswer: 3000,
      isTurnInProgress: false,
      offersShown: 3,
      line: 'The build uses pnpm workspaces.',
      tag: 'You should know',
      iteration: 1,
      promptOrigin: 'bridge',
      promptsSurvived: 2,
      leftBy: 'pushed_out',
      clearedBy: 'session_end',
      offVia: 'typed',
      version: { major: 2, minor: 1, patch: 308, isDev: false, builtAtS: 1792830000 },
    },
  },
]

const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 7,
  cache_creation_input_tokens: 3,
}

export const EXPLAINED_CASES = [
  { name: 'shown', record: { outcome: 'shown', direction: 'first', latencyMs: 900, usage: USAGE } },
  {
    name: 'fork',
    record: { outcome: 'fork', direction: 'simpler_words', latencyMs: 1200, usage: null },
  },
  { name: 'empty', record: { outcome: 'empty', direction: 'less_detail', latencyMs: 300, usage: USAGE } },
]

export const PROPOSED_CASES = [
  {
    name: 'shown',
    record: { outcome: 'shown', tag: 'Heads up', step: 6, latencyMs: 500, usage: USAGE, offersShown: 1 },
  },
  {
    name: 'none-no-usage',
    record: { outcome: 'none', tag: undefined, step: 12, latencyMs: 400, usage: null, offersShown: 0 },
  },
  {
    name: 'deduped',
    record: {
      outcome: 'deduped',
      tag: 'You should know',
      step: 18,
      latencyMs: 600,
      usage: USAGE,
      offersShown: 2,
    },
  },
  {
    name: 'parse-failed',
    record: {
      outcome: 'parse_failed',
      tag: undefined,
      step: 24,
      latencyMs: 700,
      usage: USAGE,
      offersShown: 2,
    },
  },
]

export const PAGE_CASES = [
  { name: 'ready', record: { outcome: 'ready', forkMs: 100, totalMs: 200, usage: USAGE } },
  { name: 'fork', record: { outcome: 'fork', forkMs: 0, totalMs: 0, usage: null } },
]

export const VERSION_CASES = [
  { name: 'release', base: '2.1.308', builtAt: '2026-10-22T03:28:37Z' },
  { name: 'dev', base: '2.1.309-dev', builtAt: '' },
  { name: 'bad', base: 'unknown', builtAt: 'nope' },
]

export const UI_OFFER_CASES = [
  {
    name: 'terminal-closed',
    surface: 'terminal',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: false,
    offArmed: false,
    off: true,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'terminal-open',
    surface: 'terminal',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: true,
    offArmed: false,
    off: true,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'terminal-armed',
    surface: 'terminal',
    line: 'The build uses pnpm workspaces.',
    tag: 'You should know',
    isOpen: false,
    offArmed: true,
    off: true,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'terminal-no-off',
    surface: 'terminal',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: false,
    offArmed: false,
    off: false,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'terminal-narrow',
    surface: 'terminal',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: false,
    offArmed: false,
    off: true,
    maxRows: 8,
    bodyColumns: 40,
  },
  {
    name: 'desktop-closed',
    surface: 'desktop',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: false,
    offArmed: false,
    off: false,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'desktop-open',
    surface: 'desktop',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: true,
    offArmed: false,
    off: false,
    maxRows: 24,
    bodyColumns: 100,
  },
  {
    name: 'desktop-external',
    surface: 'desktop',
    line: 'The build uses pnpm workspaces.',
    tag: 'Heads up',
    isOpen: false,
    offArmed: false,
    off: false,
    maxRows: 24,
    bodyColumns: 100,
    hideCopy: true,
  },
]

export const UI_EXPLAINED_CASES = [
  { name: 'terminal', surface: 'terminal', text: EXPLANATION_CASES[4].input, actions: true },
  { name: 'desktop', surface: 'desktop', text: EXPLANATION_CASES[5].input, actions: true },
  { name: 'no-actions', surface: 'terminal', text: EXPLANATION_CASES[1].input, actions: false },
]

export const ABOUT_FIT_CASES = [
  {
    name: 'terminal-closed',
    surface: 'terminal',
    isOpen: false,
    hideCopy: false,
    maxRows: 24,
    bodyColumns: 100,
    tag: 'Heads up',
    line: 'The build uses pnpm workspaces.',
  },
  {
    name: 'terminal-open',
    surface: 'terminal',
    isOpen: true,
    hideCopy: false,
    maxRows: 24,
    bodyColumns: 100,
    tag: 'Heads up',
    line: 'The build uses pnpm workspaces.',
  },
  {
    name: 'terminal-narrow',
    surface: 'terminal',
    isOpen: false,
    hideCopy: false,
    maxRows: 6,
    bodyColumns: 40,
    tag: 'Heads up',
    line: 'The build uses pnpm workspaces.',
  },
  {
    name: 'desktop',
    surface: 'desktop',
    isOpen: false,
    hideCopy: false,
    maxRows: 24,
    bodyColumns: 100,
    tag: 'Heads up',
    line: 'The build uses pnpm workspaces.',
  },
  {
    name: 'external',
    surface: 'terminal',
    isOpen: false,
    hideCopy: true,
    maxRows: 24,
    bodyColumns: 100,
    tag: 'Heads up',
    line: 'The build uses pnpm workspaces.',
  },
]

export const ABOUT_FRAME_CASES = [
  { name: 'terminal', ownsComposer: false, maxRows: 24, bodyColumns: 100, hideCopy: false },
  { name: 'desktop', ownsComposer: true, maxRows: 24, bodyColumns: 100, hideCopy: false },
  { name: 'external', ownsComposer: false, maxRows: 24, bodyColumns: 100, hideCopy: true },
]

export const CARD_TEXT_CASES = CARD_CASES
export const FIT_CARD_CASES = [
  { name: 'normal', cards: [CARD_CASES[0].card, CARD_CASES[1].card], columns: 100 },
  { name: 'narrow', cards: [CARD_CASES[2].card], columns: 40 },
]

const offerView = (id, shownAt) => ({
  id,
  tag: 'Heads up',
  view: { kind: 'offer', line: `${id} line`, shownAt },
})

const explainedView = (id, shownAt) => ({
  id,
  tag: 'You should know',
  view: {
    kind: 'explained',
    line: `${id} line`,
    text: '**Title**\nBody',
    iteration: 1,
    shownAt,
  },
})

export const STATE_ROWS_CASES = [
  { name: 'empty', rows: undefined, next: offerView('a', 1000) },
  {
    name: 'replace',
    rows: [offerView('a', 1000), offerView('b', 2000)],
    next: explainedView('a', 3000),
  },
  {
    name: 'new-first',
    rows: [offerView('a', 1000), offerView('b', 2000)],
    next: offerView('c', 3000),
  },
  {
    name: 'overflow',
    rows: Array.from({ length: 34 }, (_, index) =>
      index % 2 === 0 ? offerView(`old-${index}`, 1000) : explainedView(`old-${index}`, 2000),
    ),
    next: offerView('new', 3000),
  },
]

export const STATE_KEPT_CASES = [
  { name: 'offer', view: { kind: 'offer', line: 'Line', shownAt: 1000 }, prompts: 1 },
  {
    name: 'explained',
    view: { kind: 'explained', line: 'Line', text: 'Text', iteration: 1, shownAt: 1000 },
    prompts: 1,
  },
]

export const STATE_BAND_CASES = [
  { name: 'terminal', surfaces: ['terminal'], watched: [], bridged: false },
  { name: 'watched-desktop', surfaces: ['desktop'], watched: ['desktop'], bridged: false },
  { name: 'unwatched-desktop', surfaces: ['desktop'], watched: [], bridged: false },
  { name: 'bridge-terminal-only', surfaces: ['terminal'], watched: [], bridged: true },
  { name: 'bridge-desktop', surfaces: ['terminal', 'desktop'], watched: ['desktop'], bridged: true },
]

export const STATE_ABOUT_KEYS = [
  { name: 'stamped', view: { line: 'Line', shownAt: 1000 } },
  { name: 'unstamped', view: { line: 'Line' } },
]

export const STATE_ITERATIONS = [
  { name: 'offer', view: { kind: 'offer' } },
  { name: 'asked-none', view: { kind: 'asked' } },
  { name: 'asked', view: { kind: 'asked', iteration: 2 } },
  { name: 'explained', view: { kind: 'explained', iteration: 1 } },
  { name: 'off', view: { kind: 'off' } },
]

export const STATE_DUE = [
  { name: 'same', offeredTurn: 't1', turnId: 't1', ended: false },
  { name: 'same-ended', offeredTurn: 't1', turnId: 't1', ended: true },
  { name: 'different', offeredTurn: 't1', turnId: 't2', ended: false },
]

export const STATE_LOOKS = [
  { name: '0', value: 0 },
  { name: '1', value: 1 },
  { name: '2', value: 2 },
  { name: '3', value: 3 },
  { name: '4', value: 4 },
  { name: '10', value: 10 },
  { name: '20', value: 20 },
]

export const STATE_SAME = [
  { name: 'same', left: offerView('a', 1000).view, right: offerView('a', 1000).view },
  { name: 'different-kind', left: offerView('a', 1000).view, right: explainedView('a', 1000).view },
  { name: 'different-time', left: offerView('a', 1000).view, right: offerView('a', 2000).view },
]

export const STATE_UNATTENDED = [
  { name: 'explaining', view: { kind: 'explaining', line: 'Line' }, active: false },
  { name: 'making', view: { kind: 'making', line: 'Line' }, active: false },
  { name: 'explaining-active', view: { kind: 'explaining', line: 'Line' }, active: true },
  { name: 'offer', view: offerView('a', 1000).view, active: false },
]

export const STATE_ROWS_OF = [
  {
    name: 'invalid',
    rows: [
      { id: 'ok', view: offerView('ok', 1000).view },
      { id: 1, view: offerView('bad', 1000).view },
      { id: 'bad-view', view: { kind: 'nope' } },
      null,
      'nope',
    ],
  },
]

export const STATE_OPENED = [
  { name: 'mixed', rows: [offerView('a', 1000), explainedView('b', 2000), { id: 'c' }] },
]

export const STATE_DROPPED = [
  {
    name: 'drop',
    before: [offerView('a', 1000), offerView('b', 2000)],
    after: [offerView('a', 3000)],
  },
]

export const STATE_CLEARED = [
  { name: 'clear', rows: [offerView('a', 1000), offerView('b', 2000)], id: 'a' },
]

export const STATE_COUNTS = [
  { name: 'good', value: 3 },
  { name: 'negative', value: -1 },
  { name: 'float', value: 1.5 },
  { name: 'string', value: '3' },
]

export const STATE_STRINGS = [
  { name: 'empty', value: undefined },
  { name: 'strings', value: ['a', 1, null, 'b'] },
]

export const STATE_FORGET = [
  { name: 'remove', watched: ['terminal', 'desktop'], surfaces: ['terminal'] },
  { name: 'keep', watched: ['terminal'], surfaces: ['terminal', 'desktop'] },
]

export const STATE_REVIVE = [
  { name: 'remove', set: ['a', 'b'], id: 'a' },
  { name: 'absent', set: ['a'], id: 'b' },
]

export const STATE_OPEN = [
  { name: 'offer', view: { kind: 'offer' } },
  { name: 'explained', view: { kind: 'explained' } },
  { name: 'asked', view: { kind: 'asked' } },
  { name: 'off', view: { kind: 'off' } },
  { name: 'null', view: null },
]
