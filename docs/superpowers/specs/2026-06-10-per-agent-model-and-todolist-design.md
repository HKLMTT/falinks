# 员工指定模型 + todolist 无人值守 — 设计文档

日期:2026-06-10
状态:需求已与 boss 逐项确认(建单方式/上报机制/巡查节奏/失败语义/持久化策略)
实施顺序:先功能 1(小),后功能 2;发布时版本升中位(0.11.0)。

---

## 功能 1:创建员工指定模型

### 现状与目标

模型选择目前完全由外部 CLI 的全局默认决定,falinks 无字段无参数。目标:每个员工可在创建时指定模型,贯穿首启/resume//clear//restart 全生命周期。

### 设计

- `falinks.config.json` 的 agent 加可选 `model?: string`(`src/core/config.ts` 解析,空/缺省=沿用 CLI 全局默认,即现状)。
- `src/agent/mcp-config.ts`:`LaunchSpec` 加 `model?`;`buildAgentLaunch`:
  - claude:命令追加 `--model <m>`——**fresh 与 `--resume` 两种命令都加**(否则重启恢复的会话漂回全局默认,正是 pasg-dev 事故里模型漂移的路径);
  - codex:追加 `-m <m>`——**spike 已验证**(2026-06-10:`codex --help` 与 `codex resume --help` 均有 `-m, --model <MODEL>`,fresh 与 resume 都支持)。
- 传递链全程透传 model:`/add` 向导(见下)→ `/admin/add` body → `BusDeps.onAddAgent(spec)` → `launchInto(a)` → `buildAgentLaunch`。
- **修复既有缺口**:`onAddAgent` 目前只 launchInto + 写回配置文件,**不把新员工 push 进内存 `cfg.agents`**——导致本会话内对 /add 创建的员工 `/restart` 报 unknown agent(它查 cfg.agents)、`/lead` 切换的 bootstrap 重组也漏掉它。本期一并修:onAddAgent 成功后把 spec(含 model)push 进 `cfg.agents`。否则"model 贯穿 /restart"的承诺对主入口(/add 向导)不成立。
- `/add` 向导(console)在选完 cli 后加一步「模型(留空=CLI 默认)」,自由文本,不做名单校验——**填错的自然兜底**:CLI 启动失败 → 员工永不报到 → A-1 失联检测 90s 内亮 ⚠(v0.10.x 已交付的机制)。
- 持久化口同步:`src/team-persist.ts` 的 `addAgentToConfigFile` 写回 model;`src/templates.ts` 模板 agent 支持可选 model。
- `/restart` 走 launchInto 同链路,自动沿用配置 model,无需额外改动。
- **有意不做**:初始建队向导(setup)暂不加模型步骤(用 /add 或手改配置);roster 不显示模型(YAGNI)。

---

## 功能 2:todolist 无人值守

### 需求要点(已确认)

- boss 用控制台命令逐条建单;团队按顺序执行;**lead 调专门 MCP 工具上报完成**,系统才下发下一条。
- 双机制保送达:① lead 主动上报(taskdone);② 空闲巡查——全员空闲满 N(默认 10 分钟,可配)后询问 lead,**追问不止**,不自动重启。
- 失败记录后继续下一条(夜间批量不被堵);跑完给 boss 汇总。
- 落盘持久化;falinks 重启后**不自动续跑**,提示 `/todo resume`。
- 线性跑一遍,不循环;一个项目同时只有一个清单。

### 实体与存储

`~/.falinks/todos/<projectKey>.json`(新模块 `src/todo-store.ts`,仿 session/store.ts):

```ts
interface TodoTask { seq: number; body: string; status: 'pending' | 'current' | 'done' | 'failed'; result?: string; ts?: number; }
interface TodoState {
  state: 'idle' | 'running' | 'paused' | 'finished';
  nudgeMinutes: number;   // 巡查间隔 N,默认 10,/todo start [N] 可指定
  tasks: TodoTask[];
}
```

每次状态变更落盘。**载入规则:文件里 state=running 一律降为 paused**——进程死过,文件说 running 不可信,由 boss `/todo resume` 决定续跑。

### 核心引擎 `src/core/todo.ts`(纯类,同 Router/Guards 模式)

不碰 iTerm/HTTP/文件;依赖注入:`now()`、`dispatch(task, isResend)`(下发回调)、`nudge(task)`(巡查询问回调)、`announce(text)`(汇总/告警回调)、`persist(state)`。全部逻辑可纯单测。

接口(供 index.ts 与 admin 端点调用):
- `add(body)`:任何状态可加(running 时往队尾追加);**finished 态 add 自动转 idle 并清除已完结条目**(汇总已发进消息流不丢信息)——否则「跑完→直接加明晚任务→start 报错→被迫 clear 连新任务一起删」;
- `rm(seq)`:pending 可删;**paused 态额外允许 rm current**(标 failed、result="boss 移除",resume 后从下一条继续)——lead 永不上报且巡查无效时 boss 的脱困正路;running 态的 current 与 done/failed 拒绝;
- `clear()`:仅非 running 可清空整单;
- `start(nMinutes?)`:校验 ①list 非空 ②state 为 idle/finished(finished 需先 clear,start 报错提示) ③**有 lead**(无则报错「先 /lead 指定组长」);置 running,下发第一条;
- `stop()`:running→paused;不再下发与巡查;**迟到的 taskdone 仍记录结果但不下发下一条**;
- `resume()`:paused→running,**先同 start 校验有 lead**(无则报错,而不是 resume 后立刻进挂起态),再**重发 current 条目**(标注「重发」——重启后 lead 可能已忘,挂起期间 lead 可能换人);
- `onTaskdone(seq, status, result)`:见下;
- `tick(anyBusy: boolean, hasLead: boolean)`:健康轮询(1.5s)驱动,管巡查计时与 lead 缺失挂起。

### taskdone 工具(总线)

`taskdone(seq: number, status: 'done' | 'failed', result: string)`:

- **权限**:`router.get(agentName)?.lead === true`,非 lead 报错;
- **seq 必填且必须等于 current.seq**——防模型抽风连调两次把下一条也误完结(错位时报错「当前是任务 j,不是 k」);无 running list 或无 current 时报错;
- 行为:记录 status/result → 落盘 → running 态立即下发下一条;最后一条完结 → state=finished → `announce` 汇总(x 成 y 败 + 各条 result 摘要),写入消息流;
- paused 态:只记录,不下发;
- 工具 description 写明「仅 todolist 运行中由组长调用」;
- 调用本身经 bus handler 打点 touchMcp → 顺带自愈 lead 的 ⚠(与失联检测天然衔接)。

### 下发与巡查消息(身份设计与送达保障)

- **下发/巡查均以 boss 名义** `router.send('boss', lead, …)`:lead 按 houseRules 回 boss 无害;若用非成员名,lead `sendmsg(to=该名)` 会 unknown target 报错。boss 虚拟、从不 handling → 每条都是新 thread,夜跑不累积回合数(已对照 guards 代码核实)。
- **send 返回值必须检查**(undefined = 被守卫丢弃:限流/lead dead):
  - 下发失败:引擎不标"已派发",由下一轮巡查兜底重试——**巡查机制同时就是下发失败的重试机制**,这是设计依赖,不是巧合;
  - 巡查失败:**不重置巡查计时**(否则每次失败白等 N 分钟),下一 tick 重试;
  - 连续失败(≥3)→ announce 告警一条(边沿)。
- 下发模板:「【任务 k/n】<body>↵完成后调用 taskdone(seq:k, status:"done"|"failed", result:"…")上报,系统才会下发下一条;勿用 sendmsg 回复本条,过程中可照常与团队/boss 沟通。」
- 巡查模板**自包含**(lead 被 /clear 或换人后也能接上):「【任务 k/n 进度巡查】全员已空闲 N 分钟仍未收到上报。任务内容:<body>。已完成请调 taskdone(seq:k,…);仍在推进则继续即可,本提醒每 N 分钟一次。」
- **重发防叠**:引擎记录最近一次下发的消息 id;重发(resume/换 lead)前先 `router.cancelQueued(id)` 撤掉可能仍在 inbox 排队的旧下发——否则 lead 忙时 stop→resume 会顺序收到同一任务两份,副作用型任务有重复执行风险。
- **汇总**:`router.send('falinks', 'boss', 汇总)`——**不注册** `falinks` 为虚拟成员(`send()` 不校验发件人,只解析收件人;注册反而会让它出现在花名册里污染 roster)。to=boss 虚拟 → 纯入消息流,控制台可见,不投递任何 pane;未知发件人在消息渲染里走默认色。`/add` 拒绝保留名 `falinks`(`boss` 已被 name-exists 天然拒绝)。

### 空闲巡查计时(tick 内)

- 仅 state=running 且有 current 时计时;
- 「空闲」判定 = **无任何非虚拟员工处于 busy**(idle/stuck/launching/dead 都算闲——stuck 的人不在产出);
- 计时重置事件:①任一员工转 busy;②下发任务(含重发);③发出一次巡查询问(间隔自然成「每满 N 问一次」);④收到 taskdone;
- 满 N → `nudge(current)` → 重置 → 继续,**永不放弃**;lead 失联(⚠)时巡查照发(失联告警已由 v0.10.x 机制呈现),不自动重启。

### lead 缺失挂起(运行中防真空)

- tick 发现 `hasLead === false`(被 /remove、dead、或从未设)→ 引擎置内部 `suspended` 标志:暂停下发与巡查,`announce` 控制台警告「无组长,todolist 挂起,/lead 指定后自动继续」(边沿触发,一次);
- lead 回来(/lead 指定新人、或 dead 经 /restart 复活)→ 解除挂起并**重发 current**(新 lead 没上下文,消息自包含);
- 挂起属运行时瞬态,不改持久化 state(仍是 running——重启载入会降 paused,语义一致)。

### 命令与端点(控制台与总线分进程,必须走 HTTP)

- console:`/todo add <内容(可多行)>`、`/todo list`、`/todo rm <seq>`、`/todo clear`、`/todo start [N分钟]`、`/todo stop`、`/todo resume`;`/todo` 带子命令补全;**add 的内容取命令关键字之后的原始余文**(保留换行与空格,不能走现有的 `split(/\s+/)` 整行拆词);`start` 的 N 校验正整数;
- bus:`POST /admin/todo` `{op: 'add'|'rm'|'clear'|'start'|'stop'|'resume', …}` 统一分发 + `GET /admin/todo` 返回完整状态(列表/进度);
- 控制台呈现:① running/paused 时活区常驻一行进度「📋 k/n 当前:<body 截断> [⏸ 已暂停]」(并入现有 roster/diag 轮询,GET /admin/todo);② `/todo list` 用**底部浮层**展示(同 langPick//lead 选择器的模式:多行渲染、Esc 关闭)——控制台没有"本地多行输出"通道(/help 只是单行 status,历史区完全由服务端消息流派生),不要往那条路走;
- 启动恢复提示:**由控制台自己从 GET /admin/todo 推导**(paused 且有未完成条目 → status 行提示「检测到未完成的 todolist(k/n 完成),/todo resume 继续」)——单窗口与分离控制台两种模式统一(分离模式拿不到 up 进程的启动期 status)。

### 边界与有意不做

- `/clear` 全员会清掉 lead 的任务记忆——不拦截,由自包含的巡查消息兜底(下一轮巡查 lead 即可续上);
- 不做多清单并行、不做 task 间依赖/优先级、不做定时启动(YAGNI,夜跑=人走前 /todo start);
- 不做 boss 手机通知(超出本期)。

### 改动文件清单(预估)

| 文件 | 改动 |
|---|---|
| `src/core/config.ts` | AgentConfig.model 解析 |
| `src/agent/mcp-config.ts` | LaunchSpec.model;claude `--model`(fresh+resume);codex spike 后定 |
| `src/core/todo.ts`(新) | TodoEngine 纯类:状态机/巡查计时/挂起/汇总 |
| `src/todo-store.ts`(新) | todos 落盘/载入(running→paused 降级) |
| `src/bus/server.ts` | taskdone 工具(lead+seq 校验);`/admin/todo` GET/POST;**BusDeps 加 `todo` 依赖钩子**(taskdone/op/state 三口,触达 index.ts 里的引擎);onAddAgent spec.model 透传 |
| `src/index.ts` | TodoEngine 接线:tick 进健康轮询、dispatch/nudge/announce/persist 回调(dispatch/nudge 检查 send 返回值);launchInto model 透传;**onAddAgent push 进 cfg.agents** |
| `src/console/parse.ts` `commands.ts` `app.tsx` | /todo 子命令解析与补全;进度常驻行;向导加模型步 |
| `src/team-persist.ts` | model 写回配置 |
| `src/templates.ts` | 模板 agent 可选 model |
| `src/i18n/zh.ts` `en.ts` | /todo 全套文案、下发/巡查/汇总模板、向导模型步、taskdone 工具描述 |

### 测试要点

- TodoEngine 纯单测:线性下发→taskdone 推进;failed 继续;最后一条→finished+汇总;seq 错位拒绝;重复 taskdone 拒绝;stop 后迟到 taskdone 只记录;resume 重发 current(且先 cancelQueued 旧下发);巡查计时四种重置事件;**巡查/下发 send 失败不重置计时、连续失败边沿告警**;空闲满 N 触发 nudge 且永不放弃;lead 缺失挂起(边沿一次告警)与恢复重发;running 时 add 追加/rm 仅 pending/clear 仅非 running;**finished 态 add 转 idle 清旧条目**;**paused 态 rm current 标 failed**;start 校验(空单/已 running/无 lead)。
- todo-store:载入 running→paused;round-trip。
- bus:taskdone 非 lead 拒绝、无任务拒绝、seq 校验;/admin/todo op 分发。
- console:**/todo add 多行原始余文解析**(防 split 拆碎回归);**/todo 子命令补全**(现 commandState 正则打出空格即失活,子命令补全是新逻辑);浮层渲染。
- model:buildAgentLaunch 各 CLI/各模式(fresh/resume)命令含 model 参数;不填不含;config 解析;team-persist 写回;**onAddAgent 后 cfg.agents 含新员工(/restart 可用)**。
- 实机验收:3 条任务清单(lead 真 claude):正常推进两条(taskdone 驱动)→ 故意让 lead 不上报,等 N(用 1 分钟配置)触发巡查 → lead 补报 → 第三条标 failed → 汇总出现在消息流;/todo stop+resume 重发;重启后提示 resume。

### 验收标准(对照需求原文)

「晚上持续做一系列测试任务,中途按 list 执行,不循环,没完成不中断」:start 后无人值守,系统仅靠 taskdone+巡查驱动到底,全程不需要 boss 在场;任何单条失败不中断;跑完有汇总可晨检;中途 falinks 崩溃,早上 resume 不丢进度。

---

## 全面自查记录(写入时已修正的坑)

1. 重复/错位 taskdone 会误结下一条 → seq 必填且校验。
2. 「全员空闲」若定义为"全员 idle"会被 stuck/launching 卡住永不巡查 → 改为「无人 busy」。
3. 巡查消息不自包含,lead 被 /clear 或换人后接不上 → 模板带任务内容。
4. finished 后无法重新建单 → 补 /todo clear。
5. 文件说 running 但进程死过 → 载入一律降 paused。
6. stop 后迟到的 taskdone 丢结果 → 记录不推进。
7. 挂起告警若逐 tick 重复会刷屏 → 边沿触发(同失联告警模式)。

第二轮复查追加修正:

8. 汇总若把 `falinks` 注册成虚拟成员会污染花名册 → 不注册,裸 from 发送(send 不校验发件人);/add 拒绝保留名。
9. `/todo add` 多行内容会被现有 `split(/\s+/)` 拆碎 → 解析取关键字后原始余文。
10. resume 不校验 lead 会"恢复即挂起"造成困惑 → resume 与 start 同校验。
11. codex 的 resume 命令是否吃模型 flag 未知 → 并入 spike 验证项。

第三轮对抗性审查(独立复核,对照实码)追加修正:

12. 「复用 /help 多行呈现」机制不存在(/help 仅单行 status)→ /todo list 改底部浮层(langPick 模式)。
13. /add 创建的员工不进内存 cfg.agents → 本会话 /restart 报 unknown、/lead 重组漏掉 → onAddAgent 补 push(既有缺口,功能 1 的 model 承诺依赖它)。
14. send() 被守卫丢弃返回 undefined 全程未处理(3am 静默丢的残余路径)→ 下发失败靠巡查重试(写明设计依赖)、巡查失败不重置计时、连续失败边沿告警。
15. finished 态 add 后被迫 clear 连新任务一起删 → finished 态 add 自动转 idle 清旧条目。
16. stop→resume 重发与 inbox 排队旧下发叠成两份(副作用任务重复执行风险)→ 重发前 cancelQueued。
17. current 卡死无脱困正路 → paused 态允许 rm current(标 failed 跳过)。
18. 启动恢复提示只在单窗口模式可达 → 改由控制台从 GET /admin/todo 推导,两模式统一。
