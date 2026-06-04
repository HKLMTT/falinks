# dagent Phase 4 — 控制台 + 分屏布局 + 运行时增删员工 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 一个 iTerm 窗口即驾驶舱：左侧 Ink 控制台 pane（花名册/状态、消息流水、输入框），右侧平铺员工 pane；员工可运行时增删。

**Architecture:** `TerminalDriver` 增加 pane 操作（splitFrom/closePane）；`up` 建窗→console pane→员工 pane 分屏；控制台是 `dagent console`（Ink）跑在左 pane，经 admin HTTP 路由轮询/操作；新增 `/admin/add|remove` 路由回调到 orchestrator 的运行时增删。Router 增 `removeAgent`。spike 已验证全部 iTerm 分屏机制。

**Tech Stack:** TypeScript/Node, vitest, `ink`+`react`（TUI）, osascript。

**Spike 已验证（2026-06-04）：** split vertically/horizontally 返回新 pane session；现有 findSession 命中 pane；按 id 注入/读屏精确作用单 pane；运行时 split 加 pane、close session 关单 pane 均可行。

---

## File Structure
```
src/terminal/driver.ts   # 接口 + Fake：splitFrom, closePane
src/terminal/iterm.ts    # ITerm2Driver：splitFrom(osascript split), closePane(close session)
src/core/router.ts       # removeAgent(name)
src/console/parse.ts     # parseConsoleInput 纯函数
src/console/app.tsx      # Ink TUI 组件
src/console/main.tsx     # dagent console 入口
src/bus/server.ts        # /admin/add, /admin/remove + BusDeps 回调
src/index.ts             # up：分屏布局 + console pane + 运行时 add/remove 回调装配
src/cli.ts               # console 子命令
tests/terminal/fake-pane.test.ts
tests/core/router-remove.test.ts
tests/console/parse.test.ts
tests/bus/admin-lifecycle.test.ts
scripts/smoke-layout.ts  # 分屏 + 增删 半自动冒烟（cat 占位）
```

---

### Task 1: Driver pane 操作（splitFrom / closePane）

**Files:** Modify `src/terminal/driver.ts`, `src/terminal/iterm.ts`; create `tests/terminal/fake-pane.test.ts`

- [ ] **Step 1: 写失败测试 `tests/terminal/fake-pane.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { FakeDriver } from '../../src/terminal/driver.js';

test('splitFrom records anchor+direction and returns a new session id', async () => {
  const d = new FakeDriver();
  const anchor = await d.launch({ cwd: '/c', command: 'console' });
  const sid = await d.splitFrom(anchor, 'vertical', { cwd: '/a', command: 'claude' });
  expect(sid).toBe('fake-session-2');
  expect(d.windows.get(sid)).toEqual({ cwd: '/a', command: 'claude' });
  expect(d.splits).toEqual([{ anchor, direction: 'vertical', sessionId: sid }]);
});

test('closePane removes only that session', async () => {
  const d = new FakeDriver();
  const a = await d.launch({ cwd: '/c', command: 'console' });
  const b = await d.splitFrom(a, 'horizontal', { cwd: '/b', command: 'codex' });
  await d.closePane(b);
  expect(d.windows.has(b)).toBe(false);
  expect(d.windows.has(a)).toBe(true);
});
```

- [ ] **Step 2: Run `npx vitest run tests/terminal/fake-pane.test.ts` → FAIL.**

- [ ] **Step 3: Modify `src/terminal/driver.ts`** — add to `TerminalDriver` interface (after `launch`):
```ts
  /** 从 anchor pane 切出新 pane（vertical=左右, horizontal=上下），在其中起 command，返回新 session id。 */
  splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string>;
  /** 关闭单个 pane（不关整窗）。 */
  closePane(sessionId: string): Promise<void>;
```
And in `FakeDriver` add:
```ts
  splits: { anchor: string; direction: 'vertical' | 'horizontal'; sessionId: string }[] = [];

  async splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string> {
    if (!this.windows.has(anchorSessionId)) throw new Error(`unknown session: ${anchorSessionId}`);
    const sid = `fake-session-${++this.counter}`;
    this.windows.set(sid, opts);
    this.splits.push({ anchor: anchorSessionId, direction, sessionId: sid });
    return sid;
  }

  async closePane(sessionId: string): Promise<void> {
    this.windows.delete(sessionId);
  }
```
(`counter`/`windows` already exist in FakeDriver.)

- [ ] **Step 4: Modify `src/terminal/iterm.ts`** — add methods to `ITerm2Driver`:
```ts
  async splitFrom(anchorSessionId: string, direction: 'vertical' | 'horizontal', opts: LaunchOpts): Promise<string> {
    const verb = direction === 'vertical' ? 'split vertically' : 'split horizontally';
    const cmd = escapeAppleScript(`cd ${shQuote(opts.cwd)} && ${opts.command}`);
    const script = `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${anchorSessionId}" then
          tell s
            set newp to (${verb} with default profile)
          end tell
          tell newp to write text "${cmd}"
          return (id of newp)
        end if
      end repeat
    end repeat
  end repeat
  return "NOT_FOUND"
end tell`;
    const id = await osascript(script);
    if (!id || id === 'NOT_FOUND') throw new Error(`splitFrom: anchor not found: ${anchorSessionId}`);
    return id;
  }

  async closePane(sessionId: string): Promise<void> {
    const action = `close s
          return "OK"`;
    await osascript(onSession(sessionId, action));
  }
```
(`escapeAppleScript`, `shQuote`, `osascript`, `onSession` already in the module.)

- [ ] **Step 5: Run `npx vitest run tests/terminal/fake-pane.test.ts` → PASS (2). Then `npm test` + `npx tsc --noEmit`.**

- [ ] **Step 6: Commit** `git add src/terminal/driver.ts src/terminal/iterm.ts tests/terminal/fake-pane.test.ts && git commit -m "feat(terminal): splitFrom + closePane (pane ops)"`

---

### Task 2: Router.removeAgent（TDD）

**Files:** Modify `src/core/router.ts`; create `tests/core/router-remove.test.ts`

- [ ] **Step 1: 写失败测试 `tests/core/router-remove.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';

function mk() {
  const deliverer: Deliverer = { deliver: () => {} };
  let n = 0;
  const r = new Router(deliverer, { now: () => 0, genId: () => `m${++n}` });
  r.addAgent('alice'); r.register('alice', 'SA');
  r.addAgent('bob'); r.register('bob', 'SB');
  return r;
}

test('removeAgent drops the agent from roster and lookups', () => {
  const r = mk();
  r.removeAgent('bob');
  expect(r.get('bob')).toBeUndefined();
  expect(r.roster().map((a) => a.name)).toEqual(['alice']);
});

test('after removeAgent, sending to it returns undefined', () => {
  const r = mk();
  r.removeAgent('bob');
  expect(r.send('alice', 'bob', 'x')).toBeUndefined();
});

test('removeAgent on unknown name is a no-op (no throw)', () => {
  const r = mk();
  expect(() => r.removeAgent('ghost')).not.toThrow();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add to `src/core/router.ts` (a public method):**
```ts
  /** 从花名册移除一个 agent（运行时删员工）。未知名为 no-op。 */
  removeAgent(name: AgentName): void {
    this.agents.delete(name);
  }
```

- [ ] **Step 4: Run `npx vitest run tests/core/router-remove.test.ts` → PASS (3). Then `npm test` + `npx tsc --noEmit`.**

- [ ] **Step 5: Commit** `git add src/core/router.ts tests/core/router-remove.test.ts && git commit -m "feat(core): Router.removeAgent"`

---

### Task 3: 控制台输入解析（纯函数 TDD）

**Files:** create `src/console/parse.ts`, `tests/console/parse.test.ts`

- [ ] **Step 1: 写失败测试 `tests/console/parse.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { parseConsoleInput } from '../../src/console/parse.js';

test('@name message -> say', () => {
  expect(parseConsoleInput('@alice 在吗')).toEqual({ kind: 'say', to: 'alice', message: '在吗' });
});

test('plain text -> broadcast', () => {
  expect(parseConsoleInput('全体开会')).toEqual({ kind: 'broadcast', message: '全体开会' });
});

test('/add name cli cwd -> add', () => {
  expect(parseConsoleInput('/add carol claude /tmp/c')).toEqual({
    kind: 'add', spec: { name: 'carol', cli: 'claude', cwd: '/tmp/c' },
  });
});

test('/remove name -> remove', () => {
  expect(parseConsoleInput('/remove bob')).toEqual({ kind: 'remove', name: 'bob' });
});

test('/help -> help', () => {
  expect(parseConsoleInput('/help').kind).toBe('help');
});

test('/add with missing args -> error', () => {
  expect(parseConsoleInput('/add carol').kind).toBe('error');
});

test('empty input -> noop', () => {
  expect(parseConsoleInput('   ').kind).toBe('noop');
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/console/parse.ts`:**
```ts
export type ConsoleAction =
  | { kind: 'say'; to: string; message: string }
  | { kind: 'broadcast'; message: string }
  | { kind: 'add'; spec: { name: string; cli: string; cwd: string } }
  | { kind: 'remove'; name: string }
  | { kind: 'help' }
  | { kind: 'noop' }
  | { kind: 'error'; message: string };

/** 解析控制台输入行为一个动作。@x=私聊, /add /remove /help=命令, 其余=群发。 */
export function parseConsoleInput(line: string): ConsoleAction {
  const s = line.trim();
  if (!s) return { kind: 'noop' };

  if (s.startsWith('/')) {
    const [cmd, ...args] = s.slice(1).split(/\s+/);
    if (cmd === 'help') return { kind: 'help' };
    if (cmd === 'remove') {
      if (!args[0]) return { kind: 'error', message: '用法: /remove <name>' };
      return { kind: 'remove', name: args[0] };
    }
    if (cmd === 'add') {
      if (args.length < 3) return { kind: 'error', message: '用法: /add <name> <cli> <cwd>' };
      return { kind: 'add', spec: { name: args[0], cli: args[1], cwd: args[2] } };
    }
    return { kind: 'error', message: `未知命令: /${cmd}` };
  }

  if (s.startsWith('@')) {
    const m = s.slice(1).match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return { kind: 'error', message: '用法: @<name> <message>' };
    return { kind: 'say', to: m[1], message: m[2] };
  }

  return { kind: 'broadcast', message: s };
}
```

- [ ] **Step 4: Run `npx vitest run tests/console/parse.test.ts` → PASS (7). Then `npm test` + `npx tsc --noEmit`.**

- [ ] **Step 5: Commit** `git add src/console/parse.ts tests/console/parse.test.ts && git commit -m "feat(console): input parser (@say, broadcast, /add, /remove)"`

---

### Task 4: Admin /add /remove 路由 + BusDeps 回调（TDD）

**Files:** Modify `src/bus/server.ts`; create `tests/bus/admin-lifecycle.test.ts`

- [ ] **Step 1: 写失败测试 `tests/bus/admin-lifecycle.test.ts`:**
```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus; let added: any[]; let removed: string[];

async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm1' });
  added = []; removed = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onAddAgent: async (spec) => { added.push(spec); return { ok: true }; },
    onRemoveAgent: async (name) => { removed.push(name); return { ok: true }; },
  }, 0);
});
afterEach(async () => { await bus.close(); });

test('POST /admin/add invokes onAddAgent with the spec', async () => {
  const { json } = await http('POST', '/admin/add', { name: 'carol', cli: 'claude', cwd: '/tmp/c', role: 'dev' });
  expect(json.ok).toBe(true);
  expect(added).toEqual([{ name: 'carol', cli: 'claude', cwd: '/tmp/c', role: 'dev' }]);
});

test('POST /admin/remove invokes onRemoveAgent with the name', async () => {
  const { json } = await http('POST', '/admin/remove', { name: 'bob' });
  expect(json.ok).toBe(true);
  expect(removed).toEqual(['bob']);
});

test('add without callback returns ok:false', async () => {
  await bus.close();
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm1' });
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
  const { json } = await http('POST', '/admin/add', { name: 'x', cli: 'claude', cwd: '/x' });
  expect(json.ok).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Modify `src/bus/server.ts`:**
(a) Extend `BusDeps`:
```ts
export interface BusDeps {
  router: Router;
  getSessionId(name: string): string | undefined;
  onAddAgent?(spec: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string }): Promise<{ ok: boolean; error?: string }>;
  onRemoveAgent?(name: string): Promise<{ ok: boolean; error?: string }>;
}
```
(b) In the admin block, add two routes (before the final `404`):
```ts
      if (req.method === 'POST' && url.pathname === '/admin/add') {
        if (!deps.onAddAgent) return sendJson({ ok: false, error: 'add not supported' });
        const r = await deps.onAddAgent({ name: String(abody.name), cli: String(abody.cli), cwd: String(abody.cwd), role: abody.role, bootstrap: abody.bootstrap });
        return sendJson(r);
      }
      if (req.method === 'POST' && url.pathname === '/admin/remove') {
        if (!deps.onRemoveAgent) return sendJson({ ok: false, error: 'remove not supported' });
        const r = await deps.onRemoveAgent(String(abody.name));
        return sendJson(r);
      }
```

- [ ] **Step 4: Run `npx vitest run tests/bus/admin-lifecycle.test.ts` → PASS (3). Then `npx vitest run tests/bus/admin.test.ts tests/bus/server.test.ts` (regression). Then `npm test` + `npx tsc --noEmit`.**

- [ ] **Step 5: Commit** `git add src/bus/server.ts tests/bus/admin-lifecycle.test.ts && git commit -m "feat(bus): /admin/add + /admin/remove with orchestrator callbacks"`

---

### Task 5: 控制台 Ink TUI

**Files:** Modify `package.json`(deps); create `src/console/app.tsx`, `src/console/main.tsx`

**说明：** Ink TUI 渲染靠半自动验证（无单测——解析逻辑已在 Task 3 测）。组件轮询 admin 路由刷新花名册+日志，输入框用 parseConsoleInput 分发到 admin。

- [ ] **Step 1: 安装依赖** `npm install ink@^5 react@^18 ink-text-input@^6`。确认写入 dependencies。

- [ ] **Step 2: 创建 `src/console/app.tsx`:**
```tsx
import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { parseConsoleInput } from './parse.js';

const base = (port: number) => `http://127.0.0.1:${port}`;

async function admin(port: number, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base(port)}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function App({ port }: { port: number }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const { exit } = useApp();

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        setRoster(r.roster ?? []);
        const l = await admin(port, 'GET', '/admin/log');
        setLog((l.log ?? []).slice(-15));
      } catch { /* up 还没起或断开，忽略 */ }
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [port]);

  const onSubmit = async (line: string) => {
    setInput('');
    const a = parseConsoleInput(line);
    try {
      if (a.kind === 'noop') return;
      if (a.kind === 'help') { setStatus('@name 私聊 · 纯文本群发 · /add <name> <cli> <cwd> · /remove <name>'); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'say') { await admin(port, 'POST', '/admin/say', { to: a.to, message: a.message }); setStatus(`→ ${a.to}`); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: a.message }); setStatus('→ 全员'); return; }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? `＋ ${a.spec.name}` : '⚠ ' + (r.error ?? 'add 失败')); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? `－ ${a.name}` : '⚠ ' + (r.error ?? 'remove 失败')); return; }
    } catch (e: any) {
      setStatus('⚠ ' + (e?.message ?? 'error'));
    }
  };

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  return (
    <Box flexDirection="column" height="100%">
      <Text bold>dagent 控制台</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text underline>花名册</Text>
        {roster.map((a) => (
          <Text key={a.name} color={color(a.status)}>{a.virtual ? '·' : '●'} {a.name} <Text dimColor>{a.role ?? ''} [{a.status}]</Text></Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Text underline>消息</Text>
        {log.map((m, i) => (
          <Text key={i}><Text color="cyan">{m.from}</Text>→<Text color="magenta">{m.to}</Text>: {String(m.body).split('\n')[0].slice(0, 60)}</Text>
        ))}
      </Box>
      <Box marginTop={1}><Text color="green">› </Text><TextInput value={input} onChange={setInput} onSubmit={onSubmit} /></Box>
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 3: 创建 `src/console/main.tsx`:**
```tsx
import React from 'react';
import { render } from 'ink';
import { readFileSync } from 'node:fs';
import { App } from './app.js';

function runtimePort(): number {
  try { return JSON.parse(readFileSync('.dagent-runtime.json', 'utf8')).port; }
  catch { console.error('找不到 .dagent-runtime.json —— dagent up 在运行吗？'); process.exit(1); }
}

render(<App port={runtimePort()} />);
```

- [ ] **Step 4: 编译确认** `npx tsc --noEmit`（若 tsx/JSX 报错，确认 tsconfig `jsx` 设置——加 `"jsx": "react-jsx"` 到 compilerOptions）。运行 `npm test`（无回归）。

- [ ] **Step 5: Commit** `git add package.json package-lock.json src/console/app.tsx src/console/main.tsx tsconfig.json && git commit -m "feat(console): Ink TUI (roster/log/input) for dagent console"`

---

### Task 6: 装配 — up 分屏布局 + 运行时增删 + console 子命令 + 冒烟

**Files:** Modify `src/index.ts`, `src/cli.ts`; create `scripts/smoke-layout.ts`

- [ ] **Step 1: 重写 `src/index.ts` 的 `up`** 为分屏布局 + 抽出 `launchAgentInto` + 装配增删回调。完整新 `src/index.ts`:
```ts
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, type AgentConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import type { TerminalDriver } from './terminal/driver.js';
import { startBus } from './bus/server.js';
import { mcpConfigFor, launchCommandFor } from './agent/mcp-config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function up(configPath: string) {
  const cfg = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const driver = new ITerm2Driver();
  let n = 0;
  const guards = new Guards(cfg.guards, () => Date.now());
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes, guards,
  });
  router.addVirtual('boss');

  const sessions = new Map<string, string>();
  const tmp = mkdtempSync(join(tmpdir(), 'dagent-'));

  // 运行时把一个员工启动进 anchor 旁的新 pane
  async function launchInto(anchor: string, dir: 'vertical' | 'horizontal', a: AgentConfig & { bootstrap?: string }): Promise<string> {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));
    const command = launchCommandFor(a.cli, cfgPath);
    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const state = detectScreenState(await driver.readScreen(sid));
      if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
      if (state === 'ready') { await driver.inject(sid, a.bootstrap ?? `你是 ${a.name}。开机调 register；收到「来自 X」用 sendmsg 回复 X；收尾调 idle。`, true); break; }
    }
    return sid;
  }

  const bus = await startBus({
    router,
    getSessionId: (name) => sessions.get(name),
    onAddAgent: async (spec) => {
      if (router.get(spec.name)) return { ok: false, error: 'name exists' };
      lastRight = await launchInto(lastRight, 'horizontal', spec);
      return { ok: true };
    },
    onRemoveAgent: async (name) => {
      const sid = sessions.get(name);
      if (!sid) return { ok: false, error: 'unknown agent' };
      await driver.closePane(sid);
      sessions.delete(name);
      router.removeAgent(name);
      return { ok: true };
    },
  }, cfg.busPort);
  writeFileSync('.dagent-runtime.json', JSON.stringify({ port: bus.port }));
  console.log(`[dagent] bus on :${bus.port}`);

  // 左侧 console pane
  const consoleSid = await driver.launch({ cwd: process.cwd(), command: 'npx tsx src/console/main.tsx' });
  await sleep(800);

  // 右列：第一个员工竖分得右列，其余横分堆叠
  let lastRight = consoleSid;
  let first = true;
  for (const a of cfg.agents) {
    lastRight = await launchInto(lastRight, first ? 'vertical' : 'horizontal', a);
    first = false;
  }
  console.log('[dagent] 布局就绪。控制台在左 pane。Ctrl-C 收工。');
}
```
> 注：`lastRight` 在 `onAddAgent` 闭包中被引用并更新（运行时 add 堆到右列底部）；TypeScript 中需 `let lastRight` 在两处之前声明——把 `let lastRight = consoleSid;` 上移到 `startBus` 之前（初值 consoleSid，下面循环再赋值）。**实现时把 `let lastRight = consoleSid;` 声明放在 `launchInto` 定义之后、`startBus` 之前。**

- [ ] **Step 2: 删除 `src/index.ts` 底部任何旧入口**（应已在 Phase 3 移除；确认无 `up(...)` 调用残留——入口在 cli.ts）。

- [ ] **Step 3: 在 `src/cli.ts` 的 switch 加 `console` 子命令**（在 `up` case 之后）：
```ts
    case 'console': {
      await import('./console/main.js');
      break;
    }
```

- [ ] **Step 4: 创建 `scripts/smoke-layout.ts`**（cat 占位，验证分屏 + 运行时增删，零 token，不起 claude/console）：
```ts
import { ITerm2Driver } from '../src/terminal/iterm.js';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const d = new ITerm2Driver();
  const consoleSid = await d.launch({ cwd: '/tmp', command: 'echo CONSOLE; cat' });
  await sleep(800);
  let right = await d.splitFrom(consoleSid, 'vertical', { cwd: '/tmp', command: 'echo EMP1; cat' });
  await sleep(500);
  right = await d.splitFrom(right, 'horizontal', { cwd: '/tmp', command: 'echo EMP2; cat' });
  await sleep(500);
  console.log('注入 EMP2 ...'); await d.inject(right, 'hello-emp2', true); await sleep(600);
  const ok = (await d.readScreen(right)).includes('hello-emp2');
  console.log('运行时增员工 EMP3 ...'); const emp3 = await d.splitFrom(right, 'horizontal', { cwd: '/tmp', command: 'echo EMP3; cat' });
  await sleep(600);
  console.log('删 EMP3 pane ...'); await d.closePane(emp3); await sleep(500);
  console.log(ok ? '✅ LAYOUT SMOKE PASS' : '❌ FAIL');
  await sleep(2000); await d.close(consoleSid); process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5:** `npx tsc --noEmit`（clean）+ `npm test`（全过）。运行 `npx tsx scripts/smoke-layout.ts` → 观察一个窗口左 console + 右两 pane、注入命中、加/删 pane，打印 `✅ LAYOUT SMOKE PASS`。

- [ ] **Step 6: Commit** `git add src/index.ts src/cli.ts scripts/smoke-layout.ts && git commit -m "feat: up split-layout + runtime add/remove + console subcommand + layout smoke"`

---

## Self-Review（对照 spec §4–5）
- splitFrom/closePane（§4.1）→ T1 ✅；Router.removeAgent（§4.3）→ T2 ✅；输入解析（§4.5）→ T3 ✅；/admin/add|remove + 回调（§4.4）→ T4 ✅；Ink TUI（§4.5）→ T5 ✅；分屏布局 + 运行时增删装配 + console 子命令（§4.2,§5）→ T6 ✅。
- 占位符：无 TBD。Ink 渲染半自动验证（解析逻辑已单测）。
- 类型一致：`splitFrom`/`closePane`/`removeAgent`/`BusDeps.onAddAgent|onRemoveAgent`/`parseConsoleInput`/`ConsoleAction`/`launchInto` 跨任务一致。
- 回归：T1/T2/T4 各自不破坏既有；T6 重写 up 后跑全量 + 布局冒烟。
- **lastRight 闭包提升**：Step 1 注里已标明声明位置，避免 TS use-before-declare。

## 交付物
`dagent up` 起一个 iTerm 窗口：左 Ink 控制台（花名册/状态/消息流/输入）、右平铺员工;控制台可 `@私聊`、群发、`/add`、`/remove`;运行时增删员工经 admin 回调落到 split/closePane + router。
