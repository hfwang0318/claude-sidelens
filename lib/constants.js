// Constants shared by the sidelens hooks module.
//
// These mirror the values Claude Code 2.1.308 uses for its built-in
// "You should know" mod (cc-plugin-you-should-know).  Keeping them here makes
// the behavioural contract easy to compare against the upstream release.

export const PLUGIN_NAME = 'sidelens'
export const OFF_COMMAND = `/plugin disable ${PLUGIN_NAME}`
export const DEBUG_ENV = 'CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG'
export const USER_TYPE_ENV = 'USER_TYPE'

export const CHECK_EVERY = 6
export const CLEAR_AFTER_PROMPTS = 2
export const CHECKS_KEPT = 3
export const SEEN_MAX = 50
export const SESSIONS_MAX = 32
export const SHOWN_KEEP_MS = 3 * 24 * 60 * 60 * 1000
export const LOOKS_TO_SKIP_MAX = 16
export const TYPED_PAST_FREE = 2
export const ASKED_MS = 20_000
export const MS_PER_SECOND = 1000

export const CARD_WIDTH = 60
export const CARD_INSET = 2
export const CHOICE_GAP = 3
export const KEY_TEXT = '0: '
export const WIDE_FROM = 4352
export const STAR_CELLS = 2
export const WRAP_RESERVE_CELLS = 1
export const OFFER_MARGIN_ROWS = 1
export const FALLBACK_COLUMNS = 80

export const MAX_LINE_WIDTH = 240
export const MAX_CAPTION_LENGTH = 4000
export const MAX_CARDS = 4
export const MAX_SKETCH_LINES = 12
export const MAX_SKETCH_WIDTH = 120
export const MAX_TITLE_WIDTH = 120
export const SLUG_MAX = 48

export const DEFAULT_TAG = 'You should know'
export const HEADS_UP = /^\W*heads[\s-]*up\W*$/i
export const TAG_OPENERS = { 'You should know': 'you_should_know', 'Heads up': 'heads_up' }
export const LEARN_LABEL = /^learn\s*:\s*/i
export const EXPLAIN_LABEL = /^explain:\s*/i
export const INLINE_TAG =
  /[.\s\u2014\u2013-]*\s\**tag\**\s*:\s*\**\s*(heads[\s-]*up|you should know)\W*$/i
export const TAG_LABEL = new RegExp(
  String.raw`^[\s>*_"'\u201C\u201D\u2018\u2019` +
    '`' +
    String.raw`]*tag[\s*_"'\u201C\u201D\u2018\u2019` +
    '`' +
    String.raw`]*(?::\s*|[-\u2013\u2014](?:\s+|$))`,
  'i',
)

export const TITLE_LINE = /^(?:\*\*([^*]+)\*\*|#+\s*(.+))$/
export const FENCE_LINE = /^```/
export const HARD_BREAK = '  \n'
export const LIST_MARKER = /^(?:[-*+\u2022]|(\d+)([.)]))\s+/
export const LEADING_NUMBER = /^(\d+)([.)])(?=\s|$)/
export const MARKUP = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`|[\\`*_{}[<>#+\-=|~^$&:@]|(?<=[wW]{3})\./g
export const STRUCTURAL = /[\\`*_{}[<>#+\-=|~^$&:@]|(?<=[wW]{3})\./g

export const WRAPPING_QUOTES = [
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ['`', '`'],
]
export const CLOSERS = WRAPPING_QUOTES.map(([, close]) => close).join('')
export const ENDS_A_SENTENCE = new RegExp(`[.!?\u2026][${CLOSERS})\\]]*$`)
export const ENDS_WITH_QUESTION = new RegExp(`\\?[${CLOSERS}]?$`)

export const PAGE_KINDS = {
  ready: 'ok',
  reset: null,
  fork: 'bad',
  empty: 'bad',
  publish: 'bad',
  blocked: 'sad',
  timeout: 'bad',
}
export const PAGE_OUTCOMES = ['ready', 'reset', 'fork', 'empty', 'publish', 'blocked', 'timeout']
export const PROPOSED_KINDS = {
  shown: 'ok',
  none: 'ok',
  parse_failed: 'sad',
  deduped: 'ok',
  stale: 'ok',
  aborted: null,
  api_error: 'bad',
  error: 'bad',
}
export const PROPOSED_OUTCOMES = [
  'shown',
  'none',
  'parse_failed',
  'deduped',
  'stale',
  'aborted',
  'api_error',
  'error',
]
export const UNANSWERED_OUTCOMES = {
  'nothing-to-fork': 'none',
  'api-error': 'api_error',
  'empty-reply': 'none',
  aborted: 'aborted',
}
export const EXPLAINED_OUTCOMES = ['shown', 'fork', 'empty']
export const EXPLAIN_DIRECTIONS = ['first', 'simpler_words', 'less_detail', 'more_detail']
export const CLEARED_BY = ['prompt', 'session_end']
export const LEFT_BY = ['session_end', 'pushed_out']
export const OFF_VIA = ['row', 'offer', 'typed']
export const PROMPT_ORIGINS = ['composer', 'bridge', 'other']
export const OPENERS = ['understand', 'review', 'learn', 'see']
export const QUESTION_WORDS = ['why', 'how', 'what']
export const ASKED_WAYS = {
  simpler_words: 'in simpler words',
  less_detail: 'with less detail',
  more_detail: 'in more detail',
}
export const ANSWERS = [
  'helpful',
  'yes_explain',
  'yes_page',
  'not_relevant',
  'not_understood',
  'hard_to_read',
  'know_it',
  'not_now',
  'ignored_submit',
  'ignored_timeout',
  'got_it',
  'chat',
  'respond',
  'simpler_words',
  'less_detail',
  'more_detail',
  'not_helpful',
  'dismiss',
  'explained_helpful',
  'explained_not_understood',
  'page_helpful',
  'page_not_helpful',
  'page_unread',
  'left_open',
  'turn_off',
  'off_failed',
  'off_confirmed',
  'off_abandoned',
]
export const DEBUG_ON_WORDS = ['1', 'true', 'yes', 'on']
export const RELEASE_BASE = /^(\d+)\.(\d+)\.(\d+)(-dev)?$/

// Surfaces that draw their own composer (desktop, mobile, VS Code) suppress
// hotkey chrome and the terminal's star column.
export const OWN_COMPOSER = { terminal: false, desktop: true, mobile: true, vscode: true }

export const TERMINAL_INK = { star: { color: 'suggestion' }, tag: { dimColor: true } }
export const DIM_INK = { star: { color: 'subtle' }, tag: { color: 'subtle' } }
export const LEAD_INK = {
  terminal: TERMINAL_INK,
  desktop: DIM_INK,
  mobile: TERMINAL_INK,
  vscode: TERMINAL_INK,
}

export const NARROW_BOUNDS = {
  hangulJamo: 4352,
  punctuation: { first: 8208, last: 8286 },
  arrows: { first: 8592, last: 8703 },
  shapes: { first: 9472, last: 9727 },
  mediumSmallSquares: { white: 9725, black: 9726 },
}

export const PLUGIN_DESCRIPTION =
  'You should know: a side agent watches your back while Claude works on longer tasks. ' +
  'It looks for things worth knowing that you might miss, and surfaces them above the prompt.'

export const WATCHING = 'A side agent is watching your back while Claude works.'
export const WHEN =
  'When something comes up that you should know but might miss, this plugin flags it for you.'
export const SESSION_NOTE =
  '"You should know" made this page from the conversation at the time; it is a one-off explainer, not maintained.'

export const OFF_BOX_BUSY =
  'Your prompt box has text in it. Send or clear it, then press again to turn suggestions off.'
export const OFF_BOX_BUSY_DIALOG = 'A dialog has the keyboard. Answer it, then press 2 again.'
export const RESPOND_BOX_BUSY =
  'Your prompt box has text in it. Send or clear it, then press 2 again.'
export const RESPOND_NOT_FILLED = "The prompt box didn't take the note. Press 2 to try again."
export const RESPOND_BLOCKED = 'A dialog has the keyboard. Answer it, then press 2 again.'

export const PLUGIN_ALIASES = ['suggest-learning', 'you-should-know']

// The official mod's ids across releases.  A sidelens session yields while any
// of these is enabled in `enabledPlugins`.
export const OFFICIAL_PLUGIN_IDS = [
  'cc-plugin-you-should-know@builtin',
  'cc-plugin-you-should-know',
  'suggest-learning@builtin',
  'you-should-know@builtin',
  'suggest-learning',
  'you-should-know',
]
