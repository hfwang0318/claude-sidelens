# Interactive computer-use test

This is the end-to-end test run performed through the macOS desktop with the
CUA driver, not `claude plugin test`. It drives a real iTerm2 window and a real
Claude Code 2.1.308 session on a third-party model.

## Environment

- macOS, iTerm2, Claude Code **2.1.308**
- `ANTHROPIC_BASE_URL=http://127.0.0.1:3456` (Claude Code Router)
- model `zhipu/glm-5.3[1m]`
- plugin loaded with `--plugin-dir /Users/hfwang/workspace/claude-sidelens`
- `defaultEnabled: false`, so the plugin was explicitly enabled with
  `/plugin enable sidelens@inline` and `/reload-plugins`

The session then logged:

```text
sidelens: reloaded (6 hooks: prompt.submit, command.run, turn.step,
  ui.render, session.detach, session.end)
```

## 1. A natural offer

A long task was run in `/tmp/sidelens-lab` (a tiny HTTP server that keeps every
request body in memory). After the sixth model step the side agent produced a
real `Heads up` offer:

> 本会话没有任何写文件或执行命令的工具，主 agent 正在四处寻找替代方案，但按原要求很可能无法真正创建并运行测试。

![Natural Heads up offer](screenshots/offer-missing-tools.png)

This is a natural offer from `$.model.fork` on the third-party session, not a
fixture.

## 2. Learn more

The empty prompt had the band hotkeys armed. Pressing `1` ran the explain fork
and replaced the offer with a titled explainer and the choices
`1: Understood  2: Chat in main session  0: Dismiss`:

![Explanation after Learn more](screenshots/learn-more.png)

## 3. Chat in main session

Pressing `2` filled the prompt with the quoted note (the fill succeeded; the
prompt was not submitted by the plugin), then `Enter` submitted it as the user's
message. The main agent answered it and verified the files on disk:

![Quoted draft in the prompt](screenshots/chat-draft.png)

## 4. Knew this already

A second natural offer was produced after the agent cleaned `/tmp/sidelens-risk`:
it had stashed an uncommitted change and the final answer did not mention the
stash.

![Natural offer about the unmentioned stash](screenshots/offer-stash.png)

Pressing `2` cleared the band. The store then contained the topic in
`known`:

```json
"known": [
  "主 agent 在清理 /tmp/sidelens-risk 时没有销毁那处未提交改动，而是存进了 git stash，而最终回答不会提到它。."
]
```

## 5. Dismiss and the 20-second feedback window

For deterministic UI coverage, a well-formed `offer` row was written into the
plugin store for the current session, then a new prompt caused the band to
redraw. Pressing `0` replaced the offer with the feedback row:

```text
Dismissed.  1: That was helpful  2: Not relevant  3: Couldn't understand
            4: Turn off suggestions  0: Dismiss
```

![Feedback row after Dismiss](screenshots/feedback-row.png)

After 21 seconds the row disappeared by itself (the 20-second `ignored_timeout`
path).

## 6. Turn off suggestions

On the feedback row, pressing `4` filled the prompt with:

```text
/plugin disable sidelens
```

![Turn off fills the disable command](screenshots/turn-off.png)

`Enter` ran the command; the `/plugin` menu then showed
`Disabled sidelens. Applies when you close this menu.` The plugin was re-enabled
and reloaded afterwards to confirm the 6 hooks again.

## 7. A bug found and fixed

The first live test of `4: Turn off suggestions` on the feedback row did nothing.
The asked-row action had been wired to `armOff`, which only arms an **offer**
row and returns for an `asked` row. The built-in mod calls its turn-off function
directly from the feedback row.

Fixed in `hooks/register.js`: the asked-row off action now calls `turnOff(...)`
directly. A regression test was added
(`Turn off suggestions on the feedback row turns suggestions off at once`), and
the live session was reloaded and retried successfully. This is exactly the kind
of defect that unit/UI mounting tests without the real event chain can miss.

## 8. What was not shown, and why

The `3: What is this` and the offer-row `4: Disable` controls were absent in this
session. The mods API in Claude Code 2.1.308 hard-codes
`$.env.get("USER_TYPE")` to `"external"` for every mod:

```js
const value = name === "USER_TYPE" ? "external" : process.env[name]
```

So this is not a third-party-model flag and not necessarily the account type; it
is the value a mod is allowed to see. The built-in mod hides both controls for
that value (about copy and the voluntary offer-row turn-off path), and `sidelens`
keeps that behavior. Driving those two controls would require changing the
branch or mocking the value in a test harness; a real external-user session
cannot show them.

`claude -p` cannot be used for a band test at all: it has no drawn surface, so
the built-in mod and `sidelens` both correctly produce no suggestion.

## Result

| Check | Result |
| --- | --- |
| Plugin loads with 6 hooks | pass |
| Natural third-party offer | pass |
| Learn more → explain fork | pass |
| Chat in main session → draft fill | pass |
| Knew this already → `known` | pass |
| Dismiss → feedback row | pass |
| 20-second timeout | pass |
| Turn off → command fill → plugin disabled | pass (after fixing asked-row action) |
| Re-enable + reload | pass |
| Mods see `USER_TYPE=external`; about/offer-disable hidden | expected parity |

## Deterministic official parity

The computer-use run above is the end-to-end check. The deterministic,
fixture-backed comparison against the official module is documented in
[PARITY.md](PARITY.md) and runs as part of `npm run test`.


## Official-priority suspension

The CUA session above ran with the official mod unavailable, so the
official-priority path did not execute there. It is covered deterministically by
`tests/sidelens.test.ts` with `enabledPlugins` stubs: the official id and its
older alias both suppress the fork and band, and a stale sidelens view is
cleared.
