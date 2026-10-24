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

## What this suite does not prove

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
