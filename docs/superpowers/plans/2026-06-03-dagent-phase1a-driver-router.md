# dagent Phase 1A — Terminal Driver + Router 核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 dagent 的两根去风险后的承重柱——iTerm2 终端驱动（osascript 注入/读屏）与 Router 消息状态机（纯逻辑），并用真实 iTerm 集成冒烟把"启动窗口→注入→读屏→按 Router 投递"端到端跑通。

**Architecture:** TypeScript/Node（ESM）。`Router` 是纯逻辑状态机，通过注入的 `Deliverer` 回调把"该投递了"这件事交给 orchestrator；orchestrator 用 `ITerm2Driver` 把消息 `write text` 注入目标窗口。驱动是接口 `TerminalDriver`，测试用 `FakeDriver`、生产用 `ITerm2Driver`。本计划**不含 MCP 总线**（见后续 Plan 1B）——"发送"在冒烟里用直接调用 `router.send()` 模拟。

**Tech Stack:** TypeScript, Node 24 (ESM), vitest（测试）, tsx（运行脚本）, osascript（iTerm 控制）。

**Spike 已验证的事实（本计划据此编写）：** `write text "<含\n消息>"` 行间发 LF=插入换行、末尾 CR=提交，一次投递多行；`text of session` 可读屏；iTerm 不支持 `session id "X"` 直接寻址，须遍历 windows→tabs→sessions 匹配。

---

## File Structure

```
dagent/
  package.json              # ESM, scripts: test / test:watch / smoke
  tsconfig.json             # NodeNext, strict
  vitest.config.ts
  src/
    core/
      types.ts              # AgentName, AgentStatus, Message, AgentRuntime
      router.ts             # Router 状态机 + Deliverer 接口（纯逻辑）
    terminal/
      driver.ts             # TerminalDriver 接口 + FakeDriver
      applescript.ts        # escapeAppleScript（纯函数，可单测）
      iterm.ts              # ITerm2Driver（osascript I/O）
    orchestrator.ts         # 把 Router + Driver 接成 Deliverer；消息格式化
  scripts/
    smoke-relay.ts          # 真实 iTerm 集成冒烟
  tests/
    core/router.test.ts
    terminal/applescript.test.ts
    terminal/fake-driver.test.ts
    orchestrator.test.ts
```

---

### Task 0: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `tests/smoke.test.ts`（临时占位，证明测试链路通，Task 1 后删除）

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "dagent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "tsx scripts/smoke-relay.ts"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 4: 创建临时 `tests/smoke.test.ts`**

```ts
import { expect, test } from 'vitest';

test('toolchain works', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: 安装依赖并运行**

Run: `npm install && npm test`
Expected: 1 passed (`tests/smoke.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts tests/smoke.test.ts package-lock.json
git commit -m "chore: scaffold dagent TS project (vitest, tsx)"
```

---

### Task 1: 核心类型

**Files:**
- Create: `src/core/types.ts`
- Delete: `tests/smoke.test.ts`

- [ ] **Step 1: 创建 `src/core/types.ts`**

```ts
export type AgentName = string;

export type AgentStatus =
  | 'launching' // 已建窗、CLI 启动中，尚未就绪
  | 'idle'      // 就绪、空闲，可接收注入
  | 'busy'      // 已注入一条、正在处理
  | 'stuck'     // 标 busy 后超时未 idle
  | 'dead';     // 窗口关闭 / 注入失败 / 连接断开

export interface Message {
  id: string;
  from: AgentName;
  to: AgentName;
  body: string;
  ts: number;
}

export interface AgentRuntime {
  name: AgentName;
  role?: string;
  status: AgentStatus;
  sessionId?: string; // iTerm session id（register 时填入）
  inbox: Message[];
}
```

- [ ] **Step 2: 删除临时占位测试**

Run: `rm tests/smoke.test.ts`

- [ ] **Step 3: 编译确认类型无误**

Run: `npx tsc --noEmit`
Expected: 无输出（成功）

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts
git rm tests/smoke.test.ts
git commit -m "feat(core): add domain types (Message, AgentRuntime)"
```

---

### Task 2: Router 状态机（纯逻辑 TDD）

**Files:**
- Create: `src/core/router.ts`
- Test: `tests/core/router.test.ts`

- [ ] **Step 1: 写失败测试 `tests/core/router.test.ts`**

```ts
import { beforeEach, expect, test, vi } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup(routes?: Record<string, string>) {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = {
    deliver: (agent, msg) => delivered.push({ agent, msg }),
  };
  let n = 0;
  const router = new Router(deliverer, {
    now: () => 1000,
    genId: () => `m${++n}`,
    routes,
  });
  router.addAgent('alice');
  router.addAgent('bob', 'dev');
  return { router, delivered };
}

test('register marks agent idle and stores sessionId', () => {
  const { router } = setup();
  router.register('alice', 'SID-A');
  const a = router.get('alice')!;
  expect(a.status).toBe('idle');
  expect(a.sessionId).toBe('SID-A');
});

test('send to an idle agent delivers immediately and marks busy', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  const msg = router.send('alice', 'bob', 'hello');
  expect(msg?.id).toBe('m1');
  expect(delivered).toHaveLength(1);
  expect(delivered[0].msg.body).toBe('hello');
  expect(router.get('bob')!.status).toBe('busy');
  expect(router.get('bob')!.inbox).toHaveLength(0);
});

test('send to a busy agent queues in inbox without delivering', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.send('alice', 'bob', 'first');  // delivered, bob busy
  router.send('alice', 'bob', 'second'); // queued
  expect(delivered).toHaveLength(1);
  expect(router.get('bob')!.inbox).toHaveLength(1);
});

test('onIdle delivers the next queued message', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.send('alice', 'bob', 'first');
  router.send('alice', 'bob', 'second');
  router.onIdle('bob');
  expect(delivered).toHaveLength(2);
  expect(delivered[1].msg.body).toBe('second');
  expect(router.get('bob')!.status).toBe('busy');
});

test('send to a launching (not yet registered) agent queues until register', () => {
  const { router, delivered } = setup();
  router.send('alice', 'bob', 'early'); // bob still launching
  expect(delivered).toHaveLength(0);
  expect(router.get('bob')!.inbox).toHaveLength(1);
  router.register('bob', 'SID-B');
  expect(delivered).toHaveLength(1);
});

test('role name resolves via routes table', () => {
  const { router, delivered } = setup({ manager: 'alice' });
  router.register('alice', 'SID-A');
  const msg = router.send('bob', 'manager', 'hi boss');
  expect(msg?.to).toBe('alice');
  expect(delivered[0].agent.name).toBe('alice');
});

test('send to unknown target returns undefined and delivers nothing', () => {
  const { router, delivered } = setup();
  expect(router.send('alice', 'nobody', 'x')).toBeUndefined();
  expect(delivered).toHaveLength(0);
});

test('send to a dead agent is dropped', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.markDead('bob');
  expect(router.send('alice', 'bob', 'x')).toBeUndefined();
  expect(delivered).toHaveLength(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core/router.test.ts`
Expected: FAIL（`Cannot find module '../../src/core/router.js'`）

- [ ] **Step 3: 实现 `src/core/router.ts`**

```ts
import type { AgentName, AgentRuntime, Message } from './types.js';

export interface Deliverer {
  /** Router 决定"现在该把 msg 投给 agent 了"时调用；实现负责真正注入（副作用）。 */
  deliver(agent: AgentRuntime, msg: Message): void;
}

export interface RouterDeps {
  now: () => number;
  genId: () => string;
  routes?: Record<string, AgentName>; // role/别名 -> 真实 agent 名
}

export class Router {
  private agents = new Map<AgentName, AgentRuntime>();

  constructor(private deliverer: Deliverer, private deps: RouterDeps) {}

  addAgent(name: AgentName, role?: string): void {
    this.agents.set(name, { name, role, status: 'launching', inbox: [] });
  }

  register(name: AgentName, sessionId: string): void {
    const a = this.must(name);
    a.sessionId = sessionId;
    a.status = 'idle';
    this.pump(a);
  }

  resolve(to: AgentName): AgentName | undefined {
    if (this.agents.has(to)) return to;
    const routed = this.deps.routes?.[to];
    return routed && this.agents.has(routed) ? routed : undefined;
  }

  send(from: AgentName, to: AgentName, body: string): Message | undefined {
    const target = this.resolve(to);
    if (!target) return undefined;
    const a = this.must(target);
    if (a.status === 'dead') return undefined;
    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now() };
    a.inbox.push(msg);
    this.pump(a);
    return msg;
  }

  onIdle(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy' || a.status === 'stuck') a.status = 'idle';
    this.pump(a);
  }

  markDead(name: AgentName): void {
    this.must(name).status = 'dead';
  }

  markStuck(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy') a.status = 'stuck';
  }

  get(name: AgentName): AgentRuntime | undefined {
    return this.agents.get(name);
  }

  roster(): AgentRuntime[] {
    return [...this.agents.values()];
  }

  /** 若 agent 空闲且 inbox 非空，取出一条投递并标 busy。 */
  private pump(a: AgentRuntime): void {
    if (a.status !== 'idle') return;
    const msg = a.inbox.shift();
    if (!msg) return;
    a.status = 'busy';
    this.deliverer.deliver(a, msg);
  }

  private must(name: AgentName): AgentRuntime {
    const a = this.agents.get(name);
    if (!a) throw new Error(`unknown agent: ${name}`);
    return a;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/core/router.test.ts`
Expected: PASS（8 passed）

- [ ] **Step 5: Commit**

```bash
git add src/core/router.ts tests/core/router.test.ts
git commit -m "feat(core): Router state machine with inbox + role routing"
```

---

### Task 3: TerminalDriver 接口 + FakeDriver

**Files:**
- Create: `src/terminal/driver.ts`
- Test: `tests/terminal/fake-driver.test.ts`

- [ ] **Step 1: 写失败测试 `tests/terminal/fake-driver.test.ts`**

```ts
import { expect, test } from 'vitest';
import { FakeDriver } from '../../src/terminal/driver.js';

test('launch returns a stable fake session id and remembers the window', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  expect(sid).toBe('fake-session-1');
  expect(d.windows.get(sid)).toEqual({ cwd: '/tmp', command: 'cat' });
});

test('inject records text and submit flag per session', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  await d.inject(sid, 'hello', true);
  await d.inject(sid, 'partial', false);
  expect(d.injections).toEqual([
    { sessionId: sid, text: 'hello', submit: true },
    { sessionId: sid, text: 'partial', submit: false },
  ]);
});

test('readScreen returns canned content set via setScreen', async () => {
  const d = new FakeDriver();
  const sid = await d.launch({ cwd: '/tmp', command: 'cat' });
  d.setScreen(sid, 'line1\nline2');
  expect(await d.readScreen(sid)).toBe('line1\nline2');
});

test('inject to unknown session throws', async () => {
  const d = new FakeDriver();
  await expect(d.inject('nope', 'x', true)).rejects.toThrow(/unknown session/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/terminal/fake-driver.test.ts`
Expected: FAIL（`Cannot find module '.../driver.js'`）

- [ ] **Step 3: 实现 `src/terminal/driver.ts`**

```ts
export interface LaunchOpts {
  cwd: string;
  command: string; // 例如 "claude" 或 "codex"
}

export interface TerminalDriver {
  /** 新建终端窗口、cd 到 cwd 并运行 command；返回稳定 session 句柄。 */
  launch(opts: LaunchOpts): Promise<string>;
  /** 把 text 注入 session；submit=true 时末尾提交（回车）。 */
  inject(sessionId: string, text: string, submit: boolean): Promise<void>;
  /** 读取该 session 当前可见屏幕文本。 */
  readScreen(sessionId: string): Promise<string>;
  /** 关闭该 session 所在窗口。 */
  close(sessionId: string): Promise<void>;
}

/** 测试替身：记录所有 inject、可设定 readScreen 返回值。 */
export class FakeDriver implements TerminalDriver {
  windows = new Map<string, LaunchOpts>();
  injections: { sessionId: string; text: string; submit: boolean }[] = [];
  private screens = new Map<string, string>();
  private counter = 0;

  async launch(opts: LaunchOpts): Promise<string> {
    const sid = `fake-session-${++this.counter}`;
    this.windows.set(sid, opts);
    return sid;
  }

  async inject(sessionId: string, text: string, submit: boolean): Promise<void> {
    if (!this.windows.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    this.injections.push({ sessionId, text, submit });
  }

  async readScreen(sessionId: string): Promise<string> {
    if (!this.windows.has(sessionId)) throw new Error(`unknown session: ${sessionId}`);
    return this.screens.get(sessionId) ?? '';
  }

  async close(sessionId: string): Promise<void> {
    this.windows.delete(sessionId);
  }

  setScreen(sessionId: string, content: string): void {
    this.screens.set(sessionId, content);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/terminal/fake-driver.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git add src/terminal/driver.ts tests/terminal/fake-driver.test.ts
git commit -m "feat(terminal): TerminalDriver interface + FakeDriver"
```

---

### Task 4: AppleScript 转义（纯函数 TDD）

**Files:**
- Create: `src/terminal/applescript.ts`
- Test: `tests/terminal/applescript.test.ts`

**背景：** 注入文本是不可信输入，必须铁桶级转义后才能拼进 AppleScript 字符串字面量。规则：`\`→`\\`、`"`→`\"`、真实换行(LF)→`\n`（AppleScript 字面量里 `\n` = LF = Claude TUI 的插入换行）、剥除 `\r`。

- [ ] **Step 1: 写失败测试 `tests/terminal/applescript.test.ts`**

```ts
import { expect, test } from 'vitest';
import { escapeAppleScript } from '../../src/terminal/applescript.js';

test('escapes backslashes first', () => {
  expect(escapeAppleScript('a\\b')).toBe('a\\\\b');
});

test('escapes double quotes', () => {
  expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
});

test('converts newline to literal \\n (AppleScript LF)', () => {
  expect(escapeAppleScript('line1\nline2')).toBe('line1\\nline2');
});

test('strips carriage returns', () => {
  expect(escapeAppleScript('a\r\nb')).toBe('a\\nb');
});

test('combined: quote + backslash + newline order is correct', () => {
  // 输入: 反斜杠、引号、换行各一
  expect(escapeAppleScript('\\"\n')).toBe('\\\\\\"\\n');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/terminal/applescript.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/terminal/applescript.ts`**

```ts
/**
 * 把任意文本转义为可安全嵌入 AppleScript 双引号字符串字面量的形式。
 * 顺序很重要：先转义反斜杠，再转义引号，最后把换行变为字面 \n。
 */
export function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/terminal/applescript.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: Commit**

```bash
git add src/terminal/applescript.ts tests/terminal/applescript.test.ts
git commit -m "feat(terminal): bulletproof AppleScript string escaping"
```

---

### Task 5: ITerm2Driver（osascript I/O）

**Files:**
- Create: `src/terminal/iterm.ts`

**说明：** 这是 I/O 适配层，逻辑都在已测的 `escapeAppleScript` + osascript 脚本里。无单元测试（真实验证在 Task 7 集成冒烟）。脚本经 `osascript -` 的 stdin 传入，避免 shell 引号问题。

- [ ] **Step 1: 实现 `src/terminal/iterm.ts`**

```ts
import { spawn } from 'node:child_process';
import { escapeAppleScript } from './applescript.js';
import type { LaunchOpts, TerminalDriver } from './driver.js';

/** 执行一段 AppleScript（经 osascript stdin），返回 trim 后的 stdout。 */
function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('osascript', ['-']);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `osascript exit ${code}`)),
    );
    p.stdin.write(script);
    p.stdin.end();
  });
}

/** 生成"遍历 windows→tabs→sessions 匹配 id 后执行 action"的脚本片段。 */
function onSession(sessionId: string, action: string): string {
  return `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${sessionId}" then
          ${action}
        end if
      end repeat
    end repeat
  end repeat
  return "NOT_FOUND"
end tell`;
}

export class ITerm2Driver implements TerminalDriver {
  async launch(opts: LaunchOpts): Promise<string> {
    const cmd = escapeAppleScript(`cd ${opts.cwd} && ${opts.command}`);
    const script = `tell application "iTerm2"
  set w to (create window with default profile)
  tell current session of w
    write text "${cmd}"
    return id
  end tell
end tell`;
    const id = await osascript(script);
    if (!id || id === 'NOT_FOUND') throw new Error('launch failed: no session id');
    return id;
  }

  async inject(sessionId: string, text: string, submit: boolean): Promise<void> {
    const nl = submit ? 'YES' : 'NO';
    const action = `tell s to write text "${escapeAppleScript(text)}" newline ${nl}
          return "OK"`;
    const r = await osascript(onSession(sessionId, action));
    if (r !== 'OK') throw new Error(`inject: session not found: ${sessionId}`);
  }

  async readScreen(sessionId: string): Promise<string> {
    const action = `return text of s`;
    const r = await osascript(onSession(sessionId, action));
    if (r === 'NOT_FOUND') throw new Error(`readScreen: session not found: ${sessionId}`);
    return r;
  }

  async close(sessionId: string): Promise<void> {
    const action = `close w
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }
}
```

- [ ] **Step 2: 编译确认无类型错误**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add src/terminal/iterm.ts
git commit -m "feat(terminal): ITerm2Driver via osascript (launch/inject/readScreen/close)"
```

---

### Task 6: Orchestrator（Deliverer 实现 + 消息格式化）

**Files:**
- Create: `src/orchestrator.ts`
- Test: `tests/orchestrator.test.ts`

**说明：** orchestrator 实现 `Deliverer`：把 Router 交来的 `Message` 格式化成注入文本，调 `driver.inject(sessionId, text, true)` 注入并提交。格式带"回复请用 sendmsg"约定（B2 prompt 约定）。

- [ ] **Step 1: 写失败测试 `tests/orchestrator.test.ts`**

```ts
import { expect, test } from 'vitest';
import { formatMessage, makeDeliverer } from '../src/orchestrator.js';
import { FakeDriver } from '../src/terminal/driver.js';
import type { AgentRuntime, Message } from '../src/core/types.js';

test('formatMessage embeds sender, body, and reply convention', () => {
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: '帮我看下登录', ts: 1 };
  const text = formatMessage(msg);
  expect(text).toContain('alice');
  expect(text).toContain('帮我看下登录');
  expect(text).toContain('sendmsg');
  expect(text).toContain('"alice"'); // 回复目标
});

test('deliverer injects formatted text (submit=true) into the agent sessionId', async () => {
  const driver = new FakeDriver();
  const sid = await driver.launch({ cwd: '/tmp', command: 'cat' });
  const deliverer = makeDeliverer(driver);
  const agent: AgentRuntime = { name: 'bob', status: 'busy', sessionId: sid, inbox: [] };
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };

  deliverer.deliver(agent, msg);
  await new Promise((r) => setTimeout(r, 10)); // 等待异步 inject

  expect(driver.injections).toHaveLength(1);
  expect(driver.injections[0].sessionId).toBe(sid);
  expect(driver.injections[0].submit).toBe(true);
  expect(driver.injections[0].text).toContain('alice');
});

test('deliver to an agent without sessionId throws synchronously', () => {
  const driver = new FakeDriver();
  const deliverer = makeDeliverer(driver);
  const agent: AgentRuntime = { name: 'bob', status: 'busy', inbox: [] };
  const msg: Message = { id: 'm1', from: 'alice', to: 'bob', body: 'hi', ts: 1 };
  expect(() => deliverer.deliver(agent, msg)).toThrow(/no sessionId/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/orchestrator.ts`**

```ts
import type { Deliverer } from './core/router.js';
import type { AgentRuntime, Message } from './core/types.js';
import type { TerminalDriver } from './terminal/driver.js';

/** 把一条消息格式化成注入目标窗口的文本，含"用 sendmsg 回复"约定。 */
export function formatMessage(msg: Message): string {
  return (
    `【来自 ${msg.from}】${msg.body}\n` +
    `(回复请调用 sendmsg(to="${msg.from}", message="..."))`
  );
}

/** 用 driver 构造一个 Deliverer：注入格式化文本并提交。 */
export function makeDeliverer(driver: TerminalDriver): Deliverer {
  return {
    deliver(agent: AgentRuntime, msg: Message): void {
      if (!agent.sessionId) throw new Error(`deliver: agent ${agent.name} has no sessionId`);
      const text = formatMessage(msg);
      // 注入是异步 I/O；Router 不等待。失败时打日志（Plan 1B 接 markDead）。
      void driver.inject(agent.sessionId, text, true).catch((e) => {
        console.error(`[deliver] inject to ${agent.name} failed:`, e);
      });
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 全量测试**

Run: `npm test`
Expected: 全部 PASS（router 8 + fake-driver 4 + applescript 5 + orchestrator 3 = 20）

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: orchestrator Deliverer + message formatting"
```

---

### Task 7: 真实 iTerm 集成冒烟（半自动）

**Files:**
- Create: `scripts/smoke-relay.ts`

**目标：** 不依赖 MCP、不花 CLI token。用 `cat` 作"替身员工"（回显注入内容到屏幕），验证 `ITerm2Driver` 的 launch/inject/readScreen 与 Router 投递接通：模拟 `boss → A` 发消息，注入进 A 窗口，读屏确认 A 屏幕出现该消息。

- [ ] **Step 1: 实现 `scripts/smoke-relay.ts`**

```ts
import { Router } from '../src/core/router.js';
import { makeDeliverer } from '../src/orchestrator.js';
import { ITerm2Driver } from '../src/terminal/iterm.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const driver = new ITerm2Driver();
  const deliverer = makeDeliverer(driver);
  let n = 0;
  const router = new Router(deliverer, { now: () => Date.now(), genId: () => `m${++n}` });

  router.addAgent('alice');
  console.log('launching alice window (running cat as stand-in agent)...');
  const sid = await driver.launch({ cwd: '/tmp', command: 'cat' });
  await sleep(1500);
  router.register('alice', sid);

  console.log('sending boss -> alice ...');
  router.send('boss', 'alice', 'PING_12345 多行测试\n第二行');
  await sleep(1500);

  const screen = await driver.readScreen(sid);
  const ok = screen.includes('PING_12345') && screen.includes('第二行');
  console.log('--- alice screen ---\n' + screen);
  console.log(ok ? '\n✅ SMOKE PASS: 多行消息已注入并被回显' : '\n❌ SMOKE FAIL');

  console.log('closing window in 3s...');
  await sleep(3000);
  await driver.close(sid);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 运行冒烟（需真实 iTerm；首次会弹自动化授权，需点允许）**

Run: `npm run smoke`
Expected: 终端打印 `✅ SMOKE PASS`，并可见一个 iTerm 窗口弹出、显示注入的多行 `PING_12345` 文本后自动关闭。

- [ ] **Step 3: 若失败排查**

- 报"session not found"：确认 iTerm 是 iTerm2（非 Terminal.app），且 `id of s` 形态与 spike 一致。
- 无窗口弹出 / 报权限：系统设置 → 隐私与安全性 → 自动化，允许当前终端控制 iTerm。
- 屏幕无回显：确认 `cat` 已启动（替身需读 stdin 回显）；必要时把 command 换成 `cat` 前加 `sleep 0.5`。

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-relay.ts
git commit -m "test: real-iTerm integration smoke (driver + router relay)"
```

---

## Self-Review（对照 spec 的覆盖检查）

- **spec §3 注入方式（write text 多行）** → Task 4（转义）+ Task 5（inject）+ Task 7（真实多行冒烟）✅
- **spec §3 读屏** → Task 5（readScreen）+ Task 7 ✅
- **spec §3 会话需遍历寻址** → Task 5 `onSession` 遍历实现 ✅
- **spec §4 ② Router/状态机** → Task 2（含 inbox 纪律、busy/idle 迁移、角色路由）✅
- **spec §4 ③ 驱动作为可替换接口** → Task 3 接口 + FakeDriver，Task 5 真实实现 ✅
- **spec §6 注入文本含 sendmsg 回复约定** → Task 6 `formatMessage` ✅
- **spec §7 角色路由** → Task 2 `resolve` + `routes` ✅
- **本计划范围外（留给后续）：** MCP 总线（register/sendmsg/idle/who 的真实 agent 调用）= Plan 1B；服务端 thread 派生 / 循环·预算防护 = Plan 2；人入口 CLI = Plan 3；`stuck` 超时计时器与 `markDead` 接线在 Plan 1B 接 MCP 连接事件时落地。
- **占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性：** `Deliverer`/`Router`/`TerminalDriver`/`FakeDriver`/`Message`/`AgentRuntime`/`escapeAppleScript`/`formatMessage`/`makeDeliverer` 在各 Task 间签名一致。

## 交付物
完成后 dagent 拥有：经单测的 Router 状态机、经单测的终端驱动接口与转义、真实可用的 ITerm2Driver，以及一条真实 iTerm 冒烟证明"启动→多行注入→读屏→Router 投递"端到端可行。下一步 Plan 1B 在此之上接 MCP 总线，让真实 agent 通过 `sendmsg` 驱动这套，并在该里程碑敲定 B2 回传机制。
