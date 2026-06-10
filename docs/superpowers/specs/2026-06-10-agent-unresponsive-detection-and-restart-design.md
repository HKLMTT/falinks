# 员工失联检测 + /restart 重启命令 — 设计文档

日期:2026-06-10
状态:已与 boss 确认通过
背景事故:pasg-dev 办公室,lead 的 claude 被手动重启成裸进程(无 --mcp-config),此后所有回复只打在自己 pane 里,boss 端零感知,持续约 10 分钟无人发现。

## 问题

falinks 对"员工 CLI 没挂上 falinks MCP 工具"完全不可见:

1. **失联不可见**:健康轮询只看 pane 存活与忙闲。员工没调 `register`、MCP 工具缺失时,花名册仍显示正常(idle/busy),消息持续投给一个永远无法回复的员工;员工在 pane 里打出的"工具未挂载"求救没人看到。
2. **手动重启无归队路径**:falinks 理念允许手动操作 pane,但 MCP 配置写在临时目录(`$TMPDIR/falinks-*/<name>-mcp.json`),用户手动重启 CLI 不可能带上正确参数,也没有命令可以替他做。事故中用户正是因为缺这条命令才起了裸 claude。
3. **resume 死胡同**:恢复进 100% 上下文耗尽的旧会话,员工恢复即瘫痪,表现同失联。

## 方案总览

- **A. 失联检测**:以"总线收到该员工的 MCP 调用"为唯一可靠信号,两条规则判定失联嫌疑,花名册标 ⚠ + 控制台警告 + 诊断落盘;收到任意 MCP 调用即自愈。
- **B. `/restart <name> [fresh]` 命令**:关掉员工 pane,用与启动完全一致的链路重建(默认 resume 已知会话;fresh 清会话记录全新开局)。
- **C. resume 死胡同不做专门检测**:读屏判上下文百分比太脆;此类员工一被指派任务就会触发 A-2 告警,由 boss 用 `/restart <name> fresh` 处置,警告文案中给出提示。

已否决的替代方案:
- 主动探测 CLI 的 MCP 客户端——HTTP server 无法反向 ping 客户端,不可行。
- 读屏匹配"未挂载"等字样——依赖 agent 措辞,脆。
- /restart 原地在 shell 重打命令(pane 位置不变)——要求前台 CLI 已退出或能安全打断,注入序列脆;选 close+resplit(位置会变,可接受)。

## A. 失联检测

### 信号采集

- 总线 `serverForAgent` 的**每个**工具 handler(register/sendmsg/idle/ask/who)入口处调 `router.touchMcp(agentName)`,记录 `lastMcpAt`。
- 这是服务端事实,不依赖读屏、不依赖 agent 配合。
- **注意**:`touchMcp` 只放在 bus 工具 handler 层,**绝不能**放进 `router.register()` 内部——resume 路径由 falinks 服务端代登记(index.ts 直接调 router.register),那不是员工的 MCP 活动,混进来会掩盖失联。
- `touchMcp` 对未知名宽容(get 而非 must,忽略不抛):任何人可以 curl 任意 `/agent/<name>/mcp` 路径(总线无名单校验),不能让野请求炸轮询或污染状态。
- **辅助信号 `lastMcpHttpAt`**:HTTP handler 里凡命中 `/agent/<name>/mcp` 路径即记录(CLI 进程启动时会 initialize + tools/list,早于任何工具调用)。只用于 A-1 告警**文案分流**,不作触发条件(/clear 不重建连接,同进程不会再 initialize):
  - 该员工从未有过 HTTP 活动 → "CLI 可能没挂 falinks 配置(手动重启过?)"(本次事故形态);
  - 有过 HTTP 活动但没调工具 → "MCP 已连接但未报到(会话可能瘫痪,或模型漏了 register)"。

### 判定规则

**A-1 报到超时**(覆盖:fresh 启动、/clear 重注入、手动重启后被 /clear)

- bootstrap **交付时刻**记 `expectRegisterBy = now + 90s`:claude = 就绪检测后注入 fullBootstrap 成功那一刻;codex = bootstrap 走命令行参数,以启动注入序列完成时刻计。(houseRules ① 要求开机立刻 register)
- 健康轮询里:过了 `expectRegisterBy` 且这期间没有任何该员工的 MCP 调用 → 标记失联嫌疑。
- resume 不设此期限(服务端代登记,员工本来就不会主动调工具)。
- 清除条件:touchMcp 命中、员工下线/移除、/restart(fresh 重置新期限,resume 不设)。
- 阈值 90s 取舍:API 限流重压下首回合可能超时 → 误报,但收到 register 即自愈,文案带"可能"。常量集中定义,不进配置(YAGNI)。

**A-2 有活无声**(覆盖:resume 后 MCP 失效、手动重启的裸 CLI、上下文死胡同)

- 投递消息时记投递时刻;之后该员工经**自动降闲路径**(健康轮询 `mark-idle`,即不是它自己调 idle 工具——两者最终都走 `router.onIdle`,区分在 index.ts 调用点做,router 不感知)回到空闲,且 `lastMcpAt < lastDeliverAt` → 哑巴嫌疑 +1。
- **前置守卫**:该员工确有投递记录(`lastDeliverAt` 存在)才计数——`observeBusy` 升忙再降闲的无投递场景不算。
- 连续 2 次 → 标记失联嫌疑。houseRules ④ 明确要求"完成任务或无实质内容时调用 idle 结束回合",所以正常员工处理完消息**必然**至少有一次 MCP 调用(sendmsg/idle/ask),不会误中;留 2 次余量防极端竞态。

### 呈现与自愈

- `AgentRuntime` 增加正交标志(如 `unresponsive: boolean`),**不**新增 AgentStatus 状态(忙闲与失联是两个维度)。
- 花名册:该员工名旁加 `⚠ 未报到/失联` 徽章(i18n)。
- 控制台消息区警告行(走现有诊断警告渲染):"⚠ {name} 启动后未报到/对消息无任何回应——它的 CLI 可能没挂上 falinks 工具(手动重启过?)或会话已瘫痪,试试 /restart {name}"。
- 诊断落盘:`appendDiag({ kind: 'agent-unresponsive', name, rule: 'register-timeout' | 'mute', ts })`。
- **边沿触发**:标志 false→true 转变时落一次 diag/警告行,不逐轮询重复刷;⚠ 徽章常驻直到自愈。
- **不阻断投递**:对 ⚠ 员工的消息照常排队/投递(boss 看到 ⚠ 自行决定 /restart),不改变路由语义。
- **自愈**:收到该员工任意 MCP 调用 → 清标志、清哑巴计数、清 expectRegisterBy(touchMcp 内顺带)。
- 排除:虚拟成员(boss)。

## B. /restart 命令

### 语义

- `/restart <name>`:关该员工 pane → 走 launchInto 同款链路重建。会话决策与正常启动一致(decideClaudeSession/decideCodexSession:有记录则 resume,即保留员工记忆)。
- `/restart <name> fresh`:先删 `store.agents[name]` 会话记录再重建 → 全新会话 + 注入 bootstrap(处置上下文死胡同/会话损坏)。
- pane 位置:重新从锚点 split,位置可能变化——接受,换实现稳定。

### 行为细节

- 员工在 router 中**不移除**:排队中的 inbox 消息保留,重启就绪、重新 register 后照常投递;重启期间状态回 `launching`(router 需要一个把现有员工置回 launching 的方法,launchInto 走"已存在则置 launching"变体而不是无条件 addAgent)。
- **关键竞态——必须加 `restarting` 守卫集合**(同现有 `clearing` 模式):closePane 之后到新 pane 建好之间,健康轮询会发现旧 sid 消失,连续 3 次(≈4.5s)就把员工 `removeAgent` 下线、inbox 全丢。重启期间该员工跳过轮询的"pane 消失下线"与忙闲校准。重入保护:`restarting` 与 `clearing` 互斥,重复 /restart 拒绝。
- 清理与重建:复用 onRemoveAgent 的清理项(missStreak/idleStreak/lastDeliverAt/哑巴计数/expectRegisterBy 一并清),sessions.set 指向新 sid;旧 sid 若是 lastRight 锚点则按现有规则复位。
- pane 染色下标:launchInto 现按 `roster().length` 算新员工下标,restart 时员工已在花名册会算错——变体按该员工现有 roster 下标取色,保持颜色不变。
- 配置文件不动(不是 /remove)。
- 入口:控制台命令 `/restart`(带补全)+ `/admin/restart` 端点(`{ name, fresh? }`)+ bus deps 增 `onRestartAgent`。
- 失败处理:pane 重建失败 → 返回错误显示在控制台,员工状态标 dead(与 pane 丢失路径一致),restarting 守卫务必 finally 清除。

## C. resume 死胡同

不做专门检测。A-2 告警文案中包含 `/restart {name} fresh` 提示,boss 一条命令处置。README/文档补充说明:手动重启员工 CLI 请改用 `/restart`。

## 改动文件清单(预估)

| 文件 | 改动 |
|---|---|
| `src/core/types.ts` | AgentRuntime 加 `unresponsive`、`lastMcpAt` |
| `src/core/router.ts` | `touchMcp()`(宽容未知名)、失联标志读写、置回 launching、roster 透出 |
| `src/bus/server.ts` | 各工具 handler 调 touchMcp;HTTP handler 记 lastMcpHttpAt;`/admin/restart`;deps.onRestartAgent |
| `src/index.ts` | expectRegisterBy 记录与轮询判定;哑巴计数;`restarting` 守卫集合;onRestartAgent 实现(closePane + launchInto 变体) |
| `src/console/app.tsx` + `log-format.ts` | ⚠ 徽章、警告行 |
| `src/console/commands.ts` | /restart 补全 |
| `src/i18n/zh.ts` `en.ts` | 徽章、警告(按 lastMcpHttpAt 分流两种文案)、命令帮助 |
| `src/session/store.ts` | (已有 delete 能力,fresh 用) |

## 测试要点

- touchMcp/失联标志/哑巴计数/置回 launching:纯逻辑单测(router);touchMcp 未知名不抛。
- A-1:bootstrap 交付后 90s 无调用 → unresponsive;期间任意工具调用 → 不触发/自愈;resume 不设期限;服务端代登记(resume 的 router.register)**不**触发 touchMcp。
- A-2:投递→自动降闲且零 MCP 调用 ×2 → unresponsive;自己调 idle → 计数清零;无投递的 observeBusy 降闲不计数。
- 边沿触发:unresponsive 持续期间 diag 只落一条。
- /restart:resume 语义(store 保留)、fresh 语义(store 删除)、inbox 保留、launching 状态、颜色不变;重启期间轮询不把员工误下线(restarting 守卫);失败路径 finally 清守卫。
- 回归:正常员工(register→sendmsg→idle)全程无 ⚠。

## 验收标准(对照事故)

重演事故场景:手动在员工 pane 起裸 claude → /clear 全员 → 90s 内控制台出现 ⚠ 与警告行;boss 执行 /restart lead → 员工带 MCP 配置重启、register 报到、⚠ 消失、排队消息送达。

## 实现后记(2026-06-10)

- /restart 失败的员工**留在花名册标 dead**(可再次 /restart 重试或 /remove 移除),与"pane 丢失即自动下线"路径有意不同——别"修"回去。
- 花名册徽章实现为纯红色 `⚠`,病因文案放在下方警告行(unresponsiveWarn,按 mcpSeen 分流),与 spec 措辞略异属有意取舍。
- codex 的 A-1 期限从进程启动起算(claude 从 bootstrap 注入成功起算),防 codex 快手 register 落在启动盲窗里。
