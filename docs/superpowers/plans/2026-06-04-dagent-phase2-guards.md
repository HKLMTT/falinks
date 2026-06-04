# dagent Phase 2 — 循环/预算防护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 给 dagent 加服务端权威的防失控机制——thread 派生、每 thread 回合上限、退化循环检测、全局发送节流——防止多 agent 无限乒乓与 token 爆炸。全部纯逻辑 + Router 集成 + 装配，无需真实 agent。

**Architecture:** 一个纯 `Guards` 模块（core）持有配置与状态（thread 回合计数、近期消息体、发送时间窗），由 `Router` 在 `send()` 时咨询。thread 由"谁在处理哪条消息"的上下文服务端派生（不信 agent 传参）。`Router` 接收**可选** `guards`，未配置时行为与 Phase 1 完全一致（既有测试不变）。

**Tech Stack:** TypeScript/Node, vitest。注入式 `now()` 时钟使节流/循环可确定性测试。

**关键设计：**
- **thread 派生**：投递消息 M 给 agent A 时记 `A.handling = M.thread`；A 调 `send` 时新消息继承 `A.handling`（无则新 thread）；A `onIdle` 时清空 `handling`。发起者非注册 agent（如 `system`/`boss`）→ 新 thread。
- **回合上限**：每 thread 累计消息 > `maxTurnsPerThread`(默认20) → 熔断（send 返回 undefined + 日志）。这也是交替型乒乓的总兜底。
- **循环检测**：同一 thread 内连续 `loopWindow`(默认3) 条归一化后完全相同、或全为空 → 熔断（捕捉退化重复）。
- **全局节流**：滚动 60s 内发送数 ≥ `maxInjectionsPerMinute`(默认30) → 拒绝该 send + 日志（在 send 处节流，避免投递层 re-pump 难题）。
- 所有熔断 `console.warn` 明示，不静默。

---

## File Structure
```
src/core/
  config.ts     # 扩展：GuardConfig + DagentConfig.guards + parseConfig 默认/合并
  guards.ts     # 新增：Guards 类（纯逻辑）
  types.ts      # 扩展：Message.thread?, AgentRuntime.handling?
  router.ts     # 集成：RouterDeps.guards?；send 咨询 guards；pump 设 handling；onIdle 清 handling
  index.ts      # 装配：从 cfg.guards 构造 Guards 传入 Router
tests/core/
  guards.test.ts
  router-guards.test.ts
  config.test.ts   # 追加 guards 默认/override 用例
```

---

### Task 1: GuardConfig 解析 + Guards 模块（TDD）

**Files:** Modify `src/core/config.ts`; create `src/core/guards.ts`, `tests/core/guards.test.ts`; append to `tests/core/config.test.ts`

- [ ] **Step 1: 在 `tests/core/config.test.ts` 末尾追加：**
```ts
test('parseConfig fills guard defaults when absent', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] });
  expect(cfg.guards).toEqual({ maxTurnsPerThread: 20, maxInjectionsPerMinute: 30, loopWindow: 3 });
});

test('parseConfig merges partial guard overrides', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }], guards: { maxTurnsPerThread: 5 } });
  expect(cfg.guards).toEqual({ maxTurnsPerThread: 5, maxInjectionsPerMinute: 30, loopWindow: 3 });
});
```

- [ ] **Step 2: 写失败测试 `tests/core/guards.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { Guards } from '../../src/core/guards.js';

const cfg = { maxTurnsPerThread: 3, maxInjectionsPerMinute: 2, loopWindow: 3 };
function mk(now: () => number = () => 0) { return new Guards(cfg, now); }

test('newThread returns unique ids', () => {
  const g = mk();
  expect(g.newThread()).not.toBe(g.newThread());
});

test('checkMessage allows up to maxTurnsPerThread then breaks with turn-cap', () => {
  const g = mk();
  expect(g.checkMessage('t1', 'a').ok).toBe(true);  // 1
  expect(g.checkMessage('t1', 'b').ok).toBe(true);  // 2
  expect(g.checkMessage('t1', 'c').ok).toBe(true);  // 3
  const d = g.checkMessage('t1', 'd');              // 4 > 3
  expect(d.ok).toBe(false);
  expect(d.reason).toBe('turn-cap');
});

test('checkMessage breaks with loop on loopWindow identical bodies', () => {
  const g = mk();
  expect(g.checkMessage('t1', 'same').ok).toBe(true);
  expect(g.checkMessage('t1', ' same ').ok).toBe(true); // 归一化后相同
  const d = g.checkMessage('t1', 'same');               // 第3条相同 → loop
  expect(d.ok).toBe(false);
  expect(d.reason).toBe('loop');
});

test('checkMessage breaks with loop on consecutive empty bodies', () => {
  const g = mk();
  g.checkMessage('t1', '');
  g.checkMessage('t1', '   ');
  expect(g.checkMessage('t1', '').reason).toBe('loop');
});

test('different bodies in a thread do not trigger loop (bounded only by turn-cap)', () => {
  const g = new Guards({ maxTurnsPerThread: 100, maxInjectionsPerMinute: 100, loopWindow: 3 }, () => 0);
  expect(g.checkMessage('t1', 'x').ok).toBe(true);
  expect(g.checkMessage('t1', 'y').ok).toBe(true);
  expect(g.checkMessage('t1', 'x').ok).toBe(true); // 交替，非连续相同 → 不熔断
});

test('allowInjection enforces rolling per-minute cap', () => {
  let t = 0;
  const g = mk(() => t);
  expect(g.allowInjection()).toBe(true);   // 1
  expect(g.allowInjection()).toBe(true);   // 2
  expect(g.allowInjection()).toBe(false);  // 3 >= cap(2)
  t = 61_000;                               // 超过 60s 窗口
  expect(g.allowInjection()).toBe(true);   // 旧的过期，重新允许
});
```

- [ ] **Step 3: 运行确认失败** `npx vitest run tests/core/guards.test.ts tests/core/config.test.ts`。

- [ ] **Step 4: 扩展 `src/core/config.ts`** —— 在文件中加入 `GuardConfig`，给 `DagentConfig` 加 `guards`，并在 `parseConfig` 末尾（`return` 前）合并默认值。

替换 `DagentConfig` 接口为：
```ts
export interface GuardConfig {
  maxTurnsPerThread: number;
  maxInjectionsPerMinute: number;
  loopWindow: number;
}

export interface DagentConfig {
  busPort: number;
  agents: AgentConfig[];
  routes: Record<string, AgentName>;
  guards: GuardConfig;
}
```
在 `parseConfig` 的 `return { ... }` 之前加入：
```ts
  const gd = raw.guards ?? {};
  const guards: GuardConfig = {
    maxTurnsPerThread: typeof gd.maxTurnsPerThread === 'number' ? gd.maxTurnsPerThread : 20,
    maxInjectionsPerMinute: typeof gd.maxInjectionsPerMinute === 'number' ? gd.maxInjectionsPerMinute : 30,
    loopWindow: typeof gd.loopWindow === 'number' ? gd.loopWindow : 3,
  };
```
并把返回改为 `return { busPort: raw.busPort, agents, routes, guards };`

- [ ] **Step 5: 实现 `src/core/guards.ts`:**
```ts
import type { GuardConfig } from './config.js';

export type BreakReason = 'turn-cap' | 'loop';
export interface GuardDecision {
  ok: boolean;
  reason?: BreakReason;
}

/** 服务端权威的防失控状态机：thread 回合上限、退化循环检测、全局发送节流。纯逻辑，时钟注入。 */
export class Guards {
  private threadTurns = new Map<string, number>();
  private threadRecent = new Map<string, string[]>();
  private sendTimes: number[] = [];
  private seq = 0;

  constructor(private cfg: GuardConfig, private now: () => number) {}

  newThread(): string {
    return `th${++this.seq}`;
  }

  /** 记录一条消息进入 thread，返回是否触发熔断（turn-cap / loop）。 */
  checkMessage(thread: string, body: string): GuardDecision {
    const turns = (this.threadTurns.get(thread) ?? 0) + 1;
    this.threadTurns.set(thread, turns);
    if (turns > this.cfg.maxTurnsPerThread) return { ok: false, reason: 'turn-cap' };

    const norm = body.trim().replace(/\s+/g, ' ');
    const recent = this.threadRecent.get(thread) ?? [];
    recent.push(norm);
    while (recent.length > this.cfg.loopWindow) recent.shift();
    this.threadRecent.set(thread, recent);
    if (recent.length >= this.cfg.loopWindow && recent.every((b) => b === recent[0])) {
      return { ok: false, reason: 'loop' };
    }
    return { ok: true };
  }

  /** 全局节流：滚动 60s 内发送数 < 上限则允许并记录，否则拒绝。 */
  allowInjection(): boolean {
    const t = this.now();
    const cutoff = t - 60_000;
    this.sendTimes = this.sendTimes.filter((x) => x > cutoff);
    if (this.sendTimes.length >= this.cfg.maxInjectionsPerMinute) return false;
    this.sendTimes.push(t);
    return true;
  }
}
```

- [ ] **Step 6: 运行确认通过** `npx vitest run tests/core/guards.test.ts tests/core/config.test.ts` (guards 6 + config 7)。然后 `npm test` + `npx tsc --noEmit`。

- [ ] **Step 7: Commit**
```bash
git add src/core/guards.ts src/core/config.ts tests/core/guards.test.ts tests/core/config.test.ts
git commit -m "feat(core): Guards (turn cap, loop detect, rate throttle) + guard config"
```

---

### Task 2: Router 集成 guards（TDD）

**Files:** Modify `src/core/types.ts`, `src/core/router.ts`; create `tests/core/router-guards.test.ts`

- [ ] **Step 1: 扩展 `src/core/types.ts`** —— 给 `Message` 加可选 `thread?: string`；给 `AgentRuntime` 加可选 `handling?: string`：
```ts
export interface Message {
  id: string;
  from: AgentName;
  to: AgentName;
  body: string;
  ts: number;
  thread?: string; // 服务端派生的会话线程 id（仅在配置了 Guards 时设置）
}

export interface AgentRuntime {
  name: AgentName;
  role?: string;
  status: AgentStatus;
  sessionId?: string;
  inbox: Message[];
  handling?: string; // 当前正在处理的消息的 thread（用于派生回复 thread）
}
```

- [ ] **Step 2: 写失败测试 `tests/core/router-guards.test.ts`:**
```ts
import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import { Guards } from '../../src/core/guards.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup(guardCfg = { maxTurnsPerThread: 3, maxInjectionsPerMinute: 100, loopWindow: 3 }, now: () => number = () => 0) {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = { deliver: (agent, msg) => delivered.push({ agent, msg }) };
  let n = 0;
  const guards = new Guards(guardCfg, now);
  const router = new Router(deliverer, { now: () => 0, genId: () => `m${++n}`, guards });
  router.addAgent('alice');
  router.addAgent('bob');
  router.register('alice', 'SA');
  router.register('bob', 'SB');
  return { router, delivered, guards };
}

test('a delivered message sets the recipient handling-thread; their reply inherits it', () => {
  const { router, delivered } = setup();
  router.send('system', 'alice', 'seed');         // new thread for alice
  const t = delivered[0].msg.thread!;
  expect(t).toBeTruthy();
  expect(router.get('alice')!.handling).toBe(t);
  router.onIdle('alice'); // 处理完一条，但我们要测继承：在 idle 前发
});

test('reply from a handling agent inherits the same thread', () => {
  const { router, delivered } = setup();
  router.send('system', 'alice', 'seed');     // alice busy, handling = t
  const t = router.get('alice')!.handling!;
  // alice 在处理中回复 bob → 继承 t
  const msg = router.send('alice', 'bob', 'hi bob');
  expect(msg!.thread).toBe(t);
});

test('turn-cap breaks the thread: send returns undefined after the cap', () => {
  const { router } = setup({ maxTurnsPerThread: 2, maxInjectionsPerMinute: 100, loopWindow: 99 });
  // 同一 thread：system->alice 起 thread，alice 在 handling 中连发，超过 2 条后熔断
  router.send('system', 'alice', 'm1');          // turn 1, thread t
  expect(router.send('alice', 'bob', 'm2')).toBeTruthy();   // turn 2 (继承 t)
  expect(router.send('alice', 'bob', 'm3')).toBeUndefined(); // turn 3 > cap → 熔断
});

test('rate limit breaks send when exceeded', () => {
  const { router } = setup({ maxTurnsPerThread: 99, maxInjectionsPerMinute: 1, loopWindow: 99 });
  expect(router.send('system', 'alice', 'a')).toBeTruthy();   // 1 allowed
  expect(router.send('system', 'bob', 'b')).toBeUndefined();  // 2 > cap(1) → 节流熔断
});

test('onIdle clears handling thread', () => {
  const { router } = setup();
  router.send('system', 'alice', 'seed');
  expect(router.get('alice')!.handling).toBeTruthy();
  router.onIdle('alice');
  expect(router.get('alice')!.handling).toBeUndefined();
});
```

- [ ] **Step 3: 运行确认失败** `npx vitest run tests/core/router-guards.test.ts`。

- [ ] **Step 4: 修改 `src/core/router.ts`：**
(a) `RouterDeps` 增加可选 `guards`：
```ts
import type { Guards } from './guards.js';
// ...
export interface RouterDeps {
  now: () => number;
  genId: () => string;
  routes?: Record<string, AgentName>;
  guards?: Guards;
}
```
(b) 重写 `send` 方法为：
```ts
  send(from: AgentName, to: AgentName, body: string): Message | undefined {
    const target = this.resolve(to);
    if (!target) return undefined;
    const a = this.must(target);
    if (a.status === 'dead') return undefined;

    const g = this.deps.guards;
    let thread: string | undefined;
    if (g) {
      const sender = this.agents.get(from);
      thread = sender?.handling ?? g.newThread();
      const dec = g.checkMessage(thread, body);
      if (!dec.ok) {
        console.warn(`[guard] thread ${thread} broken: ${dec.reason} (${from} -> ${target})`);
        return undefined;
      }
      if (!g.allowInjection()) {
        console.warn(`[guard] rate limit hit, dropping ${from} -> ${target}`);
        return undefined;
      }
    }

    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now(), thread };
    a.inbox.push(msg);
    this.pump(a);
    return msg;
  }
```
(c) `pump` 投递时记录 handling：
```ts
  private pump(a: AgentRuntime): void {
    if (a.status !== 'idle') return;
    const msg = a.inbox.shift();
    if (!msg) return;
    a.status = 'busy';
    a.handling = msg.thread;
    this.deliverer.deliver(a, msg);
  }
```
(d) `onIdle` 清空 handling（在设为 idle 后）：
```ts
  onIdle(name: AgentName): void {
    const a = this.must(name);
    if (a.status === 'busy' || a.status === 'stuck') a.status = 'idle';
    a.handling = undefined;
    this.pump(a);
  }
```

- [ ] **Step 5: 运行** `npx vitest run tests/core/router-guards.test.ts` → PASS (5)。**关键：再跑 1A 的 `npx vitest run tests/core/router.test.ts` 确认 8 个旧测试仍全过**（无 guards 路径不变）。然后 `npm test` + `npx tsc --noEmit`。

- [ ] **Step 6: Commit**
```bash
git add src/core/types.ts src/core/router.ts tests/core/router-guards.test.ts
git commit -m "feat(core): Router consults Guards (thread derive, turn cap, loop, rate)"
```

---

### Task 3: 装配 guards 进 `dagent up`

**Files:** Modify `src/index.ts`

- [ ] **Step 1:** 在 `src/index.ts` 顶部加导入：
```ts
import { Guards } from './core/guards.js';
```

- [ ] **Step 2:** 在构造 `Router` 处，先建 Guards 并传入。把：
```ts
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes,
  });
```
改为：
```ts
  const guards = new Guards(cfg.guards, () => Date.now());
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes, guards,
  });
```

- [ ] **Step 3:** 验证 `npx tsc --noEmit`（clean）+ `npm test`（全过，无回归）。**不**运行 `npm run up`。

- [ ] **Step 4: Commit**
```bash
git add src/index.ts && git commit -m "feat: wire Guards into dagent up from config"
```

---

## Self-Review（对照 spec §8）
- **服务端 thread 派生（不信 agent 传参）** → Task 2 handling 继承机制 ✅
- **回合上限熔断** → Task 1 checkMessage turn-cap + Task 2 send 熔断 ✅
- **循环检测（连续相同/空）** → Task 1 checkMessage loop ✅（交替型由 turn-cap 兜底，已在测试与注释说明）
- **全局节流** → Task 1 allowInjection + Task 2 send 节流 ✅
- **熔断不静默** → Task 2 `console.warn` ✅
- **不破坏 Phase 1** → guards 可选，未配置时 Router 行为不变；Task 2 Step 5 显式回归 1A 8 测试 ✅
- **占位符扫描**：无 TBD。相似度用"归一化后完全相同"，编辑距离近似列为未来增强（注释）。
- **类型一致性**：`GuardConfig`/`Guards`/`GuardDecision`/`Message.thread`/`AgentRuntime.handling`/`RouterDeps.guards` 跨任务一致。

## 交付物
dagent 具备服务端权威的防失控：任何会话超 20 回合或退化重复即熔断、全局发送节流，全部可单测、不依赖真实 agent；`dagent up` 自动从配置启用。
