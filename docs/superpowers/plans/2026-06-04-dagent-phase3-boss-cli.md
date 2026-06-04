# dagent Phase 3 — 老板 CLI 入口（人作为参与者）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 让"老板"（人）以特殊成员 `boss` 参与办公室：用 `dagent say/broadcast/roster/log` 子命令给员工发消息、群发、查看花名册与消息流水。通过在已运行的 `dagent up` 进程的总线 HTTP server 上增设 admin 路由实现；CLI 子命令读 runtime 端口文件后 HTTP 调用。

**Architecture:** `dagent up` 进程已托管一个 HTTP server（MCP 总线）。在同一 server 上加 `/admin/*` 路由（在 `/agent/.../mcp` 路由之前判断）。boss→员工走已验证的 `router.send('boss', agent, msg)` 注入路径；员工→boss 通过把 `boss` 注册为**虚拟成员**（无窗口、消息只入全局日志、不注入）接收。`dagent up` 启动时把实际端口写入 `.dagent-runtime.json`，CLI 子命令读它再 HTTP 调 admin 路由。全部可测，无需真实 agent（注入路径 1B 已验证）。

**Tech Stack:** TypeScript/Node, vitest（admin 路由用 Node http client 真实往返测试）。

**关键设计：**
- **全局消息日志**：`Router` 记录每条成功创建的消息，`messages()` 暴露，供 `/admin/log`。
- **虚拟成员 boss**：`router.addVirtual('boss')` → 状态 idle、`virtual=true`、无 sessionId。`send` 到虚拟目标时只入日志、**不入 inbox、不注入、不置 busy**（boss 无窗口，回复供人查看日志）。
- **admin 路由**：`GET /admin/roster`、`GET /admin/log`、`POST /admin/say {to,message}`、`POST /admin/broadcast {message}`。
- **runtime 端口文件**：`dagent up` 写 `.dagent-runtime.json {port}`；CLI 读它。

---

## File Structure
```
src/core/
  types.ts        # AgentRuntime.virtual?
  router.ts       # messageLog + messages() + addVirtual() + send 虚拟短路
src/bus/
  server.ts       # /admin/* 路由（roster/log/say/broadcast）
src/
  cli.ts          # dagent 子命令入口（say/broadcast/roster/log/up）
  index.ts        # up：写 runtime 文件、addVirtual('boss')
tests/core/
  router-virtual.test.ts
tests/bus/
  admin.test.ts
```

---

### Task 1: Router 全局日志 + 虚拟成员（TDD）

**Files:** Modify `src/core/types.ts`, `src/core/router.ts`; create `tests/core/router-virtual.test.ts`

- [ ] **Step 1: `src/core/types.ts`** —— 给 `AgentRuntime` 加 `virtual?: boolean;`（注释：虚拟成员（如 boss）：无窗口，消息只入日志不注入）。其余不变。

- [ ] **Step 2: 写失败测试 `tests/core/router-virtual.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup() {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = { deliver: (agent, msg) => delivered.push({ agent, msg }) };
  let n = 0;
  const router = new Router(deliverer, { now: () => 1, genId: () => `m${++n}` });
  router.addAgent('alice');
  router.register('alice', 'SA');
  router.addVirtual('boss');
  return { router, delivered };
}

test('addVirtual registers an idle, window-less member', () => {
  const { router } = setup();
  const b = router.get('boss')!;
  expect(b.status).toBe('idle');
  expect(b.virtual).toBe(true);
  expect(b.sessionId).toBeUndefined();
});

test('sending to a virtual member logs but does NOT deliver/inject', () => {
  const { router, delivered } = setup();
  const msg = router.send('alice', 'boss', 'here is my reply');
  expect(msg).toBeTruthy();
  expect(delivered).toHaveLength(0);                 // 未注入
  expect(router.get('boss')!.status).toBe('idle');   // 未置 busy
  expect(router.messages().some((m) => m.to === 'boss' && m.body === 'here is my reply')).toBe(true);
});

test('messages() records all successful sends in order', () => {
  const { router } = setup();
  router.send('boss', 'alice', 'task one');   // boss -> alice (real, delivered)
  router.send('alice', 'boss', 'done');       // alice -> boss (virtual, logged)
  const log = router.messages();
  expect(log.map((m) => `${m.from}->${m.to}:${m.body}`)).toEqual([
    'boss->alice:task one',
    'alice->boss:done',
  ]);
});

test('sending to a real member still delivers (regression)', () => {
  const { router, delivered } = setup();
  router.send('boss', 'alice', 'hi');
  expect(delivered).toHaveLength(1);
  expect(delivered[0].agent.name).toBe('alice');
});
```

- [ ] **Step 3: 运行确认失败** `npx vitest run tests/core/router-virtual.test.ts`。

- [ ] **Step 4: 修改 `src/core/router.ts`:**
(a) 在类内加字段与访问器（放在 `private agents` 附近）：
```ts
  private messageLog: Message[] = [];

  /** 全局消息流水（供 admin /log 查看）。 */
  messages(): Message[] {
    return [...this.messageLog];
  }

  /** 注册一个虚拟成员（如 boss）：无窗口、立即 idle、消息只入日志不注入。 */
  addVirtual(name: AgentName, role?: string): void {
    this.agents.set(name, { name, role, status: 'idle', inbox: [], virtual: true });
  }
```
(b) 在 `send` 中，于创建 `msg` 之后、`a.inbox.push` 之前，加入日志记录与虚拟短路。把 `send` 末尾：
```ts
    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now(), thread };
    a.inbox.push(msg);
    this.pump(a);
    return msg;
```
改为：
```ts
    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now(), thread };
    this.messageLog.push(msg);
    if (a.virtual) return msg;       // 虚拟成员：只记日志，不注入、不置 busy
    a.inbox.push(msg);
    this.pump(a);
    return msg;
```
（注：`thread` 变量在无 guards 时为 `undefined`，与现状一致。）

- [ ] **Step 5: 运行** `npx vitest run tests/core/router-virtual.test.ts` → PASS (4)。再跑 `npx vitest run tests/core/router.test.ts` 确认 8 个旧测试仍过（虚拟短路只对 virtual 目标生效，普通路径加了一行 log push 不影响断言）。然后 `npm test` + `npx tsc --noEmit`。

- [ ] **Step 6: Commit**
```bash
git add src/core/types.ts src/core/router.ts tests/core/router-virtual.test.ts
git commit -m "feat(core): message log + virtual member (boss) in Router"
```

---

### Task 2: 总线 admin 路由（TDD）

**Files:** Modify `src/bus/server.ts`; create `tests/bus/admin.test.ts`

**说明：** 在 `startBus` 的 http handler 中，于现有 `/agent/.../mcp` 匹配之前，先处理 `/admin/*`。复用现有 body 预解析。`/admin/say`/`/broadcast` 以 `boss` 身份调 `router.send`。

- [ ] **Step 1: 写失败测试 `tests/bus/admin.test.ts`:**
```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus; let driver: FakeDriver; let router: Router;
const sessions = new Map<string, string>();

async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addAgent('alice'); router.addAgent('bob');
  router.addVirtual('boss');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  router.register('alice', sessions.get('alice')!);
  router.register('bob', sessions.get('bob')!);
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

test('GET /admin/roster returns all members incl boss', async () => {
  const { status, json } = await http('GET', '/admin/roster');
  expect(status).toBe(200);
  expect(json.roster.map((a: any) => a.name).sort()).toEqual(['alice', 'bob', 'boss']);
});

test('POST /admin/say injects boss message into the target', async () => {
  const { json } = await http('POST', '/admin/say', { to: 'alice', message: 'hello team' });
  expect(json.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('alice') && i.text.includes('hello team'))).toBe(true);
  expect(driver.injections.some((i) => i.text.includes('boss'))).toBe(true);
});

test('POST /admin/say to unknown target returns ok:false', async () => {
  const { json } = await http('POST', '/admin/say', { to: 'ghost', message: 'x' });
  expect(json.ok).toBe(false);
});

test('POST /admin/broadcast sends to all real members, not boss itself', async () => {
  const { json } = await http('POST', '/admin/broadcast', { message: '全体注意' });
  expect(json.sent.sort()).toEqual(['alice', 'bob']);
  expect(driver.injections.filter((i) => i.text.includes('全体注意')).length).toBe(2);
});

test('GET /admin/log returns the message log', async () => {
  await http('POST', '/admin/say', { to: 'alice', message: 'logged-msg' });
  const { json } = await http('GET', '/admin/log');
  expect(json.log.some((m: any) => m.to === 'alice' && m.body === 'logged-msg' && m.from === 'boss')).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败** `npx vitest run tests/bus/admin.test.ts`。

- [ ] **Step 3: 修改 `src/bus/server.ts`** —— 在 `startBus` 的 `http.createServer` 回调里，解析 URL 后、MCP `PATH_RE` 匹配之前，加入 admin 处理。具体：在 `const url = new URL(...)` 之后、`const match = PATH_RE.exec(...)` 之前插入：
```ts
    // ---- admin 路由（人/老板入口）----
    if (url.pathname.startsWith('/admin/')) {
      const { router } = deps;
      const sendJson = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let body: any;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { body = {}; }
      }
      if (req.method === 'GET' && url.pathname === '/admin/roster') {
        return sendJson({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status, virtual: !!a.virtual })) });
      }
      if (req.method === 'GET' && url.pathname === '/admin/log') {
        return sendJson({ log: router.messages() });
      }
      if (req.method === 'POST' && url.pathname === '/admin/say') {
        const msg = router.send('boss', String(body.to), String(body.message));
        return sendJson(msg ? { ok: true, id: msg.id } : { ok: false, error: 'unknown or dropped' });
      }
      if (req.method === 'POST' && url.pathname === '/admin/broadcast') {
        const sent: string[] = [];
        for (const a of router.roster()) {
          if (a.virtual || a.status === 'dead' || a.name === 'boss') continue;
          if (router.send('boss', a.name, String(body.message))) sent.push(a.name);
        }
        return sendJson({ sent });
      }
      res.writeHead(404); res.end('unknown admin route');
      return;
    }
```
（注：`return sendJson(...)` 在 async handler 中提前返回，避免落到 MCP 处理。）

- [ ] **Step 4: 运行** `npx vitest run tests/bus/admin.test.ts` → PASS (5)。再跑 `npx vitest run tests/bus/server.test.ts` 确认原 5 个 MCP 测试仍过。然后 `npm test` + `npx tsc --noEmit`。

- [ ] **Step 5: Commit**
```bash
git add src/bus/server.ts tests/bus/admin.test.ts
git commit -m "feat(bus): admin routes (roster/log/say/broadcast) for boss"
```

---

### Task 3: `dagent` CLI 子命令 + runtime 端口文件 + 装配 boss

**Files:** Create `src/cli.ts`; modify `src/index.ts`, `package.json`

- [ ] **Step 1: 修改 `src/index.ts`** —— (a) 顶部已 import fs；在 `up` 内 `startBus` 之后写 runtime 文件、并注册 boss。把：
```ts
  const bus = await startBus({ router, getSessionId: (name) => sessions.get(name) }, cfg.busPort);
  console.log(`[dagent] bus on :${bus.port}`);
```
改为：
```ts
  router.addVirtual('boss');
  const bus = await startBus({ router, getSessionId: (name) => sessions.get(name) }, cfg.busPort);
  writeFileSync('.dagent-runtime.json', JSON.stringify({ port: bus.port }));
  console.log(`[dagent] bus on :${bus.port} (runtime written to .dagent-runtime.json)`);
```
(b) 把文件末尾的入口（`const configPath = process.argv[2] ...; up(...)`）**删除** —— 入口移到 `cli.ts`。改为导出 `up`：
将 `async function up(` 改为 `export async function up(`，并删掉文件底部的：
```ts
const configPath = process.argv[2] ?? 'dagent.config.json';
up(configPath).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 创建 `src/cli.ts`:**
```ts
import { readFileSync } from 'node:fs';
import { up } from './index.js';

function runtimePort(): number {
  try {
    return JSON.parse(readFileSync('.dagent-runtime.json', 'utf8')).port;
  } catch {
    console.error('找不到 .dagent-runtime.json —— dagent up 在运行吗？');
    process.exit(1);
  }
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${runtimePort()}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'up':
      await up(rest[0] ?? 'dagent.config.json');
      break;
    case 'say': {
      const [to, ...msg] = rest;
      console.log(await admin('POST', '/admin/say', { to, message: msg.join(' ') }));
      break;
    }
    case 'broadcast':
      console.log(await admin('POST', '/admin/broadcast', { message: rest.join(' ') }));
      break;
    case 'roster':
      console.log(JSON.stringify(await admin('GET', '/admin/roster'), null, 2));
      break;
    case 'log':
      console.log(JSON.stringify(await admin('GET', '/admin/log'), null, 2));
      break;
    default:
      console.log('用法: dagent <up|say <agent> <msg>|broadcast <msg>|roster|log>');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 修改 `package.json` scripts** —— 把 `"up": "tsx src/index.ts"` 改为 `"dagent": "tsx src/cli.ts"`，并加 `"up": "tsx src/cli.ts up"`。同时把 `.dagent-runtime.json` 加入 `.gitignore`。

- [ ] **Step 4:** 验证 `npx tsc --noEmit`（clean）+ `npm test`（全过，无回归）。冒烟 CLI 的 usage（不需真实 agent）：`npx tsx src/cli.ts` 应打印用法。`npx tsx src/cli.ts roster` 在无 runtime 文件时应报"dagent up 在运行吗？"并退出 1。

- [ ] **Step 5: Commit**
```bash
git add src/cli.ts src/index.ts package.json .gitignore
git commit -m "feat: dagent CLI (say/broadcast/roster/log/up) + runtime port file + boss member"
```

---

## Self-Review（对照 spec §9）
- **`dagent say <agent> "msg"`（boss→员工注入）** → T2 /admin/say + T3 CLI ✅
- **`dagent broadcast`** → T2 /admin/broadcast（跳过 boss/dead/virtual）✅
- **`dagent roster`** → T2 /admin/roster（含 boss）✅
- **`dagent log`（观察消息流水）** → T1 messages() + T2 /admin/log ✅
- **boss 出现在 roster** → T1 addVirtual('boss') + T3 装配 ✅
- **员工回复 boss 落日志而非注入** → T1 虚拟短路 ✅
- **不破坏前序** → 普通路径仅加一行 log push；虚拟短路只对 virtual 目标；T1/T2 显式回归既有测试 ✅
- **占位符扫描**：无 TBD。
- **类型一致性**：`AgentRuntime.virtual`、`router.messages()`、`router.addVirtual()`、admin 路由形状、CLI 调用一致。

## 交付物
老板可用 `dagent say/broadcast/roster/log` 实时指挥并观察这屋子 agent;boss 作为虚拟成员让员工的回复可被人看到。至此 dagent v1 三期(终端驱动+Router、MCP 总线、防护、人入口)齐备。
