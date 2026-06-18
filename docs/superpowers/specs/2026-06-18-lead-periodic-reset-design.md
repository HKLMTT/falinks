# 设计:todo 模式 lead 周期性重置 + 项目状态记忆

日期:2026-06-18
状态:已定稿,待实现
前序:`docs/superpowers/specs/2026-06-18-todo-reset-workers-design.md`(员工侧「下发即重置」,已实现)

## 背景与问题

上一个增量解决了**员工**的长跑隔离(每任务全新会话),但留下真正的瓶颈:**lead 不重置,上下文无界**。lead 看遍每条任务、每次拆解、每份汇报、每次 nudge——长跑到后半夜会撞模型上限触发 CLI 有损 auto-compact,或更早就质量下滑。且「员工全新需完整交底」把全部跨任务连续性压在 lead 一人身上,反而加速其膨胀。

本设计给 lead 一套**受控记忆 + 周期重置**:用 lead 亲笔维护的高保真项目状态档,替掉 CLI 不可控的有损 compact——到点主动 `/clear` lead、重加载文档续航。

## 决策摘要(已与 boss 确认)

| 议题 | 决策 |
|---|---|
| 机制激进度 | **主动重置 lead + 重加载文档**(非被动等 CLI compact) |
| 文档维护 | **lead 持续增量维护**(随每次 taskdone 顺手刷新),整篇替换、非流水 |
| 触发 | **按任务数 K 周期**:每完成 K 条,在下发下一条前重置 |
| 回灌机制 | **方案 A**:`composeBootstrap` 对 lead 嵌入当前文档;`leadstate` 写入时同步更新 bootstraps 条目;`resetLead` 复用 `clearOneWorker(lead)` |
| 记忆清理 | `/clear` 与 `/todo clear` **删文档**(白纸);周期重置**留文档**(续航);lead 自行策展 |
| 配置 | 单一总开关 `leadReset.enabled`(**默认开**,K 默认 **5**),配置文件 + 控制台覆盖 |
| 安全阀 | 无 lead 或文档为空 → 跳过重置(空操作 + 提醒) |
| 员工侧 | 维持现状(「下发即重置」总是开启无开关,不加旋钮) |

## 架构

### ① `leadstate` MCP 工具 + 文档
- 新增工具(仅组长,同 taskdone/todoplan 一类):`leadstate(content: string)`——**整篇替换**式写入项目状态档(不设追加模式,逼文档保持有界)。
- 内容指引(写进工具描述 + `coordinatorRules`):目标/范围、关键决策与理由、约定/坑、已完成、下一步。**精炼、策展式**。
- 节奏指引:**随每次 taskdone 顺手刷新**(把更新绑在天然任务边界,保证重置时文档新鲜)。
- `enabled=false` 时此工具 no-op(返回提示「lead 记忆已关闭」)。

### ② 落盘模块 `src/leadstate-store.ts`(仿 `src/todo-store.ts`)
- `loadLeadState(cwd): string`(无则空串)、`saveLeadState(cwd, content): void`、`clearLeadState(cwd): void`。
- 纯文本 markdown,按 launchCwd 哈希存 `~/.falinks/leadstate/<hash>.md`,跨重启存活。哈希与落盘风格对齐 `runtime`/`sessions`。

### ③ 引擎:计数与触发(`src/core/todo.ts`)
- `TodoState` 仅增 `completedSinceLeadReset: number`(默认 0)——这是真正的 run 状态,持久化。`enabled`/`K` **不入 TodoState**(见⑦,住 config 文件,避免持久值盖过 config 的歧义)。
- 新 getter 回调 `leadResetEvery(): number`:引擎现取当前 K;index 实现返回 `enabled ? K : 0`(enabled 折进 getter,关闭即返回 0)。
- `taskdone`(done/failed 均计)时 `++completedSinceLeadReset`。
- `dispatchNext(isResend=false)` 中、`resetWorkers()` **之后**:取 `k = cb.leadResetEvery()`,若 `k > 0 && completedSinceLeadReset >= k` → 调 `resetLead()` 并归零计数。
- 自然结果:`start` 首条不触发(计数 0);第 K 条 taskdone 后的推进才触发;`nudge`/`redispatch(isResend=true)` 不触发;`enabled=false`(k=0)永不触发。
- 新回调 `resetLead(): void`(fire-and-forget)。引擎不判断文档是否为空——只管按 K 计数并触发;文档为空时是否真重置由 index 侧安全阀裁决(见⑥)。
- `completedSinceLeadReset` 归零点:`resetLead` 触发时;`clear()`(弃单)与 `plan()` 重建清单时(新一摊活重新计数)。
- `clear()`(对应 `/todo clear`)额外触发文档清除回调(见⑤ `wipeLeadMemory`)。

### ④ index.ts:`composeBootstrap` + `resetLead` 接线(方案 A 核心)
- `composeBootstrap(a)` 对 lead 末尾追加当前文档(仅当 `enabled` 且文档非空):
  `…coordinatorRules + (a.lead && enabled && doc ? "\n【项目状态(续接用,这是你上一段会话沉淀的记忆)】\n" + doc : "")`,compose 时现读 `loadLeadState(launchCwd)`。
- **`leadstate` 处理器**:`saveLeadState(content)` + 重算并更新 lead 的 bootstraps 条目(`bootstraps.set(lead, composeBootstrap(leadSpec))`,leadSpec 从 `cfg.agents` 查)。于是 lead 的 bootstraps 永远带最新文档。`onSetLead` 已重建 bootstrap,只要走 `composeBootstrap` 新 lead 即自动带文档、旧 lead 卸任后不带。
- **`resetLead` 回调** = 安全阀通过后 `void clearOneWorker(currentLead()).catch(()=>{})`(fire-and-forget)。既有 `clearOneWorker` 重注入的就是含文档的 bootstrap;下一条任务经 hold 队列在其后落地——时序天然正确。⇒ 周期重置、`/restart` 全部统一走「重注入含文档 bootstrap」自愈。

### ⑤ 记忆清理:两种「清」区别对待
| 动作 | 会话 | 文档 | 实现 |
|---|---|---|---|
| 周期重置 `resetLead` | 清 | **保留→重加载** | `clearOneWorker(lead)`,不动文档 |
| `/clear`(手动,单个/全员) | 清 | **删除→白纸** | `onClear` 对 lead:先 `clearLeadState` + 重算 bootstraps(此时无文档)→ 再 `clearOneWorker` |
| `/todo clear`(弃单) | — | **删除** | 引擎 `clear()` 触发 `wipeLeadMemory` 回调 → `clearLeadState` + 重算 bootstraps |
| `leadstate(content)`(lead) | — | 整篇覆盖(空=自清) | ④ 路径 |

两条「清」的唯一差别:重注入前是否先抹文档 + 重算 bootstraps 条目。

### ⑥ 安全阀(index 侧裁决)
`resetLead` 真执行前:若 `!enabled` 或 `currentLead()` 为空 或 `loadLeadState()` 为空 → **空操作**;文档为空时额外向 boss 发一条「跳过重置:lead 尚无状态档」提醒(边沿,避免每 K 条刷屏)。理由:重置无文档的 lead = 全失忆,严格更糟。引擎照常归零,K 条后再试;一旦 lead 维护了文档,重置即生效。

### ⑦ 配置面(2 旋钮,config 文件为唯一真相)
- **项目配置文件** `falinks.config.json`:`todo: { leadReset: { enabled: bool, everyTasks: int } }`,声明式、唯一真相。`parseConfig`(`src/core/config.ts`)按 `paneTheme` 的模式加类型校验;缺省视为 `{ enabled: true, everyTasks: 5 }`。
- **运行时控制台** `/todo leadreset on|off|<N>`:当场改内存 `cfg` + **写回 config 文件**(仿 `onSetLead` 写回 `configPath`,重启保留)。不再复制进 TodoState,杜绝「持久值盖过 config」的歧义。
- 引擎经 `leadResetEvery()` getter 现取;index 返回 `cfg.todo.leadReset.enabled ? everyTasks : 0`。
- 关闭效果:getter 返回 0(引擎永不触发)、`leadstate` no-op、`composeBootstrap` 不嵌文档 —— 完全回到当前行为。

### ⑧ i18n
- 新增:`leadstate` 工具描述、`coordinatorRules` 补「维护项目状态档」段、重置跳过提醒文案、`/todo leadreset` 反馈、记忆关闭提示。zh + en 同步(en = typeof zh)。

## 错误处理 / 边界
- 重置边界 lead 应已空闲(刚 taskdone);solo lead 同样适用。
- lead 在重置中收到的派活经 `router.hold` 排队,重注入 + register 后投出,不丢(与 `resetWorkers` 同一机制)。
- 文档无界风险:v1 仅靠工具描述/提示词强调「精炼、整篇替换」;超长软警告留后续。
- `enabled` 运行时被关:已嵌入某次 bootstrap 的文档不会主动回收,但下次任何 clear 重注入即不再带——可接受。

## 测试点
- **引擎**(`tests/core/todo*.test.ts` spy 模式,callbacks 增 `resetLead` spy、`wipeLeadMemory` spy、`leadResetEvery` getter):
  1. 前 K-1 次完成不触发 `resetLead`;第 K 次完成后的推进触发并归零;每 K 重复。
  2. `nudge` / `resume`/redispatch(isResend=true)不触发。
  3. `resetLead` 在 `resetWorkers` **之后**调用(顺序)。
  4. `leadResetEvery()` 返回 0 时永不触发(enabled=false 路径);返回不同 K 时周期随之变。
  5. `clear()` 触发 `wipeLeadMemory` 并归零 `completedSinceLeadReset`;`plan()` 重建亦归零。
  - 既有三测试文件 stub 需补 `resetLead`、`wipeLeadMemory`、`leadResetEvery`(编译前置)。
- **`leadstate-store`**:load/save/clear round-trip;无文件返回空串。
- **`composeBootstrap`**:lead + enabled + 非空文档 → 含文档段;文档空 / enabled=false / 非 lead → 不含。
- **index 接线**(`resetLead` 安全阀、`onClear`/`clear` 抹文档、`leadstate` 更新 bootstraps):I/O 胶水,build + 人工复查。

## 范围外(本次不做)
- lead 文档超长的自动告警/截断。
- 手动 `/lead reset`(留记忆的显式版)——周期重置已覆盖主场景。
- 员工侧加开关。
- 区分「同项目续接」vs「新项目」自动判定文档去留——靠 boss 显式 `/clear`、`/todo clear` 与 lead 策展。
