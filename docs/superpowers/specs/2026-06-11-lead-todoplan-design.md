# lead 经 MCP 建单与启动(todo 模式协作流)— 设计文档

日期:2026-06-11
版本:0.12.0(功能,升中位)
基础:0.11.0 的 TodoEngine / BusDeps.todo 钩子 / taskdone 工具 / /todo 命令体系

## 场景(需求原文)

boss 与 lead 沟通完整需求流程,lead 分析拆解;若 boss 在需求中**明确要求用 todo 模式执行**,lead 把拆解后的任务以 MCP 形式建进 falinks 的 todolist,**等待 boss 确认后开始执行**(确认方式已选定:lead 用 ask 弹选择题,boss 点选后 lead 调启动工具)。

## 方案取舍

- 给 lead 加两个新 MCP 工具:**`todoplan`(批量建单)+ `todostart`(启动)**,权限同 taskdone(仅 lead)。
- 否决"一个万能 todo(op) 工具"(语义模糊,模型易误用)和"把 /admin/todo 全量 op 开放给 lead"(rm/clear/stop 是 boss 的管理权,越权面大)。
- `todostart` 不加新钩子,bus 工具 handler **复用现有 `deps.todo.op('start', {n})`**(handler 硬编码只调 start);`todoplan` 在钩子上新增 `plan(tasks, from)` 一口。

## 完整流程

1. boss ↔ lead 沟通需求,boss 明确说"用 todo 模式执行";
2. lead 拆解定稿后调 `todoplan(tasks: string[], replace?: boolean)` 一次性建整单(原子);
3. 系统以 `falinks → boss` 发消息留痕:「组长 {name} 已建 N 条任务清单,/todo list 查看」;控制台进度行新增 **idle 待开跑**分支:`📋 N 条待开跑(/todo list 查看)`;
4. lead 用**现有 ask 工具**问 boss:「清单已建好(N 条),开始执行?」,选项建议含巡查间隔(如 `开始(巡查10分钟) / 开始(巡查30分钟) / 暂不`);
5. boss 点选 → 答案文本回到 lead → lead 调 `todostart(nudgeMinutes?)` → 进入 0.11.0 既有执行流(下发/taskdone/巡查/汇总)。任务下发对象就是 lead 自己:调用回合内它处于 busy,消息入 inbox 排队、转闲即送达,无竞态。

## 工具定义

### `todoplan(tasks: string[], replace?: boolean)`

- schema:`tasks: z.array(z.string()).min(1)`,`replace: z.boolean().optional()`;
- 权限:`router.get(agentName)?.lead === true`,非 lead 拒绝;无 todo 钩子拒绝;
- 引擎层校验(新方法 `plan(tasks, replace)`):
  - 逐条 trim 后为空的 body 拒绝(整单原子失败,不部分写入);
  - running/paused → 拒绝「清单执行中」;
  - finished → 自动清旧账(与现有 add 的 finished→idle 语义一致);
  - **idle 且已有条目 → 默认拒绝**(防覆盖 boss 手动建的单),错误信息提示「重建请传 replace:true 或请 boss /todo clear」;`replace === true` 时清空后建(**lead 修订清单的正路**:boss 看完说"拆细点"时不必求 boss 手动 clear);
  - 成功:批量 push(seq 沿单调计数器),**一次 persist**,返回 `{ ok: true, seqs: number[] }`;
- 成功后 index.ts 包装层发系统通知(见上第 3 步),通知带建单人名字(钩子签名 `plan(tasks, replace, from)`,from 由 bus handler 传 agentName);
- 工具 description 写明:「仅当 boss 明确要求 todo 模式时使用;建完必须用 ask 征得 boss 同意才可 todostart;修订自己刚建的清单时传 replace:true」。

### `todostart(nudgeMinutes?: number)`

- schema:`nudgeMinutes: z.number().optional()`;权限同上(仅 lead);
- handler 直接调 `deps.todo.op('start', { n: nudgeMinutes })`——复用引擎 `start()` 全部既有校验(空单/已 running/paused 应走 resume/finished 提示/无 lead/N 正整数);
- 工具 description 写明:「必须先经 ask 获得 boss 明确同意;paused 状态的恢复属 boss 干预权(/todo resume),本工具不可用」。

## 约束与守护(软硬结合)

- 「先 ask 等 boss 同意」是**软约束**:写进协调者工作法(coordinatorRules)与两个工具的 description;
- 硬兜底:boss 随时 `/todo stop`;启动有多重留痕(boss 自己点过 ask、进度行从"待开跑"变 running、消息流有下发记录),不存在无感启动;
- lead 没有 rm/clear/stop/resume 工具,管理权完整保留在 boss 手里。

## 协调者工作法(coordinatorRules)追加

zh/en 同步,在现有条目后追加一条(编号顺延):

「当 boss 明确要求用 todo 模式执行时:拆解定稿后调用 todoplan(tasks:[每条一个任务]) 建成清单 → 用 ask(to:"boss") 确认是否开始执行(选项里给巡查间隔,如"开始(巡查10分钟)/开始(巡查30分钟)/暂不")→ boss 同意后调 todostart(nudgeMinutes) 启动;之后每完成一条用 taskdone(seq, status, result) 上报,系统会自动下发下一条。未经 boss 同意绝不 todostart;要修订刚建的清单用 todoplan(…, replace:true)。」

## 控制台呈现

- 进度行(app.tsx 现有 running/paused 分支)增加 idle 分支:`state === 'idle' && tasks.length > 0` → `📋 N 条待开跑(/todo list 查看)`(i18n 新键 `todoPendingLine(n)`)。idle 态任务必为 pending(状态机保证),不会误显示旧账。
- 其余复用现有:`/todo list` 浮层、`/todo start`(boss 仍可手动启动,与 todostart 幂等互斥:后到者收「already running」)。

## 改动文件清单(预估)

| 文件 | 改动 |
|---|---|
| `src/core/todo.ts` | `plan(tasks, replace)` 方法(原子批量建,冲突矩阵) |
| `src/bus/server.ts` | todoplan/todostart 两工具(touch + lead 校验);BusDeps.todo 钩子加 `plan(tasks, replace, from)` |
| `src/index.ts` | 钩子 plan 实现(engine.plan + 成功后 falinks→boss 通知) |
| `src/console/app.tsx` | 进度行 idle 待开跑分支 |
| `src/i18n/zh.ts` `en.ts` | 两工具描述、todoPlannedMsg(from, n)、todoPendingLine(n)、coordinatorRules 追加条目 |

## 测试要点

- 引擎 plan:批量 seqs 连续;空数组/空白条目原子拒绝;running/paused 拒绝;finished 清旧账后建;idle 非空默认拒绝、replace:true 覆盖;idle 空直接建;一次 persist。
- bus:todoplan 非 lead 拒绝、schema 校验、replace 透传、from=agentName 透传;todostart 非 lead 拒绝、n 透传到 op('start')、复用引擎校验(paused 时报错)。
- i18n parity;console 进度行 idle 分支(有 pending 显示、空单不显示、running 仍走原分支)。
- 实机验收(完整协作流):boss 发需求并注明"用 todo 模式" → lead 拆解后 todoplan(3 条) → 控制台出现「待开跑」进度行 + falinks 通知 → lead ask 弹到 boss → boss 点「开始(巡查10分钟)」 → lead todostart → 任务下发回 lead → 3 条跑完出汇总。另验:replace 修订、boss 手动 /todo start 与 todostart 互斥、非 lead 调用被拒。

## 边界与有意不做

- 不做"硬性 ask 凭证校验"(无法可靠判定 boss 同意与 todostart 的因果,软约束+boss 兜底已够,与用户选定的方案一致);
- 不给 lead resume/stop/rm/clear 工具(管理权属 boss);
- 不做多清单/草稿态(YAGNI:replace 已覆盖修订场景)。

## 自查记录(写入时已修正)

1. lead 修订清单无路 → todoplan 加 replace 参数(默认拒绝覆盖)。
2. 通知不知建单人 → 钩子 plan 带 from(bus handler 传 agentName)。
3. todostart 原拟新钩子 → 复用 op('start'),少一接口面且不暴露管理 op。
4. 参数校验缺失 → zod min(1) + 引擎拒空白条目且原子失败。
5. 确认 lead 调 todostart 时自己 busy,任务 1 入 inbox 排队无竞态;paused 恢复权留 boss。

## 实现后记(2026-06-11)

- todoPlannedMsg 最终文案较设计稿增补后半句「待 boss 确认后由组长启动(或你直接 /todo start)」,明确双启动路径;行为无变化。
- 测试要点中的控制台 idle 分支未落为独立 vitest 用例,由实机 E2E 验收覆盖;i18n 新键中英一致性由 `en: typeof zh` 类型约束(CI 全项目 tsc 门槛)兜底。
