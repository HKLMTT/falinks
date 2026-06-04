```
╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗
╠╣ ╠═╣║  ║║║║╠╩╗╚═╗
╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝
```

# falinks

> 一屋 AI 牛马，您只管动嘴 🐴

把多个终端 AI CLI（Claude Code、Codex…）编排成**一间办公室**：在一个分屏的真实 iTerm2 窗口里，每个 CLI 是一名"员工"，它们通过一条 MCP 总线互相对话、协作完成任务；左侧是一个控制台，你（老板）在那儿实时看花名册、消息流水，并下指令、增删员工。

名字取自宝可梦 **Falinks（六合一队列）**：一个头目带着一队队员协同行动——正是本项目的模型。

---

## 它能做什么

- **一个窗口 = 一间办公室**：你运行 `falinks` 的那个 iTerm 窗口直接变成办公室——左侧控制台，右侧平铺各员工 pane，不再多弹窗口。
- **真实、可干预**：每个员工就是普通 iTerm pane，你随时能打字、滚屏、Ctrl-C 接管，和平时用 CLI 一样。
- **员工互相对话**：A 用 `sendmsg` 发给 B，falinks 把消息注入 B 的窗口；B 处理后回复，全程自动路由。
- **团队模板**：启动时选预设团队（单人 / 结对 / 全栈 / 调研），或现场自定义并存成你自己的模板。
- **多 CLI 混编**：claude、codex 都能当员工。
- **运行时增删员工**（控制台 `/add` 向导）、**关窗自动下线**、**防失控护栏**（回合上限 / 循环检测 / 节流）、**省 token 协作规则**（禁寒暄客套）。

---

## 前置条件（仅 macOS）

- macOS + **iTerm2**（`/Applications/iTerm.app`）
- Node ≥ 20
- 至少一个 AI CLI：[`claude`](https://claude.com/claude-code)（Claude Code）和/或 [`codex`](https://developers.openai.com/codex/cli)
- 首次运行会弹"自动化"权限，请允许 falinks 控制 iTerm

## 安装

```bash
npm install -g @liujia307/falinks   # macOS 全局安装通常需 sudo：sudo npm i -g @liujia307/falinks
falinks doctor      # 自检环境（Node / iTerm2 / claude / codex）
```

> 命令名是 **`falinks`**（包名带作用域，但命令就是 `falinks`）。有新版时控制台会**提示**你执行更新命令（不会自动更新）。

## 快速开始

`cd` 到你的项目目录，敲一个词：

```bash
cd ~/your-project
falinks
```

**每次启动都会让你选团队**（↑↓ 选，Enter 确认）——这样每个项目都能用不同团队：

```
falinks — 选择团队（↑↓ 选 · Enter 确认）
  ▶ 继续当前团队（alice/bob）   ← 已有配置时默认在这，回车即沿用
  单人助手（1 人）
  结对编程（开发者+审查者）（2 人）
  全栈小组（组长+前端+后端+测试）（4 人）
  调研组（调研员+撰写+审校）（3 人）
  ＋ 自定义团队…
```

选完，**这一个窗口**里就起好办公室：左控制台 + 右员工。选了新团队会更新该目录的 `falinks.config.json`；选「继续当前」则沿用。收工：在该窗口 **Ctrl-C**。

## 控制台

左侧控制台输入框（`@` 和 `/` 都有自动补全）：

| 输入 | 作用 |
|---|---|
| `@alice 帮我看下登录` | 私聊某员工 |
| `全体同步进度` | 群发（纯文本，不带 @） |
| `/add` | 向导式加员工：**名字 → cli → 角色/职责 → 工作目录** |
| `/remove bob` | 删员工（关其 pane） |
| `/help` | 用法 |

也有脚本式子命令（在任意终端）：

```bash
falinks say <agent> <消息>     # 以"老板"身份私聊
falinks broadcast <消息>        # 群发
falinks roster                  # 花名册 + 状态
falinks log                     # 消息流水
falinks init                    # 仅生成/选择配置，不启动
falinks doctor                  # 环境自检
```

## 配置 `falinks.config.json`

```jsonc
{
  "busPort": 7878,
  "agents": [
    { "name": "alice", "cli": "claude", "cwd": ".", "role": "组长", "bootstrap": "你负责统筹分配。" },
    { "name": "bob",   "cli": "codex",  "cwd": ".", "role": "后端", "bootstrap": "你负责写后端。" }
  ],
  "routes": { "manager": "alice" },
  "guards": { "maxTurnsPerThread": 20, "maxInjectionsPerMinute": 30, "loopWindow": 3 }
}
```

- `cwd`：员工的工作目录（默认 = 你运行 falinks 的目录，多数情况大家同目录）。
- `role` / `bootstrap`：员工的角色与开场设定。
- `routes`：把角色别名映射到具体员工（可选）。
- `guards`：防失控护栏（回合上限 / 每分钟消息上限 / 连续重复熔断）。

自定义团队保存的模板在 `~/.falinks/templates/`，下次选单里就会出现。

## 它怎么工作

falinks 进程内跑一个 **MCP HTTP 总线**，每个员工的 CLI 连到 `…/agent/<name>/mcp`（sender 由路径推断，不可伪造）。员工通过 `register / sendmsg / idle / who` 四个 MCP 工具协作；发送方向走工具调用，送达方向由 falinks 用 iTerm `write text` 注入目标员工窗口来唤醒它。所有员工共享一份"协作规则"（先 register、有实质内容才回、禁客套、收尾 idle）以省 token。

## 已知限制

- 仅 macOS + iTerm2，单窗口单 tab。
- 同一时间一套办公室（运行时状态写在 `~/.falinks/runtime.json`，固定端口）。
- 员工以 `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` 运行：这是**本机、单用户、互信**的协作场景，**不是安全沙箱**——A 发给 B 的消息会被 B 当指令执行，请勿在不可信内容上使用。

## License

MIT
