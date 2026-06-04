# 会话恢复（Session Restore）设计

日期：2026-06-04 · 目标版本：0.2.3

## 1. 目标

团队跑起来后，每个 AI 员工（claude / codex）有自己的 CLI 会话。用户关掉窗口后，下次在**同一个项目目录**跑 `falinks` 并选「继续当前团队」，期望这些员工**带着上次的对话记忆**恢复，而不是从零开始。

## 2. 已验证的事实

- **claude** 支持启动时**指定** session id：`--session-id <uuid>`；恢复：`--resume <uuid>`。会话文件落在 `~/.claude/projects/<目录编码>/<session-id>.jsonl`，文件名即 id。
- **codex** 不能预设 id，但每个 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 首行 `session_meta` 带 `payload.id`（即 resume id）与 `payload.cwd`。恢复：`codex resume <id> [PROMPT]`。
- 两个 CLI 的 `/status` 都在屏上显示 session id（codex `Session:`、claude `Session ID:`）。

**未证实（实现时在 falinks 里实跑验证）**：`--resume` / `codex resume` 是否真把记忆带回（这是两 CLI 的核心功能，文档保证；headless `-p` 用户明确不让用、且单独计费/行为可能不同，网关鉴权在沙箱里也跑不通，故只能交互实测）。

## 3. 关键设计决策

### 3.1 拿 session id 的方式（按 CLI 分）

**只在「首次捕获」做。恢复时一律用 store 里存好的 id，不扫盘、不读屏。整套方案不含任何靠运气/竞态的猜测。**

| CLI | 首次捕获方式 | 理由 |
|-----|------|------|
| claude | 首启即 `--session-id <falinks 生成的 uuid>`，零读屏零捕获 | id 是我们自己定的，必然准 |
| codex | **仅 `/status` 读屏**：员工就绪后向**该 pane** 注入 `/status`，readScreen 正则抠 `Session:\s*<uuid>`。读不到 → **不捕获，直接当全新**（下次重开），**绝不猜** | `/status` 问 pane 它自己的 id，与盘上其它会话、与任何并发都无关，是唯一不靠运气的来源 |

**为什么不扫盘**：扫 `~/.codex/sessions` 取「新增/最新」本质是赌「这一瞬只有这一个 session 落地」。只要有别的程序同目录同时建会话，差集里就有多个，选哪个都是赌——而**赌错会把员工接到别人的会话上，比不恢复更糟**。故彻底不用扫盘。

**读不到时为何不兜底猜**：宁可丢一次记忆（安全降级为全新），也绝不冒「接错会话」的险。codex 能否恢复，**完全取决于 `driver.readScreen` 能否抓到 codex `/status` 的输出**（见 §7 spike）。

### 3.2 「同一个团队」的标识 = 启动目录

- key = `sha1(realpath(process.cwd()))` 前 16 hex；落盘 `~/.falinks/sessions/<key>.json`。
- 文件内同时存可读的 `cwd` 便于调试。
- 同目录再次启动 + 选「继续当前团队」（即 `cfg.agents` 名单不变）→ 按员工名查到 id → 恢复。
- 换模板 / 自定义团队 → 员工名变 → 查不到 → 全新；启动时把 store 裁剪到当前 `cfg.agents` 名单，旧名条目丢弃（“换团队 = 全新会话”）。

### 3.3 恢复时的注入：静默重连 + 一句话

恢复时总线是新进程（端口/注册都重来）。**不重发** HOUSE_RULES/角色 bootstrap，只注入一句：

```
【falinks 已恢复会话】总线已重连。请立刻重新调用 register 报到，然后待命；无需重述之前内容。
```

- claude 恢复：`needsBootstrapInject` 仍为 true，但注入的文本换成上面这句（而非完整 bootstrap）。
- codex 恢复：把这句作为 `codex resume <id> '<nudge>'` 的 PROMPT 位置参数传入，`needsBootstrapInject` 仍为 false。

### 3.4 兜底

任一环节失败 → 当作全新员工跑：
- codex `/status` 读屏没拿到 id → 不猜，该员工本次 sessionId 记为空，下次仍是全新。
- claude `--resume` 的会话文件不存在（按 3.5 自愈判定）→ 改用 `--session-id <新 uuid>` 全新跑。
- 非单窗口模式下 `console.log` 提示「X 未能恢复，已新开会话」；单窗口（进程内 Ink 控制台）模式不打印以免污染画面（员工会重新 register，花名册自然反映）。

### 3.5 claude 恢复/全新 的自愈判定

为避免「对一个已存在的 id 传 `--session-id` 报错」与「对不存在的 id 传 `--resume` 报错」：

```
stored = store.agents[name]            // {cli:'claude', sessionId}
if stored?.cli==='claude' && 文件存在(agent.cwd, stored.sessionId):
    恢复：--resume <stored.sessionId>
else:
    全新：生成新 uuid，--session-id <新 uuid>      // 全新永远用新 id，绝不复用旧 id 传 --session-id
落盘 store.agents[name] = {cli:'claude', sessionId: 本次用的 uuid}
```

`文件存在`：检查 `~/.claude/projects/<enc(cwd)>/<uuid>.jsonl`，其中 `enc(cwd) = realpath(cwd).replace(/[^a-zA-Z0-9]/g,'-')`（经样本验证：`/private/tmp/falinks-try8`→`-private-tmp-falinks-try8`、`/Users/liujia/工作/dagent`→`-Users-liujia----dagent`）。此判定仅为「避免 resume 报错」的启发式；编码若因 claude 内部改动失配，最坏退化为「当全新跑」，不崩。

## 4. 组件与改动

### 新增 `src/session/store.ts`
- `sessionStorePath(launchCwd): string` → `~/.falinks/sessions/<key>.json`
- `loadStore(launchCwd): { cwd: string; agents: Record<string, {cli: string; sessionId: string}> }`（不存在返回空壳）
- `saveStore(launchCwd, store)`、`pruneToAgents(store, names[])`
- 纯函数 + 注入 `homedir`/根路径便于测试。

### 新增 `src/session/capture.ts`
- `parseStatusSessionId(screen: string, cli: 'claude'|'codex'): string | null`
  - codex：`/Session:\s*([0-9a-fA-F-]{36})/`
  - claude：`/Session ID:\s*([0-9a-fA-F-]{36})/`
- `encodeClaudeProjectDir(cwd): string`、`claudeSessionExists(cwd, sessionId, homedir?): boolean`

### 改 `src/agent/mcp-config.ts`
`LaunchSpec` 增加可选：`sessionId?`（claude 全新时 `--session-id`）、`resume?: { sessionId: string }`。
- claude 全新：`claude --mcp-config X --dangerously-skip-permissions --session-id <uuid>`
- claude 恢复：`claude --mcp-config X --dangerously-skip-permissions --resume <uuid>`
- codex 全新：维持现状（bootstrap 作位置参数）
- codex 恢复：`codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox -c '…transport' -c '…url' resume <id> '<nudge>'`
  - **实现 spike**：确认全局 flag（`--no-alt-screen`/`--dangerously-bypass…`）能否置于 `resume` 子命令前、`-c` 与 `<id> <prompt>` 的位置。若不行，退化为 `codex resume <id> -c … '<nudge>'` 并用 `-c` 覆盖等价开关。

### 改 `src/index.ts`（`up`）
- 开头：`launchCwd = realpath(process.cwd())`；`store = loadStore(launchCwd)`；`pruneToAgents(store, cfg.agents.map(a=>a.name))`。
- `launchInto` 增参/返回：依 3.5 决定 claude 的 fresh/resume 与 uuid；codex fresh 分支在「信任对话盲发 Enter」之后注入 `/status` 读屏捕获 id（读不到则不捕获、当全新），resume 分支走 resume 命令 + nudge；返回 `{ sid, sessionId, cli }`。
- 每次 launchInto 后更新 `store.agents[name]` 并 `saveStore`（`onAddAgent` 动态加员工同样持久化）。
- 恢复路径注入文本用 `RECONNECT_NUDGE`（见 3.3）。

### `src/terminal/driver.ts`（如需）
codex `/status` 捕获要 readScreen（已有）；无新接口。FakeDriver 可预置「/status 屏内容」供测试 `parseStatusSessionId`。

## 5. 关键 spike / 风险（实现第一步先验，决定 codex 能否恢复）

1. **codex `/status` 读屏可行性（阻断性）**：在 falinks 实际启动模式（`--no-alt-screen`）下，注入 `/status` 后 `driver.readScreen` 能否抓到含 `Session:` 的内容。
   - **能** → codex 恢复可用。
   - **不能** → 本版 **codex 不支持恢复**（claude 照常支持）；不退扫盘（扫盘会赌错、接错会话）。届时 spec 据实降级，控制台对 codex 员工明示「暂不支持恢复」。
2. **codex resume flag 组合（非阻断）**：确认全局 flag 能否置于 `resume` 前、`-c` 与 `<id> <prompt>` 的位置；不行则退 `codex resume <id> -c … '<nudge>'` + `-c` 覆盖等价开关。

## 6. 测试（vitest，纯函数 + FakeDriver，不碰真 CLI/iTerm）
- store：save/load 往返、key 稳定、prune 行为。
- capture：`parseStatusSessionId`（codex/claude 样本屏）、`encodeClaudeProjectDir`（上面两个已知样本）、`claudeSessionExists`（临时目录建假 jsonl）。
- mcp-config：claude fresh 含 `--session-id <uuid>`、claude resume 含 `--resume <uuid>`、codex resume 含 `resume <id>` 与 nudge。

## 7. 实测验收（用户在能正常跑 CLI 的终端，非 `-p`）
1. 临时项目跑 `falinks`，建 1 claude + 1 codex，分别告诉各自一个暗号。
2. 关掉两个员工窗口。
3. 同目录再跑 `falinks` → 选「继续当前团队」。
4. 分别问暗号 → 都答得出 = 通过（codex 那项以 §5.1 spike 结果为准）。

## 8. 明确不做（YAGNI）
跨机器同步、会话列表管理 UI、claude `--fork-session`、自动清理过期会话文件、扫盘猜测会话。
