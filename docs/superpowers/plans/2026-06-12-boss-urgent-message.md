# boss 插队消息(! 前缀直送 + 排队提升直送)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** boss 发消息可加句首 `!` 跳过队列直接注入目标 pane(员工生成中也直送,CLI 输入缓冲会在本回合内呈现);排队浮层中按 `!` 把已排队消息提升为直送。

**Architecture:** Router 加 urgent 直送路径(忙时不动状态机、闲时等价 pump)+ `promoteQueued`;bus 透传 `urgent` 并新增 `/admin/promote`;控制台 parse 识别 `!` 前缀、浮层加 `!` 键、消息流标 ⚡。员工 `sendmsg` 不变(插队是 boss 专属)。

**Tech Stack:** TypeScript (NodeNext ESM, `.js` 后缀 import), vitest, Ink (React)。测试零 `as any`。每个 task 完成即 commit。CI 用全项目 `npx tsc --noEmit`(含 tests/),交付前必须 `npm run build`。

**Spec:** `docs/superpowers/specs/2026-06-12-boss-urgent-message-design.md`
**与 spec 的两处已定偏差**(实现按本计划,事后补 spec 后记):
1. urgent 投递**照常更新** `lastDeliverAt`(spec 原说跳过)。原因:闲时直送依赖投递宽限(IDLE_GRACE_MS)防"注入后 CLI 未开始输出就被自动降闲、把下一条排队消息也 pump 进来"的交错 bug;A-2 误报风险本就低(需连续 2 次且任意 MCP 调用自愈)。净效果:**index.ts 一行不改**。
2. 目标 `launching`(CLI 还没起来)时直送会注进未就绪的 shell 而丢失:`send(urgent)` 此时**退化为正常排队**(消息不带 urgent 标,控制台如实显示 ⏳);`promoteQueued` 此时返回 `ok:false`。

---

### Task 1: Router urgent 直送路径 + `Message.urgent`

**Files:**
- Modify: `src/core/types.ts:17`(Message 加字段)
- Modify: `src/core/router.ts:70-107`(send 加 opts)、`router.ts:229-238` 附近(新增私有 deliverUrgent)
- Test: `tests/core/router-urgent.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `tests/core/router-urgent.test.ts`(harness 仿照 `tests/core/router-cancel.test.ts`):

```ts
import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';
import { Guards } from '../../src/core/guards.js';

function makeRouter(guards?: Guards) {
  const delivered: Message[] = [];
  const deliverer: Deliverer = { deliver: (_a: AgentRuntime, m: Message) => { delivered.push(m); } };
  let n = 0;
  const r = new Router(deliverer, { now: () => 1, genId: () => `m${++n}`, guards });
  r.addVirtual('boss');
  r.addAgent('dev');
  r.register('dev', 's1'); // idle
  return { r, delivered };
}

test('urgent+目标 busy:立即投递,inbox 不变,状态机不动(handling 不被改写)', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');                 // idle → 即时投递,dev busy
  const q = r.send('boss', 'dev', 'queued-1')!;    // 排队
  const handling = r.get('dev')!.handling;
  const handlingFrom = r.get('dev')!.handlingFrom;

  const u = r.send('boss', 'dev', 'cut-in', { urgent: true })!;
  expect(u.urgent).toBe(true);
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in']); // 立即出去,不等空闲
  expect(r.get('dev')!.status).toBe('busy');
  expect(r.get('dev')!.handling).toBe(handling);         // 在办的线程跟踪不被插队改写
  expect(r.get('dev')!.handlingFrom).toBe(handlingFrom);
  expect(r.queuedMessageIds().has(q.id)).toBe(true);     // 旧排队消息原地不动
  expect(r.queuedMessageIds().has(u.id)).toBe(false);    // urgent 从不入队

  r.onIdle('dev'); // 干完 → pump 排队那条
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in', 'queued-1']);
});

test('urgent+目标 idle:等价普通发送(置 busy、设 handling)', () => {
  const { r, delivered } = makeRouter();
  const u = r.send('boss', 'dev', 'hello', { urgent: true })!;
  expect(u.urgent).toBe(true);
  expect(delivered.map((m) => m.body)).toEqual(['hello']);
  const dev = r.get('dev')!;
  expect(dev.status).toBe('busy');
  expect(dev.handlingFrom).toBe('boss');
});

test('urgent+目标 stuck:直送(stuck 视同忙,不动状态)', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');
  r.markStuck('dev');
  r.send('boss', 'dev', 'cut-in', { urgent: true });
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in']);
  expect(r.get('dev')!.status).toBe('stuck');
});

test('urgent+目标 launching:退化为正常排队,消息不带 urgent 标', () => {
  const { r, delivered } = makeRouter();
  r.addAgent('newbie'); // launching,未 register
  const m = r.send('boss', 'newbie', 'early', { urgent: true })!;
  expect(m.urgent).toBeUndefined();                  // 没直送就别标 ⚡(控制台如实显示 ⏳)
  expect(delivered).toEqual([]);
  expect(r.queuedMessageIds().has(m.id)).toBe(true); // 在队列里,register 后照常 pump
  r.register('newbie', 's2');
  expect(delivered.map((m2) => m2.body)).toEqual(['early']);
});

test('urgent+目标 dead:拒绝(返回 undefined)', () => {
  const { r } = makeRouter();
  r.markDead('dev');
  expect(r.send('boss', 'dev', 'x', { urgent: true })).toBeUndefined();
});

test('urgent 仍受限流护栏约束', () => {
  const { r, delivered } = makeRouter(new Guards({ maxInjectionsPerMinute: 1 }, () => 1));
  r.send('boss', 'dev', 'first');                                       // 用掉额度
  expect(r.send('boss', 'dev', 'cut-in', { urgent: true })).toBeUndefined(); // 限流照拦
  expect(delivered.map((m) => m.body)).toEqual(['first']);
});

test('urgent 发给虚拟成员(boss):只记日志,带 urgent 标但不投递', () => {
  const { r, delivered } = makeRouter();
  const m = r.send('dev', 'boss', 'report', { urgent: true })!;
  expect(m).toBeDefined();
  expect(delivered).toEqual([]);
});
```

注意:`Guards` 构造参数以 `src/core/guards.ts` 实际签名为准(写测试前先读它,限流测试按真实 API 调整;若构造形如 `new Guards(cfg, now)` 以上即可用)。虚拟成员测试里 urgent 标不标都可接受——断言只要求"不投递、不报错";若实现选择虚拟成员不标 urgent,把该断言改成 `expect(m.urgent).toBeUndefined()` 并在实现注释说明。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/router-urgent.test.ts`
Expected: FAIL(send 不接受第 4 个参数 → tsc/类型错误或运行断言失败)

- [ ] **Step 3: 实现**

`src/core/types.ts` Message 接口 `canceled` 字段后加:

```ts
  urgent?: boolean; // boss 插队直送:跳过队列直接注入(忙时进 CLI 输入缓冲);排队消息被提升直送时事后补标
```

`src/core/router.ts` 改 `send`(只动签名、msg 构造和入队前分叉,守卫逻辑不动):

```ts
  send(from: AgentName, to: AgentName, body: string, opts?: { urgent?: boolean }): Message | undefined {
    // ……(resolve/dead/守卫代码原样保留)……

    // launching 的 pane 还没就绪,直送会注进启动中的 shell 而丢失 → 退化为正常排队(不标 urgent,控制台如实显示排队)。
    const urgent = !!opts?.urgent && !a.virtual && a.status !== 'launching';
    const msg: Message = { id: this.deps.genId(), from, to: target, body, ts: this.deps.now(), thread, ...(urgent ? { urgent: true } : {}) };
    this.messageLog.push(msg);
    const cap = this.deps.logCap ?? 300;
    if (this.messageLog.length > cap) this.messageLog.shift();
    this.deps.onLog?.(msg);
    if (a.virtual) return msg;       // 虚拟成员：只记日志，不注入、不置 busy
    if (urgent) { this.deliverUrgent(a, msg); return msg; }
    a.inbox.push(msg);
    this.pump(a);
    return msg;
  }
```

`pump` 后面新增私有方法:

```ts
  /** 插队直送:闲时等价 pump(置 busy、记 handling);忙/卡时不动状态机——别把在办线程的跟踪改写成插队消息的。 */
  private deliverUrgent(a: AgentRuntime, msg: Message): void {
    if (a.status === 'idle') {
      a.status = 'busy';
      a.handling = msg.thread;
      a.handlingFrom = msg.from;
    }
    this.deliverer.deliver(a, msg);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/router-urgent.test.ts tests/core`
Expected: 新文件全 PASS,core 旧测试无回归

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/router.ts tests/core/router-urgent.test.ts
git commit -m "feat(core): router urgent 直送路径——跳过队列直接投递,忙时不动状态机,launching 退化排队"
```

---

### Task 2: `Router.promoteQueued` 排队提升直送

**Files:**
- Modify: `src/core/router.ts`(cancelQueued 后新增方法)
- Test: `tests/core/router-promote.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `tests/core/router-promote.test.ts`(makeRouter 同 Task 1,无 guards):

```ts
import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function makeRouter() {
  const delivered: Message[] = [];
  const deliverer: Deliverer = { deliver: (_a: AgentRuntime, m: Message) => { delivered.push(m); } };
  let n = 0;
  const r = new Router(deliverer, { now: () => 1, genId: () => `m${++n}` });
  r.addVirtual('boss');
  r.addAgent('dev');
  r.register('dev', 's1'); // idle
  return { r, delivered };
}

test('promoteQueued:排队中 → 出队+立即直送+流水标 urgent,目标状态不动', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');                // dev busy
  const q1 = r.send('boss', 'dev', 'queued-1')!;
  const q2 = r.send('boss', 'dev', 'queued-2')!;

  expect(r.promoteQueued(q2.id)).toEqual({ ok: true, to: 'dev' });
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-2']); // 立即出去
  expect(r.get('dev')!.status).toBe('busy');
  expect(r.queuedMessageIds().has(q2.id)).toBe(false);
  expect(r.queuedMessageIds().has(q1.id)).toBe(true);                   // 其余不动
  expect(r.messages().find((m) => m.id === q2.id)?.urgent).toBe(true);  // 流水补标(⚡ 渲染依据)
  expect(r.messages().find((m) => m.id === q2.id)?.canceled).toBeUndefined();

  r.onIdle('dev');
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-2', 'queued-1']);
});

test('promoteQueued:目标空闲时(理论不该有排队,防御路径)等价 pump 置 busy', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');
  const q = r.send('boss', 'dev', 'queued-1')!;
  r.get('dev')!.status = 'idle'; // 直接造"空闲但还有排队"的瞬时态(轮询竞态下可能出现)
  expect(r.promoteQueued(q.id)).toEqual({ ok: true, to: 'dev' });
  expect(r.get('dev')!.status).toBe('busy');
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-1']);
});

test('promoteQueued:已投出/不存在 → ok:false', () => {
  const { r } = makeRouter();
  const m1 = r.send('boss', 'dev', 'first')!; // 即时投递,不在队列
  expect(r.promoteQueued(m1.id)).toEqual({ ok: false });
  expect(r.promoteQueued('nope')).toEqual({ ok: false });
  expect(r.messages().find((m) => m.id === m1.id)?.urgent).toBeUndefined();
});

test('promoteQueued:目标 launching → ok:false,消息留在队列', () => {
  const { r, delivered } = makeRouter();
  r.addAgent('newbie'); // launching
  const m = r.send('boss', 'newbie', 'early')!;
  expect(r.promoteQueued(m.id)).toEqual({ ok: false });
  expect(r.queuedMessageIds().has(m.id)).toBe(true); // 没被吞,register 后照常投
  expect(delivered).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/router-promote.test.ts`
Expected: FAIL(promoteQueued 不存在)

- [ ] **Step 3: 实现**

`src/core/router.ts` `cancelQueued` 后新增:

```ts
  /** 把一条仍在排队的消息提升为插队直送(按 id 全员查找):出队、补标 urgent、立即投递。
   *  已投出/不存在 → ok:false;目标 launching(pane 未就绪,直送会丢)也 ok:false、消息留队。
   *  注:流水与 inbox 持同一对象引用,补标即生效;持久化历史在发送时已落盘,事后补的 urgent
   *  标不回写(重启后历史不显示 ⚡,可接受——只是显示标记)。 */
  promoteQueued(id: string): { ok: boolean; to?: AgentName } {
    for (const a of this.agents.values()) {
      const i = a.inbox.findIndex((m) => m.id === id);
      if (i >= 0) {
        if (a.status === 'launching' || a.status === 'dead') return { ok: false };
        const msg = a.inbox[i];
        a.inbox.splice(i, 1);
        msg.urgent = true;
        this.deliverUrgent(a, msg);
        return { ok: true, to: a.name };
      }
    }
    return { ok: false };
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/router.ts tests/core/router-promote.test.ts
git commit -m "feat(core): promoteQueued——排队消息提升为插队直送,launching/dead 拒绝"
```

---

### Task 3: bus 透传 urgent + `/admin/promote`

**Files:**
- Modify: `src/bus/server.ts:232-248`(/admin/say、/admin/broadcast、新增 /admin/promote)
- Test: `tests/bus/admin-urgent.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `tests/bus/admin-urgent.test.ts`(harness 照抄 `tests/bus/admin-cancel.test.ts` 的 beforeEach/afterEach/post/get,FakeDriver+makeDeliverer):

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let driver: FakeDriver;

async function post(path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}
async function get(path: string) {
  return (await fetch(`http://127.0.0.1:${bus.port}${path}`)).json();
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addVirtual('boss');
  router.addAgent('dev');
  router.register('dev', await driver.launch({ cwd: '/d', command: 'cat' })); // idle
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
});
afterEach(async () => { await bus.close(); });

test('/admin/say urgent:true:目标忙也立即注入,log 带 urgent 且 queued:false', async () => {
  router.send('boss', 'dev', 'first'); // dev busy
  const before = driver.injections.length;
  const r = await post('/admin/say', { to: 'dev', message: 'cut-in', urgent: true });
  expect(r.ok).toBe(true);
  expect(driver.injections.length).toBeGreaterThan(before); // 直接注入,没等空闲
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === r.id);
  expect(rec.urgent).toBe(true);
  expect(rec.queued).toBe(false);
});

test('/admin/say 不带 urgent:行为不变(忙时排队)', async () => {
  router.send('boss', 'dev', 'first');
  const r = await post('/admin/say', { to: 'dev', message: 'normal' });
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === r.id);
  expect(rec.queued).toBe(true);
  expect(rec.urgent).toBeUndefined();
});

test('/admin/broadcast urgent:true:忙员工也直送', async () => {
  router.send('boss', 'dev', 'first'); // dev busy
  const before = driver.injections.length;
  const r = await post('/admin/broadcast', { message: 'all-hands', urgent: true });
  expect(r.sent).toEqual(['dev']);
  expect(driver.injections.length).toBeGreaterThan(before);
});

test('/admin/promote:排队消息提升直送,log 翻 urgent+queued:false;不存在 → ok:false', async () => {
  router.send('boss', 'dev', 'first');               // dev busy
  const q = router.send('boss', 'dev', 'second')!;   // 排队
  const before = driver.injections.length;
  expect(await post('/admin/promote', { id: q.id })).toEqual({ ok: true, to: 'dev' });
  expect(driver.injections.length).toBeGreaterThan(before);
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === q.id);
  expect(rec.urgent).toBe(true);
  expect(rec.queued).toBe(false);
  expect((await post('/admin/promote', { id: 'nope' })).ok).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/bus/admin-urgent.test.ts`
Expected: FAIL(urgent 被忽略 → cut-in 进队列;/admin/promote 404/ok:false)

- [ ] **Step 3: 实现**

`src/bus/server.ts` 三处:

```ts
      if (req.method === 'POST' && url.pathname === '/admin/say') {
        const msg = router.send('boss', String(abody.to), String(abody.message), { urgent: abody.urgent === true });
        return sendJson(msg ? { ok: true, id: msg.id } : { ok: false, error: 'unknown or dropped' });
      }
```

```ts
      if (req.method === 'POST' && url.pathname === '/admin/promote') {
        // 把排队消息提升为插队直送;已投出/不存在/目标未就绪 → ok:false。
        const r = router.promoteQueued(String(abody.id));
        return sendJson(r.ok ? { ok: true, to: r.to } : { ok: false, error: 'not queued' });
      }
```

```ts
      if (req.method === 'POST' && url.pathname === '/admin/broadcast') {
        const sent: string[] = [];
        for (const a of router.roster()) {
          if (a.virtual || a.status === 'dead' || a.name === 'boss') continue;
          if (router.send('boss', a.name, String(abody.message), { urgent: abody.urgent === true })) sent.push(a.name);
        }
        return sendJson({ sent });
      }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/bus`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts tests/bus/admin-urgent.test.ts
git commit -m "feat(bus): /admin/say|broadcast 透传 urgent + 新增 /admin/promote 提升排队消息"
```

---

### Task 4: 控制台 parse `!` 前缀 + i18n usageUrgent

**Files:**
- Modify: `src/console/parse.ts`(ConsoleAction + parseConsoleInput)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(usageUrgent;en 类型为 `typeof zh`,两边都要加否则编译失败)
- Test: `tests/console/parse.test.ts`(追加用例)

- [ ] **Step 1: 写失败测试**

`tests/console/parse.test.ts` 追加(import 沿用文件现有的):

```ts
test('! 前缀:!@名字 → urgent say', () => {
  expect(parseConsoleInput('!@lead 改方向')).toEqual({ kind: 'say', to: 'lead', message: '改方向', urgent: true });
});

test('! 前缀:!纯文本 → urgent reply', () => {
  expect(parseConsoleInput('!停下先别动')).toEqual({ kind: 'reply', message: '停下先别动', urgent: true });
});

test('! 前缀:!@all → urgent broadcast', () => {
  expect(parseConsoleInput('!@all 全员暂停')).toEqual({ kind: 'broadcast', message: '全员暂停', urgent: true });
});

test('! 前缀:!+路径 → 路径守卫照常生效,得 urgent reply', () => {
  expect(parseConsoleInput('!/var/folders/x/shot.png 看这张图')).toEqual({ kind: 'reply', message: '/var/folders/x/shot.png 看这张图', urgent: true });
});

test('! 前缀:命令不可插队(!/todo list)→ error', () => {
  expect(parseConsoleInput('!/todo list').kind).toBe('error');
});

test('! 前缀:单独一个 ! → error', () => {
  expect(parseConsoleInput('!').kind).toBe('error');
  expect(parseConsoleInput('!  ').kind).toBe('error');
});

test('! 前缀:!@名字(无消息体)→ error(沿用 usageMention 检查)', () => {
  expect(parseConsoleInput('!@lead').kind).toBe('error');
});
```

注:现有用例若用 `toEqual` 精确比对 say/reply/broadcast 结果,不受影响——`urgent` 不出现在非 `!` 输入的返回对象里(实现用条件展开,不放 `urgent: undefined` 键)。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/console/parse.test.ts`
Expected: 新增用例 FAIL(`!xx` 现被当普通 reply 文本,无 urgent 字段)

- [ ] **Step 3: 实现**

`src/console/parse.ts` ConsoleAction 前三个成员加可选字段:

```ts
export type ConsoleAction =
  | { kind: 'say'; to: string; message: string; urgent?: boolean }
  | { kind: 'broadcast'; message: string; urgent?: boolean }
  | { kind: 'reply'; message: string; urgent?: boolean }
  // ……其余成员不动……
```

`parseConsoleInput` 在 `if (s.startsWith('/'))` **之前**插入:

```ts
  // 句首 ! = boss 插队直送:剥掉后按原逻辑解析余文,只有消息类(say/broadcast/reply)能插队,命令不行。
  // 路径守卫在递归里照常生效:"!/var/x.png 描述" → reply → urgent。
  if (s.startsWith('!')) {
    const rest = s.slice(1).trim();
    if (!rest) return { kind: 'error', message: t().usageUrgent };
    const inner = parseConsoleInput(rest);
    if (inner.kind === 'say' || inner.kind === 'broadcast' || inner.kind === 'reply') return { ...inner, urgent: true };
    if (inner.kind === 'error') return inner; // 余文本身格式错(如 !@lead 缺消息体):报那个更具体的错
    return { kind: 'error', message: t().usageUrgent };
  }
```

`src/i18n/zh.ts` 在 `usageMention` 附近加(具体插哪行看现有分组,跟 usage* 们放一起):

```ts
  usageUrgent: '插队直送用法:!@名字 消息 · !消息(插队回复) · !@all 消息——跳过排队直接送达;命令不可插队',
```

`src/i18n/en.ts` 对应位置加:

```ts
  usageUrgent: 'Urgent send: !@name msg · !msg (urgent reply) · !@all msg — skips the queue, delivered immediately; commands cannot be urgent',
```

- [ ] **Step 4: 跑测试确认通过 + 全项目类型检查**

Run: `npx vitest run tests/console/parse.test.ts tests/i18n.test.ts && npx tsc --noEmit`
Expected: 全 PASS,tsc 零错误(en/zh 键平衡)

- [ ] **Step 5: Commit**

```bash
git add src/console/parse.ts src/i18n/zh.ts src/i18n/en.ts tests/console/parse.test.ts
git commit -m "feat(console): 句首 ! 解析为插队消息(say/reply/broadcast),命令不可插队"
```

---

### Task 5: 控制台接线——dispatch 带 urgent、⚡ 渲染、浮层 `!` 键提升

**Files:**
- Modify: `src/console/app.tsx`(dispatch ~176-184、flatLines header ~279、qCancel 浮层 ~420-442、浮层标题 ~686)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(新键 + 改 qcancelTitle/helpStatus)
- Test: `tests/console/app-e2e.test.tsx`(追加 1 个 renderE2E)

- [ ] **Step 1: i18n 新键**

`src/i18n/zh.ts`:

```ts
  urgentMark: ' ⚡直送',
  urgentOk: (to: string) => `⚡ → ${to}(直送)`,
  urgentBroadcastOk: '⚡ 已群发(直送)',
  qpromoteOk: (to: string) => `⚡ 已插队直送 1 条(→ ${to})`,
  qpromoteFailed: '插队失败(可能刚已送达,或员工未就绪)',
```

改两个现有键:

```ts
  qcancelTitle: (n: number) => `排队消息(共 ${n} 条)（↑↓ 选 · Enter 取消 · ! 插队直送 · Esc 关闭）`,
```

`helpStatus` 末尾追加 ` · !消息 插队直送`(整串保持一行)。

`src/i18n/en.ts` 对应:

```ts
  urgentMark: ' ⚡urgent',
  urgentOk: (to: string) => `⚡ → ${to} (urgent)`,
  urgentBroadcastOk: '⚡ broadcast (urgent)',
  qpromoteOk: (to: string) => `⚡ promoted 1 queued message (→ ${to})`,
  qpromoteFailed: 'promote failed (just delivered, or worker not ready)',
  qcancelTitle: (n: number) => `queued messages (${n}) (↑↓ select · Enter cancel · ! send now · Esc close)`,
```

en 的 `helpStatus` 末尾追加 ` · !msg urgent send`。

- [ ] **Step 2: dispatch 带 urgent + 状态行区分**

`src/console/app.tsx` dispatch 里 say/broadcast/reply 三个分支替换为:

```tsx
      if (a.kind === 'say') { const r = await admin(port, 'POST', '/admin/say', { to: a.to, message: expand(a.message), urgent: a.urgent }); setStatus(r.ok ? (a.urgent ? t().urgentOk(a.to) : t().sayOk(a.to)) : '⚠ ' + t().sayUndelivered(a.to, r.error ?? t().guardrailBlocked)); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: expand(a.message), urgent: a.urgent }); setStatus(a.urgent ? t().urgentBroadcastOk : t().broadcastOk); return; }
      if (a.kind === 'reply') {
        const target = lastReplyTarget(log);
        if (!target) { setStatus(t().noReplyTarget); return; }
        const r = await admin(port, 'POST', '/admin/say', { to: target, message: expand(a.message), urgent: a.urgent });
        setStatus(r.ok ? (a.urgent ? t().urgentOk(target) : t().replyOk(target)) : '⚠ ' + t().sayUndelivered(target, r.error ?? t().guardrailBlocked));
        return;
      }
```

- [ ] **Step 3: ⚡ 渲染**

flatLines 的 header 组装处,`canceledMark` 行后加一行(urgent 可能是 promote 事后补标,和 canceled 一样从实时 log 查):

```tsx
      if (liveById.get(m.id)?.urgent) header.push({ text: t().urgentMark, color: 'yellow' });
```

- [ ] **Step 4: 浮层 `!` 键**

qCancel 浮层键处理块(`if (qCancel !== null) {`)内、`return; // 浮层吞掉其它键` 之前加:

```tsx
      if (ev.type === 'text' && ev.text === '!') {
        const target = queuedMsgs[selIdx];
        if (!target) { setQCancel(null); return; }
        void (async () => {
          const r = await admin(port, 'POST', '/admin/promote', { id: target.id });
          setStatus(r.ok ? t().qpromoteOk(target.to) : '⚠ ' + t().qpromoteFailed);
          if (r.ok) {
            // 本地即时翻状态(不等下轮轮询):排队列表立刻缩、历史行立刻标 ⚡。
            const nl = log.map((m: any) => (m.id === target.id ? { ...m, queued: false, urgent: true } : m));
            setLog(nl);
            setPending(pendingCounts(nl));
          }
        })();
        return;
      }
```

- [ ] **Step 5: e2e 测试**

`tests/console/app-e2e.test.tsx` 末尾追加(沿用文件内 renderE2E/fakeStdout/fakeStdin/waitFor):

```tsx
renderE2E('e2e:浮层按 ! 提升排队消息直送 → 等送达消失、历史标 ⚡直送', { timeout: 15000 }, async () => {
  router.send('boss', 'alice', '占住-alice');   // 即时投递 → alice busy
  router.send('boss', 'alice', '排队-丙');      // 排队

  const stdout = fakeStdout(100, 30);
  const stdin = fakeStdin();
  const inst = render(<App port={bus.port} />, { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const lastFrame = () => (stdout.frames as string[]).map(strip).filter((x) => x.trim()).at(-1) ?? '';
  try {
    await waitFor(() => lastFrame().includes('等送达'));

    stdin.emit('data', '\x1b'); // Esc → 排队浮层
    await waitFor(() => lastFrame().includes('排队消息'));
    expect(lastFrame()).toContain('排队-丙');

    const before = driver.injections.length;
    stdin.emit('data', '!');    // ! 提升直送
    await waitFor(() => lastFrame().includes('已插队直送'));
    expect(driver.injections.length).toBeGreaterThan(before); // 真注入了(没等 alice 空闲)
    await waitFor(() => !lastFrame().includes('等送达'));      // 排队计数清零
    await waitFor(() => lastFrame().includes('⚡直送'));        // 历史行标记
  } finally {
    inst.unmount();
  }
});
```

注:beforeEach 里 `driver` 已是模块级变量,可直接断言 injections。

- [ ] **Step 6: 全量验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全 PASS(renderE2E 本地跑、CI 跳过),tsc 零错误

- [ ] **Step 7: Commit**

```bash
git add src/console/app.tsx src/i18n/zh.ts src/i18n/en.ts tests/console/app-e2e.test.tsx
git commit -m "feat(console): ! 插队直送接线——发送带 urgent、消息流 ⚡ 标记、排队浮层 ! 键提升直送"
```

---

### Task 6: 文档 + build

**Files:**
- Modify: `README.md`、`README.zh-CN.md`(控制台表格 + 特性列表)
- Modify: `docs/superpowers/specs/2026-06-12-boss-urgent-message-design.md`(实现后记)
- Run: `npm run build`

- [ ] **Step 1: README**

`README.md` 控制台表格 `@all sync up everyone` 行后加:

```markdown
| `!message` / `!@name message` / `!@all message` | **urgent send**: skips the queue and lands in the worker's pane immediately, even mid-generation (the CLI buffers it into the current turn). Feed shows ⚡. In the queued-messages overlay (Esc), press `!` to promote a queued message to urgent. |
```

特性列表 "No accidental broadcasts" 条目后加:

```markdown
- **Urgent (cut-in) messages**: prefix with `!` to bypass the queue — delivered into the worker's pane immediately even while it's generating; queued messages can be promoted with `!` in the Esc overlay. Boss-only; workers always queue.
```

`README.zh-CN.md` 找到对应中文表格/列表加等价行(对照中文版现有措辞风格):

```markdown
| `!消息` / `!@名字 消息` / `!@all 消息` | **插队直送**:跳过排队立即注入员工 pane,生成中也直送(CLI 缓冲进当前回合);消息流标 ⚡。Esc 排队浮层里按 `!` 可把已排队消息提升直送 |
```

```markdown
- **插队消息**:句首 `!` 跳过队列直接送达——员工生成中也立即进它的输入缓冲;已排队的消息在 Esc 浮层按 `!` 提升直送。仅 boss 可插队,员工互发照常排队。
```

- [ ] **Step 2: spec 实现后记**

spec 文件末尾加:

```markdown
## 实现后记(2026-06-12)

- 两处与原设计的偏差(实现时定):① urgent 投递**照常更新** lastDeliverAt——闲时直送依赖投递宽限防过早自动降闲+排队消息交错注入;A-2 误报需连续 2 次且任意 MCP 调用自愈,风险可接受。净效果 index.ts 零改动。② 目标 launching 时直送退化为正常排队(消息不标 urgent),promoteQueued 返回 ok:false——pane 未就绪,直送必丢。
- promote 事后补标的 urgent 不回写持久化历史(重启后旧消息不显示 ⚡)——纯显示标记,可接受。
```

- [ ] **Step 3: build + 最终全量**

Run: `npm run build && npx vitest run && npx tsc --noEmit`
Expected: build 成功(用户跑 dist/,交付前必须 build),测试全 PASS

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md docs/superpowers/specs/2026-06-12-boss-urgent-message-design.md
git commit -m "docs: 插队直送使用说明(README 双语)+ spec 实现后记"
```

---

## 验收(实机,实现完成后由主会话执行,不在子任务里)

1. `/tmp` 起测试办公室(haiku 模型),lead 忙时控制台发 `!@lead 测试插队`,确认:文字立即出现在 lead pane 输入框并提交、本回合内被处理、消息流显示 ⚡直送、无 ⏳;
2. 造排队消息(连发两条),Esc 开浮层按 `!`,确认选中条立即注入、浮层计数缩、历史标 ⚡;
3. 普通消息行为不变(忙时 ⏳ 排队、空闲 pump);
4. 收尾 shutdown + 清理 `~/.falinks/{sessions,todos,runtime}` 测试残档。
