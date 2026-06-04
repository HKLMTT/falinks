# 会话恢复（Session Restore）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关窗后再次在同一项目目录跑 `falinks` 并选「继续当前团队」，让每个 claude/codex 员工带着上次会话记忆恢复。

**Architecture:** claude 启动即用 `--session-id <uuid>` 预设确定性 id、恢复用 `--resume`；codex 无法预设，仅靠就绪后向其 pane 注入 `/status` 读屏抓 id，读不到则降级为全新（绝不扫盘猜测）。每个项目目录一份 `~/.falinks/sessions/<key>.json` 存 `{员工名:{cli,sessionId}}`，恢复时直接用存好的 id。

**Tech Stack:** Node ESM + TypeScript，vitest，既有 `FakeDriver` 测试替身，iTerm2 driver。

设计依据：`docs/superpowers/specs/2026-06-04-session-restore-design.md`。

---

## Task 1: Spike — 确认 codex `/status` 能被 readScreen 抓到（阻断 codex 恢复）

**这是唯一决定 codex 能否恢复的实验，必须先做。** 不写代码，手动在能正常跑 codex 的终端实测。

- [ ] **Step 1: 起一个 codex（falinks 实际启动模式）**

```bash
cd /tmp && rm -rf cdxspike && mkdir cdxspike && cd cdxspike
codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox
```
进去后（信任对话按 Enter 接受），输入 `/status`，确认屏上出现 `Session: <uuid>`。

- [ ] **Step 2: 用和 driver 相同的方式读屏**

另开一个终端，找到该 codex 的 iTerm session id（`echo $ITERM_SESSION_ID` 在那个 pane 里看冒号后部分），然后：
```bash
osascript -e 'tell application "iTerm2" to repeat with w in windows
  repeat with t in tabs of w
    repeat with s in sessions of t
      if (id of s) is "粘贴UUID" then return (contents of s)
    end repeat
  end repeat
end repeat'
```
**期望**：输出文本里能看到 `Session: <uuid>`。

- [ ] **Step 3: 裁决并记录**

- 能读到 → 在 spec §5.1 标注「spike 通过，codex 恢复启用」，继续后续任务。
- 读不到 → 在 spec §5.1 标注「codex 读屏失败，本版 codex 不支持恢复」。则后续 Task 5 的 codex resume 分支仍实现（无害），但 Task 6 中 codex **永远走 fresh 且不尝试捕获**（`decideCodexSession` 永远返回 fresh、不注入 /status），claude 恢复照常。

---

## Task 2: `src/session/capture.ts` — 解析 /status、claude 会话文件判定

**Files:**
- Create: `src/session/capture.ts`
- Test: `tests/session/capture.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/session/capture.test.ts`:
```ts
import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStatusSessionId, encodeClaudeProjectDir, claudeSessionExists } from '../../src/session/capture.js';

const CODEX_STATUS = `>_ OpenAI Codex (v0.137.0)
  Directory:      ~/工作/dagent
  Session:        019e92f3-c07b-7711-b509-fdf38f98ae14
  Token usage:    0 total`;

const CLAUDE_STATUS = `Settings  Status  Config
  Version:     2.1.162
  Session ID:  5bce55fd-00c9-4348-a876-ab07332b3229
  cwd:         /Users/liujia/工作/porygon`;

test('parses codex /status session id', () => {
  expect(parseStatusSessionId(CODEX_STATUS, 'codex')).toBe('019e92f3-c07b-7711-b509-fdf38f98ae14');
});

test('parses claude /status session id', () => {
  expect(parseStatusSessionId(CLAUDE_STATUS, 'claude')).toBe('5bce55fd-00c9-4348-a876-ab07332b3229');
});

test('codex matcher does not pick up claude "Session ID:" line', () => {
  expect(parseStatusSessionId(CLAUDE_STATUS, 'codex')).toBeNull();
});

test('returns null when no id present', () => {
  expect(parseStatusSessionId('nothing here', 'codex')).toBeNull();
});

test('encodeClaudeProjectDir replaces every non-alnum with dash (known samples)', () => {
  expect(encodeClaudeProjectDir('/private/tmp/falinks-try8')).toBe('-private-tmp-falinks-try8');
  expect(encodeClaudeProjectDir('/Users/liujia/工作/dagent')).toBe('-Users-liujia----dagent');
});

test('claudeSessionExists true only when <id>.jsonl is under the encoded project dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const cwd = '/private/tmp/proj-x';
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}');
  expect(claudeSessionExists(cwd, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(true);
  expect(claudeSessionExists(cwd, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/session/capture.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`src/session/capture.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** 从一屏 /status 文本里抠 session id。codex 行首是 `Session:`，claude 是 `Session ID:`。读不到返回 null。 */
export function parseStatusSessionId(screen: string, cli: 'claude' | 'codex'): string | null {
  const label = cli === 'codex' ? 'Session' : 'Session ID';
  const m = screen.match(new RegExp(`${label}:\\s*(${UUID})`));
  return m ? m[1].toLowerCase() : null;
}

/** claude 把每个项目的会话存在 ~/.claude/projects/<编码 cwd>/ 下，编码=把非字母数字全替成 '-'。 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 该 cwd 下是否已存在某 session id 的 jsonl（决定 claude 用 --resume 还是 --session-id，避免 resume 报错）。 */
export function claudeSessionExists(cwd: string, sessionId: string, home = homedir()): boolean {
  return existsSync(join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`));
}
```

> 注意：codex 的 `Session:` 正则不会误命中 claude 的 `Session ID:`（因为后者 `Session` 后面是空格+`ID`，不是 `:`）。测试已覆盖。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/session/capture.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/session/capture.ts tests/session/capture.test.ts
git commit -m "feat(session): /status 解析 + claude 会话文件判定"
```

---

## Task 3: `src/session/store.ts` — 每项目会话存档

**Files:**
- Create: `src/session/store.ts`
- Test: `tests/session/store.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/session/store.test.ts`:
```ts
import { expect, test } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, saveStore, pruneToAgents, sessionStorePath } from '../../src/session/store.js';

test('sessionStorePath is stable for the same cwd and under sessions/', () => {
  const root = '/x/.falinks';
  const a = sessionStorePath('/proj/foo', root);
  const b = sessionStorePath('/proj/foo', root);
  expect(a).toBe(b);
  expect(a.startsWith(join(root, 'sessions'))).toBe(true);
  expect(a.endsWith('.json')).toBe(true);
  expect(sessionStorePath('/proj/bar', root)).not.toBe(a);
});

test('load on missing file returns empty store; save then load round-trips', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-root-'));
  const cwd = '/proj/foo';
  expect(loadStore(cwd, root)).toEqual({ cwd, agents: {} });

  const store = { cwd, agents: { alice: { cli: 'claude', sessionId: 'id-1' } } };
  saveStore(cwd, store, root);
  expect(existsSync(sessionStorePath(cwd, root))).toBe(true);
  expect(loadStore(cwd, root)).toEqual(store);
});

test('load tolerates corrupt json -> empty store', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-root-'));
  const cwd = '/proj/foo';
  saveStore(cwd, { cwd, agents: { a: { cli: 'codex', sessionId: 'x' } } }, root);
  // 覆写成坏 json
  writeFileSync(sessionStorePath(cwd, root), '{ broken');
  expect(loadStore(cwd, root)).toEqual({ cwd, agents: {} });
});

test('pruneToAgents drops entries whose name is not in the current team', () => {
  const store = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: '1' }, bob: { cli: 'codex', sessionId: '2' } } };
  pruneToAgents(store, ['alice']);
  expect(store.agents).toEqual({ alice: { cli: 'claude', sessionId: '1' } });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/session/store.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`src/session/store.ts`:
```ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir } from '../runtime.js';

export interface AgentSession { cli: string; sessionId: string; }
export interface SessionStore { cwd: string; agents: Record<string, AgentSession>; }

/** 每个项目目录一份存档：~/.falinks/sessions/<cwd 的 sha1 前16位>.json。root 可注入便于测试。 */
export function sessionStorePath(launchCwd: string, root = runtimeDir()): string {
  const key = createHash('sha1').update(launchCwd).digest('hex').slice(0, 16);
  return join(root, 'sessions', `${key}.json`);
}

/** 读存档；不存在或损坏都返回空壳。 */
export function loadStore(launchCwd: string, root = runtimeDir()): SessionStore {
  const p = sessionStorePath(launchCwd, root);
  if (!existsSync(p)) return { cwd: launchCwd, agents: {} };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return { cwd: launchCwd, agents: data.agents ?? {} };
  } catch {
    return { cwd: launchCwd, agents: {} };
  }
}

/** 写存档（自动建目录）。 */
export function saveStore(launchCwd: string, store: SessionStore, root = runtimeDir()): void {
  const p = sessionStorePath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(store, null, 2));
}

/** 把存档裁剪到当前团队名单（换团队后旧员工的会话作废）。 */
export function pruneToAgents(store: SessionStore, names: string[]): void {
  for (const name of Object.keys(store.agents)) {
    if (!names.includes(name)) delete store.agents[name];
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/session/store.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): 每项目会话存档 load/save/prune"
```

---

## Task 4: `src/session/decide.ts` — fresh/resume 决策（纯函数）

**Files:**
- Create: `src/session/decide.ts`
- Test: `tests/session/decide.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/session/decide.test.ts`:
```ts
import { expect, test } from 'vitest';
import { decideClaudeSession, decideCodexSession } from '../../src/session/decide.js';
import type { SessionStore } from '../../src/session/store.js';

const gen = () => 'new-uuid-0000';

test('claude: no stored entry -> fresh with a new uuid', () => {
  const store: SessionStore = { cwd: '/p', agents: {} };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => false))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('claude: stored entry + session file exists -> resume with stored id', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: 'old-id' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => true))
    .toEqual({ mode: 'resume', sessionId: 'old-id' });
});

test('claude: stored entry but file missing -> fresh with NEW uuid (never reuse old id for --session-id)', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: 'old-id' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => false))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('claude: stored entry is codex (cli changed) -> fresh', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'codex', sessionId: 'x' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => true))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('codex: stored entry -> resume; otherwise fresh', () => {
  const withId: SessionStore = { cwd: '/p', agents: { bob: { cli: 'codex', sessionId: 'cid' } } };
  expect(decideCodexSession(withId, 'bob')).toEqual({ mode: 'resume', sessionId: 'cid' });
  expect(decideCodexSession({ cwd: '/p', agents: {} }, 'bob')).toEqual({ mode: 'fresh' });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/session/decide.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`src/session/decide.ts`:
```ts
import type { SessionStore } from './store.js';
import { claudeSessionExists } from './capture.js';

export interface ClaudeDecision { mode: 'resume' | 'fresh'; sessionId: string; }
export type CodexDecision = { mode: 'resume'; sessionId: string } | { mode: 'fresh' };

/**
 * claude：有存档且对应会话文件还在 → resume 旧 id；否则 fresh 用新生成的 uuid。
 * fresh 永远用新 uuid，绝不把旧 id 拿去传 --session-id（会报「已存在」）。
 */
export function decideClaudeSession(
  store: SessionStore,
  name: string,
  agentCwd: string,
  genUuid: () => string,
  sessionExists: (cwd: string, id: string) => boolean = claudeSessionExists,
): ClaudeDecision {
  const stored = store.agents[name];
  if (stored?.cli === 'claude' && sessionExists(agentCwd, stored.sessionId)) {
    return { mode: 'resume', sessionId: stored.sessionId };
  }
  return { mode: 'fresh', sessionId: genUuid() };
}

/** codex：有存档就 resume 那个 id；否则 fresh（fresh 时由 /status 现场捕获 id）。 */
export function decideCodexSession(store: SessionStore, name: string): CodexDecision {
  const stored = store.agents[name];
  if (stored?.cli === 'codex') return { mode: 'resume', sessionId: stored.sessionId };
  return { mode: 'fresh' };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/session/decide.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/session/decide.ts tests/session/decide.test.ts
git commit -m "feat(session): fresh/resume 决策纯函数"
```

---

## Task 5: 扩展 `buildAgentLaunch` 支持 --session-id / --resume / codex resume

**Files:**
- Modify: `src/agent/mcp-config.ts`（`LaunchSpec`、`buildAgentLaunch`）
- Modify: `tests/agent/mcp-config.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**

在 `tests/agent/mcp-config.test.ts` 末尾追加：
```ts
test('claude fresh: includes --session-id when sessionId given', () => {
  const r = buildAgentLaunch('claude', { ...spec, sessionId: 'uuid-fresh' });
  expect(r.command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions --session-id uuid-fresh');
});

test('claude resume: includes --resume and NOT --session-id', () => {
  const r = buildAgentLaunch('claude', { ...spec, resumeId: 'uuid-resume' });
  expect(r.command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions --resume uuid-resume');
});

test('codex resume: uses resume <id> with bootstrap (nudge) as prompt', () => {
  const r = buildAgentLaunch('codex', { ...spec, resumeId: 'cid-1', bootstrap: '【falinks 已恢复会话】请重新 register。' });
  expect(r.command).toContain('resume cid-1');
  expect(r.command).toContain("'【falinks 已恢复会话】请重新 register。'");
  expect(r.command).toContain('--no-alt-screen');
  expect(r.needsBootstrapInject).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/agent/mcp-config.test.ts`
Expected: FAIL（新 3 个用例，旧的仍过）。

- [ ] **Step 3: 写实现**

改 `src/agent/mcp-config.ts`：`LaunchSpec` 增字段，`buildAgentLaunch` 两个 case 加分支。

`LaunchSpec` 接口替换为：
```ts
export interface LaunchSpec {
  name: string;
  busPort: number;
  mcpConfigPath: string; // claude 用
  bootstrap: string;     // 首启=完整 bootstrap；恢复=重连提示语
  sessionId?: string;    // claude 首启：--session-id（确定性 id）
  resumeId?: string;     // 恢复：claude --resume / codex resume <id>
}
```

`buildAgentLaunch` 两个 case 替换为：
```ts
    case 'claude': {
      const tail = spec.resumeId
        ? ` --resume ${spec.resumeId}`
        : spec.sessionId
          ? ` --session-id ${spec.sessionId}`
          : '';
      return {
        command: `claude --mcp-config ${spec.mcpConfigPath} --dangerously-skip-permissions${tail}`,
        needsBootstrapInject: true,
      };
    }
    case 'codex': {
      const url = busUrl(spec.name, spec.busPort);
      const base =
        `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox` +
        ` -c 'mcp_servers.falinks.transport="streamable_http"'` +
        ` -c 'mcp_servers.falinks.url="${url}"'`;
      const command = spec.resumeId
        ? `${base} resume ${spec.resumeId} ${shQuote(spec.bootstrap)}`
        : `${base} ${shQuote(spec.bootstrap)}`;
      return { command, needsBootstrapInject: false };
    }
```

> **codex resume flag 组合 spike（实现时验一次）**：上面把全局 flag 放在 `resume` 子命令前。手动验证 `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox -c '...' resume <id> '<prompt>'` 能正常拉起旧会话。若 codex 拒绝该顺序，改为 `codex resume <id> -c '...' '<prompt>'` 并用 `-c approval_policy=...` 等覆盖等价开关，同步更新本测试的断言。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/agent/mcp-config.test.ts`
Expected: PASS（原 6 + 新 3 = 9）。

- [ ] **Step 5: 提交**

```bash
git add src/agent/mcp-config.ts tests/agent/mcp-config.test.ts
git commit -m "feat(session): buildAgentLaunch 支持 --session-id/--resume/codex resume"
```

---

## Task 6: 接线 `src/index.ts` — 决策、捕获、持久化、恢复注入

**Files:**
- Modify: `src/index.ts`

无新单元测试（涉及真 driver/计时）；正确性靠 Task 2-5 的单测 + Task 7 实测。每步给出完整代码。

- [ ] **Step 1: 加导入与重连提示语常量**

在 `src/index.ts` 顶部 import 区追加：
```ts
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadStore, saveStore, pruneToAgents, type SessionStore } from './session/store.js';
import { decideClaudeSession, decideCodexSession } from './session/decide.js';
import { parseStatusSessionId } from './session/capture.js';
```

在 `HOUSE_RULES` 常量后追加：
```ts
/** 恢复时不重发 bootstrap，只让员工重新挂到新总线。 */
const RECONNECT_NUDGE =
  '【falinks 已恢复会话】总线已重连。请立刻重新调用 register 报到，然后待命；无需重述之前内容。';
```

- [ ] **Step 2: 在 `up()` 里加载存档**

在 `up()` 内、`const sessions = new Map...` 附近加：
```ts
  const launchCwd = (() => { try { return realpathSync(process.cwd()); } catch { return process.cwd(); } })();
  const store: SessionStore = loadStore(launchCwd);
  pruneToAgents(store, cfg.agents.map((a) => a.name));
```

- [ ] **Step 3: 重写 `launchInto` —— 决策、命令、注入、捕获、落盘**

把现有 `launchInto` 整体替换为：
```ts
  async function launchInto(
    anchor: string,
    dir: 'vertical' | 'horizontal',
    a: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string },
  ): Promise<string> {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));

    const fullBootstrap =
      `${HOUSE_RULES}\n你的身份：${a.name}${a.role ? `（${a.role}）` : ''}。${a.bootstrap ?? ''}`;

    // 决定 fresh / resume，并据此选注入文本与命令参数。
    let resuming = false;
    let sessionId: string | undefined;
    let resumeId: string | undefined;
    let claudeSessionId: string | undefined; // claude 首启用 --session-id 的确定性 id

    if (a.cli === 'claude') {
      const d = decideClaudeSession(store, a.name, a.cwd, randomUUID);
      resuming = d.mode === 'resume';
      if (resuming) resumeId = d.sessionId;
      else claudeSessionId = d.sessionId;
      sessionId = d.sessionId; // 两种情况都把这个 id 落盘
    } else if (a.cli === 'codex') {
      const d = decideCodexSession(store, a.name);
      if (d.mode === 'resume') { resuming = true; resumeId = d.sessionId; sessionId = d.sessionId; }
    }

    const injectText = resuming ? RECONNECT_NUDGE : fullBootstrap;
    const { command, needsBootstrapInject } = buildAgentLaunch(a.cli, {
      name: a.name, busPort: bus.port, mcpConfigPath: cfgPath,
      bootstrap: injectText, sessionId: claudeSessionId, resumeId,
    });

    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    await driver.setName(sid, a.name).catch(() => {});

    if (needsBootstrapInject) {
      // claude：信任对话→就绪后注入（resuming 时注入的是重连提示语）。
      for (let i = 0; i < 30; i++) {
        await sleep(700);
        const state = detectScreenState(await driver.readScreen(sid));
        if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
        if (state === 'ready') { await driver.inject(sid, injectText, true); break; }
      }
    } else {
      // codex：bootstrap/重连语已作为命令位置参数传入；盲发 Enter 接受信任目录对话。
      await sleep(2500);
      await driver.inject(sid, '', true);
      await sleep(1500);
      await driver.inject(sid, '', true);
      await sleep(3000);
      await driver.inject(sid, '', true);

      // codex 首启：注入 /status 读屏抓 session id（读不到则不记，下次仍 fresh）。
      if (!resuming) {
        await sleep(2000);
        await driver.inject(sid, '/status', true);
        await sleep(2500);
        const screen = await driver.readScreen(sid).catch(() => '');
        const captured = parseStatusSessionId(screen, 'codex');
        if (captured) sessionId = captured;
      }
    }

    // 落盘：拿到 id 才记；codex 没抓到则删掉旧条目，确保下次 fresh 而非误 resume。
    if (sessionId) store.agents[a.name] = { cli: a.cli, sessionId };
    else delete store.agents[a.name];
    saveStore(launchCwd, store);

    return sid;
  }
```

- [ ] **Step 4: 编译确认无类型错误**

Run: `npm run build`
Expected: 无报错（dist 更新）。

- [ ] **Step 5: 跑全量测试确认未回归**

Run: `npx vitest run`
Expected: 既有用例全过 + 新增 session 用例全过。

- [ ] **Step 6: 提交**

```bash
git add src/index.ts
git commit -m "feat(session): up/launchInto 接线会话恢复(决策/捕获/落盘)"
```

---

## Task 7: 实测验收（手动，能正常跑 CLI 的终端，非 -p）

- [ ] **Step 1: 首启并埋暗号**

```bash
cd /tmp && rm -rf restore-test && mkdir restore-test && cd restore-test
falinks   # 选/建团队：1 个 claude + 1 个 codex（同目录）
```
在控制台分别 `@claude员工 记住暗号:紫色河马蛋糕`、`@codex员工 记住暗号:橙色斑马沙发`，确认各自回应。

- [ ] **Step 2: 关窗**

关掉两个员工 pane（控制台健康轮询会显示其下线）。Ctrl-C 收工。

- [ ] **Step 3: 同目录恢复**

```bash
cd /tmp/restore-test && falinks   # 选「继续当前团队」
```
观察：claude pane 命令含 `--resume`、codex pane 含 `resume <id>`（可 `ps` 或看 pane 首行）。

- [ ] **Step 4: 验记忆**

控制台 `@claude员工 暗号是什么?`、`@codex员工 暗号是什么?`。
- claude 答「紫色河马蛋糕」= claude 恢复通过。
- codex 答「橙色斑马沙发」= codex 恢复通过（若 Task 1 spike 判定 codex 不支持，则此项预期为「答不出/全新」，符合降级设计）。

- [ ] **Step 5: 记录结果**

把实测结论写入本计划末尾「验收记录」。

---

## Task 8: 文档 + 版本 0.2.3 + 收尾

**Files:**
- Modify: `CHANGELOG.md`、`package.json`、`README.md`（如需补一段会话恢复说明）

- [ ] **Step 1: CHANGELOG 加 0.2.3 段**

在 `CHANGELOG.md` 顶部 `## 0.2.2` 之上插入：
```markdown
## 0.2.3

- **会话恢复**：同目录再次启动并选「继续当前团队」时，每个员工带着上次对话记忆恢复——claude 用 `--session-id`/`--resume`，codex 用 `/status` 抓 id 后 `codex resume`。会话档按项目目录存于 `~/.falinks/sessions/`；换团队=全新会话；恢复只注入一句重连提示、不重发 bootstrap（省 token）。codex 若读屏拿不到 id 则安全降级为全新（绝不扫盘误接他人会话）。
```

- [ ] **Step 2: 版本号 0.2.2 → 0.2.3**

改 `package.json` 的 `"version": "0.2.2"` 为 `"0.2.3"`。

- [ ] **Step 3: 构建 + 全量测试**

Run: `npm run build && npx vitest run`
Expected: 构建无错，全部用例通过。

- [ ] **Step 4: 提交**

```bash
git add CHANGELOG.md package.json README.md docs/superpowers/plans/2026-06-04-session-restore.md
git commit -m "chore: release 0.2.3 — 会话恢复"
```

> 发布由用户手动 `npm publish --access public`（需 OTP）。本计划不替用户发布。

---

## 验收记录
（Task 7 完成后填写：claude 恢复 = ?；codex 恢复 = ?；codex resume flag 组合最终形态 = ?）
