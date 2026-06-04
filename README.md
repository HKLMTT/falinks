# falinks

把多个终端 AI CLI（Claude Code、Codex…）编排成**一间办公室**：在分屏的真实 iTerm2 窗口里，每个 CLI 是一名“员工”，它们通过一条 MCP 总线互相对话、协作完成任务；左侧一个控制台让你（老板）实时看花名册、消息流水，并下达指令、增删员工。

> 名字来自宝可梦 **falinks（六合一队列）**：一个头目带着一队队员协同行动——正是本项目的模型。

## 它能做什么

- **一个 iTerm2 窗口 = 一间办公室**：左侧 falinks 控制台，右侧平铺各员工 pane。
- **真实可见、可手动干预**：每个员工就是普通 iTerm pane，你随时能打字、滚屏、接管。
- **员工之间互相对话**：A 用 `sendmsg` 发给 B，falinks 把消息注入 B 的窗口；B 处理后回复，全程自动路由。
- **多 CLI 混编**：claude、codex 都能当员工。
- **运行时增删员工**、**关窗自动下线**、**防失控护栏**（回合上限/循环检测/节流）、**省 token 协作规则**（禁寒暄客套）。

## 前置条件（仅 macOS）

- macOS + **iTerm2**（`/Applications/iTerm.app`）
- Node ≥ 20
- 至少一个 AI CLI：[`claude`](https://claude.com/claude-code)（Claude Code）和/或 [`codex`](https://developers.openai.com/codex/cli)
- 首次运行会弹“自动化”权限，请允许控制 iTerm

## 安装

```bash
npm install -g falinks
falinks doctor   # 自检环境
```

## 用法

```bash
falinks init     # 在当前目录生成 falinks.config.json 并建好员工目录
falinks up       # 起总线 + 开分屏窗口 + 启动员工（控制台在左 pane）
```

在左侧控制台输入框里：

| 输入 | 作用 |
|---|---|
| `@alice 帮我看下登录` | 私聊某员工 |
| `全体同步进度` | 群发（纯文本） |
| `/add` | 向导式加员工（选 cli、目录自动补全） |
| `/remove bob` | 删员工（关其 pane） |
| `/help` | 用法 |

`@` 和 `/` 都有自动补全。也有脚本式子命令：`falinks say <agent> <msg>` / `broadcast <msg>` / `roster` / `log`。

## 配置 `falinks.config.json`

```jsonc
{
  "busPort": 7878,
  "agents": [
    { "name": "alice", "cli": "claude", "cwd": "~/proj", "role": "manager", "bootstrap": "你负责统筹。" },
    { "name": "bob",   "cli": "codex",  "cwd": "~/proj", "role": "dev",     "bootstrap": "你负责写代码。" }
  ],
  "routes": { "manager": "alice" },
  "guards": { "maxTurnsPerThread": 20, "maxInjectionsPerMinute": 30, "loopWindow": 3 }
}
```

## 已知限制

- 仅 macOS + iTerm2，单窗口单 tab。
- 同一时间一套办公室（运行时状态写在 `~/.falinks/runtime.json`）。
- 员工以 `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` 运行：这是**本机互信**场景，不是安全沙箱。

## License

MIT
