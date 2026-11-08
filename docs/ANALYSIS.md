# Claude Code「You should know」官方插件分析，以及 sidelens 的对等实现

目标：把 Claude Code 内置 mod `cc-plugin-you-should-know`（简称 YSK）的能力**原样**搬到普通
mod 里，只去掉「只有官方模型/官方账号可用」这一层限制。本文先拆官方实现，再给出逐项对照和验证
结果。

分析对象：Claude Code **2.1.308**（`claude --version` 输出 `2.1.308 (Claude Code)`），
macOS arm64。官方 mod 的源码在二进制的 Bun 模块图里，模块头为
`// @bun @bytecode`，版本 2.1.308。

---

## 1. 结论

1. YSK 本身**并不依赖 Anthropic 专有模型接口**。它的侧请求只用公开 mods API
   `$.model.fork({ prompt })`；该 API 的类型和实现都明确写着「使用 session 自己的 model、
   system prompt、tools 和凭据」。所以换成三方模型后，侧请求天然走三方模型。
2. 真正拦住三方模型的是**可用性判断**，不是请求本身：

   ```js
   // 官方源码（2.1.308）
   var bn = false;
   var On = () => (aEt() || false)
     && !Ls("hipaa") && !Ls("zdr") && !Ls("ldr")
     && k("tengu_jolly_dewdrop", bn);
   ```

   - `aEt()`：compliance taints 是否已经 settled。
   - `Ls(...)`：是否带 HIPAA / ZDR / LDR taint。
   - `k("tengu_jolly_dewdrop", false)`：读取 Anthropic 服务端下发的 feature flag，默认 false。

   三方模型 / Claude Code Router / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 的场景下，
   这个 flag 不会被下发，`isAvailable()` 为 false，内置 mod 就不会出现在 `/plugin` 里。
3. 因此 `sidelens` 的做法是：**保留 YSK 的 hooks、prompt、解析、UI、状态、节流、遥测，全部
   不变；只把 `isAvailable` 这层 gate 去掉**，并把插件自己的名字用于 `$.state` 和禁用命令。
4. 实测：在本机 `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`、模型
   `zhipu/glm-5.3[1m]`（Claude Code Router）下，`$.model.fork` 返回
   `{"isAnswered":true,"text":"FORK_OK",...}`，`cache_read_input_tokens=16576`。
   说明三方 endpoint 能正常处理 fork（含共享 prompt cache 前缀）。

---

## 2. 官方插件的外部形态

### 2.1 注册

官方在二进制里这样注册（简化）：

```js
var Ube = "cc-plugin-you-should-know";
var vn = {
  name: Ube,
  description: "You should know: a side agent watches your back ...",
  isAvailable: On,
};
var Ka = () => YS({
  ...vn,
  defaultEnabled: false,
  hooksModule: $N(import.meta.dir, ct, () => is()),
});
```

- 它是一个 **built-in mod**：`$N(...)` 把编译进二进制的 hooks module 交给引擎。
- `defaultEnabled: false`：默认关闭，需要 `/plugin enable`。
- `isAvailable` 只在「列出/加载」时判断，不改变 hooks 本身。

### 2.2 权限清单（scan）

官方 hooks module 的 scan 声明为：

```js
{
  scan: {
    hooks: ["prompt.submit", "command.run", "turn.step", "ui.render",
            "session.detach", "session.end"],
    calls: ["clock.after", "env.get", "model.fork", "prompt.fill", "prompt.read",
            "prompt.submit", "session.id", "session.surfaces", "session.version",
            "state.get", "state.set", "store.get", "store.set",
            "telemetry.log", "telemetry.mark", "ui.invalidate", "ui.resolve", "ui.toast"],
    runCommands: ["plugin"],
    env: { reads: ["CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG", "USER_TYPE"], writes: [] },
    state: {
      reads:  [{ plugin: "cc-plugin-you-should-know", key: "aboutOpen" }],
      writes: [{ plugin: "cc-plugin-you-should-know", key: "aboutOpen" }],
    },
  },
  files: {},
}
```

`sidelens` 的 `claude plugin validate` 输出与这份清单逐项一致（只有 plugin/key 名字不同），
说明没有多要权限，也没有少用能力。

---

## 3. 运行流程

### 3.1 何时检查

`turn.step` 每个主线程 model step 都会触发。官方逻辑：

```js
skip = !(index > 0 && index % 6 === 0)
    || row.offeredTurn === turnId
    || view !== null
    || !isBandWatched(surfaces, watched, bridged.has(sessionId))
```

即：

- 只在 **第 6、12、18… 步** 检查；
- 当前 turn 已经给过建议，不再检查；
- band 上已经有建议/解释，不再检查；
- 没有任何 surface 能画 band，不检查（`claude -p` 就是这种情况）；
- bridge（手机/网页 Remote Control）会话里，终端不算「能看见」，避免在终端里弹一条给手机
  的建议；
- 子 agent（`e.agentId !== undefined`）直接跳过。

`sidelens` 的可选 `checkCadence: "turnEnd"` 不走上面第 1 条的 6 步门控，而是在
`turn.step` 的 `stopReason` 表明回合结束时检查一次；见 §3.8。默认 `fixed` 与官方一致。

检查是**后台异步**的：hook 先 `yield* next(e)` 让当前 model step 继续流式返回，再在后台
`$.model.fork(...)`。官方用 `inFlight` Map 按 session 去重，保证同一 session 同时只有一次检查。

### 3.2 一次检查做什么

1. 先把 session row 的 `askedTurn` 记成当前 turn id（防止 turn 结束后才落地的旧建议）。
2. 读取 `seen`（最近 50 条建议）和 `known`（用户说「已经知道」的主题）。
3. 调用 `$.model.fork({ prompt: proposePrompt(seen, known) })`。
4. 解析模型返回：
   - `learn: none` → `outcome: "none"`；
   - 其它格式错误 → `parse_failed`；
   - 和 seen/known 重复 → `deduped`；
   - 该 turn 已结束或 askedTurn 不匹配 → `stale`；
   - 正常 → 写入 `seen`，把 view 设为 `offer`，`hidden`/`shown` 状态由 UI 读取。
5. 发 `you_should_know_proposed` 遥测；debug 模式下还会记录最近 3 次 check 的结果、耗时、
   step 序号，并画在 band 顶部。

`$.model.fork` 失败/没有快照时按 `reason` 映射：`nothing-to-fork`/`empty-reply` → `none`，
`api-error` → `api_error`，`aborted` → `aborted`。

### 3.3 建议的生命周期

session row 的 `view` 是状态机：

```text
offer ──Learn more──> explaining ──> explained ──Chat──> (draft in composer)
  │                        │
  │                        └─fork/empty─> failed
  ├─Knew this already──> (clear, add topic to known)
  ├─Dismiss────────────> asked ──20s──> (clear, ignored_timeout)
  ├─Disable ×2─────────> off (prompt filled with /plugin disable ...)
  └─two prompts────────> (clear, ignored_submit, raise looksToSkip)
```

关键常量：

| 常量 | 值 | 作用 |
| --- | --- | --- |
| `CHECK_EVERY` | 6 | 每 6 个 model step 检查一次 |
| `CLEAR_AFTER_PROMPTS` | 2 | 连续 2 个 prompt 没理它，就清掉 |
| `ASKED_MS` | 20000 | `Dismiss` 后反馈窗口 20 秒 |
| `SEEN_MAX` | 50 | 去重/避免重复建议的最近条数 |
| `SESSIONS_MAX` | 32 | 同时保留的 session row 数 |
| `SHOWN_KEEP_MS` | 3 天 | 已展示建议的保留时间 |
| `LOOKS_TO_SKIP_MAX` | 16 | 「用户总是不看」时最多跳过的检查次数 |
| `TYPED_PAST_FREE` | 2 | 前 2 次直接放过，之后指数退避 |

### 3.4 用户动作与结果

| 动作 | 写入 | 遥测 |
| --- | --- | --- |
| Learn more | view=explained（或先 explaining） | `yes_explain`, `you_should_know_explained` |
| Knew this already | known += topic, clear | `know_it` |
| What is this | `$.state.aboutOpen` 翻转 | — |
| Disable | 第一次 arm，第二次 fill `/plugin disable ...` | `turn_off` / `off_failed` |
| Dismiss | view=asked，20s 后清 | `not_now` / `ignored_timeout` |
| 反馈按钮 | 清 view | `helpful` / `not_relevant` / `not_understood` 等 |
| 连续 2 个 prompt | clear | `ignored_submit` |
| 输入 `/plugin disable ...` | 确认 off | `off_confirmed` |

---

### 3.5 官方插件生效时自动让位（用户要求的额外能力）

这是本项目超出官方行为的用户请求能力之一：

- 每次 plugin load 内第一次 `prompt.submit` / `turn.step` / `ui.render` 时，
  调用 `$.settings.read()` 读取 merged settings；
- 若 `enabledPlugins` 里官方 id（`cc-plugin-you-should-know@builtin` 及旧名）为 `true`，
  则 `officialState.check = true`；
- `prompt.submit` / `command.run` / `turn.step` / `ui.render` 立即 `next`，不 fork、不画 band；
- 第一次发现时清掉本 session 残留的 `view`；
- 不修改 `enabledPlugins`，不卸载自己，不持久化；官方关闭后 `/reload-plugins` 恢复；
- 检测结果 per-load 缓存；运行中改 settings 需要 reload 才重新评估；
- `settings.read` 失败/被拒绝时按“官方未启用”处理（catch false），sidelens 继续工作；
- 这是 **enabled** 检测，不读取官方 `isAvailable` gate。官方 enabled 但不可用时也会让位，
  属于保守策略。

代价：scan 多一个 `settings.read`（官方 18 + 1 intentional）；parity scan 允许这一个额外
call，其他新增 call 仍失败。

### 3.6 自动发送给主 agent（用户要求的额外能力）

- manifest 声明 `userConfig.autoSend`（boolean，默认 `false`）。它出现在 `/config`，
  也可以写在 user settings 的 `pluginConfigs["sidelens@<marketplace>"].options.autoSend`；
- `register(on, options)` 读取 `options.autoSend === true`；不新增 hook、`$` 调用、
  env 读取或 state 键；
- 关闭（默认）时 `chat()` 完全走官方路径：`$.prompt.fill` 把草稿放进输入框，由用户按 Enter；
- 开启时 `showExplanation()` 在第一次解释（iteration 1）写入 view 后调用 `autoChat()`，
  复用官方已有的 `$.prompt.submit({ text })` 提交 `respondDraft`；
- 提交的是 prompt，不改写 composer，也不读取/覆盖输入框；用户正在输入的草稿保持原样；
- 发送成功后与官方 Chat 路径一致：记 `respond`、写 `known`、清 view，解释面板关闭。
  因此一条建议只会有 `yes_explain` + `respond` 两条 answered 事件，与官方
  Learn more + Chat 相同，不会再多出 `got_it` / `dismiss`；
- 发送在途时 `responding` 阻止 Chat 再次触发；`prompt.submit` 被 drop 或抛错时
  toast `AUTO_SEND_FAILED`、不记 answered，面板保留，`2: Chat in main session`
  仍可作为手动回退；
- 关闭（默认）时解释出现后仍只等待用户选择，`Chat in main session` 的 fill 路径不变。

### 3.7 backlog（用户要求的额外能力）

用于多会话并行、用户暂时顾不上某个会话的场景。默认关闭，且与 `autoSend` 互斥
（`autoSend` 会立即清面板，backlog 无意义；同时开启时 `autoSend` 优先）。

- manifest 声明 `userConfig.backlog`（boolean，默认 `false`）；
- `explained` 面板挂着时，`turn.step` 的 skip 条件不再因 `view !== null` 直接跳过，
  而是允许继续检查，直到 backlog 达到上限；
- 检查结果不替换当前面板，而是写入 session row 的 `backlog`：
  `{ line, tag, proposedAt, turnId, step, promptSeq, telemetry }`，只存标题，
  不存解释；`telemetry` 保存 `latency_ms` / `usage` / `offers_shown`，供延后的
  官方 proposed 事件使用；
- 上限 `BACKLOG_MAX = 3`；TTL 取 `BACKLOG_TTL_MS = 30 分钟` 与
  `BACKLOG_TTL_PROMPTS = 3 个用户 prompt` 的较小者，惰性清理；
- 用户处理当前面板（`got_it` / `respond` / `know_it` / 反馈结束 / 20s 反馈超时）后，
  队首以 `offer` 形式出队，view 带 `fromBacklog: true` 和 `proposedAt`；
- 面板和其后的解释上方都加一行 `Earlier note · found Nm ago`，明确不是当前轮的内容；
- 在 backlog offer 上按 `Learn more` 时重新 `explain()`，解释基于当前 transcript；
- 用户连续 type-past 一个 offer（`ignored_submit`）时清空 backlog 并沿用
  `looksToSkip` 退避；`turn_off` 和 `session.end` 也清空；
- 队列中的 line 会合并进 `proposePrompt` 的 `seen` 参数做去重，但只有真正展示时才
  写入官方 `seen`；
- backlog 队列、`promptSeq`、session row 和 `aboutOpen` 按 session 存；但
  `seen` / `known` / `typedPastInARow` / `looksToSkip` 是插件级 store，所有 session
  共享（官方行为，为 parity 保留）。因此并行会话里，一个会话的 `Knew` 或 type-past
  会影响其他会话；backlog 只解决“本条消息是否有积压”，不解决跨会话抑制；
- 出队刻意绕过 `isOfferDue` 的同 turn 规则，由 TTL 控制新鲜度——这是 backlog 的核心
  intentional difference；
- 遥测：入队时**不发**官方 `you_should_know_proposed`，只发项目专属
  `you_should_know_backlog` 的 `queued`；官方 proposed 延后到笔记真正展示时发出，
  沿用入队时保存的 `step` / `latency_ms` / `usage` / `offers_shown`，并带
  `queued: true`。因此被丢弃的笔记不会被计入 `outcome = shown`；
- `you_should_know_backlog` 的 `shown` / `dropped_ttl` / `dropped_ignored` /
  `dropped_off` / `dropped_session_end` 带 `wait_ms` / `age_ms` / `depth`，
  是评估 backlog 实际使用量的准确口径；
- 不新增 hook、`$` 调用、env 或 state 键，scan 仍是 6 hooks / 19 calls。

### 3.8 checkCadence（用户要求的额外能力）

官方固定每 6 个 model step 检查。这个模式有两个结构性问题：短回合不到 6 步永远
不检查；长回合的第 6/12… 步可能还在工具序列中间，建议基于未完成的工作，后续步骤
可能已经补完。

- manifest 声明 `userConfig.checkCadence`（string，`options: ["fixed", "turnEnd"]`，
  默认 `fixed`）；`fixed` 与官方完全一致；
- `turnEnd` 不新增 hook：`turn.step` 是流式事件，`yield* next(e)` 的结果带
  `stopReason`。`isTurnEnd()` 接受 `end_turn` / `max_tokens` / `stop_sequence` /
  `refusal`；`tool_use` / `pause_turn` / `compaction` / `null` 继续等待；
- `runStep(sid, surfaces, { atEnd, allowCheck })`：turnEnd 模式下，每个 step 的
  常规调用只维护状态（survival、backlog 过期、`promptSeq`），`allowCheck: false`；
  回合结束时用 `atEnd: true` 检查一次；
- 单步回合的 index 是 0；`atEnd` 检查跳过 turn-start survival 逻辑，避免在
  检查前 return；下一回合开始时 survival 照常执行；
- **与 `autoSend` 互斥，`autoSend` 优先**：autoSend 把笔记作为新 prompt 提交，
  这本身是一个新回合；若不互斥，新回合结束会再次检查，形成链式发送；
- 所有官方门控（view、`offeredTurn`、`isBandWatched`、`looksToSkip`、backlog）不变；
- **drain（需要 `backlog`）**：第一次检查找到内容后，把它放进 `seen` 再问，
  最多 `TURN_DRAIN_MAX = 3` 条；第一次结果立即展示，后续 pass 在后台运行，
  额外条目入 backlog，并带 `drain: true`，出队时标签为
  `Another note · found just now`（普通积压项仍是 `Earlier note`）；
- drain 在某次返回 `none`、backlog 已满或达到 3 条时停止；只有第一次有结果才继续；
- drain 每次入队后调用 `popBacklogIfIdle`：当前没有打开的面板时立即弹出队首，
  避免“用户先关掉第一条、补查后才入队”导致第二条一直留在队列；
  `advanceBacklog` 也会拒绝覆盖已经打开的面板；
- `atEnd` 检查遇到 `inFlight`（当前 check 或 drain 未结束）不丢弃：`pendingDue`
  保存该 hook 调用自己的 retry 闭包（捕获本回合 `e`），当前任务 finally 后重试；
  后到的回合覆盖 pending，`session.end` 清除；
- 遥测：官方 `proposed` 增加可选 `trigger: "turnEnd"` 和 `pass: 2/3`；
  队列项延后发出的 proposed 也带这些字段；
- 不新增 hook、`$` 调用、env 或 state 键，scan 仍是 6 hooks / 19 calls。

## 4. UI 结构

官方在 `ui.render` 的 `{ component: "AbovePrompt" }` 里自绘一条 band。树形大致：

```text
Box(column, marginTop=1)
├─ 终端:  Box(row) [ ✦ 列 ][ Text("You should know · <learn line>") ]
│  桌面:  Box(row) [ Box(key="about")[ Text(✦ Heads up ·) , hover 卡片 ] ][ Text(line) ]
└─ Box(row, marginLeft=2)
   ├─ 1: Learn more
   ├─ 2: Knew this already
   ├─ 3: What is this        （空间够时）
   ├─ 4: Disable             （仅终端；桌面用 /plugin）
   └─ 0: Dismiss
```

- `Terminal` 用 `hasStarColumn: true`，`✦` 单独一列；`Desktop`/`Mobile`/`VS Code` 用
  `hasStarColumn: false`，`Button` 去掉 `hotkey`/`plain`，改成原生按钮，`leadInk` 变暗。
- 宽度/行数适配是纯函数：`cellsAtMost`、`wrapRows`、`choicesRows`、`headedRows`、
  `fittedCopy`、`aboutFit`。在 `maxRows` 不够时，`What is this` 会被省略，副本会截断；
  终端 `budget: "scrolls"`，桌面按 `maxRows/bodyColumns` 计算。
- 解释卡片用 `Markdown` + `Code`（sketch）。标题、正文、sketch、caption 的解析和转义
  规则与官方一致：`parseExplanation`、`literal`、`proseOf`、`truncateToCells`。
- `aboutOpen` 是一个 `StateFamily<string>`，按 `${shownAt ?? "unstamped"} ${line}` 作为
  id，保存当前展开的「What is this」卡片 key。

---

## 5. Prompt

官方有两个 prompt builder：

### 5.1 `proposePrompt(seen, known)`

- 33KB 左右，包含：
  - 系统提醒：这是一次 side request，独立 agent，无工具，一次性回答；
  - observer 角色、示例、输出格式 `learn:` / `tag:` / `explain:`；
  - 「什么时候该建议、什么时候 `learn: none`」的详细标准；
  - 标题、解释语言、可读性、用户上下文等要求；
  - 最近的建议列表和用户已经知道的主题列表。
- 输出只允许两种：

  ```text
  learn: none
  ```

  或

  ```text
  learn: <一句话>
  tag: You should know | Heads up
  explain:
  **<标题>**
  <解释正文>
  ```

- 解释正文要求标题 3–7 个 plain words、总字数尽量 <120、可扫描、必要时给 ASCII sketch。

### 5.2 `explainPrompt(topic, previous?)`

- 比 propose 短，用于用户点 `Learn more` 后生成更深的解释。
- `previous` 存在时表示「再讲简单点 / 少讲点 / 多讲点」，会要求“不要重复上一版”。
- 解释格式与 propose 的 `explain:` 部分一致，最终由 `parseExplanation` 解析成卡片。

`sidelens` 的 `lib/prompts.js` 直接保留了这两段文本（字节级），因此三方模型收到的指令与
官方一致。

---

## 6. 模型调用：为什么三方模型也能用

官方用：

```js
const result = await s.model.fork({ prompt: proposePrompt(seen, known) });
// result: { isAnswered, text, usage } 或 { isAnswered:false, reason, usage? }
```

`$.model.fork` 的类型说明（2.1.308 本地生成的 `claude-code/index.d.ts`）：

> Runs one tool-less completion over the session's OWN transcript as the main
> thread last sent it ... The main thread's last request again (its model, system
> prompt, tools, messages) with `prompt` after it: every tool denied ...
> always a result, never null.

也就是说：

- model = session 当前 model，不是硬编码的 Claude；
- system prompt = session 的 system prompt；
- messages = session 最后的 transcript；
- credentials = session 的凭据；
- tools 全部 deny，side agent 不能调用工具；
- 共享 main thread 的 prompt cache 前缀。

因此它天然兼容 Anthropic API、Bedrock、Vertex、Foundry，以及任何 Anthropic-compatible
三方 endpoint（Claude Code Router 等）。官方 mod 的 `providerAgnostic` 提示也确实存在，
只是它的 `isAvailable` 被 feature flag 挡住了。

### 6.1 实测

本机环境：

```text
ANTHROPIC_BASE_URL=http://127.0.0.1:3456
ANTHROPIC_MODEL=zhipu/glm-5.3[1m]
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

用一个最小 probe mod 在 `turn.complete` 里调用 `$.model.fork`：

```text
$.model.fork (forkprobe): 6355ms, 1 replies
[forkprobe] $.ui.log: PROBE fork {"isAnswered":true,"text":"FORK_OK",
  "usage":{"input_tokens":...,"output_tokens":...,
           "cache_read_input_tokens":16576,"cache_creation_input_tokens":0}}
```

结论：三方模型和 CCR 能正确处理 fork，包括 cache 前缀；YSK 的限制不在模型调用层。

---

## 7. `sidelens` 的逐项对照

| 官方 | sidelens | 说明 |
| --- | --- | --- |
| `cc-plugin-you-should-know` | `sidelens` | 插件名 / state plugin / disable target |
| `isAvailable: On`（flag + taint） | 无 `isAvailable` | **唯一的能力性差异**：去掉官方模型 gate |
| `defaultEnabled: false` | `defaultEnabled: false` | 保持 opt-in |
| 6 个 hooks | 同 6 个 | prompt.submit / command.run / turn.step / ui.render / session.detach / session.end |
| 18 个 `$` calls | 同 18 个 | validate 输出逐项一致 |
| `proposePrompt` / `explainPrompt` | 原文保留 | 字节级 |
| `parseProposedLine` / `parseExplanation` | 逐行移植 | 相同的 none/parse_failed/deduped/stale |
| 6 步节奏 / 2 次 prompt / 20s | 相同 | 常量一致；可选 `checkCadence: "turnEnd"` 是在此之上的扩展 |
| `userConfig` | 无 | `autoSend` / `backlog` / `checkCadence` 三个 opt-in 扩展 |
| 终端/桌面布局 | 相同 | 星号列、hotkey、hover 卡片、fit 逻辑 |
| `seen`/`known`/`sessions`/`typedPastInARow`/`looksToSkip` | 相同 | store schema 一致；`seen`/`known`/`typedPastInARow`/`looksToSkip` 是插件级共享状态，`sessions` 内部按 session 分行 |
| `aboutOpen` state | 相同结构 | plugin 名改为 sidelens |
| 遥测事件名/字段 | 相同 | `you_should_know_*`、`learn_explain`、`learn_page` |
| 禁用命令 | `/plugin disable sidelens` | 外置插件的实际名字 |
| 页面（making/ready/failed） | 保留代码路径 | 官方 2.1.308 中该路径没有触发入口，属于死代码 |
| HIPAA/ZDR/LDR 排除 | 无 | 公开 mods API 读不到 compliance taint；敏感组织不要启用 |

### 7.1 有意保留的“死能力”

官方源码里有 `making` / `ready` / `failed` / `page` 的 UI 和 telemetry，但 2.1.308 的
hooks 里没有任何代码把 view 置为 `making`，`pressConsentOf` 也没有调用点。为了保持
「不多不少」，`sidelens` 保留了这些纯函数和渲染分支，但没有新增入口；用户可见能力与官方一致。

### 7.2 有意改变的文案

只有一处：`What is this` 卡片里的禁用命令从
`/plugin disable cc-plugin-you-should-know@builtin` 改成
`/plugin disable sidelens`。因为外置插件不叫那个名字，也不在 `@builtin`。

### 7.3 关于 `USER_TYPE=external`

官方和 `sidelens` 都用它决定是否隐藏 `What is this` 和 offer 行的
`4: Disable`。注意：Claude Code 2.1.308 的 mods API 对 **所有** mod 都把
`$.env.get("USER_TYPE")` 固定返回 `"external"`：

```js
const value = name === "USER_TYPE" ? "external" : process.env[name]
```

这与三方模型无关，也不是普通账号/员工账号的实时判断；它是插件沙箱允许看到的值。
所以在本机交互测试里，这两个控件不会出现；要在测试里覆盖，只能在 harness 中 mock，
或改掉这个分支（不建议，因为会偏离官方行为）。

---

## 8. 实现结构

```text
hooks/register.js   六个 hook + 所有 $. 调用（validate 要求调用可见）
lib/prompts.js      proposePrompt / explainPrompt（官方原文）
lib/parse.js        建议/解释解析、none 判断、off 命令
lib/ui.js           AbovePrompt 树、fit、卡片、Markdown 转义
lib/data.js         session row、view 状态机、left_open/cleared
lib/telemetry.js    answered/proposed/explained/page 记录
lib/text.js         控制序列清理、宽度、截断、换行
lib/constants.js    所有阈值、颜色、标签、copy
types/index.d.ts    sidelens.aboutOpen: StateFamily<string>
tests/              30 个测试（13 行为 + 4 解析 + 13 官方差分）
scripts/parity/     官方模块提取、fixture 生成、tree 记录器
tests/parity/       corpus + fixture + 官方差分测试
```

`hooks/register.js` 里保留了官方变量语义但改成可读命名；`lib/` 是纯函数，不接触 `$`，
因此 `claude plugin validate` 能完整列出权限。

---

## 9. 验证

### 9.1 静态验证

```text
$ claude plugin validate .
  ❯ ./register.js hooks: prompt.submit, command.run{command=plugin}, turn.step,
      ui.render{component=AbovePrompt}, session.detach, session.end
  ❯ ./register.js calls: $.clock.after, $.env.get, $.model.fork, $.prompt.fill,
      $.prompt.read, $.prompt.submit, $.session.id, $.session.surfaces,
      $.session.version, $.settings.read, $.state.get, $.state.set,
      $.store.get, $.store.set, $.telemetry.log, $.telemetry.mark,
      $.ui.invalidate, $.ui.resolve, $.ui.toast
  ❯ env reads: CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG, USER_TYPE
  ❯ state reads/writes: sidelens.aboutOpen
  ✔ Validation passed
```

### 9.2 行为测试（`claude plugin test`）

39 个行为/纯函数测试覆盖（另有 §9.5 的 13 个官方差分测试）：

1. 三方 model 的 fork 产生 offer，band 文本/按钮正确，Learn more 进入解释；
2. 第 6 步才检查，重复建议 dedupe；
3. 子 agent step 不触发；
4. Knew this already 清 band 并写入 known；
5. Dismiss → asked → 20s timeout → ignored_timeout；
6. Disable 两次 → arm → fill `/plugin disable sidelens` → turn_off；
7. 连续 2 个 prompt → clear + ignored_submit + typedPastInARow；
8. 观察结果没有 explanation 时，Learn more 再发一次 explain fork；
9. Desktop 去掉 hotkey/星号列，保留原生按钮；
10. Chat in main session 生成带引用的 draft、填入 prompt、清 band、写入 known
    （autoSend 默认关闭，不提交）；
11. `autoSend: true` 时解释一出现就提交 draft（不 fill、不按 Chat），随后关闭面板、
    写 known；answered 事件恰好是 `yes_explain` + `respond`；
12. `autoSend: true` 且输入框已有文本时仍自动提交、关闭面板，且不改写用户草稿；
13. 反馈行的 `4: Turn off suggestions` 直接关闭并填入禁用命令（本轮实测发现并修复的回归）；
14. 官方 `cc-plugin-you-should-know@builtin` 启用时，sidelens 不 fork、不画 band，并清掉旧 view；
15. 官方旧名（`you-should-know@builtin`）同样触发让位；
16–19. 纯函数测试：`learn: none`、完整 proposal、解释卡片/sketch、off 命令识别；
20. `backlog`：解释挂着时继续检查，新建议入队而不替换面板；
21. 处理解释后队首以 `Earlier note` offer 出队；
22. backlog offer 的 `Learn more` 重新 fork，并保留 `Earlier note` 标签；
23. 队列上限 3，满后不再 fork；
24. 3 个 prompt 后队列项过期并记 `dropped_ttl`；
25. 连续 type-past 清空 backlog 并记 `dropped_ignored`；
26. `autoSend` 开启时 backlog 不生效；
27–28. backlog 纯函数：`liveBacklog` / `withoutBacklogLine`、`backlogLabel`；
29. `isTurnEnd` 只接受结束回合的 `stopReason`；
30. `turnEnd`：单步回合在结束时检查一次；
31. `turnEnd`：`tool_use` 步不检查，等到结束步再检查；
32. `fixed` 默认仍忽略单步回合；
33. `autoSend` 与 `turnEnd` 互斥，`autoSend` 优先；
34. `turnEnd` + backlog：第一条立即展示，drain 到 3 条，额外条目入队并标
    `Another note`，延后的 proposed 带 `pass: 2`；
35. 第一次检查返回 `none` 时不再 drain；
36. 没有 backlog 时 `turnEnd` 只取一条；
37. 第一条面板在补查期间关闭时，补查入队后立即弹出队首；
38. 补查占锁期间下一回合结束，其检查在锁释放后重试，而不是被丢弃；
39. 全部开关关闭：仍只在第 6/12/18 步检查，不写 backlog/promptSeq，
    不出现 queued/trigger/pass 遥测。

结果：全部测试文件合计 `71 pass, 0 fail`。

### 9.3 真实 provider 验证

先用一个最小 probe mod 验证 `$.model.fork` 本身（§6.1），再在交互式 CLI 里跑完整插件。

第一次直接 `--plugin-dir` 时，日志里只有 `Loaded inline plugin from path: sidelens`，没有
`hooks module sidelens`。原因是 manifest 的 `defaultEnabled: false`（与官方一致）：插件被
加载，但 mod 尚未启用。用 `/plugin enable sidelens@inline` + `/reload-plugins` 后，日志出现：

```text
hooks module sidelens@inline loaded (worker, environment 1, tier user);
  events: prompt.submit,command.run,turn.step,ui.render,session.detach,session.end
```

随后让三方模型依次读取 8 个文件（产生多个 model step），第 6 步触发检查：

```text
$.model.fork (sidelens): 19068ms, 1 replies
$.store.set (sidelens@inline): sessions
sidelens (user) answered ui.render without next()
```

store 中记录：

```json
{
  "sessions": [{
    "id": "...",
    "askedTurn": "...",
    "checked": 1,
    "checks": [{
      "number": 1, "step": 6, "outcome": "none",
      "latencyMs": 19070, "at": ...
    }]
  }]
}
```

这次观察结果是 `learn: none`（读源码的场景没有必须打断用户的主题），所以 band 不显示
建议；debug 模式仍按官方行为画出了 check 行。整条链路——第 6 步、真实三方 fork、解析、
store、band 重绘——都走通。

测试里还断言 fork 参数只有 `{ prompt }`，没有任何 model/provider 字段。

---

### 9.4 交互式 computer-use 测试

在真实 iTerm2 + Claude Code 2.1.308 + `zhipu/glm-5.3[1m]` 会话中，用 CUA
驱动完成了：插件启用/重载、自然产生的 offer、Learn more、Chat in main
session、Knew this already、Dismiss + 20 秒超时、Turn off 填入并执行禁用命令、
重新启用。过程中发现并修复了「反馈行的 Turn off 错误地调用 armOff」这一
回归，并补了测试。截图、命令和结果见
[TESTING.md](TESTING.md)。

### 9.5 官方差分 parity 测试

`tests/parity/official.test.ts` 不是手写期望，而是与 **从 Claude Code 二进制里提取的官方模块**
逐项对比：

- `scripts/parity/official.mjs` 定位 `as proposePrompt` 所在的模块，读取语义导出表
  （`local as exportedName`），在 `node:vm` 里执行官方模块；minified 变量名变了也不影响查找；
- `scripts/parity/update.mjs` 用同一份 corpus 跑官方实现，生成
  `tests/parity/fixtures/official.mjs`；
- 测试端跑 sidelens 的对应函数，比较 prompt 字节、解析结果、宽度/换行、常量、遥测、
  about 布局和终端/桌面 band 树；
- 官方升级后：

  ```bash
  npm run parity:update   # 从新 binary 重新生成 fixture，打印版本和 prompt hash
  npm run test            # 用新 fixture 跑，失败即指出 case/path
  npm run parity:check    # 确认当前 fixture 与已安装官方一致（含 static scan）
  npm run parity:scan     # 对比 hooks / $ calls
  ```

- static scan：`scripts/parity/scan.mjs` 运行 `claude plugin validate`，把 6 个 hooks、19 个
  `$` 调用（官方 18 + 唯一 intentional `settings.read`）与 fixture 里的官方 scan 清单做集合对比；
- 唯一被 normalization 掉的已知差异是禁用命令
  （官方 `cc-plugin-you-should-know@builtin` ↔ `sidelens`）。
- 覆盖范围、更新流程和未覆盖项见 [PARITY.md](PARITY.md)。

当前 fixture：Claude Code **2.1.308**，16 个 proposal、11 个 explanation、8 个 offer 树、
3 个 explained 树、5 个 about-fit，外加 7 个 prompt 用例和完整状态机用例。

## 10. 已知限制

1. **`claude -p` 不画 band**：与官方相同。hooks 会加载，但没有 surface，`turn.step` 的
   `isBandWatched` 为 false，不会产生建议。
2. **需要至少 6 个 model step**：简单的一问一答不会触发。
3. **三方 endpoint 必须能处理 tool-less fork**：即把 session transcript + 一条 user
   message 发过去，并接受 tools 被 deny。大多数 Anthropic-compatible 网关可以；不支持
   tools 字段的网关会返回 `api_error`，band 不显示建议（不会崩）。
4. **compliance taint 不可读**：公开 API 没有 `aEt`/`Ls` 的等价物，因此 `sidelens` 不做
   HIPAA/ZDR/LDR 排除。敏感环境请使用官方内置 mod。
5. **prompt 版权**：`proposePrompt`/`explainPrompt` 来自 Anthropic 的 Beta 产品，仅为
   互操作性保留；再分发前请确认条款。

---

## 11. 参考资料

- 官方 mods 文档：<https://code.claude.com/docs/en/plugins/mods/overview>
- Create a mod：<https://code.claude.com/docs/en/plugins/mods/create>
- Mods reference：<https://code.claude.com/docs/en/plugins/mods/reference>
- Mods API（`$.model.fork`）：<https://code.claude.com/docs/en/plugins/mods/api#call-a-model>
- Claude Code 2.1.308 本地生成的类型：
  `.claude-plugin/types/claude-code/index.d.ts`（运行 `claude --plugin-dir` 后生成）
- 官方 `mods` 目录（部分内置 mod 源码）：
  <https://github.com/anthropics/claude-code/tree/main/mods>
- 第三方对 2.1.292 observer prompt 的提取（交叉核对）：
  <https://github.com/wassname/cc-plugin-you-should-know>

> 注：§9.5 的 fixture 测试和 §9.4 的 CUA 测试互补。前者固定官方函数的输入/输出，
> 后者验证真实 Claude Code 事件链、插件加载和终端渲染。
