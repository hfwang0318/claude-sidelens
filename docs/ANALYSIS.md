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
| 6 步节奏 / 2 次 prompt / 20s | 相同 | 常量一致 |
| 终端/桌面布局 | 相同 | 星号列、hotkey、hover 卡片、fit 逻辑 |
| `seen`/`known`/`sessions`/`typedPastInARow`/`looksToSkip` | 相同 | store schema 一致 |
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
tests/              28 个测试（11 行为 + 4 解析 + 13 官方差分）
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
      $.session.version, $.state.get, $.state.set, $.store.get, $.store.set,
      $.telemetry.log, $.telemetry.mark, $.ui.invalidate, $.ui.resolve, $.ui.toast
  ❯ env reads: CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG, USER_TYPE
  ❯ state reads/writes: sidelens.aboutOpen
  ✔ Validation passed
```

### 9.2 行为测试（`claude plugin test`）

15 个行为/纯函数测试覆盖（另有 §9.5 的 13 个官方差分测试）：

1. 三方 model 的 fork 产生 offer，band 文本/按钮正确，Learn more 进入解释；
2. 第 6 步才检查，重复建议 dedupe；
3. 子 agent step 不触发；
4. Knew this already 清 band 并写入 known；
5. Dismiss → asked → 20s timeout → ignored_timeout；
6. Disable 两次 → arm → fill `/plugin disable sidelens` → turn_off；
7. 连续 2 个 prompt → clear + ignored_submit + typedPastInARow；
8. 观察结果没有 explanation 时，Learn more 再发一次 explain fork；
9. Desktop 去掉 hotkey/星号列，保留原生按钮；
10. Chat in main session 生成带引用的 draft、填入 prompt、清 band、写入 known；
11. 反馈行的 `4: Turn off suggestions` 直接关闭并填入禁用命令（本轮实测发现并修复的回归）；
12–15. 纯函数测试：`learn: none`、完整 proposal、解释卡片/sketch、off 命令识别。

结果：与 §9.5 合计 `28 pass, 0 fail`。

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

- static scan：`scripts/parity/scan.mjs` 运行 `claude plugin validate`，把 6 个 hooks、18 个
  `$` 调用与 fixture 里的官方 scan 清单做集合对比；
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
