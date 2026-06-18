# 设计:todo 模式「下发即重置员工」+ 下发消息自带角色锚点

日期:2026-06-18
状态:已定稿,待实现

## 背景与问题

AI 跑长任务时,会话上下文持续膨胀 → 混乱、质量下滑,难以持久完成任务。falinks 的 `/todo` 无人值守清单正是长任务场景:每条 task 下发给 **lead**,由 lead 拆解、分派给员工执行。连续多条 task 跑下来:

1. **员工上下文累积**:同一员工跨多条 task 累积无关历史,后续 task 质量下降。
2. **lead 忘记角色**:lead 上下文增长最快(看遍每次拆解/汇报/巡查),开机时注入的「协调者工作法」(`coordinatorRules`)被淹没,导致 lead **不再拆解分派、自己上手包办**(已在实跑中观察到)。

本设计解决这两点。

## 决策摘要(已与 boss 确认)

| 议题 | 决策 |
|---|---|
| 重置范围 | **只清员工,保留 lead**。lead 作为跨任务记忆锚点不动。 |
| 开关 | **总是开启,无开关**。todo 跑起来每条新任务都重置员工。 |
| 触发时机 | 仅「推进到新任务」时清(`dispatchNext` 的 `isResend===false`);`nudge`、`resume`/重发(同一 current 任务)**不清**。 |
| 完成判定 | **纯信任 lead**:唯一推进信号是 lead 调 `taskdone`,系统不自行核实完成,不查 busy、无运行时护栏。正确性靠提示词把「done」定义死。 |
| 下发消息 | 每条下发**始终**自带「你是组长,拆解分派,别包办」(角色锚点,不依赖 bootstrap 记忆);「员工均为全新会话」一句仅 `isResend===false` 时加。 |

### 为何不设运行时 busy 护栏

新模式把「lead 必须在所有分派出去的员工都回报后才 `taskdone`」从"最好如此"变成"必须如此":若 lead 过早上报,`resetWorkers` 会把仍在干活的员工当场 `/clear`,工作丢失。boss 选择**不加护栏**,把这条正确性约束完全放到提示词里讲清,换取最简实现。

## 架构(方案 A:引擎加 `resetWorkers()` 回调,触发即清、不等待)

`TodoEngine` 保持纯同步逻辑,清空作为副作用经回调注入(与现有 `dispatch`/`nudge`/`persist` 一致)。

### 改动面(4 处)

| 文件 | 改动 |
|---|---|
| `src/core/todo.ts` | `TodoCallbacks` 加 `resetWorkers(): void`;`dispatchNext` 中**仅 `!isResend`** 时、`cb.dispatch` 调用**之前**调 `cb.resetWorkers()`。 |
| `src/index.ts` | 实现 `resetWorkers` 回调:把现有 `onClear` 的**单员工清空序列**抽成可复用 helper,对所有非 lead/非 virtual/非 boss 员工并发执行;fire-and-forget(不阻塞引擎)。 |
| `src/i18n/zh.ts` + `src/i18n/en.ts` | 重写 `todoDispatchMsg`;`coordinatorRules` ④ 补一句;`todoNudgeMsg` 轻补一句。 |
| `tests/core/todo*.test.ts` | callbacks stub 增 `resetWorkers` spy;新增时机断言。 |

### 数据流 / 时序

`dispatchNext(isResend)` 内,确认确实有任务要下发(已过「无任务 → finished」早退)、`task` 已设为 current 之后,在 `cb.dispatch` 之前插入:

```ts
if (!isResend) this.cb.resetWorkers();   // 只在真正推进到新任务时清
const id = this.cb.dispatch(task, this.st.tasks.indexOf(task) + 1, this.st.tasks.length, isResend);
```

调用来源对照:
- `start()` → `dispatchNext(false)`:第 1 条任务也清(擦掉设计阶段残留),不特判首条。
- `taskdone`(running) → `dispatchNext(false)`:推进下一条,清。
- `redispatch()`(`resume()` / `tick` 中 lead 回归)→ `dispatchNext(true)`:**不清**(同一 current 任务,员工可能正在干)。
- `nudge`:不走 `dispatchNext`,天然不清。

`resetWorkers`(index.ts 侧)异步触发。期间复用现有 `clearing` 集合 + `router.hold`:lead 此刻发给「正在重置」员工的派活会**排队**,员工重注入 bootstrap、重新 `register` 后投出,不丢。

**已知竞态(可接受)**:lead 读到「员工已重置」时它们可能仍在重新 register;靠消息措辞 + 排队兜底。无人值守场景下可接受。

### `resetWorkers` 实现要点(index.ts)

- **目标** = `router.roster()` 过滤掉 `virtual`(boss 是 virtual,已含)、`currentLead()`、以及 `restarting`/`clearing` 中的员工。即 `roster().filter(a => !a.virtual && a.name !== lead && !restarting.has(a.name) && !clearing.has(a.name))`。
- ⚠ **无 lead 必须空操作**:`currentLead()` 为 `undefined` 时(lead 掉线/被移除)直接 return。否则 `name !== undefined` 恒真 → 会误清**所有**员工。`onClear` 全员清(`src/index.ts:318`)的目标是 `!a.virtual`(会含 lead),故 `resetWorkers` **不能**复用其目标列表,只能复用单员工 helper。
- **复用** 现有单员工清空序列(当前内联在 `onClear`,`src/index.ts:320` 一带):
  `clearing.add(nm)` → `router.hold(nm)` → `driver.inject(sid, '/clear', true)` → `sleep(1500)` → `armRegisterExpectation(nm)` → 重注入 `bootstraps.get(nm)` → `finally clearing.delete(nm)`,多人 `Promise.all` 并发。
  抽成 helper(如 `clearOneWorker(nm)`,**单员工粒度**),供 `onClear` 与 `resetWorkers` 共用,避免逻辑漂移。注意只能共用单员工序列,不能共用 `onClear` 的目标列表(后者含 lead)。
- 对「无 lead / 无目标」**空操作**(单人队、下发瞬间无 lead 都安全;见上方无-lead 守卫)。
- 不检查 busy、不告警(护栏决策)。

## 提示词改动

### `todoDispatchMsg(seq, pos, total, body, isResend)`

复用已有的 `isResend` 参数分支,**不新增 mode 标志**。

- **始终包含**(角色锚点,含重发):
  > 你是本团队的**组长/协调者**。本任务请**拆解成子任务、用 sendmsg 分派给对应员工**(前端/后端/测试…)执行;你只负责协调依赖、跟进进度、汇总结果,**不要自己动手包办**。
  > 完成判定:**只有当你分派出去的所有员工都已完成并向你回报后**,才调 `taskdone(seq, status, result)`——否则会中断他们正在进行的工作。
- **仅 `isResend===false` 追加**:
  > ⚠ 本轮员工均为**全新会话、无任何历史记忆**,分派时务必把背景/目标/验收标准一次交代清楚。
- 保留原有 `taskdone`/`taskwait` 指引与「勿用 sendmsg 回复本条」。

### `coordinatorRules` ④(todo 模式条款)

补一句:todo 模式下每条任务下发时**员工会被重置为全新会话**,你需对他们完整交底。

### `todoNudgeMsg`

轻补一句:如**仍未分派**,请拆解后分派给员工执行(防 lead 卡在「该不该自己干」)。

zh.ts 与 en.ts 同步改。

## 测试点(沿用 `tests/core/todo*.test.ts` 纯引擎 spy 模式)

⚠ **编译前置**:`TodoCallbacks` 加 `resetWorkers` 后,`tests/core/todo.test.ts`、`tests/core/todo-backoff.test.ts`、`tests/core/todo-wait.test.ts` **三个文件**的 callbacks stub 都要补上该字段(否则 TS 不过),不只是写新断言的那个文件。

在 mk() 的 callbacks stub 增 `resetWorkers: () => { calls.reset.push(...) }` spy,断言:

1. `start` 首次下发 → `resetWorkers` 被调一次。
2. `taskdone`(running) 推进下一条 → 被调。
3. `nudge`(idle 巡查)→ **不**调。
4. `resume` / redispatch(`isResend=true`)→ **不**调。
5. **调用顺序**:`resetWorkers` 在 `dispatch` **之前**(用统一 call 序列或时间戳断言)。

## 范围外(本次不做)

- **lead 周期性重置**:lead 才是 bloat 震中,但靠持久化清单当长期记忆来重置 lead 是更大改动,boss 选择保留 lead,留待后续。
- **客观完成检测**(验产物/跑测试/查 busy):本次维持纯信任 lead 模型。
