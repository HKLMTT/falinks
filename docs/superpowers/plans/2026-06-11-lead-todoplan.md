# lead 经 MCP 建单与启动(todoplan/todostart)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lead 拆解需求后可经 MCP 工具 `todoplan` 把任务建成 falinks todolist,经 ask 获 boss 同意后用 `todostart` 启动执行。

**Architecture:** 引擎加原子批量 `plan(tasks, replace)`;总线注册两个 lead 专属工具(todoplan 走钩子新口 `plan(tasks, replace, from)`,todostart 复用 `op('start')`);index.ts 在 plan 成功后发 `falinks → boss` 系统通知;控制台进度行加 idle 待开跑分支;协调者工作法追加 todo 模式流程。

**Tech Stack:** TypeScript ESM(NodeNext)、vitest、Ink。验证门槛:**全项目 `npx tsc --noEmit`(含 tests,这是 CI 的门槛,严于 tsconfig.build.json)** + `npm test`;交付前 `npm run build`。

**Spec:** `docs/superpowers/specs/2026-06-11-lead-todoplan-design.md`

**关键既有事实**:引擎在 `src/core/todo.ts`(add/rm/clear/start/stop/resume/taskdone/tick/state,seq 单调计数器 `seqCounter`,`cb.persist`);BusDeps.todo 钩子现状见 `src/bus/server.ts:52-56`;taskdone 工具注册在 server.ts:135 附近(`touch()` 第一行 + lead 校验模式);index.ts 的钩子实现在 startBus deps 的 `todo:` 块;进度行在 app.tsx:632;coordinatorRules 在 zh.ts:189(en.ts 对应,`en: typeof zh` 编译强制同构)。**测试代码不得用 `as any` 绕类型(CI 全项目 tsc 会拦),回调参数写显式类型。**

---

### Task 1: 引擎 `plan(tasks, replace)`

**Files:**
- Modify: `src/core/todo.ts`
- Test: `tests/core/todo.test.ts`(追加)

- [ ] **Step 1: 写失败测试**(追加;mk() harness 已存在,沿用)

```ts
// —— plan(批量建单,lead 经 MCP 调用)——
test('plan:空 idle 直接建,seq 连续,一次 persist,返回 seqs', () => {
  const { e, calls } = mk();
  const before = calls.persist;
  const r = e.plan(['a', 'b', 'c'], false);
  expect(r).toEqual({ ok: true, seqs: [1, 2, 3] });
  expect(e.state().tasks.map((t) => t.status)).toEqual(['pending', 'pending', 'pending']);
  expect(calls.persist).toBe(before + 1); // 原子:整批一次落盘
});

test('plan:空数组/空白条目原子拒绝,不部分写入', () => {
  const { e } = mk();
  expect(e.plan([], false).ok).toBe(false);
  expect(e.plan(['a', '   ', 'c'], false).ok).toBe(false);
  expect(e.state().tasks).toEqual([]); // 一条都没进
});

test('plan:running/paused 拒绝', () => {
  const { e } = mk();
  e.add('x'); e.start(undefined, true);
  expect(e.plan(['a'], false).ok).toBe(false);
  e.stop();
  expect(e.plan(['a'], false).ok).toBe(false);
});

test('plan:finished 自动清旧账后建(与 add 语义一致)', () => {
  const { e } = mk();
  e.add('x'); e.start(undefined, true); e.taskdone(1, 'done', 'ok'); // → finished
  const r = e.plan(['a', 'b'], false);
  expect(r.ok).toBe(true);
  expect(e.state().state).toBe('idle');
  expect(e.state().tasks.map((t) => t.body)).toEqual(['a', 'b']); // 旧账清掉
});

test('plan:idle 非空默认拒绝(防覆盖 boss 手动单),replace:true 清空后建', () => {
  const { e } = mk();
  e.add('boss 手动加的');
  const rejected = e.plan(['a'], false);
  expect(rejected.ok).toBe(false);
  expect((rejected as { ok: false; error: string }).error).toMatch(/replace/);
  const r = e.plan(['a', 'b'], true);
  expect(r.ok).toBe(true);
  expect(e.state().tasks.map((t) => t.body)).toEqual(['a', 'b']);
});

test('plan:replace 后 seq 仍单调不复用', () => {
  const { e } = mk();
  e.add('x'); // seq 1
  const r = e.plan(['a'], true);
  expect(r).toEqual({ ok: true, seqs: [2] });
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/core/todo.test.ts` → 新用例 FAIL(plan 不存在)。

- [ ] **Step 3: 实现**(`src/core/todo.ts`,放在 `add()` 之后)

```ts
  /** 批量建单(lead 经 MCP todoplan 调用):整单原子——任一条不合法则整体拒绝,不部分写入。
   *  冲突矩阵:running/paused 拒绝;finished 清旧账(同 add);idle 非空默认拒绝(防覆盖 boss 手动单),
   *  replace=true 时清空后建(lead 修订自己刚建的清单的正路)。 */
  plan(tasks: string[], replace: boolean): { ok: true; seqs: number[] } | { ok: false; error: string } {
    if (this.st.state === 'running' || this.st.state === 'paused')
      return { ok: false, error: 'todolist is running/paused — cannot replan now' };
    if (tasks.length === 0 || tasks.some((b) => !b.trim()))
      return { ok: false, error: 'tasks must be a non-empty list of non-blank strings' };
    if (this.st.state === 'finished') { // 跑完续单:清旧账(汇总已入消息流)
      this.st.tasks = [];
      this.st.state = 'idle';
    } else if (this.st.tasks.length > 0) {
      if (!replace) return { ok: false, error: 'todolist already has tasks — pass replace:true to rebuild, or ask boss to /todo clear' };
      this.st.tasks = [];
    }
    const seqs = tasks.map((body) => {
      const task: TodoTask = { seq: ++this.seqCounter, body, status: 'pending' };
      this.st.tasks.push(task);
      return task.seq;
    });
    this.cb.persist(this.st);
    return { ok: true, seqs };
  }
```

- [ ] **Step 4: 确认通过**:`npx vitest run tests/core/todo.test.ts`(原 17 + 新 6 = 23 passed);`npx tsc --noEmit` 0 错。

- [ ] **Step 5: Commit**

```bash
git add src/core/todo.ts tests/core/todo.test.ts
git commit -m "feat(todo): 引擎 plan 原子批量建单(冲突矩阵+replace 修订)"
```

---

### Task 2: 总线两工具 + 钩子扩展

**Files:**
- Modify: `src/bus/server.ts`
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(两个工具描述)
- Test: `tests/bus/todoplan.test.ts`(新建)

- [ ] **Step 1: 写失败测试**(harness 仿 tests/bus/taskdone.test.ts,**回调参数显式类型,严禁 as any**)

```ts
// tests/bus/todoplan.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let planCalls: Array<{ tasks: string[]; replace: boolean; from: string }>;
let opCalls: Array<{ op: string; n?: number }>;

async function callTool(agent: string, name: string, args: Record<string, unknown> = {}) {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
  const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res: any = await client.callTool({ name, arguments: args });
  await client.close();
  return JSON.parse(res.content[0].text);
}

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('lead', undefined, true);
  router.addAgent('dev');
  planCalls = [];
  opCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: (_seq: number, _status: 'done' | 'failed', _result: string) => ({ ok: true }),
      op: (op: string, args: { body?: string; seq?: number; n?: number }) => { opCalls.push({ op, n: args.n }); return { ok: true }; },
      state: () => ({ state: 'idle', nudgeMinutes: 10, tasks: [] }),
      plan: (tasks: string[], replace: boolean, from: string) => { planCalls.push({ tasks, replace, from }); return { ok: true, seqs: [1, 2] }; },
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 todoplan 透传 tasks/replace/调用者名', async () => {
  const r = await callTool('lead', 'todoplan', { tasks: ['a', 'b'], replace: true });
  expect(r.ok).toBe(true);
  expect(r.seqs).toEqual([1, 2]);
  expect(planCalls).toEqual([{ tasks: ['a', 'b'], replace: true, from: 'lead' }]);
});

test('todoplan replace 缺省为 false', async () => {
  await callTool('lead', 'todoplan', { tasks: ['a'] });
  expect(planCalls[0].replace).toBe(false);
});

test('非 lead 调 todoplan/todostart 拒绝', async () => {
  const p = await callTool('dev', 'todoplan', { tasks: ['a'] });
  expect(p.ok).toBe(false);
  expect(p.error).toMatch(/lead/);
  const s = await callTool('dev', 'todostart', {});
  expect(s.ok).toBe(false);
  expect(planCalls).toEqual([]);
  expect(opCalls).toEqual([]);
});

test('lead 调 todostart 走 op(start),n 透传', async () => {
  const r = await callTool('lead', 'todostart', { nudgeMinutes: 15 });
  expect(r.ok).toBe(true);
  expect(opCalls).toEqual([{ op: 'start', n: 15 }]);
  await callTool('lead', 'todostart', {});
  expect(opCalls[1]).toEqual({ op: 'start', n: undefined });
});

test('无 todo 钩子时两工具都返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const p: any = await client.callTool({ name: 'todoplan', arguments: { tasks: ['a'] } });
    expect(JSON.parse(p.content[0].text).ok).toBe(false);
    const s: any = await client.callTool({ name: 'todostart', arguments: {} });
    expect(JSON.parse(s.content[0].text).ok).toBe(false);
    await client.close();
  } finally { await bus2.close(); }
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/bus/todoplan.test.ts` → FAIL。

- [ ] **Step 3: 实现**

① `BusDeps.todo`(server.ts:52-56)加一口:

```ts
    /** lead 批量建单(todoplan 工具):from=调用者名(通知留痕用)。 */
    plan(tasks: string[], replace: boolean, from: string): { ok: boolean; error?: string; seqs?: number[] };
```

(注意:钩子是必有四口的对象——现有字段非可选,直接加即可;tests/bus/taskdone.test.ts 的 stub 钩子需补 `plan` 字段,补成 `plan: (_t: string[], _r: boolean, _f: string) => ({ ok: true })`,显式类型。)

② `serverForAgent` 在 taskdone 工具注册后加两个工具(同款结构:`touch()` 第一行 + 钩子缺失守卫 + lead 校验):

```ts
  server.registerTool('todoplan', {
    description: t().toolDescTodoplan,
    inputSchema: { tasks: z.array(z.string()).min(1), replace: z.boolean().optional() },
  }, async ({ tasks, replace }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call todoplan' });
    return ok(deps.todo.plan(tasks, replace === true, agentName));
  });

  server.registerTool('todostart', {
    description: t().toolDescTodostart,
    inputSchema: { nudgeMinutes: z.number().optional() },
  }, async ({ nudgeMinutes }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call todostart' });
    return ok(deps.todo.op('start', { n: nudgeMinutes }));
  });
```

③ i18n 工具描述(zh 在 `toolDescTaskdone` 旁,en 对应翻译):

```ts
  toolDescTodoplan: '【todo 模式·仅组长】boss 明确要求用 todo 模式执行时,把拆解定稿的任务批量建成清单:todoplan(tasks:[每条一个任务], replace?)。建完必须用 ask(to:"boss") 征得 boss 同意才可 todostart;修订自己刚建的清单传 replace:true。',
  toolDescTodostart: '【todo 模式·仅组长】启动已建好的任务清单:todostart(nudgeMinutes?)。必须先经 ask 获得 boss 明确同意;paused 状态的恢复属 boss 干预权(/todo resume),本工具不可用。',
```

```ts
  toolDescTodoplan: '[todo mode · lead only] when boss explicitly asks for todo-mode execution, batch-create the finalized task breakdown: todoplan(tasks:[one per task], replace?). You MUST get boss approval via ask(to:"boss") before todostart; pass replace:true to revise a list you just created.',
  toolDescTodostart: '[todo mode · lead only] start the prepared task list: todostart(nudgeMinutes?). Requires explicit boss approval via ask first; resuming a paused list is the boss\'s call (/todo resume), not this tool.',
```

- [ ] **Step 4: 确认通过**:`npx vitest run tests/bus/ tests/i18n.test.ts` 全绿;`npx tsc --noEmit` 0 错(会逼出 taskdone.test.ts stub 缺 plan 的修补)。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts src/i18n/zh.ts src/i18n/en.ts tests/bus/todoplan.test.ts tests/bus/taskdone.test.ts
git commit -m "feat(bus): todoplan/todostart 工具(仅 lead)+ 钩子 plan 口"
```

---

### Task 3: index.ts 钩子实现 + 系统通知

**Files:**
- Modify: `src/index.ts`(startBus deps 的 `todo:` 块)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(todoPlannedMsg)

无独立单测(钩子是一行包装+一条 send,纯逻辑已在 Task 1/2 覆盖;实机在 Task 5)。门槛:`npx tsc --noEmit` + `npm test`。

- [ ] **Step 1: i18n 通知文案**

zh(`todoSuspendedMsg` 旁):

```ts
  todoPlannedMsg: (from: string, n: number) => `【todo 模式】组长 ${from} 已建 ${n} 条任务清单,/todo list 查看;待 boss 确认后由组长启动(或你直接 /todo start)。`,
```

en:

```ts
  todoPlannedMsg: (from: string, n: number) => `[todo mode] lead ${from} created a ${n}-task list — /todo list to review; the lead will start it after your approval (or run /todo start yourself).`,
```

- [ ] **Step 2: index.ts 的 `todo:` 钩子块加 plan 实现**(`state: () => todo.state(),` 之前)

```ts
      plan: (tasks, replace, from) => {
        const r = todo.plan(tasks, replace);
        if (r.ok) router.send('falinks', 'boss', t().todoPlannedMsg(from, tasks.length)); // 系统留痕:boss 在消息流可见
        return r;
      },
```

(参数类型由 BusDeps 接口上下文推断,无需标注;若 tsc 报隐式 any 则补显式类型。)

- [ ] **Step 3: 门槛**:`npx tsc --noEmit && npm test` 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(core): todoplan 钩子接线 + falinks→boss 建单留痕通知"
```

---

### Task 4: 控制台进度行 idle 待开跑分支 + 协调者工作法

**Files:**
- Modify: `src/console/app.tsx`(进度行,~line 632)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(todoPendingLine + coordinatorRules 追加)

- [ ] **Step 1: i18n**

zh `todoProgressLine` 旁加:

```ts
  todoPendingLine: (n: number) => `📋 ${n} 条待开跑(/todo list 查看)`,
```

en:

```ts
  todoPendingLine: (n: number) => `📋 ${n} task(s) queued, not started (/todo list to review)`,
```

zh `coordinatorRules`(zh.ts:189,现有 ①②③ + "一句话"结尾)在 ③ 之后、"一句话"之前追加:

```ts
    '④ 当 boss 明确要求用 todo 模式执行时:拆解定稿后调用 todoplan(tasks:[每条一个任务]) 建成清单 → 用 ask(to:"boss") 确认是否开始执行(选项里给巡查间隔,如「开始(巡查10分钟)/开始(巡查30分钟)/暂不」)→ boss 同意后调 todostart(nudgeMinutes) 启动;之后每完成一条用 taskdone(seq, status, result) 上报,系统会自动下发下一条。未经 boss 同意绝不 todostart;要修订刚建的清单用 todoplan(…, replace:true)。' +
```

en 对应位置追加(faithful translation,术语 todoplan/todostart/taskdone/ask 保留原名)。注意结尾"一句话"总结句不动。

- [ ] **Step 2: app.tsx 进度行**(line ~632 的 running/paused 分支)改为三态:

```tsx
        {todoState && (todoState.state === 'running' || todoState.state === 'paused') ? (() => {
          const cur = todoState.tasks.find((x: any) => x.status === 'current');
          const k = todoState.tasks.filter((x: any) => x.status === 'done' || x.status === 'failed').length + (cur ? 1 : 0);
          return <Text color="cyan">{t().todoProgressLine(k, todoState.tasks.length, cur ? String(cur.body).split('\n')[0].slice(0, 60) : '-', todoState.state === 'paused')}</Text>;
        })() : todoState && todoState.state === 'idle' && todoState.tasks.length > 0 ? (
          <Text color="cyan">{t().todoPendingLine(todoState.tasks.length)}</Text>
        ) : null}
```

(现有 running/paused 代码原样保留为第一分支,只追加 idle 分支;idle 态任务必为 pending——状态机保证,不会显示旧账。)

- [ ] **Step 3: 门槛**:`npx vitest run tests/console/ tests/i18n.test.ts && npx tsc --noEmit && npm test` 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/console/app.tsx src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(console): 进度行 idle 待开跑分支;coordinatorRules 追加 todo 模式工作法(中英)"
```

---

### Task 5: 全量验证 + 构建 + 实机验收

- [ ] **Step 1**: `npx tsc --noEmit && npm test && npm run build` — CI 同款门槛全绿。

- [ ] **Step 2: 实机验收(完整协作流)**:`/tmp/falinks-plan-verify` 单 lead 团队(模型用 claude-haiku-4-5-20251001 省配额):

1. boss 发需求:「把 A/B/C 三件事做完,**用 todo 模式执行**。A=回答1+1;B=回答2+2;C=回答3+3」;
2. 等 lead `todoplan` → 控制台出现「📋 3 条待开跑」进度行 + `falinks → boss` 通知 ✓;
3. 等 lead 的 ask 问题出现(`GET /admin/questions`)→ 用 `POST /admin/answer` 选「开始」 ✓;
4. 等 lead `todostart` → state=running、任务 1 下发回 lead ✓;
5. 三条 taskdone 跑完 → 汇总 ✓;
6. 补验:非 lead 不可调(单测已覆盖,实机略);`todoplan` 二次重建传 replace(可通过 boss 再发一条「清单改成两条,重建」观察 lead 行为,模型不配合则跳过——软约束不阻塞验收);
7. shutdown + 清理(含 `~/.falinks/todos/` 本验收的项目档案;**不得碰用户其他在跑的办公室**)。

- [ ] **Step 3**: 发现问题回前面任务修;全绿后本计划完成(发布另起:CHANGELOG + 版本 0.12.0 + push + tag,按 release-process 记忆执行,需 boss 点头)。

---

## Self-Review 结果

- **Spec 覆盖**:引擎 plan 冲突矩阵+原子+replace(T1)、两工具+lead 校验+schema+钩子 plan 口+from 透传+todostart 复用 op('start')(T2)、通知留痕(T3)、进度行 idle 分支+工作法追加+工具描述软约束(T2/T4)、实机完整协作流含 ask 确认(T5)、有意不做(硬凭证/多清单/lead 管理权)未引入。无缺口。
- **占位扫描**:en 的 coordinatorRules 追加是"对照翻译"指引(zh 原文完整给出,en: typeof zh 编译兜底);其余全代码。
- **类型一致**:`plan(tasks: string[], replace: boolean)` 引擎(T1)↔ 钩子 `plan(tasks, replace, from)`(T2 定义、T3 实现)↔ 工具 schema(T2);`todoPlannedMsg(from, n)`/`todoPendingLine(n)`/`toolDescTodoplan`/`toolDescTodostart`(定义与使用对齐);taskdone.test.ts stub 钩子补 plan 字段已写明。
- **CI 门槛**:每个任务的验证都用全项目 `npx tsc --noEmit`(0.11.0 发布时踩过的坑),测试代码禁 as any 已写进计划头与 T2。
