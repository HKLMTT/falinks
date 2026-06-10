# 员工失联检测 + /restart 命令 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 员工 CLI 没挂上 falinks MCP 工具时让 boss 看得见(⚠ 徽章+警告),并提供 `/restart <name> [fresh]` 一键带配置重启。

**Architecture:** 总线工具 handler 记录每个员工的 MCP 活动时间戳(服务端事实);两条纯函数判定规则(A-1 报到超时 / A-2 有活无声)在健康轮询里驱动 `unresponsive` 正交标志;/restart 复用 launchInto 链路重建 pane,`restarting` 守卫集合防轮询误下线。

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, Ink/React, @modelcontextprotocol/sdk。测试 `npm test`,构建 `npm run build`(**交付用户前必须 build,用户跑 dist/**)。

**Spec:** `docs/superpowers/specs/2026-06-10-agent-unresponsive-detection-and-restart-design.md`

---

### Task 1: Router 失联状态与方法

**Files:**
- Modify: `src/core/types.ts`(AgentRuntime,约 20-30 行)
- Modify: `src/core/router.ts`
- Test: `tests/core/router-unresponsive.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/router-unresponsive.test.ts
import { expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function mkRouter() {
  let n = 0;
  let now = 1000;
  const delivered: Message[] = [];
  const r = new Router(
    { deliver: (_a: AgentRuntime, m: Message) => delivered.push(m) },
    { now: () => now, genId: () => `m${++n}` },
  );
  return { r, delivered, setNow: (v: number) => { now = v; } };
}

test('touchMcp 记录时间戳并清 unresponsive 与哑巴计数', () => {
  const { r, setNow } = mkRouter();
  r.addAgent('alice');
  r.bumpMute('alice');
  r.markUnresponsive('alice');
  setNow(2000);
  r.touchMcp('alice');
  const a = r.get('alice')!;
  expect(a.lastMcpAt).toBe(2000);
  expect(a.unresponsive).toBe(false);
  expect(a.muteStreak).toBe(0);
});

test('touchMcp/touchMcpHttp 未知名宽容不抛(野请求可打任意路径)', () => {
  const { r } = mkRouter();
  expect(() => r.touchMcp('ghost')).not.toThrow();
  expect(() => r.touchMcpHttp('ghost')).not.toThrow();
});

test('touchMcpHttp 只记 HTTP 时间戳,不动 lastMcpAt', () => {
  const { r, setNow } = mkRouter();
  r.addAgent('alice');
  setNow(3000);
  r.touchMcpHttp('alice');
  const a = r.get('alice')!;
  expect(a.lastMcpHttpAt).toBe(3000);
  expect(a.lastMcpAt).toBeUndefined();
});

test('bumpMute 递增并返回当前计数', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  expect(r.bumpMute('alice')).toBe(1);
  expect(r.bumpMute('alice')).toBe(2);
  expect(r.bumpMute('ghost')).toBe(0); // 未知名宽容
});

test('markUnresponsive 边沿触发:首次 true,再标 false', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  expect(r.markUnresponsive('alice')).toBe(true);
  expect(r.markUnresponsive('alice')).toBe(false);
  expect(r.markUnresponsive('ghost')).toBe(false);
});

test('markLaunching 保留 inbox、状态回 launching、清失联痕迹', () => {
  const { r } = mkRouter();
  r.addAgent('alice');
  r.register('alice', 's1');          // idle
  r.send('boss-x', 'alice', 'one');   // 投出 → busy(发件人未知名也能送:send 只校验目标)
  r.send('boss-x', 'alice', 'two');   // 排队
  r.bumpMute('alice');
  r.markUnresponsive('alice');
  r.markLaunching('alice');
  const a = r.get('alice')!;
  expect(a.status).toBe('launching');
  expect(a.inbox.length).toBe(1);     // 排队消息保留
  expect(a.unresponsive).toBe(false);
  expect(a.muteStreak).toBe(0);
  expect(a.handling).toBeUndefined();
});
```

注意:`send` 的 from 不校验存在性(看 `router.ts:70-107`,只 resolve 目标),所以测试里 `boss-x` 可直接当发件人。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/router-unresponsive.test.ts`
Expected: FAIL,`touchMcp is not a function` 之类。

- [ ] **Step 3: 实现**

`src/core/types.ts` 的 `AgentRuntime` 末尾(`lead?` 之后)加:

```ts
  lastMcpAt?: number; // 最近一次该员工经 MCP 调用任意工具的时刻(服务端事实;失联检测的核心信号)
  lastMcpHttpAt?: number; // 最近一次命中该员工 MCP 端点的 HTTP 请求(CLI 启动 initialize 即有;只用于告警文案分流)
  unresponsive?: boolean; // 失联嫌疑(报到超时/有活无声):花名册 ⚠;收到任意 MCP 调用自愈
  muteStreak?: number; // 连续"有活无声"次数(投递后自动降闲且零 MCP 调用);touchMcp 清零
```

`src/core/router.ts` 在 `markStuck` 之后加(注意 touchMcp/touchMcpHttp 用 `agents.get` 宽容未知名,**不要**用 `must`):

```ts
  /** 员工经 MCP 调到任意工具(总线 handler 层调用;服务端代登记不算):活着的铁证,顺带自愈失联标志。 */
  touchMcp(name: AgentName): void {
    const a = this.agents.get(name); // 宽容未知名:任何人可 curl 任意 /agent/<name>/mcp
    if (!a) return;
    a.lastMcpAt = this.deps.now();
    a.unresponsive = false;
    a.muteStreak = 0;
  }

  /** 命中该员工 MCP 端点的任意 HTTP 请求(initialize/tools-list 也算):只作告警文案分流,不作触发条件。 */
  touchMcpHttp(name: AgentName): void {
    const a = this.agents.get(name);
    if (a) a.lastMcpHttpAt = this.deps.now();
  }

  /** 哑巴计数 +1(投递后自动降闲且零 MCP 调用),返回当前计数。 */
  bumpMute(name: AgentName): number {
    const a = this.agents.get(name);
    if (!a) return 0;
    a.muteStreak = (a.muteStreak ?? 0) + 1;
    return a.muteStreak;
  }

  /** 标失联嫌疑。返回是否为新标记(边沿触发:调用方据此只落一次诊断)。 */
  markUnresponsive(name: AgentName): boolean {
    const a = this.agents.get(name);
    if (!a || a.unresponsive) return false;
    a.unresponsive = true;
    return true;
  }

  /** 现有员工置回 launching(/restart 用):保留 inbox 排队消息,清 handling 与失联痕迹。 */
  markLaunching(name: AgentName): void {
    const a = this.agents.get(name);
    if (!a) return;
    a.status = 'launching';
    a.handling = undefined;
    a.handlingFrom = undefined;
    a.unresponsive = false;
    a.muteStreak = 0;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/router-unresponsive.test.ts`
Expected: 6 passed。再跑 `npx vitest run tests/core/` 确认无回归。

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/router.ts tests/core/router-unresponsive.test.ts
git commit -m "feat(router): 失联检测状态——touchMcp/哑巴计数/unresponsive 边沿标记/markLaunching"
```

---

### Task 2: 纯判定函数(A-1 报到超时 / A-2 有活无声)

**Files:**
- Modify: `src/orchestrator.ts`(文件末尾追加;与 `reconcilePaneStatus` 同风格的纯函数)
- Test: `tests/orchestrator-unresponsive.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// tests/orchestrator-unresponsive.test.ts
import { expect, test } from 'vitest';
import { checkRegisterTimeout, judgeAutoIdleSilence } from '../src/orchestrator.js';

// —— A-1 报到超时 ——
test('期限内出现 MCP 调用 → satisfied', () => {
  expect(checkRegisterTimeout({ now: 50_000, by: 90_000, since: 0, lastMcpAt: 30_000 })).toBe('satisfied');
});
test('期限已过且零调用 → timeout', () => {
  expect(checkRegisterTimeout({ now: 90_001, by: 90_000, since: 0, lastMcpAt: undefined })).toBe('timeout');
});
test('未到期且零调用 → waiting', () => {
  expect(checkRegisterTimeout({ now: 50_000, by: 90_000, since: 0, lastMcpAt: undefined })).toBe('waiting');
});
test('expectation 之前的旧调用不算数(since 之前)', () => {
  expect(checkRegisterTimeout({ now: 90_001, by: 90_000, since: 10_000, lastMcpAt: 5_000 })).toBe('timeout');
});

// —— A-2 有活无声 ——
test('投递后零 MCP 调用就自动降闲 → 计一次', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 0, lastMcpAt: undefined });
  expect(v).toEqual({ count: true, reset: false, countedAt: 100 });
});
test('投递后有 MCP 活动 → 不计且清计数(健康)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 0, lastMcpAt: 150 });
  expect(v).toEqual({ count: false, reset: true, countedAt: 100 });
});
test('同一次投递只计一次(observeBusy 再降闲不重复计)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 100, lastMcpAt: undefined });
  expect(v).toEqual({ count: false, reset: false, countedAt: 100 });
});
test('从未投递过 → 不计(前置守卫)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: undefined, countedAt: 0, lastMcpAt: undefined });
  expect(v).toEqual({ count: false, reset: false, countedAt: 0 });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/orchestrator-unresponsive.test.ts`
Expected: FAIL,导出不存在。

- [ ] **Step 3: 实现**

`src/orchestrator.ts` 末尾追加:

```ts
/**
 * A-1 报到超时判定(纯函数,健康轮询逐轮调用)。
 * since = bootstrap 交付时刻(claude=注入成功、codex=启动序列完成),by = since + 90s。
 * 员工在 since 之后有过任意 MCP 调用 → satisfied(调用方删除 expectation);
 * 过期仍无 → timeout(告警);否则 waiting。
 */
export function checkRegisterTimeout(opts: {
  now: number;
  by: number;
  since: number;
  lastMcpAt?: number;
}): 'satisfied' | 'timeout' | 'waiting' {
  if ((opts.lastMcpAt ?? 0) >= opts.since) return 'satisfied';
  if (opts.now > opts.by) return 'timeout';
  return 'waiting';
}

/**
 * A-2 有活无声判定(纯函数,自动降闲 mark-idle 时调用;员工自己调 idle 工具不会走到这)。
 * 每次投递最多贡献一次嫌疑(countedAt 去重,防 observeBusy 升降反复计同一条);
 * 投递后有 MCP 活动 = 健康 → reset 清哑巴计数;从未投递不计(observeBusy 场景守卫)。
 */
export function judgeAutoIdleSilence(opts: {
  deliveredAt?: number;
  countedAt: number;
  lastMcpAt?: number;
}): { count: boolean; reset: boolean; countedAt: number } {
  const d = opts.deliveredAt ?? 0;
  if (!d || d <= opts.countedAt) return { count: false, reset: false, countedAt: opts.countedAt };
  if ((opts.lastMcpAt ?? 0) >= d) return { count: false, reset: true, countedAt: d };
  return { count: true, reset: false, countedAt: d };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/orchestrator-unresponsive.test.ts`
Expected: 8 passed。

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator-unresponsive.test.ts
git commit -m "feat(orchestrator): A-1 报到超时 / A-2 有活无声 纯判定函数"
```

---

### Task 3: 总线打点 + roster 透出

**Files:**
- Modify: `src/bus/server.ts`
- Test: `tests/bus/touch.test.ts`(新建)

- [ ] **Step 1: 写失败测试**(harness 抄 `tests/bus/server.test.ts:1-34`)

```ts
// tests/bus/touch.test.ts
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
  router = new Router(makeDeliverer(driver), { now: () => Date.now(), genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  bus = await startBus({ router, getSessionId: (n2) => sessions.get(n2) }, 0);
});

afterEach(async () => { await bus.close(); });

test('任意工具调用都打点 lastMcpAt(以 who 为例,无副作用工具也算活着)', async () => {
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
  await callTool('alice', 'who');
  expect(router.get('alice')!.lastMcpAt).toBeGreaterThan(0);
});

test('MCP HTTP 连接(initialize)即打点 lastMcpHttpAt,早于任何工具调用', async () => {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/alice/mcp`);
  const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url)); // 只 initialize,不调工具
  await client.close();
  expect(router.get('alice')!.lastMcpHttpAt).toBeGreaterThan(0);
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
});

test('服务端代登记(resume 路径直调 router.register)不打点 lastMcpAt', () => {
  router.register('alice', sessions.get('alice')!);
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
});

test('未知名调用不炸总线', async () => {
  const r = await callTool('ghost', 'who');
  expect(r.roster).toBeDefined();
});

test('/admin/roster 透出 unresponsive 与 mcpSeen', async () => {
  router.markUnresponsive('alice');
  const res = await fetch(`http://127.0.0.1:${bus.port}/admin/roster`);
  const { roster } = await res.json() as any;
  const a = roster.find((x: any) => x.name === 'alice');
  expect(a.unresponsive).toBe(true);
  expect(a.mcpSeen).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/bus/touch.test.ts`
Expected: FAIL(lastMcpAt undefined 不增长、roster 无 unresponsive 字段)。

- [ ] **Step 3: 实现**

`src/bus/server.ts` 三处:

① `serverForAgent` 里,5 个工具 handler 开头统一打点。在 `const { router } = deps;` 之后加:

```ts
  // 任何工具调用 = 该员工经 MCP 活着的铁证(失联自愈)。服务端代登记不经此处,不会误打点。
  const touch = () => router.touchMcp(agentName);
```

然后每个 handler 第一行加 `touch();`(register/sendmsg/idle/ask/who 共 5 处),例如:

```ts
  server.registerTool('register', { description: t().toolDescRegister, inputSchema: {} }, async () => {
    touch();
    const sid = deps.getSessionId(agentName);
    ...
```

② HTTP handler 里,`PATH_RE` 匹配解码出 `agentName` 之后(server.ts:265 附近)加:

```ts
    deps.router.touchMcpHttp(agentName); // CLI 启动 initialize 即打点;只用于告警文案分流
```

③ `/admin/roster`(server.ts:149-151)的 map 里加两个字段:

```ts
      if (req.method === 'GET' && url.pathname === '/admin/roster') {
        return sendJson({ roster: router.roster().map((a) => ({ name: a.name, role: a.role, status: a.status, virtual: !!a.virtual, lead: !!a.lead, unresponsive: !!a.unresponsive, mcpSeen: a.lastMcpHttpAt != null })) });
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/bus/`
Expected: touch.test.ts 5 passed,其余 bus 测试无回归。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts tests/bus/touch.test.ts
git commit -m "feat(bus): 工具调用打点 lastMcpAt + HTTP 打点 lastMcpHttpAt + roster 透出失联字段"
```

---

### Task 4: /admin/restart 端点

**Files:**
- Modify: `src/bus/server.ts`(BusDeps + admin 路由)
- Test: `tests/bus/admin-restart.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// tests/bus/admin-restart.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let calls: Array<{ name: string; fresh: boolean }>;

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  calls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onRestartAgent: async (name, fresh) => {
      calls.push({ name, fresh });
      return name === 'alice' ? { ok: true } : { ok: false, error: 'unknown agent' };
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

async function post(body: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}/admin/restart`, { method: 'POST', body: JSON.stringify(body) });
  return res.json() as any;
}

test('转发 name 与 fresh 给 onRestartAgent', async () => {
  const r = await post({ name: 'alice', fresh: true });
  expect(r.ok).toBe(true);
  expect(calls).toEqual([{ name: 'alice', fresh: true }]);
});

test('fresh 缺省为 false', async () => {
  await post({ name: 'alice' });
  expect(calls[0].fresh).toBe(false);
});

test('未知员工把 handler 的错误透传', async () => {
  const r = await post({ name: 'ghost' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/unknown/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/bus/admin-restart.test.ts`
Expected: FAIL(404 unknown admin route → json 解析报错或 ok undefined)。

- [ ] **Step 3: 实现**

`src/bus/server.ts`:

① `BusDeps` 接口里 `onSetLead` 之后加:

```ts
  /** 重启某员工的 CLI(带正确 MCP 配置;fresh=清会话记录全新开局)。 */
  onRestartAgent?(name: string, fresh: boolean): Promise<{ ok: boolean; error?: string }>;
```

② admin 路由里 `/admin/lead` 块之后加:

```ts
      if (req.method === 'POST' && url.pathname === '/admin/restart') {
        if (!deps.onRestartAgent) return sendJson({ ok: false, error: 'restart not supported' });
        try {
          const r = await deps.onRestartAgent(String(abody.name), abody.fresh === true);
          return sendJson(r);
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/bus/admin-restart.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts tests/bus/admin-restart.test.ts
git commit -m "feat(bus): /admin/restart 端点 + onRestartAgent dep"
```

---

### Task 5: i18n 词条(zh + en)

**Files:**
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

两文件键名必须一致(`tests/i18n.test.ts` 会校验 parity)。

- [ ] **Step 1: zh.ts 加词条**

`cmdHint` 对象(zh.ts:99 附近)里加:

```ts
    restart: '重启某员工的 CLI(带 falinks 配置;加 fresh=全新会话)',
```

usage 区(`usageRemove` 附近)加:

```ts
  usageRestart: '用法: /restart <name> [fresh]',
```

console 反馈区(`removeOk` 附近,搜 `removeOk` 找同组)加:

```ts
  restartOk: (n: string) => `已重启 ${n}(等它重新报到)`,
  restartFailed: '重启失败',
  restartBusy: (n: string) => `${n} 正在重启/清空中,稍后再试`,
  // 失联警告行:按"是否连过 MCP"分流两种病因文案。
  unresponsiveWarn: (items: { name: string; mcpSeen: boolean }[]) =>
    '⚠ ' +
    items.map((i) => `${i.name}${i.mcpSeen ? '(MCP 连过但未报到,会话可能瘫痪)' : '(CLI 可能没挂 falinks 工具,手动重启过?)'}`).join('、') +
    ' —— 试试 /restart <名字> [fresh]',
```

- [ ] **Step 2: en.ts 加对应词条**(键同名,搜 en.ts 里相同锚点位置)

```ts
    restart: "restart an agent's CLI (with falinks config; add fresh = brand-new session)",
```

```ts
  usageRestart: 'usage: /restart <name> [fresh]',
```

```ts
  restartOk: (n: string) => `restarted ${n} (waiting for it to re-register)`,
  restartFailed: 'restart failed',
  restartBusy: (n: string) => `${n} is restarting/clearing, try again later`,
  unresponsiveWarn: (items: { name: string; mcpSeen: boolean }[]) =>
    '⚠ ' +
    items.map((i) => `${i.name}${i.mcpSeen ? ' (MCP connected but never registered; session may be wedged)' : ' (CLI likely missing falinks MCP config; manually restarted?)'}`).join(', ') +
    ' — try /restart <name> [fresh]',
```

- [ ] **Step 3: 跑 i18n parity 测试**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS(两边键一致)。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(i18n): /restart 与失联警告词条(中英)"
```

---

### Task 6: index.ts 接线(A-1/A-2 判定、restarting 守卫、onRestartAgent、launchInto 变体)

**Files:**
- Modify: `src/index.ts`

此任务无单测(`up()` 依赖 iTerm),正确性由 Task 1-4 的纯逻辑/总线测试 + Task 8 的实机验证兜底。每步改完跑 `npx tsc -p tsconfig.build.json --noEmit` 保证编译过。

- [ ] **Step 1: 导入与状态**

import 行(index.ts:9)把 `checkRegisterTimeout, judgeAutoIdleSilence` 加进 orchestrator 导入:

```ts
import { makeDeliverer, detectScreenState, isPaneBusy, reconcilePaneStatus, checkRegisterTimeout, judgeAutoIdleSilence } from './orchestrator.js';
```

`clearing` 声明(index.ts:49)旁加:

```ts
  const restarting = new Set<string>(); // 正在 /restart 的员工:轮询跳过(防关旧 pane 期间被"pane 消失"误下线丢 inbox)
  const REGISTER_TIMEOUT_MS = 90_000; // bootstrap 交付后这么久没任何 MCP 调用 → 报到超时告警(限流重压下可能误报,自愈)
  const MUTE_THRESHOLD = 2;           // 连续"有活无声"达到次数 → 失联告警
  const expectRegister = new Map<string, { by: number; since: number }>(); // A-1:bootstrap 交付后的报到期限
  const muteCountedAt = new Map<string, number>(); // A-2:已计过嫌疑的投递时刻(每次投递最多计一次)
  const armRegisterExpectation = (name: string) => {
    const now = Date.now();
    expectRegister.set(name, { by: now + REGISTER_TIMEOUT_MS, since: now });
  };
  // 失联告警:边沿触发(router 标志首转才落盘),花名册 ⚠ 由 /admin/roster 透出、警告行由控制台渲染。
  const alarmUnresponsive = (name: string, rule: 'register-timeout' | 'mute') => {
    if (!router.markUnresponsive(name)) return;
    try { appendDiag(launchCwd, { kind: 'agent-unresponsive', name, rule, ts: Date.now() }); } catch { /* 诊断落盘失败不致命 */ }
  };
```

- [ ] **Step 2: launchInto 支持"已存在员工"(restart 复用)**

index.ts:112 的 paneIdx 改为(restart 时保持原色):

```ts
    const paneIdx = (() => {
      const i = router.roster().findIndex((x) => x.name === a.name);
      return i >= 0 ? i : router.roster().length; // 已在花名册(restart)用原下标保色;新员工按将占下标
    })();
```

index.ts:122 的 `router.addAgent(a.name, a.role, a.lead);` 改为:

```ts
    if (router.get(a.name)) router.markLaunching(a.name); // restart:保留 inbox,状态回 launching
    else router.addAgent(a.name, a.role, a.lead);
```

- [ ] **Step 3: A-1 期限起点——bootstrap 交付时刻**

claude 分支(index.ts:137)`if (state === 'ready') { if (!resuming) await driver.inject(sid, fullBootstrap, true); break; }` 改为:

```ts
            if (state === 'ready') {
              if (!resuming) { await driver.inject(sid, fullBootstrap, true); armRegisterExpectation(a.name); }
              break;
            }
```

codex 分支:第三次盲发 Enter(index.ts:146 `await driver.inject(sid, '', true); // 第三次兜底…`)之后加:

```ts
          if (!resuming) armRegisterExpectation(a.name); // codex 的 bootstrap 是启动参数,启动序列完成即视为已交付
```

onClear 里(index.ts:232)`if (bs) await driver.inject(sid, bs, true);` 之后加:

```ts
          if (bs) armRegisterExpectation(nm); // /clear 重注入 bootstrap 后同样限期报到
```

- [ ] **Step 4: 健康轮询接入(restarting 跳过 + A-1 + A-2)**

轮询循环开头(index.ts:361 `try {` 之后、`paneExists` 判断之前)加:

```ts
          if (restarting.has(name)) continue; // 重启中:旧 pane 已关属预期,跳过下线判定与状态校准
```

`if (clearing.has(name)) continue;` 之后加 A-1 检查:

```ts
          // A-1 报到超时:bootstrap 交付后限期内必须出现任意 MCP 调用,否则告警(工具没挂/会话瘫痪)。
          const exp = expectRegister.get(name);
          if (exp) {
            const verdict = checkRegisterTimeout({ now: Date.now(), by: exp.by, since: exp.since, lastMcpAt: router.get(name)?.lastMcpAt });
            if (verdict === 'satisfied') expectRegister.delete(name);
            else if (verdict === 'timeout') { expectRegister.delete(name); alarmUnresponsive(name, 'register-timeout'); }
          }
```

`if (action === 'mark-idle') {` 分支内、现有 auto-idle 诊断之后、`router.onIdle(name);` 之前加 A-2:

```ts
              // A-2 有活无声:走到这=自动降闲(不是它自己调 idle 工具)。投递过却全程零 MCP 调用 → 哑巴嫌疑。
              const mv = judgeAutoIdleSilence({ deliveredAt: lastDeliverAt.get(name), countedAt: muteCountedAt.get(name) ?? 0, lastMcpAt: a.lastMcpAt });
              muteCountedAt.set(name, mv.countedAt);
              if (mv.reset) a.muteStreak = 0;
              if (mv.count && router.bumpMute(name) >= MUTE_THRESHOLD) alarmUnresponsive(name, 'mute');
```

员工下线清理处(轮询 `missStreak.delete(name); idleStreak.delete(name);` 一组,index.ts:369-371)与 onRemoveAgent(index.ts:212-214)各加:

```ts
            expectRegister.delete(name);
            muteCountedAt.delete(name);
```

- [ ] **Step 5: onRestartAgent 实现**

startBus deps 里 `onSetLead` 之后加:

```ts
    onRestartAgent: async (name, fresh) => {
      const spec = cfg.agents.find((x) => x.name === name);
      const sid = sessions.get(name);
      if (!spec || !sid || !router.get(name)) return { ok: false, error: `unknown agent: ${name}` };
      if (restarting.has(name) || clearing.has(name)) return { ok: false, error: t().restartBusy(name) };
      restarting.add(name);
      try {
        if (fresh) { delete store.agents[name]; saveStore(launchCwd, store); } // fresh:清会话记录→launchInto 走全新开局
        router.markLaunching(name); // inbox 保留,重新 register 后照常投递
        lastDeliverAt.delete(name);
        missStreak.delete(name);
        idleStreak.delete(name);
        expectRegister.delete(name);
        muteCountedAt.delete(name);
        await driver.closePane(sid).catch(() => {});
        sessions.delete(name);
        if (sid === lastRight) lastRight = consoleSid; // 关的是锚点 → 复位
        const anchor = await chooseAnchor(lastRight, consoleSid, (s) => driver.paneExists(s));
        lastRight = await launchInto(anchor, 'horizontal', spec);
        return { ok: true };
      } catch (e: any) {
        router.markDead(name); // 重建失败与 pane 丢失同等对待
        return { ok: false, error: String(e?.message ?? e) };
      } finally {
        restarting.delete(name);
      }
    },
```

注意:`missStreak`/`idleStreak` 声明在 startBus 调用之后(index.ts:356-357),需把这两个 Map 的声明**上移**到 `restarting` 旁(index.ts:49 区域),否则 TDZ 报错。挪声明即可,使用处不变。

- [ ] **Step 6: 编译检查 + 全量测试**

Run: `npx tsc -p tsconfig.build.json --noEmit && npm test`
Expected: 编译 0 错,全部测试通过。

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(core): 失联检测接线(A-1/A-2)+ onRestartAgent + restarting 守卫防误下线"
```

---

### Task 7: 控制台(/restart 命令、⚠ 徽章、警告行)

**Files:**
- Modify: `src/console/parse.ts`
- Modify: `src/console/commands.ts`
- Modify: `src/console/app.tsx`
- Test: `tests/console/parse.test.ts`、`tests/console/commands.test.ts`(追加用例)

- [ ] **Step 1: 写失败测试**(追加到现有文件)

`tests/console/parse.test.ts` 追加:

```ts
test('parses /restart with optional fresh flag', () => {
  expect(parseConsoleInput('/restart lead')).toEqual({ kind: 'restart', name: 'lead', fresh: false });
  expect(parseConsoleInput('/restart @lead fresh')).toEqual({ kind: 'restart', name: 'lead', fresh: true });
  expect(parseConsoleInput('/restart')).toMatchObject({ kind: 'error' });
});
```

`tests/console/commands.test.ts` 追加:

```ts
test('/res completes to restart', () => {
  const s = commandState('/res');
  expect(s.active).toBe(true);
  expect(s.matches.map((c) => c.name)).toContain('restart');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/console/parse.test.ts tests/console/commands.test.ts`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

`src/console/parse.ts`:ConsoleAction 联合(parse.ts:9 `remove` 行后)加:

```ts
  | { kind: 'restart'; name: string; fresh: boolean }
```

`/remove` 块(parse.ts:33-36)之后加:

```ts
    if (cmd === 'restart') {
      if (!args[0]) return { kind: 'error', message: t().usageRestart };
      return { kind: 'restart', name: args[0].replace(/^@/, ''), fresh: args[1] === 'fresh' };
    }
```

`src/console/commands.ts`:COMMANDS 数组 `remove` 行后加:

```ts
  { name: 'restart', usage: '/restart <name> [fresh]', get hint() { return t().cmdHint.restart; } },
```

`src/console/app.tsx` 三处:

① 动作处理:`a.kind === 'remove'`(app.tsx:172)行后加:

```ts
      if (a.kind === 'restart') { const r = await admin(port, 'POST', '/admin/restart', { name: a.name, fresh: a.fresh }); setStatus(r.ok ? t().restartOk(a.name) : '⚠ ' + (r.error ?? t().restartFailed)); return; }
```

② 花名册 ⚠ 徽章:roster 渲染(app.tsx:582)`{a.lead ? <Text color="cyan" bold> ♔</Text> : null}` 行后加:

```tsx
                {a.unresponsive ? <Text color="red" bold> ⚠</Text> : null}
```

③ 失联警告行(roster 驱动,自愈即消失):诊断行 `{hasDiag ? …}`(app.tsx:590)上面加。先在组件体内(`const hasDiag = …` 旁)算:

```ts
  const unresp = roster.filter((a) => a.unresponsive).map((a) => ({ name: a.name, mcpSeen: !!a.mcpSeen }));
```

渲染处:

```tsx
        {unresp.length ? <Text color="red">{t().unresponsiveWarn(unresp)}</Text> : null}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/console/`
Expected: 全部通过(含 app-e2e 等回归)。

- [ ] **Step 5: Commit**

```bash
git add src/console/parse.ts src/console/commands.ts src/console/app.tsx tests/console/parse.test.ts tests/console/commands.test.ts
git commit -m "feat(console): /restart 命令 + 花名册 ⚠ 失联徽章 + 警告行(roster 驱动自愈即消)"
```

---

### Task 8: 全量验证 + 构建 + 实机重演事故

**Files:** 无新改动(发现问题则回前面任务修)

- [ ] **Step 1: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全部通过、tsc 0 错。**必须 build——用户跑 dist/,不 build 测的是旧代码。**

- [ ] **Step 2: 实机重演事故场景(spec 验收标准)**

在测试项目(如 `/tmp/falinks-verify`)起一个 2 人团队,然后:

1. 手动在某员工 pane 退出 claude、起裸 `claude --dangerously-skip-permissions`;
2. 控制台 `/clear` 该员工 → **90s 内**应出现:花名册 `⚠` + 红色警告行(文案为"CLI 可能没挂 falinks 工具"分支,因为裸 claude 从未连过本进程总线? 注意:同名员工旧进程连过,mcpSeen 可能为 true,文案落"连过但未报到"分支——两种文案都算验收通过,关键是 ⚠ 出现);
3. 执行 `/restart <name>` → pane 重建、员工 register 报到、⚠ 与警告行消失;
4. 给它发条消息确认正常收发;
5. 再验 `/restart <name> fresh`:重启后是全新会话(pane 里无旧对话)且注入了 bootstrap。

- [ ] **Step 3: 回归确认正常员工无误报**

同一办公室正常员工(register→sendmsg→idle 流转)观察 ≥3 分钟,确认无 ⚠ 闪现。

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "chore: 失联检测+/restart 实机验证收尾"
```

(版本号按惯例**只在发布时**升:本批是 bugfix/防护,发布时升第三位。)

---

## Self-Review 结果

- **Spec 覆盖**:A-1(Task 2/6)、A-2(Task 2/6)、touchMcp 与代登记隔离(Task 1/3,测试显式覆盖)、HTTP 文案分流(Task 3/5/7)、边沿触发(Task 1 markUnresponsive + Task 6 alarmUnresponsive)、不阻断投递(无改动即满足)、/restart resume/fresh/inbox 保留/launching/保色/restarting 竞态(Task 6)、控制台 ⚠+警告+补全(Task 7)、验收场景(Task 8)。无缺口。
- **占位扫描**:无 TBD/TODO;每步含完整代码。
- **类型一致性**:`touchMcp/touchMcpHttp/bumpMute/markUnresponsive/markLaunching`(Task 1 定义,Task 3/6 使用);`checkRegisterTimeout/judgeAutoIdleSilence`(Task 2 定义,Task 6 使用,签名一致);`onRestartAgent(name, fresh)`(Task 4 定义,Task 6 实现);i18n 键(Task 5 定义,Task 6 用 `restartBusy`、Task 7 用 `usageRestart/cmdHint.restart/restartOk/restartFailed/unresponsiveWarn`)。一致。
