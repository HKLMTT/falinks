```
╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗
╠╣ ╠═╣║  ║║║║╠╩╗╚═╗
╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝
```

# falinks

**English** · [简体中文](README.zh-CN.md)

> A room full of AI workhorses — you just run your mouth 🐴

Orchestrate several terminal AI CLIs (Claude Code, Codex…) into **one office**: inside a single split iTerm2 window, each CLI is a "worker"; they talk to each other over an MCP bus and collaborate on tasks. On the left sits a console where you (the boss) watch the roster and message feed in real time, give orders, and add/remove workers.

The name comes from the Pokémon **Falinks** (a six-in-a-row formation): one leader marching a squad in coordination — exactly this project's model.

---

## What it does

- **One window = one office**: the iTerm window where you run `falinks` becomes the office — console on the left, worker panes tiled on the right. No extra windows.
- **Real and interruptible**: each worker is just a normal iTerm pane — you can type, scroll, or Ctrl-C to take over anytime, exactly like using the CLI yourself.
- **Workers talk to each other**: A calls `sendmsg` to B, falinks injects the message into B's pane; B replies when done — routing is automatic.
- **Team templates**: pick a preset team at startup (solo / pair / full-stack / research), or build a custom one on the spot and save it as your own template.
- **Mix CLIs**: both `claude` and `codex` can be workers.
- **Options mode (`ask` tool)**: a worker can use `ask(to, question, options)` to pose a choice — to the boss it renders as an **arrow picker** (↑↓ to select, Enter to answer) and the answer is routed back; to a peer it arrives as a numbered-options message.
- **Session resume**: close the window, run `falinks` again in the same directory and pick "continue current team" — each worker comes back with its prior conversation memory (`claude --resume`, `codex resume`). Session records live in `~/.falinks/sessions/`; switching teams starts fresh. Resume is silent (no redoing old tasks).
- **Persistent message history**: the feed is stored in `~/.falinks/messages/` (rolling cap); history survives restarts. The console message panel is multi-line, per-speaker colored, and timestamped.
- **No accidental broadcasts**: plain text only replies to "the last party you talked to"; `@all` broadcasts.
- **Urgent (cut-in) messages**: prefix with `!` to bypass the queue — delivered into the worker's pane immediately even while it's generating; queued messages can be promoted with `!` in the Esc overlay. Boss-only; workers always queue.
- **Add/remove workers at runtime** (console `/add` wizard), **`/clear` a worker's context** (identity auto-restored after), **auto-offline on window close**, **runaway guards** (turn cap / loop detection / throttle), and a **token-saving collaboration rule** (no pleasantries).
- **Per-agent model**: each worker can pin its own model (`model` in the config, or the `/add` wizard's model step — leave blank for the CLI default); passed as `claude --model` / `codex -m` and kept across restart/resume. Append Claude Code's `[1m]` suffix (e.g. `claude-opus-4-8[1m]`) for the 1M-context variant.
- **`/restart <name> [fresh]`**: relaunch a worker's CLI with the correct MCP config (`fresh` = brand-new session) — the right way to restart, instead of manually rerunning a CLI in the pane.
- **Unresponsive detection**: a worker that never registers (90s timeout) or goes silent (2× the auto-idle window) gets a red ⚠ badge in the roster plus a console warning, and self-heals on its next MCP call.
- **`/todo` unattended task list**: queue tasks (`add` / `list` / `rm` / `clear`), then `start [N]` to let the office grind through them while you're away — the lead reports each task via the `taskdone` tool, an idle nudge fires every N minutes (default 10, never gives up), failures don't stop the list, and a summary lands at the end. The list is persisted: after a restart it's paused until `/todo resume`.
- **Todo mode (lead-driven planning)**: tell the lead to "execute this in todo mode" while discussing requirements — after the breakdown is finalized it creates the list itself via the `todoplan` tool, asks you for approval (an `ask` with nudge-interval options), and only starts via `todostart` once you confirm. You keep full control: the roster line shows `📋 N queued, not started`, `/todo list` reviews it, and `stop`/`resume`/`rm`/`clear` remain boss-only commands. The lead can revise its own draft with `todoplan(replace:true)`.
- **Run multiple projects at once**: ports are auto-assigned; each project keeps its own runtime record (`~/.falinks/runtime/<hash>.json`); `falinks say/roster/log` find the matching instance by current directory; same-directory double-start is blocked.
- **Bilingual UI (i18n)**: UI text, CLI prompts, the startup wizard, and worker collaboration rules are fully bilingual. Defaults to your system language (locale starting with `zh` = Chinese, otherwise English); switch anytime with `/lang` in the console or `falinks lang`, persisted globally (`~/.falinks/settings.json`).

---

## Requirements (macOS only)

- macOS + **iTerm2** (`/Applications/iTerm.app`)
- Node ≥ 20
- At least one AI CLI: [`claude`](https://claude.com/claude-code) (Claude Code) and/or [`codex`](https://developers.openai.com/codex/cli)
- The first run triggers an "Automation" permission prompt — allow falinks to control iTerm.

## Install

```bash
npm install -g @hklmtt/falinks   # global install on macOS often needs sudo: sudo npm i -g @hklmtt/falinks
falinks doctor      # check your environment (Node / iTerm2 / claude / codex)
```

> The command is **`falinks`** (the package is scoped, but the command is just `falinks`). When a new version exists, the console **notifies** you of the update command (it never auto-updates).

## Quick start

`cd` into your project and type one word:

```bash
cd ~/your-project
falinks
```

**Every launch lets you pick a team** (↑↓ to select, Enter to confirm) — so each project can use a different team:

```
falinks — pick a team (↑↓ select · Enter confirm)
  ▶ continue current team (alice/bob)   ← default when a config exists; Enter to keep it
  Solo assistant (1)
  Pair programming (developer + reviewer) (2)
  Full-stack squad (lead + frontend + backend + QA) (4)
  Research group (researcher + writer + editor) (3)
  ＋ Custom team…
```

Once picked, the office spins up **in this one window**: console on the left, workers on the right. Picking a new team updates that directory's `falinks.config.json`; "continue current" keeps it. To wrap up: **Ctrl-C** in that window.

## Console

The console input box on the left (with autocomplete for both `@` and `/`):

| Input | Effect |
|---|---|
| `@alice take a look at login` | DM a worker |
| plain text (no `@`) | reply to "the last party you talked to" |
| `@all sync up everyone` | broadcast to all (**only `@all` broadcasts**, to avoid mistakes) |
| `!message` / `!@name message` / `!@all message` | **urgent send**: skips the queue and lands in the worker's pane immediately, even mid-generation (the CLI buffers it into the current turn); the feed shows ⚡. In the queued-messages overlay (Esc), press `!` to promote a queued message |
| `Shift+Enter` or `\` + Enter | newline in the input box (multi-line) |
| `Ctrl+V` | paste a clipboard screenshot (inserts `[Image N]`, expanded to a path for the worker to read on send) |
| `/add` | add a worker via wizard: **name → cli → model → role → working directory** (model blank = CLI default) |
| `/clear [name]` | clear a worker's context (no name = all); identity is re-injected and the worker stands by again |
| `/restart <name> [fresh]` | relaunch a worker's CLI with the correct MCP config (`fresh` = brand-new session) |
| `/todo …` | unattended task list: `add <content>` / `list` / `rm <seq>` / `clear` / `start [nudge-minutes]` / `stop` / `resume` |
| `/remove bob` | remove a worker (closes its pane) |
| `/help` | usage |
| `/lang` | switch UI language (中文 / English), takes effect immediately |
| `Ctrl-C` | quit (asks first whether to close all worker windows) |

> `Shift+Enter` works out of the box (kitty keyboard protocol; supported terminals like iTerm2 3.5+ get it directly); on unsupported terminals use `\` + Enter.

There are also scripting subcommands (from any terminal):

```bash
falinks say <agent> <message>   # DM as the "boss"
falinks broadcast <message>     # broadcast
falinks roster                  # roster + status
falinks log                     # message feed
falinks init                    # only generate/pick a config, don't launch
falinks doctor                  # environment self-check
falinks lang                    # switch UI language (set before launch)
```

## Config `falinks.config.json`

```jsonc
{
  "agents": [
    { "name": "alice", "cli": "claude", "cwd": ".", "role": "lead",    "bootstrap": "You coordinate and delegate.", "model": "claude-opus-4-8" },
    { "name": "bob",   "cli": "codex",  "cwd": ".", "role": "backend", "bootstrap": "You write the backend." }
  ],
  "routes": { "manager": "alice" },
  "guards": { "maxTurnsPerThread": 20, "maxInjectionsPerMinute": 30, "loopWindow": 3 }
}
```

- `cwd`: the worker's working directory (defaults to where you ran falinks; usually everyone shares it).
- `role` / `bootstrap`: the worker's role and opening setup.
- `model`: pin this worker's model (optional; omit for the CLI default). Passed as `claude --model` / `codex -m` and kept across restart/resume.
- `routes`: map a role alias to a specific worker (optional).
- `guards`: runaway protection (turn cap / messages-per-minute cap / repeat-loop breaker).
- `busPort` is optional; omit it and the OS assigns a free port (lets multiple projects run at once).

Saved custom-team templates live in `~/.falinks/templates/` and show up in the next picker.

## How it works

falinks runs an **MCP HTTP bus** in-process; each worker's CLI connects to `…/agent/<name>/mcp` (the sender is inferred from the path and can't be forged). Workers collaborate through the MCP tools `register / sendmsg / ask / idle / who`; the send direction goes through tool calls, while delivery is done by falinks injecting text into the target worker's pane (iTerm `write text`) to wake it. falinks also polls the screen to **detect when a worker is idle** and flushes queued messages (it doesn't rely on the worker self-reporting idle, so a worker interrupted with Ctrl-C still keeps receiving). All workers share one "collaboration rule" (register first, only reply with substance, no pleasantries, call idle to finish, use `ask` for choices) to save tokens.

## Known limitations

- macOS + iTerm2 only, single window / single tab.
- Workers run with `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`: this is a **local, single-user, mutually-trusted** collaboration scenario, **not a security sandbox** — a message from A to B is executed by B as an instruction. Do not use it on untrusted content.

## Contributing & releases

- CI runs on every push/PR (ubuntu + macOS × Node 20/24): typecheck, build, full test suite.
- Releases are automated: push a `v*` tag and GitHub Actions publishes to npm via Trusted Publishing (OIDC, no stored secrets, with provenance). See [`docs/RELEASE.md`](docs/RELEASE.md).

## License

MIT
