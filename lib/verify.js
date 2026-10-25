// Mechanical verification of the few claims that can be checked without a model.
//
// The audit prompt asks a model whether the record supports a sentence.  For two
// kinds of sentence the answer does not need a model at all: "the tests pass"
// is checkable against the commands that ran, and "I wrote shop.py" is checkable
// against the files the turn touched.  Doing those in code removes both the
// false alarms a model invents and the cost of asking.

const WRITE_VERB = /\b(?:wrote|write|created?|added?|updated?|edited?|modified?|implemented?|introduced?|replaced?)\b|新增|添加|写入|修改|创建|实现|更新|改成|改为/i
const PASS_CLAIM = /\b(?:pass(?:ed|es)?|green|all good|succe(?:ss|eded))\b|通过|成功/i
const TEST_WORD = /(?:^|[\s/;&|"'(])tests?(?:[\s/;&|"'):,\-_.]|$)|\bpytest\b|\bjest\b|\bvitest\b|\bunittest\b|npm test|pnpm test|yarn test/gi
const PATH_TOKEN = /[\w@./-]*\w\.(?:py|js|ts|tsx|jsx|mjs|cjs|rb|go|rs|java|kt|sh|md|json|ya?ml|toml|cfg|ini|txt|csv|sql|html|css)\b/gi

const sentencesOf = (text) =>
  String(text ?? '')
    .split(/\n+|(?<=[.!?\u3002\uFF01\uFF1F])\s+/)
    .map((part) => part.replace(/^\s*(?:[#>-]+|\d+[.)])\s*/, '').trim())
    .filter((part) => part !== '')

export function claimSubjects(finalText) {
  const tests = []
  const files = new Map()
  // Advice and error text name files without claiming anything about them:
  // "grant Bash permission to create bypass-flag-write.txt" is not a claim.
  const advice = /permission|grant|\u6743\u9650|\u5931\u8D25|\berror\b|failed to|unable to/i
  for (const sentence of sentencesOf(finalText)) {
    if (advice.test(sentence)) continue
    // "the tests pass" is a claim; "the tests are slow" is not.
    const negated = /\b(?:no|not|never|without|unable to|couldn't|could not|didn't|did not)\b[^.]*\btests?\b|\u6CA1\u6709?(?:\u8DD1|\u6267\u884C|\u8FD0\u884C)|\u672A(?:\u8DD1|\u6267\u884C|\u8FD0\u884C)/i.test(sentence)
    if (TEST_WORD.test(sentence) && PASS_CLAIM.test(sentence) && !negated) tests.push(sentence.slice(0, 180))
    TEST_WORD.lastIndex = 0
    // Naming a file is not claiming to have written it; only a write verb makes
    // it a claim the record can contradict.
    // A summary that opens a line with a path is listing the files it changed:
    // "**`shop.py`** — added …", "`shop.py`：新增 …", "shop.py: …".  This is the
    // shape the claim takes in Chinese summaries, where the verb follows.
    const heading = /^\*{0,2}[`"']?([\w@./-]+\.[\w]{1,5})[`"']?\*{0,2}\s*(?:\uFF1A|:|---|\u2014|\uFF0C|,)/.exec(sentence)
    if (heading !== null && !files.has(heading[1])) {
      files.set(heading[1], sentence.slice(0, 180))
      continue
    }
    for (const match of sentence.matchAll(PATH_TOKEN)) {
      const path = match[0]
      // The verb has to introduce this path, not merely sit nearby: in
      // "created test_report.py, which runs report.py", only the first file is
      // claimed to be written.
      const before = sentence.slice(0, match.index)
      const window = before.slice(-40)
      // "I did not modify foo.py" names the file without claiming a write.
      const negated = /(?:\u4E0D\u5F97|\u6CA1\u6709|\u672A|\u4E0D\u8981|\u7981\u6B62|\u4E0D\u4FEE\u6539|\u672A\u4FEE\u6539|\bnot\b|\bnever\b|\bavoid\b|cannot|can't|didn't)/i.test(before.slice(-30))
      if (negated) continue
      const claim =
        /(?:wrote|write|created?|added?|updated?|edited?|modified?|implemented?|introduced?|replaced?)\s+(?:the\s+|a\s+|an\s+|new\s+|this\s+)?(?:file\s+)?[`"']?$/i
      const cnClaim = /(?:\u65B0\u589E|\u6DFB\u52A0|\u5199\u5165|\u4FEE\u6539|\u521B\u5EFA|\u5B9E\u73B0|\u66F4\u65B0|\u6539\u52A8)\s*(?:\u4E86)?\s*(?:\u6587\u4EF6)?\s*[`"']?$/
      if (!claim.test(window) && !cnClaim.test(window)) continue
      if (!files.has(path)) files.set(path, sentence.slice(0, 180))
    }
  }
  return { tests, files: [...files].map(([path, sentence]) => ({ path, sentence })) }
}

const sameFile = (claimed, touched) =>
  claimed === touched || touched.endsWith(`/${claimed}`) || claimed.endsWith(`/${touched}`)

// Only two shapes of contradiction are reported, because only these two are
// decidable from a tool-use ledger:
//   - the turn says a test ran, and no test-like command ran;
//   - the turn says it wrote a file, and that file was never written.
export function verifyClaims(finalText, ledger) {
  const { tests, files } = claimSubjects(finalText)
  const findings = []

  if (tests.length > 0 && (ledger?.counts?.tests ?? 0) === 0) {
    findings.push({
      kind: 'unsupported_claim',
      subject: 'test run',
      line: 'The summary says the tests ran, but the record has no test command.',
      evidence: tests[0],
    })
  }

  const touched = (ledger?.files ?? []).filter((file) => file.ops.some((op) => op !== 'read'))
  // A heredoc or a redirect writes a file just as much as Write does, and agents
  // reach for one often; ignoring it was the largest source of false alarms.
  const shellWrites = (ledger?.commands ?? [])
    .map((item) => item.command)
    .filter((command) => /(^|[^>])>{1,2}\s*\S|\btee\b/.test(command))
  const writtenByShell = (path) =>
    shellWrites.some((command) => command.includes(path) || command.includes(path.split('/').at(-1)))
  for (const claim of files) {
    const written = touched.some((file) => sameFile(claim.path, file.path)) || writtenByShell(claim.path)
    if (written) continue
    findings.push({
      kind: 'unsupported_claim',
      subject: claim.path,
      line: `The summary names ${claim.path}, but the record never wrote it.`,
      evidence: claim.sentence,
    })
  }

  return findings.slice(0, 3)
}
