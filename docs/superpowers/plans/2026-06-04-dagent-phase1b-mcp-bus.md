# dagent Phase 1B — MCP 总线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 Phase 1A(Router + ITerm2Driver)之上接一条 MCP HTTP 总线,让真实 CLI agent 通过 `register/sendmsg/idle/who` 四个工具驱动 dagent,并在最后一个里程碑用两个真实 Claude agent 验证 A↔B 对话与 B2 回传机制。

**Architecture:** 单 Node 进程内起一个 HTTP server(`@modelcontextprotocol/sdk` 1.29.0,**无状态 streamable HTTP**:每个 POST 现建一个 McpServer,工具闭包持有 agent 名+共享 Router)。sender 由 URL 路径 `/agent/<name>/mcp` 推断。orchestrator 启动每个 agent 的 iTerm 窗口(带指向自身路径的 MCP 配置)、轮询就绪、注入 bootstrap、等其调 `register`。Router 已就绪(1A),sessionId 在 launch 时由 orchestrator 记入 name→sessionId 映射,`register` 工具据此调 `router.register(name, sessionId)`。

**Tech Stack:** TypeScript/Node 24 (ESM), `@modelcontextprotocol/sdk@1.29.0`, `zod/v4`, vitest, tsx, osascript。

**Spike 已验证(2026-06-04，见 `spike/mcp/`):** 包 `@modelcontextprotocol/sdk@1.29.0`;import 用 `.js` 后缀;`zod/v4`;无状态模式(`sessionIdGenerator: undefined`)+ 每 POST 现建 server + URL 路径取 agent 名 = 干净的 per-connection 身份;`handleRequest(req,res,parsedBody)` 需预解析 body;GET 收 405 但 client 容忍。

---

## File Structure
```
src/
  core/
    config.ts        # DagentConfig 类型 + loadConfig
  bus/
    server.ts        # startBus：HTTP + 4 工具，按路径取身份，接 Router
  agent/
    mcp-config.ts    # 为每个 agent 生成 claude --mcp-config 用的 JSON + 启动命令
  orchestrator.ts    # (1A 已有) 扩展：name→sessionId 映射、launchAgent 序列、seed
  index.ts           # `dagent up`：读配置→起总线→启动 agents→生命周期
tests/
  core/config.test.ts
  bus/server.test.ts          # 用真实 SDK client 往返 + 真实 Router + FakeDriver
  agent/mcp-config.test.ts
scripts/
  smoke-2agents.ts            # 里程碑：两个真实 claude agent A↔B
dagent.config.example.json
```

---

### Task 1: 安装 MCP SDK 依赖

**Files:** Modify `package.json`

- [ ] **Step 1:** 安装并固定版本：
Run: `npm install @modelcontextprotocol/sdk@1.29.0 zod@^4`
Expected: 写入 dependencies。确认 `npm view @modelcontextprotocol/sdk version` ≥ 1.29 仍兼容；若 1.29.0 不可得，装最新 1.x 并在本计划其余处替换版本号。

- [ ] **Step 2:** 确认 `package.json` 的 `dependencies` 含 `@modelcontextprotocol/sdk` 与 `zod`。

- [ ] **Step 3:** Run `npm test`（仍 23 passed）+ `npx tsc --noEmit`（clean）。

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json && git commit -m "chore: add @modelcontextprotocol/sdk + zod deps"
```

---

### Task 2: DagentConfig 类型 + loadConfig（TDD）

**Files:** Create `src/core/config.ts`, `tests/core/config.test.ts`, `dagent.config.example.json`

- [ ] **Step 1: 写失败测试 `tests/core/config.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { parseConfig } from '../../src/core/config.js';

const valid = {
  busPort: 7878,
  agents: [
    { name: 'alice', cli: 'claude', cwd: '/tmp/a', role: 'manager', bootstrap: 'hi alice' },
    { name: 'bob', cli: 'claude', cwd: '/tmp/b', bootstrap: 'hi bob' },
  ],
  routes: { manager: 'alice' },
};

test('parseConfig accepts a valid config and defaults routes to empty', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] });
  expect(cfg.busPort).toBe(1);
  expect(cfg.routes).toEqual({});
  expect(cfg.agents[0].role).toBeUndefined();
});

test('parseConfig preserves routes and roles', () => {
  const cfg = parseConfig(valid);
  expect(cfg.routes).toEqual({ manager: 'alice' });
  expect(cfg.agents[0].role).toBe('manager');
});

test('parseConfig rejects duplicate agent names', () => {
  expect(() =>
    parseConfig({ busPort: 1, agents: [
      { name: 'x', cli: 'claude', cwd: '/a', bootstrap: 'b' },
      { name: 'x', cli: 'claude', cwd: '/b', bootstrap: 'b' },
    ] }),
  ).toThrow(/duplicate agent name/);
});

test('parseConfig rejects empty agents', () => {
  expect(() => parseConfig({ busPort: 1, agents: [] })).toThrow(/at least one agent/);
});

test('parseConfig rejects a route pointing to an unknown agent', () => {
  expect(() =>
    parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/a', bootstrap: 'b' }], routes: { m: 'ghost' } }),
  ).toThrow(/route .* unknown agent/);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/core/config.test.ts` → FAIL.

- [ ] **Step 3: 实现 `src/core/config.ts`:**
```ts
import type { AgentName } from './types.js';

export interface AgentConfig {
  name: AgentName;
  cli: string;   // 例如 "claude"
  cwd: string;
  role?: string;
  bootstrap: string;
}

export interface DagentConfig {
  busPort: number;
  agents: AgentConfig[];
  routes: Record<string, AgentName>;
}

/** 校验并归一化原始配置对象。抛错即配置非法。 */
export function parseConfig(raw: any): DagentConfig {
  if (!raw || typeof raw !== 'object') throw new Error('config must be an object');
  if (typeof raw.busPort !== 'number') throw new Error('config.busPort must be a number');
  if (!Array.isArray(raw.agents) || raw.agents.length === 0)
    throw new Error('config.agents must have at least one agent');

  const names = new Set<string>();
  const agents: AgentConfig[] = raw.agents.map((a: any, i: number) => {
    for (const f of ['name', 'cli', 'cwd', 'bootstrap'] as const) {
      if (typeof a?.[f] !== 'string' || a[f].length === 0)
        throw new Error(`config.agents[${i}].${f} must be a non-empty string`);
    }
    if (names.has(a.name)) throw new Error(`duplicate agent name: ${a.name}`);
    names.add(a.name);
    return { name: a.name, cli: a.cli, cwd: a.cwd, role: a.role, bootstrap: a.bootstrap };
  });

  const routes: Record<string, AgentName> = raw.routes ?? {};
  for (const [alias, target] of Object.entries(routes)) {
    if (!names.has(target as string))
      throw new Error(`route "${alias}" -> unknown agent "${target}"`);
  }

  return { busPort: raw.busPort, agents, routes };
}
```

- [ ] **Step 4:** Run `npx vitest run tests/core/config.test.ts` → PASS (5). Then `npm test` + `npx tsc --noEmit`.

- [ ] **Step 5:** 创建 `dagent.config.example.json`:
```json
{
  "busPort": 7878,
  "agents": [
    { "name": "alice", "cli": "claude", "cwd": "/tmp/dagent-alice", "role": "manager",
      "bootstrap": "你是 alice。先调用 register 报到；收到形如「来自 X」的消息后，务必用 sendmsg(to=\"X\", message=\"...\") 回复，不要只在窗口里作答；本回合无更多动作时调用 idle。" },
    { "name": "bob", "cli": "claude", "cwd": "/tmp/dagent-bob", "role": "dev",
      "bootstrap": "你是 bob。先调用 register 报到；收到「来自 X」的消息务必用 sendmsg 回复 X；收尾调用 idle。" }
  ],
  "routes": { "manager": "alice" }
}
```

- [ ] **Step 6: Commit**
```bash
git add src/core/config.ts tests/core/config.test.ts dagent.config.example.json
git commit -m "feat(core): DagentConfig + parseConfig validation"
```

---

### Task 3: MCP 总线（register/sendmsg/idle/who）

**Files:** Create `src/bus/server.ts`, `tests/bus/server.test.ts`

**说明：** 用 spike 已验证的无状态模式。`startBus` 接收一个 `BusDeps`（Router + 取 sessionId 的回调），返回可关闭的句柄。工具按 URL 路径推断 sender。

- [ ] **Step 1: 写失败测试 `tests/bus/server.test.ts`**（用真实 SDK client 往返 + 真实 Router + FakeDriver）：
```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let driver: FakeDriver;
let router: Router;
const sessions = new Map<string, string>();

async function callTool(agent: string, name: string, args: Record<string, unknown> = {}) {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
  const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res: any = await client.callTool({ name, arguments: args });
  await client.close();
  return JSON.parse(res.content[0].text);
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  router.addAgent('bob');
  // 模拟 orchestrator 在 launch 时已记录每个 agent 的 sessionId
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  bus = await startBus({ router, getSessionId: (n) => sessions.get(n) }, 0); // port 0 = 任意空闲端口
});

afterEach(async () => { await bus.close(); });

test('register flips the calling agent to idle (identity from path)', async () => {
  const r = await callTool('alice', 'register');
  expect(r.ok).toBe(true);
  expect(r.you).toBe('alice');
  expect(router.get('alice')!.status).toBe('idle');
});

test('sendmsg routes from the path-identified sender to the target and injects', async () => {
  await callTool('alice', 'register');
  await callTool('bob', 'register');
  const r = await callTool('alice', 'sendmsg', { to: 'bob', message: 'ping' });
  expect(r.ok).toBe(true);
  // bob 收到注入
  expect(driver.injections.some((i) => i.sessionId === sessions.get('bob') && i.text.includes('ping'))).toBe(true);
  expect(driver.injections.some((i) => i.text.includes('alice'))).toBe(true);
});

test('idle pumps the next queued message', async () => {
  await callTool('alice', 'register');
  await callTool('bob', 'register');
  await callTool('alice', 'sendmsg', { to: 'bob', message: 'first' });  // bob busy
  await callTool('alice', 'sendmsg', { to: 'bob', message: 'second' }); // queued
  const before = driver.injections.length;
  await callTool('bob', 'idle');
  expect(driver.injections.length).toBe(before + 1);
});

test('sendmsg to unknown target returns ok:false', async () => {
  await callTool('alice', 'register');
  const r = await callTool('alice', 'sendmsg', { to: 'ghost', message: 'x' });
  expect(r.ok).toBe(false);
});

test('who returns the roster with statuses', async () => {
  await callTool('alice', 'register');
  const r = await callTool('bob', 'who');
  const names = r.roster.map((a: any) => a.name).sort();
  expect(names).toEqual(['alice', 'bob']);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/bus/server.test.ts` → FAIL.

- [ ] **Step 3: 实现 `src/bus/server.ts`:**
```ts
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { Router } from '../core/router.js';

const PATH_RE = /^\/agent\/([^/]+)\/mcp$/;

export interface BusDeps {
  router: Router;
  getSessionId(name: string): string | undefined;
}

export interface Bus {
  port: number;
  close(): Promise<void>;
}

function ok(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

/** 为某个 agent 现建一个 McpServer，工具闭包持有该 agent 名 + 共享 deps。 */
function serverForAgent(agentName: string, deps: BusDeps): McpServer {
  const { router } = deps;
  const server = new McpServer({ name: `dagent-bus-${agentName}`, version: '1.0.0' }, { capabilities: {} });

  server.registerTool('register', { description: '报到：告知 dagent 你已就绪', inputSchema: {} }, async () => {
    const sid = deps.getSessionId(agentName);
    if (!sid) return ok({ ok: false, error: 'no session for agent' });
    router.register(agentName, sid);
    return ok({ ok: true, you: agentName, roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  server.registerTool('sendmsg', {
    description: '给某个同事/角色发消息', inputSchema: { to: z.string(), message: z.string() },
  }, async ({ to, message }) => {
    const msg = router.send(agentName, to, message);
    return msg ? ok({ ok: true, id: msg.id, to: msg.to }) : ok({ ok: false, error: `unknown or dead target: ${to}` });
  });

  server.registerTool('idle', { description: '本回合收尾，释放空闲状态', inputSchema: {} }, async () => {
    router.onIdle(agentName);
    return ok({ ok: true });
  });

  server.registerTool('who', { description: '查看在线花名册', inputSchema: {} }, async () => {
    return ok({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status })) });
  });

  return server;
}

export function startBus(deps: BusDeps, port: number): Promise<Bus> {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const match = PATH_RE.exec(url.pathname);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    const agentName = match[1];

    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { body = undefined; }
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = serverForAgent(agentName, deps);
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  return new Promise((resolve) => {
    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise<void>((r) => httpServer.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 4:** Run `npx vitest run tests/bus/server.test.ts` → PASS (5). Then `npm test` + `npx tsc --noEmit`.
  - 若 client 连接因 GET-SSE 405 报错而非容忍：在测试里改用 `client.callTool` 前不显式开流即可（SDK 默认容忍）；如仍有问题，参考 `spike/mcp/` 的可运行版本对齐。

- [ ] **Step 5: Commit**
```bash
git add src/bus/server.ts tests/bus/server.test.ts
git commit -m "feat(bus): MCP HTTP bus (register/sendmsg/idle/who) wired to Router"
```

---

### Task 4: 每 agent 的 MCP 配置 + 启动命令生成（TDD）

**Files:** Create `src/agent/mcp-config.ts`, `tests/agent/mcp-config.test.ts`

**说明：** 为 Claude Code 生成一个 `--mcp-config` JSON（指向该 agent 的总线路径），并拼出启动命令。Claude 的 MCP 配置文件格式：`{ "mcpServers": { "dagent": { "type": "http", "url": "<url>" } } }`。

- [ ] **Step 1: 写失败测试 `tests/agent/mcp-config.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { mcpConfigFor, launchCommandFor } from '../../src/agent/mcp-config.js';

test('mcpConfigFor builds an http MCP config pointing at the agent path', () => {
  const cfg = mcpConfigFor('alice', 7878);
  expect(cfg).toEqual({
    mcpServers: { dagent: { type: 'http', url: 'http://127.0.0.1:7878/agent/alice/mcp' } },
  });
});

test('launchCommandFor (claude) includes the mcp config path and skip-permissions', () => {
  const cmd = launchCommandFor('claude', '/tmp/alice-mcp.json');
  expect(cmd).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions');
});

test('launchCommandFor (codex) uses codex flags', () => {
  const cmd = launchCommandFor('codex', '/tmp/alice-mcp.json');
  expect(cmd).toContain('codex');
  expect(cmd).toContain('/tmp/alice-mcp.json');
});
```

- [ ] **Step 2:** Run `npx vitest run tests/agent/mcp-config.test.ts` → FAIL.

- [ ] **Step 3: 实现 `src/agent/mcp-config.ts`:**
```ts
export interface McpConfigFile {
  mcpServers: { dagent: { type: 'http'; url: string } };
}

export function mcpConfigFor(agentName: string, busPort: number): McpConfigFile {
  return {
    mcpServers: {
      dagent: { type: 'http', url: `http://127.0.0.1:${busPort}/agent/${agentName}/mcp` },
    },
  };
}

/** 拼出在终端里启动该 CLI 并连上 dagent 总线的命令。 */
export function launchCommandFor(cli: string, mcpConfigPath: string): string {
  switch (cli) {
    case 'claude':
      return `claude --mcp-config ${mcpConfigPath} --dangerously-skip-permissions`;
    case 'codex':
      // Codex 用 --config 指向含 mcp_servers 的 TOML/JSON；此处占位为可工作的近似，
      // 真实 Codex 接入在 1B 里程碑按其当前 flag 校准（见 Task 7 备注）。
      return `codex --config ${mcpConfigPath}`;
    default:
      throw new Error(`unsupported cli: ${cli}`);
  }
}
```
> 备注：Codex 的精确 flag 在 Task 7 里程碑用真实 codex 校准；1B 首个验证用 claude×2，故 codex 分支先给近似并标注。

- [ ] **Step 4:** Run `npx vitest run tests/agent/mcp-config.test.ts` → PASS (3). Then `npm test` + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/agent/mcp-config.ts tests/agent/mcp-config.test.ts
git commit -m "feat(agent): per-agent MCP config + launch command builder"
```

---

### Task 5: Orchestrator 扩展 — 就绪检测纯函数（TDD）+ launchAgent 序列

**Files:** Modify `src/orchestrator.ts`, create `tests/orchestrator-ready.test.ts`

**说明：** 把"读屏判断状态"的纯逻辑抽成可测函数 `detectScreenState(screen)`；`launchAgent` 编排（建窗→写配置→已在 launch 命令里起 CLI→轮询读屏处理信任对话→注入 bootstrap）是 I/O，靠 Task 7 里程碑验证。

- [ ] **Step 1: 写失败测试 `tests/orchestrator-ready.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { detectScreenState } from '../src/orchestrator.js';

test('detects the trust dialog', () => {
  expect(detectScreenState('... Is this a project you created or one you trust? ... 1. Yes, I trust')).toBe('trust-dialog');
});

test('detects the ready prompt (claude box)', () => {
  expect(detectScreenState('Claude Code v2.1.161\n❯ \n  for agents')).toBe('ready');
});

test('returns starting when neither marker present', () => {
  expect(detectScreenState('Last login: ...\n$ claude')).toBe('starting');
});
```

- [ ] **Step 2:** Run `npx vitest run tests/orchestrator-ready.test.ts` → FAIL.

- [ ] **Step 3: 在 `src/orchestrator.ts` 追加（不动现有 formatMessage/makeDeliverer）:**
```ts
export type ScreenState = 'trust-dialog' | 'ready' | 'starting';

/** 从读屏文本判断 CLI 启动阶段（用于决定注入信任选择 / bootstrap）。 */
export function detectScreenState(screen: string): ScreenState {
  if (/trust this folder|you trust\?/i.test(screen)) return 'trust-dialog';
  if (/❯/.test(screen)) return 'ready';
  return 'starting';
}
```

- [ ] **Step 4:** Run `npx vitest run tests/orchestrator-ready.test.ts` → PASS (3). Then `npm test` + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add src/orchestrator.ts tests/orchestrator-ready.test.ts
git commit -m "feat(orchestrator): detectScreenState for launch readiness"
```

---

### Task 6: `dagent up` 装配 + 生命周期

**Files:** Create `src/index.ts`

**说明：** 读配置→起总线→为每个 agent：写 MCP 配置文件到临时目录、`launchAgent`(建窗+起 CLI)→记 sessionId→轮询读屏(信任对话注 Enter、ready 后注 bootstrap)→等其 `register`(超时兜底)。提供 `dagent up <config>`。launch/poll 是 I/O,本任务只装配并保证编译与基本启动不崩;真实多 agent 验证在 Task 7。

- [ ] **Step 1: 实现 `src/index.ts`:**
```ts
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus } from './bus/server.js';
import { mcpConfigFor, launchCommandFor } from './agent/mcp-config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function up(configPath: string) {
  const cfg = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const driver = new ITerm2Driver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes,
  });
  for (const a of cfg.agents) router.addAgent(a.name, a.role);

  const sessions = new Map<string, string>();
  const bus = await startBus({ router, getSessionId: (name) => sessions.get(name) }, cfg.busPort);
  console.log(`[dagent] bus on :${bus.port}`);

  const tmp = mkdtempSync(join(tmpdir(), 'dagent-'));
  for (const a of cfg.agents) {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));
    const command = launchCommandFor(a.cli, cfgPath);
    const sid = await driver.launch({ cwd: a.cwd, command });
    sessions.set(a.name, sid);
    console.log(`[dagent] launched ${a.name} (${sid})`);

    // 轮询就绪：处理信任对话，到 ready 后注入 bootstrap
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const screen = await driver.readScreen(sid);
      const state = detectScreenState(screen);
      if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
      if (state === 'ready') { await driver.inject(sid, a.bootstrap, true); break; }
    }
  }
  console.log('[dagent] all agents launched; awaiting register + activity. Ctrl-C to stop.');
  // 进程常驻：总线在跑；用户可在窗口里手动干预或用 seed 脚本起话题
}

const configPath = process.argv[2] ?? 'dagent.config.json';
up(configPath).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2:** `npx tsc --noEmit`（clean）+ `npm test`（无回归）。

- [ ] **Step 3:** 加 `package.json` 脚本：`"up": "tsx src/index.ts"`。

- [ ] **Step 4: Commit**
```bash
git add src/index.ts package.json && git commit -m "feat: dagent up — wire bus + launch agents + bootstrap"
```

---

### Task 7: 里程碑 — 两个真实 Claude agent A↔B（半自动）+ 敲定 B2 回传

**Files:** Create `scripts/smoke-2agents.ts`, write findings into `docs/superpowers/specs/2026-06-03-dagent-design.md` (§6 回传机制)

**目标：** 用两个真实 claude agent 验证端到端:register→seed 话题→A 用 sendmsg 问 B→B 收到注入→B 用 sendmsg 回 A。**这是敲定 B2(agent 是否可靠用 sendmsg 回复 vs 需读屏兜底)的里程碑。** 会花少量 claude token。

- [ ] **Step 1: 准备目录** `mkdir -p /tmp/dagent-alice /tmp/dagent-bob`，写一个 `dagent.config.json`（基于 example，两个 claude agent）。

- [ ] **Step 2: 实现 `scripts/smoke-2agents.ts`**：复用 `up` 的装配，但在两个 agent 都 `register` 后（轮询 `router.get(name).status==='idle'`，超时 60s），向 alice 注入 seed：`router.send('system','alice','请用 sendmsg 问 bob：今天几号？拿到回复后调 idle。')`，然后每 2s 打印 `router.roster()` 状态与各窗口 `readScreen` 末尾若干行，持续 60s，观察是否出现 alice→bob→alice 的 sendmsg 往返（bob 窗口出现「来自 alice」、alice 窗口出现「来自 bob」）。最后关窗。

- [ ] **Step 3: 运行** `tsx scripts/smoke-2agents.ts`。人工观察两窗口与日志：
  - ✅ 若 B 在收到注入后**自己调了 sendmsg 回 A**（A 窗口出现「来自 bob」）→ B2「纯工具回传」成立。
  - ❌ 若 B 只在自己窗口里用自然语言作答、没调 sendmsg → B2 需「读屏兜底」：记录现象，进入 Step 4。

- [ ] **Step 4: 据观察更新 spec §6 回传机制**：把"回传"从待定改为结论（纯工具 / 工具+读屏兜底)。若需读屏兜底，在 spec 写明：orchestrator 在注入后启动一个读屏轮询,从目标窗口新增输出里抽取回复并 `router.send(目标, 原发送者, 抽取文本)`；此为 Phase 1C 的明确任务（不在 1B 实现，仅定论与规格）。

- [ ] **Step 5: Commit**
```bash
git add scripts/smoke-2agents.ts docs/superpowers/specs/2026-06-03-dagent-design.md
git commit -m "test(milestone): 2 real claude agents A<->B; settle B2 reply mechanism"
```

---

## Self-Review（对照 spec）
- **spec §3/§5 总线、按路径身份** → Task 3（spike 已验证模式）✅
- **spec §6 四工具 register/sendmsg/idle/who + 回传约定** → Task 3（工具）+ Task 7（敲定回传）✅
- **spec §7 角色路由** → Task 2 routes 入 Router（1A resolve 已支持）✅
- **spec §12 配置 + 启动序列 + per-agent MCP 配置 + 前置对话处理** → Task 2/4/5/6 ✅
- **spec §16 待验证：Claude HTTP MCP 按路径区分 sender** → Task 3 测试用真实 SDK client 证;**真实 claude 连接**在 Task 7 里程碑证 ✅
- **占位符扫描：** 无 TBD。Codex 启动 flag 明确标注为 Task 7 校准项(1B 用 claude×2),非占位而是有意延后。
- **类型一致性：** `Router`/`makeDeliverer`/`FakeDriver`/`Bus`/`BusDeps`/`parseConfig`/`mcpConfigFor`/`launchCommandFor`/`detectScreenState` 跨任务签名一致;`getSessionId` 在 Task 3 测试与 Task 6 装配中用法一致。
- **范围外（Phase 1C/后续）：** 读屏回传兜底的实现(1B 仅定论)、循环/预算防护(Plan 2)、人 CLI(Plan 3)、stuck 计时与 reconnect 守卫、Codex 精确接入。

## 交付物
真实 agent 可通过 MCP 总线 register/sendmsg/idle/who 驱动 dagent;`dagent up` 一键起总线+多窗口+bootstrap;两个真实 claude agent 的 A↔B 往返里程碑敲定 B2 回传机制(系统最后一个软假设)。
