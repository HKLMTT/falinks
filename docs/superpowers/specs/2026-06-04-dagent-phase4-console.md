# dagent Phase 4 — 控制台 + 分屏布局 + 运行时增删员工 设计

- 日期：2026-06-04
- 状态：spike 已验证布局机制，待写计划
- 依赖：Phase 1–3（已在 main）

## 1. 目标
一个 iTerm 窗口即完整驾驶舱：**左侧一个常驻控制台 pane（Ink TUI）**，**右侧平铺各员工 pane**。控制台显示花名册+状态、实时消息流水，并提供输入框（发消息 / 群发 / 增删员工）。员工可在运行时动态增减。

## 2. 布局（已 spike 验证）
```
┌──────────────┬───────────────────────────┐
│ dagent 控制台 │  alice (claude)           │
│ (Ink TUI)     ├───────────────────────────┤
│ ·花名册/状态  │  bob (codex)              │
│ ·消息流水     ├───────────────────────────┤
│ ·输入框       │  carol (claude)           │
└──────────────┴───────────────────────────┘
   左列固定宽       右列平铺，运行时可增减
```
构建顺序：建窗（console 占满）→ `console split vertically` 得右列首个 pane → 右列内 `split horizontally` 逐个堆叠员工。

## 3. Spike 结论（2026-06-04，cat 占位）
- ✅ `split vertically`（左右）/ `split horizontally`（上下），返回新 pane 的 session。
- ✅ pane 是 session，**现有 `findSession(id)` 遍历天然命中**；`inject`/`readScreen` 按 id 精确作用于单个 pane（注入只进目标、不串台）。
- ✅ 运行时再 `split` 加 pane 可行（4→5，新 id 即时可达）。
- ✅ `close (session)` 只关该 pane、窗口保留（= 删员工）；`close (window)` 关整窗（= 收工）。

## 4. 架构与改动

### 4.1 TerminalDriver 扩展
接口新增（FakeDriver + ITerm2Driver 各实现）：
- `splitFrom(anchorSessionId, direction: 'vertical'|'horizontal', opts: {cwd, command}): Promise<string>` — 从某 pane 切出新 pane、在其中 `cd && command`、返回新 session id。
- `closePane(sessionId): Promise<void>` — 关闭单个 pane（osascript `close s`）。
- 既有 `launch`（建新窗口）保留，用于建主窗口+控制台 pane。

### 4.2 布局构建（orchestrator / index）
- `launchAgentInto(anchor, spec): sessionId` — 从 anchor pane `splitFrom` 出员工 pane、起 CLI、记 sessionId、读屏处理信任对话+注入 bootstrap、等 register。**up 初始化与运行时 add 复用同一函数。**
- `up` 流程：建窗→console pane（`dagent console`）→ 记录右列 anchor → 对每个配置员工 `launchAgentInto`（首个从 console 竖分得右列，其余从上一个员工横分堆叠）。

### 4.3 Router 扩展
- `removeAgent(name)` — 从 roster 移除（用于删员工）；若有 inbox 一并丢弃 + 日志。
- 运行时 add 复用既有 `addAgent` + `register`。

### 4.4 Bus admin 路由扩展
- `POST /admin/add {name, cli, cwd, role?, bootstrap?}` → 调 BusDeps.onAddAgent 回调（orchestrator 提供）→ launchAgentInto + addAgent。
- `POST /admin/remove {name}` → 调 BusDeps.onRemoveAgent → closePane + router.removeAgent。
- BusDeps 增 `onAddAgent?(spec)`, `onRemoveAgent?(name)` 回调（由 index.ts 注入，bus 仍薄）。

### 4.5 控制台 TUI（`dagent console`，Ink）
跑在左 pane，通过 runtime 端口 + admin 路由工作：
- 轮询 `/admin/roster`（~1s）渲染**花名册+状态**（idle/busy/dead 配色）。
- 轮询 `/admin/log` 渲染**消息流水**（滚动，`from→to: body`）。
- **输入框**：
  - `@alice 文本` → POST /admin/say{to:alice}
  - 纯文本（不带@）→ POST /admin/broadcast
  - `/add <name> <cli> <cwd>` → POST /admin/add
  - `/remove <name>` → POST /admin/remove
  - `/help` 显示用法
- 左列默认宽度可配（如 40 列）。

## 5. CLI
- `dagent up [config]` → 起总线 + 建分屏窗口（含 console pane）+ 启动员工。
- `dagent console` → 仅启动 TUI（通常由 up 在 console pane 自动起，也可手动）。
- 既有 `say/broadcast/roster/log` 保留（脚本/调试用）。

## 6. 已知限制 / 非目标（本期不做）
- 仅 iTerm2 单窗口单 tab；多 tab/多窗口布局不做。
- 控制台为 TUI（终端内），非网页。
- 运行时 add 的 spec 通过控制台斜杠命令输入（无表单校验弹窗）；非法输入返回错误文本。
- 布局几何（pane 尺寸）用 iTerm 默认均分；精细比例控制（如 console 固定 40 列）尽力而为，列为可调项。
- 持久化、Codex 真实接入仍延后。

## 7. 待 spike/实现期验证
- [ ] Ink 在窄 iTerm pane 内的渲染与输入处理（实现期验证）。
- [ ] console pane 里跑 `dagent console`（tsx）的启动时序（up 注入命令后等其连 admin）。
- [ ] 左列宽度控制（iTerm split 后能否设 pane 宽/列数）。

## 8. 测试策略
- Driver pane 操作：FakeDriver 实现 splitFrom/closePane 记录调用；ITerm2Driver 真实 osascript 走集成 spike（已验证）。
- Router.removeAgent：单元测试。
- Admin add/remove 路由：HTTP 往返测试 + mock onAddAgent/onRemoveAgent 回调。
- 控制台 TUI：纯逻辑（输入解析 `@`/`/add` 等）抽成可单测函数；渲染走人工/半自动。
- 端到端：`up` 用 cat 占位员工建分屏 + 控制台，半自动冒烟（增删 pane、发消息）。
