```
╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗
╠╣ ╠═╣║  ║║║║╠╩╗╚═╗
╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝
```

# falinks

[English](README.md) · **简体中文**

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
- **选项模式（ask 工具）**：员工可用 `ask(to, question, options)` 出选择题——发给老板时控制台渲染成**箭头 picker**（↑↓ 选、Enter 回复），答案注回提问员工；发给同事则对方收到带编号选项的消息。
- **会话恢复**：关窗后同目录再跑 `falinks`、选「继续当前团队」，每个员工带着上次的对话记忆接着干（claude `--resume`、codex `codex resume`）；会话档存在 `~/.falinks/sessions/`，换团队即全新。恢复是静默的（不重做旧任务）。
- **消息历史持久化**：消息流水存在 `~/.falinks/messages/`（滚动上限），重启后历史还在；控制台消息面板分块多行、按人配色、带时间戳。
- **防误群发**：纯文本只回复「上一次对话的对方」，`@all` 才群发。
- **插队消息**：句首 `!` 跳过队列直接送达——员工生成中也立即进它的输入缓冲；已排队的消息在 Esc 浮层按 `!` 提升直送。仅 boss 可插队，员工互发照常排队。
- **运行时增删员工**（控制台 `/add` 向导）、**`/clear` 清空员工上下文**（清后自动恢复身份）、**关窗自动下线**、**防失控护栏**（回合上限 / 循环检测 / 节流）、**省 token 协作规则**（禁寒暄客套）。
- **`/todo` 无人值守任务清单**：把任务排进队列（`add` / `list` / `rm` / `clear`），`start [N]` 后你人走开，办公室自己把清单啃完——组长用 `taskdone` 工具逐条上报，空闲每 N 分钟巡查一次（默认 10，不放弃），单条失败不停整张清单，跑完发总结。清单持久化：重启后暂停，`/todo resume` 继续。团队在等长脚本/CI 时，组长可调 `taskwait(seq, minutes, reason)` 声明等待、暂停巡查（上限 120 分钟，控制台进度行可见）；无果巡查按 10→20→40→60 分钟指数退避（封顶），第 3 次无果向消息流告警——任务做完没关闭/在等外部时，不再整夜每 10 分钟摇醒大上下文组长。
- **多项目同时跑**：端口自动分配，每个项目独立一份运行时档案（`~/.falinks/runtime/<hash>.json`）；`falinks say/roster/log` 按当前目录自动找到对应实例；同目录防双开。
- **中英双语（i18n）**：界面、CLI 提示、启动向导、员工协作规则全量双语。默认跟随系统语言（`zh` 开头=中文，否则英文）；控制台 `/lang` 或 `falinks lang` 随时切换，设置全局持久化（`~/.falinks/settings.json`）。

---

## 前置条件（仅 macOS）

- macOS + **iTerm2**（`/Applications/iTerm.app`）
- Node ≥ 20
- 至少一个 AI CLI：[`claude`](https://claude.com/claude-code)（Claude Code）和/或 [`codex`](https://developers.openai.com/codex/cli)
- 首次运行会弹"自动化"权限，请允许 falinks 控制 iTerm

## 安装

```bash
npm install -g @hklmtt/falinks   # macOS 全局安装通常需 sudo：sudo npm i -g @hklmtt/falinks
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
| 直接打字（不带 @） | 回复「上一次对话的对方」 |
| `@all 全体同步进度` | 群发全员（**只有 `@all` 才群发**，防误操作） |
| `!消息` / `!@名字 消息` / `!@all 消息` | **插队直送**：跳过排队立即注入员工 pane，生成中也直送（CLI 缓冲进当前回合；全角 `！` 也可）；消息流标 ⚡。Esc 排队浮层里按 `!` 可把已排队消息提升直送 |
| `Shift+回车` 或 `\` + 回车 | 输入框换行（多行输入） |
| `Ctrl+V` | 粘贴剪贴板截图（插入 `[图片N]`，发送时展开成路径给员工读） |
| `/add` | 向导式加员工：**名字 → cli → 角色/职责 → 工作目录** |
| `/clear [名字]` | 清空某员工上下文（不带名=全员）；清后自动重注入身份、重新待命 |
| `/todo …` | 无人值守任务清单：`add <内容>` / `list` / `rm <序号>` / `clear` / `start [巡查分钟]` / `stop` / `resume` |
| `/remove bob` | 删员工（关其 pane） |
| `/help` | 用法 |
| `/lang` | 切换界面语言（中文 / English），即时生效 |
| `Ctrl-C` | 退出（先问是否关闭所有员工窗口） |

> `Shift+回车` 开箱即用（启用 kitty 键盘协议，支持的终端如 iTerm2 3.5+ 直接生效）；不支持的终端用 `\` + 回车换行。

也有脚本式子命令（在任意终端）：

```bash
falinks say <agent> <消息>     # 以"老板"身份私聊
falinks broadcast <消息>        # 群发
falinks roster                  # 花名册 + 状态
falinks log                     # 消息流水
falinks init                    # 仅生成/选择配置，不启动
falinks doctor                  # 环境自检
falinks lang                    # 切换界面语言（启动前设置）
```

## 配置 `falinks.config.json`

```jsonc
{
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
- `busPort`：可选；不写则由系统自动分配空闲端口（这样多个项目能同时跑）。

自定义团队保存的模板在 `~/.falinks/templates/`，下次选单里就会出现。

## 它怎么工作

falinks 进程内跑一个 **MCP HTTP 总线**，每个员工的 CLI 连到 `…/agent/<name>/mcp`（sender 由路径推断，不可伪造）。员工通过 `register / sendmsg / ask / idle / who` 这几个 MCP 工具协作；发送方向走工具调用，送达方向由 falinks 用 iTerm `write text` 注入目标员工窗口来唤醒它。falinks 还会轮询读屏**自动识别员工已空闲**，把排队消息投出去（不依赖员工自报 idle，员工被 Ctrl-C 打断也能继续收消息）。所有员工共享一份"协作规则"（先 register、有实质内容才回、禁客套、收尾 idle、出选择题用 ask）以省 token。

## 已知限制

- 仅 macOS + iTerm2，单窗口单 tab。
- 员工以 `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` 运行：这是**本机、单用户、互信**的协作场景，**不是安全沙箱**——A 发给 B 的消息会被 B 当指令执行，请勿在不可信内容上使用。

## 贡献与发布

- 每次 push/PR 都跑 CI（ubuntu + macOS × Node 20/24）：类型检查、构建、全量测试。
- 发布自动化：打 `v*` tag，GitHub Actions 经 Trusted Publishing（OIDC，无长期密钥，带 provenance 溯源）发到 npm。详见 [`docs/RELEASE.md`](docs/RELEASE.md)。

## License

MIT
