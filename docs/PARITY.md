# Parity tests

The parity suite compares sidelens with the actual `cc-plugin-you-should-know`
module compiled into a Claude Code binary. It is not a hand-written expectation
file: `scripts/parity/update.mjs` extracts the official module, evaluates it,
runs the same corpus through both implementations, and writes the official
outputs to a fixture. The mod tests then replay that fixture against sidelens.

## What is compared

| Area | Fixture | Tests |
| --- | --- | --- |
| observer and explain prompts | 7 cases, full text + SHA-256 | byte equality |
| proposal parsing | 16 inputs | `parseProposedLine` |
| explanation parsing | 11 inputs | `parseExplanation` |
| text width/truncation | 10 strings × 4 widths | `cellsAtMost`, `wrapRows`, `truncateAtWordBoundary`, `truncateToCells`, `noteTopic`, `cleanForDraft` |
| constants | thresholds, tags, outcomes, copies | exact values |
| telemetry | answered/explained/proposed/page/version | exact records and marks |
| card copy | `TERMINAL_COPY`, `APP_COPY` | exact spans |
| choice/card layout | `choicesRows`, `fitCards`, `cardText`, `respondDraft` | exact values |
| about panel | `aboutFrame`, `aboutFit` | exact values |
| band trees | 8 offer states, 3 explained states | normalized `Box`/`Text`/`Button` trees, terminal + desktop |
| state helpers | rows, retention, watched surfaces, views | `withRow`, `keptPastPrompt`, `isBandWatched`, `aboutKeyOf`, `iterationOf`, `isOfferDue`, `looksToSkipAfter`, `isSameShowing`, `isUnattendedInFlight`, `rowsOf`, `openRowsOf`, `droppedOf`, `withViewCleared`, `storedCount`, `stringLines`, `isOpenView`, `forgetDetached`, `revive` |

The official module is found by the stable export alias `as proposePrompt`
inside the Claude Code binary. Minified local names change between releases, so
the loader reads the module's semantic export table (`Local as exportedName`)
and looks functions up by exported name. If a future release changes the export
names or packaging, the loader fails loudly instead of silently generating an
empty fixture.

## Commands

From the plugin directory:

```bash
# Validate the plugin and run all mod tests (fixture-based; no Claude binary needed)
npm run validate
npm run test

# Generate/update the fixture from the installed Claude Code
npm run parity:update

# Compare the installed Claude Code against the committed fixture
npm run parity:check

# Compare hooks/calls reported by claude plugin validate with the official scan
npm run parity:scan
```

`parity:check` runs both the fixture comparison and the static scan check. It
exits non-zero when the installed Claude Code produces different official
outputs. The fixture comparison prints the version, prompt hashes, and the first
JSON path that differs; the scan check compares hooks and `$` calls.

## Updating after a Claude Code release

1. Upgrade Claude Code and confirm the version:

   ```bash
   claude --version
   ```

2. Regenerate the official fixture:

   ```bash
   npm run parity:update
   ```

   The script prints the Claude Code version, plugin name, prompt lengths/hashes,
   and case counts, then writes
   `tests/parity/fixtures/official.mjs`.

3. Review the fixture diff. It is generated data; do not hand-edit it. A changed
   prompt hash or changed parse/tree output is the signal that the official mod
   changed.

4. Run the tests:

   ```bash
   npm run test
   ```

   A changed official behavior makes the parity tests fail with the case name
   and a path. Update `lib/`, `hooks/register.js`, or the UI tree until the suite
   is green. If the change is an intentional project difference, add it to the
   normalization in `tests/parity/official.test.ts` **and document it here**;
   do not silently weaken the comparison.

5. Run `npm run parity:check` once more before committing. Commit the fixture
   and the code change together so the pinned version and implementation stay in
   sync.

## Known intentional differences

The tests normalize exactly one known difference before comparing:

- the disable command: official `/plugin disable cc-plugin-you-should-know@builtin`
  vs sidelens `/plugin disable sidelens`.

Everything else in the fixture is compared as-is. In particular, the test does
not normalize away prompt text, state shape, UI labels, hotkeys, telemetry
fields, or layout.

Other intentional differences are outside the compared data and pinned
separately: the `isAvailable` feature-flag/compliance gate is removed, the
manifest/plugin name is `sidelens`, and `defaultEnabled` is false. The parity
suite therefore proves the core logic and presentation, not that the plugin
metadata is identical.

One requested behavior is a deliberate addition, not an official behavior:
when `enabledPlugins` says the official You should know mod is enabled,
sidelens soft-suspends for that plugin load and lets the official mod draw. It
is tested in `tests/sidelens.test.ts`, not against the official fixture, and it
adds exactly one `settings.read` call to the static scan. `scripts/parity/scan.mjs`
allows that one extra and fails on any other extra or missing call. If the
settings read fails or is denied, sidelens treats the official mod as disabled
and stays active.

A second requested addition is also outside the compared data: the manifest
declares `userConfig.autoSend` (boolean, default `false`). When on, the note is
submitted through the existing `$.prompt.submit` call as soon as the first
explanation appears, instead of waiting for **Chat in main session**; on success
the view is cleared and the topic marked known exactly as the Chat path does, so
one explanation produces one `respond` answered event. A refused send keeps the
panel and leaves the Chat action as the manual fallback. It adds no hook and no
`$` call, so the scan is unchanged, and with the default off the official
explained view is unchanged. `tests/sidelens.test.ts` covers both settings
(default off, explicit on, and a prompt box that already has text).

A third requested addition is the opt-in `userConfig.backlog` (boolean, default
`false`). While an explained view waits, checks keep running and queue up to
three proposals in the session row instead of replacing the open panel; when the
person handles the panel, the first surviving note becomes an offer labeled
`Earlier note · found Nm ago`. Queued notes expire after 30 minutes or three of
the person's prompts, whichever comes first, and the backlog is disabled while
`autoSend` is on.

This deliberately relaxes two official rules, and only while the option is on:

- the check gate no longer treats an open `explained` view as a reason to stop;
- dequeueing bypasses `isOfferDue`'s same-turn rule, because the note is shown
  later by design. Freshness is bounded by the TTL instead, and the panel is
  labeled as earlier so it is not mistaken for the current turn.

Queued proposals are **not** recorded as shown. Enqueueing emits only the
project-only `you_should_know_backlog` event with `outcome: 'queued'`; the
official `you_should_know_proposed` event is deferred until the note actually
reaches the screen, and then carries the original check's `step`, `latency_ms`,
`usage` and `offers_shown` plus `queued: true` (the `proposed()` builder adds
that property only when set, so official fixture records are unchanged). A note
that expires or is dropped never emits the official proposed event, so a
dashboard counting `outcome = shown` stays accurate. Showing, expiry and drops
also emit `you_should_know_backlog` with `outcome`, `wait_ms`, `age_ms` and
`depth`. No hook and no `$` call is added: the scan stays 6 hooks / 19 calls.
The behavior is covered by `tests/backlog.test.ts`.

The backlog queue and `promptSeq` live in the per-session row, but the
observer's memory — `seen`, `known`, `typedPastInARow` and `looksToSkip` — stays
plugin-level and is shared by every session, exactly as in the official mod.
There is no cross-session isolation to assert, so the suite does not test one;
README's "Parallel sessions" section documents the consequences.

A fourth requested addition is `userConfig.checkCadence` (string, default
`fixed`). `turnEnd` reads `stopReason` from the `turn.step` result and checks
once when the turn finishes (`end_turn`, `max_tokens`, `stop_sequence`,
`refusal`); `tool_use`, `pause_turn`, `compaction` and `null` keep waiting. It
adds no hook and no `$` call, so the scan stays 6 hooks / 19 calls. `autoSend`
wins over `turnEnd`: an auto-sent note starts a new turn, which would otherwise
trigger another end-of-turn check and chain notes into the main agent. Proposals
found this way carry `trigger: 'turnEnd'` (a project-only property added only
when set, so official fixture records are unchanged).

When `backlog` is also on, a turn that yields a note is drained: the same
`proposePrompt` is called again with the found lines in `seen`, up to
`TURN_DRAIN_MAX = 3` notes. The first note is shown immediately; later passes run
in the background and queue behind it as backlog items labeled **Another note**
rather than **Earlier note**. Drain stops on `none`, at three notes, or when the
backlog is full. After each extra pass an idle session — no open view — promotes
the queue head immediately, so a note queued after the person closed the first
panel is not stranded; `advanceBacklog` also refuses to overwrite a view that is
open at that moment. A turn whose end check arrives while an earlier check or
drain still holds the per-session lock is retried once that work settles, with
the retry bound to its own turn's event, rather than being dropped. Each extra
pass adds `pass: 2` or `pass: 3` to the official proposed record; the prompt and
parser are unchanged. `tests/cadence.test.ts` covers a one-step turn, tool-use
steps, the `fixed` default, the `autoSend` exclusion, draining, stopping on
`none`, the backlog requirement, the closed-early race, and the in-flight lock
retry. `tests/off-path.test.ts` pins the all-off path: the six-step cadence, no
`backlog`/`promptSeq` writes, no `you_should_know_backlog` event, and no
`queued`/`trigger`/`pass` properties.

## The audit layer

The audit extension adds no hook and no `$` call of its own, so the scan above is
unchanged: 6 hooks, 19 calls, one intentional extra (`settings.read`). It reads the
finished turn from the `turn.step` generator's return value, is off unless
`SIDELENS_AUDIT` is set, and is documented in [AUDIT.md](AUDIT.md). Parity therefore
covers the official path exactly as before; nothing here proves the audit's judgement,
which is measured separately under `eval/`.

## What this suite does not prove

- **The official-priority suspension** is covered by the mod harness tests, not by a
  differential replay: it is a project-specific addition.
- **Hook orchestration and async timing** are exercised by
  `tests/sidelens.test.ts` and the real CUA run, not by a differential replay.
  A differential hook-trace harness would require driving the official module's
  `register` against a fake engine.
- **Rare error paths** (aborted forks, race conditions, unusual surface
  combinations) are not exhaustively enumerated.
- **Page/artifact UI** is largely dead code in 2.1.308; only its telemetry builder
  is compared.
- **Provider behavior** is not part of the official module; the third-party
  `$.model.fork` path is covered by the live CUA test.

## CI

The fixture and parity tests are committed, so CI only needs Claude Code's mod
test runner:

```bash
npm run test
```

`npm run parity:check` is an update/release gate and needs the Claude Code
binary installed, because it extracts the official module from it. It is
deliberately not part of the fixture-only test run.
