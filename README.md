# sidelens

**You should know for every model provider.**

`sidelens` is a Claude Code **mod** that gives you the same side-agent experience as
Claude Code's built-in **You should know** mod, but without the built-in mod's
first-party availability gate. It works when Claude Code is pointed at a
third-party Anthropic-compatible model (for example a local Claude Code Router
backed by GLM, Kimi, DeepSeek, or a self-hosted gateway) as well as when it uses an
Anthropic model.

The mod watches a longer task in the background. Every sixth model step it asks a
side agent, over the session's own cached transcript, whether there is one thing
the person should really know. If there is, it draws an offer above the prompt:
`Learn more`, `Knew this already`, `What is this`, `Disable`, `Dismiss`. Choosing
`Learn more` turns the offer into a short plain-language explainer and a way to
continue the conversation in the main session.

The observer prompt, parsing rules, six-step cadence, two-prompt survival rule,
20-second feedback window, store schema, telemetry records, labels, hotkeys,
colours, and terminal/desktop layouts are ported from Claude Code 2.1.308's
`cc-plugin-you-should-know` mod. The only behavioural changes are the plugin's own
name in `$.state` and in the disable command, and the removal of the
`tengu_jolly_dewdrop` / compliance-taint availability gate. See
[the analysis](docs/ANALYSIS.md) for the full comparison.

For development rules, the current parity baseline, and a full document index,
read [CLAUDE.md](CLAUDE.md).

## Requirements

- Claude Code **2.1.287 or later** (mods are required; the parity target is
  **2.1.308**).
- An interactive CLI, the Code tab of the Desktop app, or the VS Code extension.
  Like the built-in mod, it cannot draw in `claude -p`; hooks still load there,
  but no suggestion is produced without a drawn band.
- A model that accepts a tool-less fork of the session transcript. Any provider
  that Claude Code can drive through its Anthropic-compatible API works; the mod
  never hard-codes a model or a provider.

## Install and enable

`defaultEnabled` is `false`, the same opt-in default as the built-in mod, so
loading the plugin is not the same as turning it on.

Load the directory for one session, then enable it:

```bash
claude --plugin-dir /path/to/claude-sidelens
```

```text
/plugin enable sidelens@inline
/reload-plugins
```

Or install it straight from GitHub:

```bash
claude plugin marketplace add hfwang0318/claude-sidelens
claude plugin install sidelens@claude-sidelens
claude plugin enable sidelens@claude-sidelens
```

Inside a session, the same steps are:

```text
/plugin marketplace add hfwang0318/claude-sidelens
/plugin install sidelens@claude-sidelens
/plugin enable sidelens@claude-sidelens
/reload-plugins
```

The marketplace name is `claude-sidelens`; the plugin name is `sidelens`.

The `/plugin` menu also works: open **Installed**, select `sidelens`, choose
**Enable plugin**, and run `/reload-plugins` as prompted.

While developing, validate and test from this directory:

```bash
npm run validate
npm run test
```

Official parity tests compare this plugin with the module extracted from a real
Claude Code binary:

```bash
npm run parity:update   # regenerate the fixture from the installed Claude Code
npm run parity:check    # compare the installed Claude Code with the fixture
```

The update/upgrade workflow is in [docs/PARITY.md](docs/PARITY.md).

The real interactive run (iTerm2 + Claude Code + third-party model) is recorded
with screenshots and findings in [docs/TESTING.md](docs/TESTING.md).

## Use

Work normally. After the sixth model step of a turn, the side agent may show:

```text
✦ Heads up · The build uses pnpm workspaces.

1: Learn more   2: Knew this already   3: What is this   4: Disable   0: Dismiss
```

- **Learn more** replaces the offer with a short explainer, or asks the model for
  one when the observer's reply did not carry an explanation.
- **Knew this already** remembers the topic and clears the band.
- **What is this** opens the mod's own explanation card (hover on desktop).
- **Disable** arms, then fills `/plugin disable sidelens` in the prompt on the
  second press. Press Enter to apply it.
- **Dismiss** asks for feedback; after 20 seconds the question clears itself.
- Sending two prompts while an offer is open dismisses it and raises the
  "look how often they type past it" skip counter, exactly as the built-in mod
  does.

## Privacy and data

The side request is made with `$.model.fork`. It goes to the **same endpoint,
model and credentials as the main session**, and it shares the main request's
cached prefix. With a local router, no request goes anywhere the main session does
not already go. The observer prompt instructs the side model not to reproduce
secrets, credentials, tokens, keys, environment values, or personal data.

The plugin stores only plain JSON under its own `$.store` keys (`sessions`,
`seen`, `known`, `typedPastInARow`, `looksToSkip`) and one `$.state` value
(`aboutOpen`). No files are read or written by the mod.

## Differences from the built-in mod

| Area | Built-in `cc-plugin-you-should-know` | `sidelens` |
| --- | --- | --- |
| Availability | Feature flag `tengu_jolly_dewdrop`, compliance taints, HIPAA/ZDR/LDR exclusions | No feature-flag gate; install + enable |
| Name in state | `cc-plugin-you-should-know` | `sidelens` |
| Disable command | `/plugin disable cc-plugin-you-should-know@builtin` | `/plugin disable sidelens` |
| Default | Disabled | Disabled (`defaultEnabled: false`) |
| Everything else | — | Ported unchanged |

The compliance exclusions cannot be read through the public mods API. If your
organization uses HIPAA, ZDR, or LDR controls, do not enable this plugin; use the
built-in mod on an Anthropic model instead.

## Development

```text
.claude-plugin/plugin.json   manifest (name, defaultEnabled, types)
hooks/hooks.json             points Claude Code at the hooks module
hooks/register.js            all six hooks and every mods API call
lib/prompts.js               the observer and explain prompts
lib/parse.js                 proposal/explanation parsing and the off command
lib/ui.js                    the AbovePrompt band tree
lib/data.js                  session rows and view state
lib/telemetry.js             answered/proposed/explained records
types/index.d.ts             the sidelens.aboutOpen state family
tests/                       behavior, parser, and official parity tests
scripts/parity/              official-module extractor and fixture generator
```

Static validation requires every `$.` call to be visible in the hooks module.
`hooks/register.js` is therefore the only file that touches `$`; the `lib/`
files are pure data, text, prompt, and tree builders.

## Provenance

The observer prompt and the behavioural constants are derived from Claude Code
2.1.308's built-in "You should know" mod for interoperability. Claude Code is a
Beta product of Anthropic PBC; this project is not affiliated with or endorsed by
Anthropic. The plugin code in this repository is MIT-licensed. Review Anthropic's
terms before redistributing the embedded prompt text.

## License

MIT. See [LICENSE](LICENSE).
