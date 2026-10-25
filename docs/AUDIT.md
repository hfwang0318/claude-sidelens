# The audit layer

`sidelens` has two layers.

- **Core** — the official `You should know` behaviour, byte-for-byte: prompts, 6 hooks,
  19 `$` calls, view shape, telemetry, cadence. `npm run parity:check` proves it.
- **Audit** — an optional extension that reviews the turn that just ended. Off by
  default, needs no new hook and no new `$` call.

## Verdict: experimental, unproven, off by default

Measured over twelve real calls against the eight-trap corpus:

| Metric | Value |
| --- | --- |
| evidence verifiable | **100%** (every quotation existed in the package) |
| format held | ~83% (2 `unparsable`; one retry did not fix it) |
| type agreement on labelled traps | 0 of 3 |

The last number has a cause, and it is not model weakness. The clearest trap
(`vacuous-test`: the test passes because it asserts nothing) got a
format-perfect `audit: none`. That answer is **correct under the rule as
written** — the claim "tests pass" really is backed by a test run in the record.
The defect is that the test is worthless, which is a judgement about content.

So the corpus and the capability disagree:

- The eight traps are *plausible but wrong*. Catching them needs file contents and
  an opinion about correctness.
- This layer's evidence is a tool-use ledger. It can support exactly one class of
  finding: **a claim with no corresponding action**, and **a clause never
  attempted**.

Neither class is represented in the corpus, so neither is measured. They remain
plausible, not proven.

**Therefore the audit layer ships off by default and is not recommended for
production use.** The switches exist so the code can be exercised, not because the
capability cleared a bar.

What would change the verdict: a corpus of turns where the agent claims work the
record does not contain — no test run at all, a file claimed but never written, a
clause silently dropped. Those are cheap to synthesise from existing transcripts
by deleting the corresponding tool call, and they are the only cases this
architecture can win.

## What it can and cannot judge

The side request sees the session transcript, denied tools, and nothing else. So it
can judge **what was said and what was attempted**, and cannot judge **what is true now**.
Everything below follows from that line.

| Capability | Verdict | Why |
| --- | --- | --- |
| Clause never attempted | **doable** | absence is decidable from the record |
| Clause attempted but not finished | **not doable with this evidence** | partial writes only show up in tool *results*, which `turn.step` does not return |
| Unsupported claim (said "tests pass", no test ran) | **doable** | both sides are in the record |
| Clause conflict (two clauses cannot both hold) | **doable** | both are text |
| Claimed-vs-actual file set | **doable**, abstains when a subagent did the work | the main transcript has no subagent patch |
| Coarse test gap (code changed, no test run at all) | **doable**, only the coarsest level | no file→test map exists |
| Implementation matches design intent | **not doable** | only patches are visible, never the file; reconstruction fails silently |
| Fine-grained test coverage | **not doable** | no mapping is available |
| Unverified assumptions / hidden premises | **not doable** | the bar is "did the person care", false alarms dominate |
| Secrets / security review | **not doable** | new file contents are not in the record |
| Session recap | out of scope | that is memory, not review |

## Verified on the real engine

A throwaway probe plugin (a `turn.step` hook storing `Object.keys(yield* next(e))`)
recorded this on an installed 2.1.308, headless:

```
keys: turnId, index, answer, toolUses, stopReason, usage
```

So `toolUses` is real and the evidence path holds. What the probe could not show is the
shape of one entry, because that headless run had no tools at all; `lib/ledger.js` reads
`{ name, input }` and falls back to `{ tool, ...input }`.

## Switches

All read from the environment, all default off.

| Variable | Effect |
| --- | --- |
| `SIDELENS_AUDIT` | master switch: all dimensions |
| `SIDELENS_AUDIT_COVERAGE` | clause coverage |
| `SIDELENS_AUDIT_CLAIMS` | claim-versus-record |
| `SIDELENS_AUDIT_CONFLICT` | clause conflicts |

A per-dimension value wins over the master, so `SIDELENS_AUDIT=1` with
`SIDELENS_AUDIT_CONFLICT=0` runs two dimensions.

## Where the evidence comes from

`turn.step` is an async generator: `const finished = yield* next(e)` evaluates to the
step's result, which carries `answer` and `toolUses`. `lib/ledger.js` turns those into a
compact, mechanical record — files touched, edits with their first changed line, commands
run, and a bounded excerpt of anything the turn read.

Three details that mattered in practice:

- **Edits do not only come from `Edit`.** The recorded supervisor runs edited code with
  `mcp__serena__replace_content`. The ledger keys on a path field plus the tool name's
  verb, so any MCP server shows up.
- **A `read` excerpt is the only evidence of what a file said.** "You read the test file"
  proves nothing; the excerpt showing the test body has no assertion is the finding.
- **Exit codes are often absent.** Do not build a judgement on them.

## The protocol

One request, one reply, three fields:

```
audit: none
```

or

```
audit: <one sentence>
kind: missing_clause | unsupported_claim | clause_conflict
clauses:
- 1 <quotation from the record>
- 2 none
- 3 unclear
```

`unclear` is a legal answer. A finding with no quotation is parsed as `unverified` and
dropped: an unverifiable accusation costs more trust than a missed one.

## Delivery

The audit runs on the next `prompt.submit`, so it never races the person's typing, and
the result is stored per session. `ui.render` draws it above the official band only when
the band is idle and the result is younger than ten minutes. One line, one `Dismiss`.

## Measuring it

`eval/from-supervisor.mjs` turns the eight trap tasks in `../claude-supervisor` into cases
(request, clauses, ledger, final message, expected kind). `eval/run.mjs` runs them and
reports precision, recall and the evidence-verifiability rate.

```bash
node eval/from-supervisor.mjs
node eval/run.mjs --dry                      # prompts only
node eval/run.mjs --via claude --limit 8     # uses the local CLI and its credentials
ANTHROPIC_AUTH_TOKEN=… node eval/run.mjs --mode package --reps 1
```

Precision is computed only over labelled tasks; findings on unlabelled tasks are reported
separately and reviewed by hand. The evidence rate needs neither a human nor a judge: a
finding counts as verifiable when its quotation actually appears in the package it was
given.

### First numbers (6 cases, `claude -p`, coverage+claims)

```
precision 0.0%   recall 0.0%   evidence 100%
```

Read it as a pipeline check, not a verdict. Precision was zero because both findings
landed on `false-premise`, which had no label at the time; evidence was 100% because both
quotations were real. Recall was zero partly because the `conflict` dimension was off, and
one reply did not parse. The label table and the precision scope have since been fixed.

## Limits

- The audit is inert on an engine whose `turn.step` result lacks `toolUses`; it never
  throws, it just does nothing.
- The positive path cannot be asserted through `claude plugin test`: the mock and the
  plugin both register `turn.step`, so which handler the plugin's `next(e)` reaches is
  decided by tier order. It has to be checked on a real session.
- `claude -p` as a transport costs roughly 100 s per case; a real API key is much faster.
