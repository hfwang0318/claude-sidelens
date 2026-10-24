# CLAUDE.md

本文件是这个仓库的工程说明，也是后续 Claude Code / 开发者修改本项目时的首要指令。
先读本文件，再按需读 [README](README.md)、[ANALYSIS](docs/ANALYSIS.md)、
[PARITY](docs/PARITY.md)、[TESTING](docs/TESTING.md)。

---

## 1. 项目是什么

`sidelens` 是一个 **Claude Code mod**，把官方内置 mod **You should know**
（`cc-plugin-you-should-know`）的能力移植到普通插件中，使它在使用三方
Anthropic-compatible 模型时也能工作。

官方 mod 的真实限制不是模型调用，而是可用性 gate：

```js
isAvailable = complianceTaintsSettled()
  && !hipaa && !zdr && !ldr
  && featureFlag("tengu_jolly_dewdrop", false)
```

三方 endpoint / Claude Code Router 通常拿不到这个 feature flag，所以官方 mod 不启用。
`sidelens` 去掉了这层 gate，其余能力按官方 2.1.308 对齐。

**核心原则：不增加官方没有的能力，也不缺少官方有的能力；只去掉“只能用官方模型”的限制。**
任何“顺手加一个功能”的想法都应先对照官方行为，并更新 parity 测试和文档。

---

## 2. 当前基线

- Claude Code 目标版本：**2.1.308**（最低 2.1.287）
- 插件名：`sidelens`
- 插件状态 key：`sidelens.aboutOpen`
- 禁用命令：`/plugin disable sidelens`
- `defaultEnabled: false`（与官方一致，需要显式启用）
- 测试：**28 pass, 0 fail**
  - 11 个 sidelens 行为测试
  - 4 个 parser 单元测试
  - 13 个官方差分测试
- `claude plugin validate .`：通过
- `npm run parity:check`：fixture 与已安装 2.1.308 一致，6 hooks / 18 calls 一致
- 真实三方模型：已用 `zhipu/glm-5.3[1m]` + Claude Code Router 在 iTerm2 中跑通

---

## 3. 不可破坏的契约

### 3.1 行为契约

- **Prompt 字节级一致**：`lib/prompts.js` 的 `proposePrompt` / `explainPrompt`
  必须与官方模块输出完全一致。不要手改文案、措辞、示例或换行；要改先改官方来源并更新
  parity fixture。
- **6 个 hooks 不变**：
  `prompt.submit`、`command.run{command=plugin}`、`turn.step`、`ui.render{component=AbovePrompt}`、
  `session.detach`、`session.end`。
- **18 个 `$` 调用不变**：clock.after、env.get、model.fork、prompt.fill、prompt.read、
  prompt.submit、session.id、session.surfaces、session.version、state.get、state.set、
  store.get、store.set、telemetry.log、telemetry.mark、ui.invalidate、ui.resolve、ui.toast。
- **节奏和常量不变**：每 6 个 model step 检查；连续 2 个 prompt 清除；20 秒反馈窗口；
  seen 50、sessions 32、3 天保留、looksToSkip 16、typedPastInARow 2。
- **状态机不变**：`offer → explaining → explained / failed`，`offer → asked → timeout`，
  `offer → off`；`Knew`/`Chat` 会写 `known` 并清 view。
- **UI 文案、热键、布局不变**：`1: Learn more`、`2: Knew this already`、`3: What is this`、
  `4: Disable`、`0: Dismiss`，终端星号列、桌面原生按钮、about fit 规则。
- **Telemetry 字段不变**：`you_should_know_answered`、`you_should_know_proposed`、
  `you_should_know_explained`、`learn_page` 及字段名。
- **Disable 两步式**：第一次 arm，第二次填 `/plugin disable sidelens`，不自动提交。
- **Dismiss 不等于 Disable**：Dismiss 只清当前建议并进入反馈，不关闭插件。

### 3.2 工程契约

- **所有 `$` 调用只能写在 `hooks/register.js`**。`lib/` 是纯函数，不接触 `$`。
  这是 `claude plugin validate` 的静态 scan 要求；不要在 lib 里调用 API，也不要把 `$`
  传给 import 的函数。
- **`env.get` 的名字必须是字面量**；不要用变量。
- **`state.get/set` 的 plugin/key 必须是字面量**；state plugin 固定为 `sidelens`，
  key 固定为 `aboutOpen`。
- **不要添加 `isAvailable`**：这是本项目唯一的核心差异；加回去会重新引入官方模型限制。
- **不要改 `defaultEnabled`**：官方是 opt-in；保持 `false`。
- **不要新增文件/网络/process 权限**：mod 的 scan 会暴露它们，也会破坏 parity。
- **`types/index.d.ts` 是状态契约**：`sidelens.aboutOpen: StateFamily<string>`。
- **`tests/parity/fixtures/official.mjs` 是生成文件**：不要手改，使用
  `npm run parity:update` 重新生成。

### 3.3 已知 intentional difference

只允许以下差异；新增差异必须写进 [PARITY](docs/PARITY.md) 并补 normalization：

1. 去掉 `tengu_jolly_dewdrop` / compliance-taint `isAvailable` gate；
2. 插件名、`$.state` plugin 名、禁用命令改为 `sidelens`；
3. 合规 HIPAA/ZDR/LDR 排除无法通过公开 mods API 复现（敏感组织不要启用）。

parity 测试只 normalization 禁用命令：
官方 `/plugin disable cc-plugin-you-should-know@builtin` ↔ `sidelens` `/plugin disable sidelens`。
其他内容（prompt、parser、state、UI、telemetry）不允许 normalization。

---

## 4. 代码结构

```text
.claude-plugin/plugin.json   manifest；name、defaultEnabled:false、types
.claude-plugin/icon.png      插件图标
hooks/hooks.json             指向 hooks/register.js
hooks/register.js            6 个 hooks + 所有 $. 调用 + 业务编排
lib/prompts.js              官方 observer / explain prompt（字节级一致）
lib/constants.js            阈值、标签、outcome、copy、颜色
lib/parse.js                proposal / explanation 解析、tag、off 命令
lib/text.js                 宽度、截断、换行、控制序列清理
lib/data.js                 session row、view 状态、band 可见性
lib/telemetry.js            answered / explained / proposed / page 记录
lib/ui.js                   AbovePrompt 树、about、fit、Markdown/Code
types/index.d.ts            sidelens.aboutOpen 状态声明
tests/sidelens.test.ts      行为测试（fork/UI/状态/禁用）
tests/parse.test.ts         parser 单元测试
tests/parity/               官方差分测试
scripts/parity/             官方模块提取、fixture 生成、scan、tree recorder
docs/                       分析、测试、parity 文档
```

### 数据流

1. `turn.step` 每 6 步触发一次后台 `$.model.fork`；
2. 解析结果写入 `sessions` / `seen` / `known`；
3. `ui.render{AbovePrompt}` 读取 store 和 `aboutOpen` state，画 offer/explained/asked；
4. 按键或 prompt 事件更新状态；`off` 只填命令，用户按 Enter 才真正执行；
5. `session.end` 清 row 并记录 `left_open` / `off_abandoned`。

### 重要实现点

- `ui.render` 里 `renderView()` 返回 `null` 表示“不画”，外层再 `next(e)`；
  debug 模式即使 `null` 也会画 check 行。
- `updateViewForRender(view)` 写入整个 `view`；`updateRow(patch)` 写入 row 字段。
  不要把两者混用。
- `withSurface(surface, ui)` 在桌面端会包装 `Button`，去掉 `hotkey`/`plain`；
  终端保留。
- `USER_TYPE` 在 mods API 里固定返回 `external`，所以 `What is this` 和 offer 行的
  `4: Disable` 实际不出现；反馈行的 `4: Turn off suggestions` 仍可用。不要试图伪造
  `ant` 来“修复”它，这是官方行为。

---

## 5. 常用命令

```bash
# 安装/加载
claude --plugin-dir /path/to/claude-sidelens

# 在会话里启用（defaultEnabled=false）
/plugin enable sidelens@inline
/reload-plugins

# 静态校验
npm run validate

# 全部测试（behavior + parser + official parity）
npm run test

# 从已安装的 Claude Code 重新生成官方 fixture
npm run parity:update

# 对比 fixture 与已安装 Claude Code + 对比 hooks/calls scan
npm run parity:check

# 只做 hooks/calls scan 对比
npm run parity:scan
```

`npm run test` 只依赖提交的 fixture，CI 不需要 Claude Code 二进制。
`npm run parity:update/check/scan` 需要本机 `claude`（或 `CLAUDE_CODE_BIN` 指向
`claude.exe`）。

---

## 6. 开发流程

### 6.1 普通行为修复

1. 先判断是否属于官方行为；查 `docs/ANALYSIS.md` / 官方源码对照片段。
2. 在 `tests/` 加一个失败用例（红）。
3. 修改 `lib/` 或 `hooks/register.js`（绿）。
4. 跑 `npm run test` 和 `npm run validate`。
5. 如果改变可观察行为，同步更新 `docs/ANALYSIS.md`；如果引入 intentional difference，
   更新 `docs/PARITY.md` 和 parity normalization（并说明理由）。
6. 提交 fixture 和代码一起，保证 pin 的官方版本与实现同步。

### 6.2 官方插件升级 / parity 更新

这是本项目最重要的维护流程：

```bash
claude --version
npm run parity:update     # 从新 binary 提取官方模块，重写 fixture
git diff tests/parity/fixtures/official.mjs
npm run test              # 观察哪些 case/path 变化
```

- `parity:update` 会打印 Claude Code 版本、prompt 长度/hash、case 数。
- fixture 是**生成数据**：不要手改，不要为了方便测试而弱化比较。
- 如果官方 prompt/解析/UI 真的变了，`npm run test` 会以 case 名和第一个差异路径失败；
  按失败项修改实现。
- 如果官方改变了导出名/打包布局，`scripts/parity/official.mjs` 会显式失败；更新提取器，
  不要静默跳过。
- 改完后运行 `npm run parity:check`，确认 fixture 与已安装版本一致。
- 最后更新 `docs/ANALYSIS.md` 的版本基线、`PARITY.md` 的覆盖范围和本文件的“当前基线”。

### 6.3 加测试

- 纯函数/边界：加到 `tests/parity/corpus.mjs`，`parity:update` 自动扩展 fixture；
  同时在 `tests/parity/official.test.ts` 加对应断言。
- 行为/事件链：加到 `tests/sidelens.test.ts`，用 `tests/harness.ts` 的 stub。
- 真实交互：按 `docs/TESTING.md` 用 CUA 操作 iTerm2 + Claude Code；不要用 `claude -p`
  测 band（没有 surface，不会画）。
- 测试失败信息应包含 case 名/路径；不要只断言 `toBeTruthy`。

### 6.4 调试真实会话

- 启用 debug：`CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG=1`，band 会画最近 check 行。
- 查看日志：`~/.claude/debug/latest`。
- 插件 store：`~/.claude/plugins/store/sidelens_inline-*.json`。
- 如果 `--plugin-dir` 后没有 band：先确认 `/plugin enable sidelens@inline` +
  `/reload-plugins`；`defaultEnabled=false` 时只加载插件不会加载 hooks。
- `claude -p` 没有 band 是预期行为，不要为它加特殊 surface。

---

## 7. 变更检查清单

提交前逐项确认：

- [ ] 没有改变官方 prompt 文本；`npm run test` 的 prompt 用例通过。
- [ ] 没有新增 hooks / `$` 调用 / env / state / file 权限；`npm run parity:scan` 6/18 通过。
- [ ] 没有添加 `isAvailable` 或把 `defaultEnabled` 改为 true。
- [ ] 所有 `$` 调用仍在 `hooks/register.js`；`lib/` 保持纯函数。
- [ ] `npm run validate` 通过；`npm run test` 28+ pass。
- [ ] 如果官方版本变了：fixture 已更新、版本号/文档已更新、`parity:check` 通过。
- [ ] 如果改了可观察行为：ANALYSIS/PARITY/README 已同步。
- [ ] 没有手改 `tests/parity/fixtures/official.mjs`。
- [ ] 没有把 `.claude-plugin/types/` 或根 `tsconfig.json` 提交进去（生成物，已 gitignore）。

---

## 8. 已知限制 / 非目标

- `claude -p` 不画 band；与官方一致，不为它加特殊逻辑。
- 需要至少 6 个 model step 才检查；一问一答不会触发。
- 三方 endpoint 必须支持 tool-less fork；不支持时返回 `api_error`，不显示建议。
- HIPAA/ZDR/LDR 排除无法通过公开 API 复现；敏感环境不要启用。
- Hook 编排/异步时序没有做官方 trace replay，由行为测试 + CUA 兜底。
- Page/artifact 在 2.1.308 基本是死代码；只保留了部分路径和 page telemetry。
- 本项目不是 Anthropic 官方项目；prompt 文本来自 Claude Code Beta 产品，仅为互操作性保留，
  再分发前确认条款。

---

## 9. 文档索引

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [README.md](README.md) | 安装、启用、使用、差异、开发命令 | 第一次接触项目 |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | 官方源码级分析、状态机、prompt、模型调用、逐项对照、CUA 结果 | 需要理解“为什么这样实现” |
| [docs/PARITY.md](docs/PARITY.md) | 官方差分测试的覆盖范围、fixture 生成、升级流程、未覆盖项 | 修改核心逻辑或升级 Claude Code |
| [docs/TESTING.md](docs/TESTING.md) | 真实 iTerm2 + 三方模型的 CUA 测试记录、截图、发现的问题 | 验证真实交互/UI |
| [tests/parity/corpus.mjs](tests/parity/corpus.mjs) | 差分测试输入 corpus | 加解析/UI/状态用例 |
| [tests/parity/official.test.ts](tests/parity/official.test.ts) | 我方实现 vs 官方 fixture 的断言 | 看某个 case 为什么失败 |
| [tests/parity/fixtures/official.mjs](tests/parity/fixtures/official.mjs) | 生成的官方输出 fixture（2.1.308） | 对比/审查官方变化 |
| [scripts/parity/official.mjs](scripts/parity/official.mjs) | 从 binary 提取并执行官方模块 | 官方打包/导出名变化时 |
| [scripts/parity/update.mjs](scripts/parity/update.mjs) | 生成/检查 fixture | 升级后更新基线 |
| [scripts/parity/scan.mjs](scripts/parity/scan.mjs) | 对比 `claude plugin validate` 的 hooks/calls | 改 hook/API 后 |
| [hooks/register.js](hooks/register.js) | 业务编排和全部 `$` 调用 | 改行为 |
| [lib/prompts.js](lib/prompts.js) | 官方 prompt 原文 | 只在官方升级时更新 |
| [lib/ui.js](lib/ui.js) | band 树与布局 | 改 UI |
| [lib/data.js](lib/data.js) | 状态机 | 改 view/session 逻辑 |
| [types/index.d.ts](types/index.d.ts) | `aboutOpen` state 契约 | 改 state |
| [.claude-plugin/plugin.json](.claude-plugin/plugin.json) | manifest | 改插件元数据 |

---

## 10. 参考

- 官方 Mods 文档：<https://code.claude.com/docs/en/plugins/mods/overview>
- Create a mod：<https://code.claude.com/docs/en/plugins/mods/create>
- Mods reference：<https://code.claude.com/docs/en/plugins/mods/reference>
- `$.model.fork`：<https://code.claude.com/docs/en/plugins/mods/api#call-a-model>
- 官方内置 mods 源码目录（部分）：<https://github.com/anthropics/claude-code/tree/main/mods>
