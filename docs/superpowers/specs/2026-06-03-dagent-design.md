# dagent 设计文档

- 日期：2026-06-03（含同日 spike 实测结果）
- 状态：spike 已验证关键假设，待用户评审后转实现计划
- 平台：macOS（仅 iTerm2）

## 1. 目标与一句话定位

dagent 是一个常驻 Node 进程，把多个跑在**真实可见 iTerm2 窗口**里的 AI CLI（Claude Code、Codex 等）打通成一个"办公室"：每个 CLI 是一名员工，员工之间、以及员工与"老板"（人）之间，通过 dagent 这条总线收发消息、协作对话。

- **发送方向**：CLI 调用 dagent 暴露的 MCP 工具 `sendmsg`。
- **送达方向**：dagent 用 iTerm2 `write text` 把消息直接注入目标 CLI 的 session，唤醒它处理。
- **回传方向**：以 MCP 工具调用为主、**读屏抓取为兜底**（见 §5、§16，spike 已证读屏可行）。

## 2. 硬约束（来自用户，不可妥协）

1. **所有 CLI 窗口可见，且与正常 iTerm 操作完全没有区别**——用户可随时打字、滚屏、Ctrl-C、复制粘贴、手动干预，体验与平时直接用 iTerm 跑 `claude` 一致。
2. **员工之间能够通过 dagent 收发信息。**

这两条决定了载体必须是"真·普通 iTerm 窗口"（排除 tmux：它有状态栏/prefix 键/copy-mode，违反约束 1），且必须存在一条消息总线（满足约束 2）。

## 3. 关键技术决策与依据（已据 spike 更新）

| 决策 | 选择 | 依据 / spike 结论 |
|---|---|---|
| 终端载体 | **iTerm2 only**，每员工一个普通窗口直接跑 CLI | Terminal.app 注入/读屏能力弱；tmux 违反"与普通终端无区别" |
| 注入方式 | iTerm2 **`write text "<整条含 \n 的消息>"`**，禁用剪贴板/Cmd+V | ✅ **spike 实测**：`write text` 把行间 `\n` 发为 LF(0x0a)、末尾发 CR(0x0d)；Claude TUI 把 **LF 当插入换行、CR 当提交**，故一句话即可把多行消息一次性填入并提交，claude 确认按"一条消息"收到。避开了 bracketed-paste 卡死 bug |
| 回传方式 | MCP `sendmsg` 为主 + **osascript 读屏兜底** | ✅ **spike 实测**：`text of session` / `contents of session` 可直接读到窗口内容，纯 Node 即可，无需 Python。若 agent 不可靠地用工具回复，可读屏抓取回复 |
| 消息总线 | 单进程内一个 **HTTP/SSE（streamable HTTP）MCP server** | Claude Code 与 Codex 均支持远程 HTTP MCP client。✅ **spike 实测**：Codex 0.136 内置 `codex mcp add --url`，**无需 experimental flag**（老版本才需 `experimental_use_rmcp_client`） |
| 身份绑定 | 每员工连**带自身路径的总线 URL**（`/agent/<name>/mcp`），sender 由连接路径推断 | agent 只声明 `to`，无法伪造 `from` |
| 实现栈 | **TypeScript / Node + `osascript`** 驱动 iTerm | 注入、建窗、读屏均经 osascript 完成；spike 全程用 osascript 跑通 |
| 窗口句柄 | iTerm **session id**，但**需遍历 windows→tabs→sessions 匹配**取用 | ⚠️ **spike 实测**：iTerm 不支持 `session id "X"` 直接寻址（报 -1728），必须遍历查找。驱动里封装一个 `findSession(id)` |
| 就绪/前置对话 | 启动后先读屏处理前置对话，再注入 bootstrap | ⚠️ **spike 实测**：claude 首次进目录有"信任此文件夹"对话，必须先选择（注入 CR）才到主提示符。启动序列要读屏判断状态 |

## 4. 架构与组件

```
                       ┌──────────────────────────────────────────┐
                       │            dagent (单个 Node 进程)          │
  alice 的 CLI ──MCP──▶│  ① MCP 总线 (HTTP/SSE)                      │
  (iTerm 窗口)          │     /agent/alice/mcp  → sender=alice        │
                       │     工具: register / sendmsg / idle / who   │
  bob 的 CLI  ──MCP──▶ │            │                                │
  (iTerm 窗口)          │            ▼                                │
                       │  ② Router + 状态机                          │
  你(老板) ──CLI子命令─▶│     花名册 / 每 agent {state, inbox[]}      │
                       │     mesh 路由 + 角色规则 + 循环/预算防护     │
                       │            │                                │
                       │            ▼                                │
                       │  ③ iTerm 驱动 (osascript)                   │
                       │   launch / findSession / inject / readScreen│
                       └────────────┬───────────────────────────────┘
                                    │ AppleScript (osascript)
                          ┌─────────┴─────────┐
                          ▼                   ▼
                   iTerm 窗口 alice      iTerm 窗口 bob
                   (claude)              (codex)
```

四个组件，单一职责、可独立测试：

| # | 组件 | 职责 | 依赖 | 测试 |
|---|---|---|---|---|
| ① | **MCP 总线** `bus/` | HTTP MCP server，暴露 `register/sendmsg/idle/who`；按连接路径推断 sender | MCP TS SDK | MCP client mock 打工具调用 |
| ② | **Router/状态机** `core/` | 花名册、每 agent `state` 与 `inbox`；决定何时投递；角色路由；循环/预算防护；**服务端权威的 thread 派生** | 无（纯逻辑） | 纯函数 + 内存状态，单测 |
| ③ | **iTerm 驱动** `terminal/` | `launch`、`findSession(id)`、`inject(id,text)`、`readScreen(id)` | `osascript` | 接口 mock；真实注入走集成测 |
| ④ | **Orchestrator/配置** `index.ts` | 读配置、拼装①②③、生命周期、人入口 | 上面三者 | 注入 mock 驱动 |

**设计要点**：③ 是接口 `TerminalDriver { launch, findSession, inject, readScreen }`，当前实现 `ITerm2Driver`（osascript）。② 只调驱动接口，完全不知 GUI 细节——将来换驱动只动 ③。

## 5. 注入与读屏的实测配方（spike 产出）

**注入一条消息并提交**（已验证）：
```
osascript -> tell <matched session> to write text "<整条消息，行间用真实换行>"
```
默认 `newline YES` 会在末尾补 CR 完成提交；行间的 `\n` 被 Claude TUI 当作插入换行。**一次调用即可投递任意多行消息。**

**注入但不提交**（用于前置对话/拼装）：`write text "..." newline NO`，再单独 `write text "" newline YES` 发一个 CR 提交。

**注入前清空输入框**：⚠️ spike 发现 **Ctrl-U(char 21) 不能清空 Claude 输入框**，残留会与新消息拼接。实现时需找到可靠清空方式（候选：连续 backspace / Esc / 选择全部删除），并在动工前单独验证。

**读屏**：`text of session`（可见区）/ `contents of session`（含滚动区）。用于：① 启动时判断前置对话/就绪；② 回传兜底抓取 agent 回复；③ `stuck` 诊断。

**会话寻址**：iTerm 不支持按 id 直接寻址，`findSession(id)` 遍历 windows→tabs→sessions 比对 `id`。

## 6. MCP 工具面（员工侧）

`from` 一律由连接路径推断，不接受参数。

- `register()` —— 员工开机后调用，告知就绪。返回自身 name 与可对话 roster。
- `sendmsg(to: string, message: string)` —— 给某员工/角色发消息。`to` 可为员工名或角色名（角色经路由表解析）。**thread 不由 agent 传**，由 ② 服务端按对话图派生（见 §8）。
- `idle()` —— 员工本回合收尾、无更多动作时调用，释放 busy。
- `who()` —— 查询在线 roster（含 `boss`）及各自角色/状态。

**Prompt 约定**（写入每个员工 bootstrap）：开机先调 `register`；**收到形如「来自 X」的消息后，务必用 `sendmsg(to="X", ...)` 回复，不要只在本窗口里作答**；收尾调 `idle`。
> ⚠️ 这条"务必用 sendmsg 回复"是 B2 的核心风险：依赖模型在长上下文里持续遵守。**兜底**：dagent 在注入后读屏，若一段时间内目标既未调 `sendmsg` 也未 `idle`，抓取其窗口新增输出作为回复回传（读屏已证可行）。回传机制的最终形态（纯工具 / 工具+读屏兜底 / 纯读屏）在第 1 个实现里程碑用真实双 agent 闭环敲定。

## 7. 路由：mesh + 角色规则

- **底座 mesh**：任意员工可 `sendmsg` 任意员工，dagent 不持特权、不做内容裁决。
- **角色路由（可选）**：配置里一张规则表，把角色名解析为具体员工（如 `manager → alice`），或定义默认抄送/收件人。只是寻址糖，不改变 mesh 本质。

## 8. 循环 / 预算防护（v1 纳入，服务端权威）

- **thread 服务端派生**：dagent 维护"谁回了谁"的对话图，自己给每条消息打 `thread`，**不信 agent 传参**（避免 §S1 的不可靠依赖）。
- **回合上限**：每个 thread 累计注入超过 `maxTurnsPerThread`（默认 20）则熔断，向相关员工注入"此对话已达上限，请收尾"。
- **循环检测**：对 A↔B 乒乓做检测——同一对、短时间内、消息内容近似（归一化后编辑距离/哈希相近）或空内容达 K 次即熔断。具体相似度阈值在实现期标定。
- **全局节流**：`maxInjectionsPerMinute`（默认 30）防 token 爆炸。
- 所有熔断 `log` 明示，不静默丢消息。

## 9. 人作为参与者（v1 纳入）

dagent CLI 子命令，让"老板"以特殊成员 `boss` 参与（`boss` 出现在 `who()` roster 中）：

- `dagent say <agent> "<message>"` —— 以 boss 身份发消息（注入进该员工窗口）。
- `dagent broadcast "<message>"` —— 群发所有在线员工。
- `dagent roster` —— 查看花名册与状态。
- `dagent log [agent]` —— 查看消息流水（便于观察整个 mesh）。

员工回复 boss 时 `to="boss"`；boss 无 iTerm 窗口，回复落到 `dagent log` / CLI 输出，而非注入。

## 10. 错误处理与失败模式

| 失败 | 检测 | 处理 |
|---|---|---|
| 注入 osascript 失败 / `findSession` 未命中（窗口关了） | inject 返回错误 | 标 `dead`，停投，告警，inbox 保留 |
| 员工卡死（标 busy 但久无 `idle`） | 超时计时器 | 标 `stuck`，读屏诊断，告警；不永久阻塞其 inbox |
| 员工漏调 `idle` | 同上超时兜底 | 超时后视为 idle，投递下一条 |
| MCP 连接断开 | 总线连接事件 + **重连宽限**（避免把正常重连误杀） | 宽限内重连则保活，超时才标 `dead` |
| 人输入与注入交织 | 不可控（人随时打字） | **明确接受**：人输入不受 busy 锁约束，可能与注入交织——这是"可干预"的固有代价（§S3） |
| dagent 重启 | —— | v1 无持久化，状态/inbox 丢失（§13） |

## 11. 安全模型与告诫

- **信任边界**：dagent 假定**本机、单用户、互信的多 agent 场景**，**不是**安全沙箱。
- **prompt 注入风险**：员工很可能以 `--dangerously-skip-permissions`/`--yolo` 运行（否则审批弹窗卡住自动协作）。此时 A 发给 B 的文本会被 B 当指令执行——固有风险，文档显著告知，用户自担。
- **注入转义**：消息体当**不可信输入**，铁桶级 AppleScript 字符串转义（`"`、`\`、换行等）后才拼入 osascript。`write text` 比 `do script` 安全，但仍如此处理。
- ~~`dangerousCommandGuard`~~ **删除**：从自然语言消息识别"危险意图"不可靠，会给虚假安全感（§S5）。安全应靠"信任边界"声明，而非内容扫描。

## 12. 身份绑定与配置

**花名册配置**（`dagent.config.json` 草案）：
```jsonc
{
  "busPort": 7878,
  "agents": [
    { "name": "alice", "cli": "claude", "cwd": "~/projA", "role": "manager",
      "bootstrap": "你是 alice。开机调 register；收到「来自 X」消息务必用 sendmsg 回复 X；收尾调 idle。" },
    { "name": "bob", "cli": "codex", "cwd": "~/projB", "role": "dev", "bootstrap": "你是 bob。..." }
  ],
  "routes": { "manager": "alice" },
  "guards": { "maxTurnsPerThread": 20, "maxInjectionsPerMinute": 30 }
}
```
> 注：不同 agent 建议配**不同 `cwd`**，避免并发改同一仓库踩踏（§S4）。

**启动序列**（每个 agent）：起总线 → osascript 建 iTerm 窗口 → `cd <cwd> && <cli ...>`（带指向 `/agent/<name>/mcp` 的 MCP 配置）→ **读屏轮询**：若出现信任/onboarding 对话则注入相应选择；到主提示符后注入 bootstrap → 等待该 agent 调 `register`（带超时兜底）。

## 13. 已知限制

- 仅 macOS + iTerm2。
- 无持久化：dagent 重启丢失运行态。
- 首次运行需授予 iTerm/自动化（System Events）权限，无法在无人值守环境跳过。
- 员工单一线性上下文会混入跨人对话；thread 元数据缓解但不根治，长对话仍有上下文污染。
- 同 `cwd` 并发改文件会踩踏（建议不同 cwd；worktree 隔离为未来项）。
- 注入前清空输入框的可靠机制待实现期确定（Ctrl-U 无效）。

## 14. 测试策略

- **②Router/状态机**：纯逻辑单测——路由、inbox 纪律、状态迁移、thread 派生、循环/预算熔断（mock 驱动 + mock 时钟）。
- **①MCP 总线**：MCP client mock 验证四工具的 sender 推断与参数校验。
- **③iTerm 驱动**：契约测试用 fake；真实 `launch/inject/readScreen` 走半自动集成测试。spike 的 `raw-keylog.mjs` + osascript 注入/读屏脚本沉淀为驱动的回归基线。
- **端到端冒烟**：2 员工点对点 A→B→A 一轮（v1 验收基线，也是敲定回传机制的里程碑）。

## 15. v1 范围与分期

按构建顺序：

1. **最小闭环**（spine）：2 员工、点对点、`write text` 注入 + 读屏、`sendmsg` 路由 + `register/idle` + 总线身份绑定。**在此里程碑用真实双 agent 敲定回传机制（纯工具 vs 工具+读屏兜底）。** 验收：A↔B 一轮对话端到端成功。
2. **循环/预算防护**：服务端 thread 派生、回合上限、循环检测、节流（§8）。
3. **人作为参与者**：`dagent say/broadcast/roster/log`（§9）。

**v1 不做**：持久化、Terminal.app、3+ 大规模编排调优、Web UI、git worktree 隔离。

## 16. 假设验证状态

**spike 已验证（2026-06-03）：**
- [x] `write text` 多行注入：行间 LF=插入换行、末尾 CR=提交，claude 按一条多行消息接收。✅
- [x] osascript 读屏：`text`/`contents of session` 可读窗口内容，纯 Node 可行。✅
- [x] Codex 0.136 HTTP MCP client：内置 `codex mcp add --url`，无需 experimental flag。✅
- [x] iTerm 会话寻址需遍历匹配（不支持 `session id "X"`）。✅（已纳入设计）
- [x] 启动有前置对话（信任文件夹），需读屏处理后再注入。✅（已纳入设计）

**仍需在第 1 实现里程碑验证：**
- [ ] **B2 回传可靠性**：claude/codex 是否能被 bootstrap 可靠引导用 `sendmsg` 回复；不行则启用读屏兜底。需真实 MCP 总线方能测。
- [ ] Claude Code 连远程 HTTP 总线时按 per-agent URL 路径区分 sender 的稳定性（`claude mcp add --transport http` + 独立路径/header）。
- [ ] 注入前清空输入框的可靠机制。
- [ ] osascript 每次注入/读屏延迟与高频下的稳定性（量级 ~50–150ms）。
