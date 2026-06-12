# todolist 巡查空转治理实现计划(taskwait + 无果退避)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lead 可用 `taskwait` 声明"等外部过程,X 分钟内勿巡查";无果巡查指数退避封顶 60 分钟 + 第 3 次告警;dispatch/nudge 文案升级。通宵空转成本降 ~6 倍。

**Architecture:** TodoEngine 纯逻辑扩展(等待窗 + 无果计数 + 退避间隔),副作用照旧经回调注入由 index.ts 拼模板;bus 注册 lead 专属 `taskwait` 工具;控制台进度行显示等待状态。

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import), vitest, zod (MCP inputSchema), Ink。测试零 `as any`;每个 task 单独 commit 且全项目 `npx tsc --noEmit` 必须绿(引擎回调签名变更与 index.ts 接线必须同 commit)。

**Spec:** `docs/superpowers/specs/2026-06-12-todo-nudge-idle-burn-fix-design.md`
**Spec 的一处细化**(实现按本计划,事后补 spec 后记):waitUntil/waitReason 字段随 TodoState 落盘(saveTodo 整体序列化),但 **loadTodo 不恢复**它们——重启后清单必经 paused→resume→重发,旧等待声明随旧会话作废,比"过期戳无害"更干净。

---

### Task 1: taskwait 全链(store 字段 + 引擎方法 + 等待窗 + bus 工具 + i18n + 接线)

**Files:**
- Modify: `src/todo-store.ts`(TodoState 加字段;loadTodo 不恢复)
- Modify: `src/core/todo.ts`(taskwait 方法 + tick 等待窗 + TodoCallbacks.announceWaiting)
- Modify: `src/index.ts`(TodoEngine 回调加 announceWaiting)
- Modify: `src/bus/server.ts`(BusDeps.todo 接口加 taskwait + 注册工具)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(todoWaitingMsg、toolDescTaskwait)
- Test: `tests/core/todo-wait.test.ts`(新建)、`tests/bus/taskwait.test.ts`(新建)

- [ ] **Step 1: 写引擎失败测试**

新建 `tests/core/todo-wait.test.ts`(harness 仿照 `tests/core/todo.test.ts` 的 mk(),回调对象需加 `announceWaiting`——注意 Task 1 改了 TodoCallbacks,旧测试文件 mk() 也要补这个回调字段,否则 tsc 失败;旧文件只补字段不加断言):

```ts
// tests/core/todo-wait.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';
import type { TodoState } from '../../src/todo-store.js';

function mk(initial?: TodoState) {
  let now = 0;
  let nextId = 0;
  const calls = {
    dispatch: [] as { seq: number; pos: number; isResend: boolean }[],
    nudge: [] as { seq: number; pos: number }[],
    waiting: [] as { seq: number; minutes: number; reason: string }[],
    persist: 0,
  };
  const e = new TodoEngine({
    now: () => now,
    dispatch: (t, pos, _total, isResend) => { calls.dispatch.push({ seq: t.seq, pos, isResend }); return `msg${++nextId}`; },
    nudge: (t, pos) => { calls.nudge.push({ seq: t.seq, pos }); return true; },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceSendFailing: () => {},
    announceWaiting: (t, minutes, reason) => { calls.waiting.push({ seq: t.seq, minutes, reason }); },
    removedByBossText: () => 'removed',
    persist: () => { calls.persist++; },
  }, initial);
  return { e, calls, setNow: (v: number) => { now = v; } };
}
const MIN = 60_000;

test('taskwait:等待期内 tick 不巡查,到期后按正常节奏恢复(到期+N 分钟才第一轰)', () => {
  const { e, calls, setNow } = mk();
  e.add('跑 e2e'); e.start(undefined, true); // current=#1,默认 nudgeMinutes=10
  expect(e.taskwait(1, 30, '等 16 轮 e2e 跑完').ok).toBe(true);
  expect(calls.waiting).toEqual([{ seq: 1, minutes: 30, reason: '等 16 轮 e2e 跑完' }]);
  expect(e.state().waitUntil).toBe(30 * MIN);

  for (let m = 1; m <= 29; m++) { setNow(m * MIN); e.tick(false, true); }
  expect(calls.nudge).toEqual([]); // 等待期 29 分钟全静默

  setNow(35 * MIN); e.tick(false, true); // 到期后 5 分钟:锚点从到期附近起算,还不到 10 分钟
  expect(calls.nudge).toEqual([]);
  expect(e.state().waitUntil).toBeUndefined(); // 过期已清

  setNow(45 * MIN); e.tick(false, true); // 到期已 15 分钟 ≥ 10 → 巡查恢复
  expect(calls.nudge.length).toBe(1);
});

test('taskwait 校验:非 running/无 current/seq 错位/minutes 越界或非整数', () => {
  const { e } = mk();
  expect(e.taskwait(1, 10, 'x').ok).toBe(false); // idle 无清单
  e.add('a'); e.start(undefined, true);
  expect(e.taskwait(2, 10, 'x').ok).toBe(false);   // 错位:current 是 1
  expect(e.taskwait(1, 0, 'x').ok).toBe(false);    // 0 非法
  expect(e.taskwait(1, 121, 'x').ok).toBe(false);  // 超 120 封顶
  expect(e.taskwait(1, 10.5, 'x').ok).toBe(false); // 非整数
  expect(e.taskwait(1, 120, 'x').ok).toBe(true);   // 上界恰好可用
});

test('taskwait:taskdone 推进下一条后旧等待声明清除(不压制新任务巡查)', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.add('b'); e.start(undefined, true);
  expect(e.taskwait(1, 120, '长等待').ok).toBe(true);
  setNow(5 * MIN);
  expect(e.taskdone(1, 'done', 'ok').ok).toBe(true); // 推进到 #2
  expect(e.state().waitUntil).toBeUndefined();        // 等待声明随旧任务作废
  setNow(16 * MIN); e.tick(false, true);              // #2 下发于 5min,空闲 11 分钟 ≥ 10
  expect(calls.nudge.map((x) => x.seq)).toEqual([2]); // 新任务照常巡查
});

test('taskwait:anyBusy 与等待窗并存时锚点不漂移(等待期内忙碌不影响到期后的节奏)', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true);
  e.taskwait(1, 20, '等脚本');
  setNow(10 * MIN); e.tick(true, true);  // 等待期内有人忙
  setNow(25 * MIN); e.tick(false, true); // 到期后 5 分钟
  expect(calls.nudge).toEqual([]);
  setNow(36 * MIN); e.tick(false, true); // 到期后 16 分钟 ≥ 10
  expect(calls.nudge.length).toBe(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/todo-wait.test.ts`
Expected: FAIL(taskwait/announceWaiting 不存在 → 编译错误)

- [ ] **Step 3: 实现 store 与引擎**

`src/todo-store.ts` TodoState 加:

```ts
export interface TodoState {
  state: 'idle' | 'running' | 'paused' | 'finished';
  nudgeMinutes: number; // 巡查间隔 N(分钟),默认 10
  tasks: TodoTask[];
  waitUntil?: number;  // taskwait 等待声明截止时刻(ms):等待期内暂停巡查;随档落盘但 loadTodo 不恢复
  waitReason?: string; // 等待原因(boss 进度行/公告可见)
}
```

`loadTodo` 构造 st 处保持只取三个字段不变(天然不恢复 wait 字段),在 st 构造后加注释:

```ts
    // waitUntil/waitReason 有意不恢复:重启后清单必经 paused→resume 重发,旧等待声明随旧会话作废。
```

`src/core/todo.ts`:

常量区(`FAIL_ANNOUNCE_AT` 旁)加:

```ts
const WAIT_CAP_MIN = 120; // taskwait 单次等待上限(分钟):防 lead 一句声明把巡查睡死
```

TodoCallbacks 接口加(announceSendFailing 后):

```ts
  /** lead 经 taskwait 声明等待外部过程:向 boss 公告(消息流可见,知道为什么安静)。 */
  announceWaiting(task: TodoTask, minutes: number, reason: string): void;
```

`taskdone` 方法后加:

```ts
  /** lead 声明"任务推进中,等待外部过程(长脚本/CI),X 分钟内暂停巡查"。
   *  仅 running 且 seq 必须是 current——等待是当前任务的属性;到期由 tick 自动清除并恢复正常节奏。 */
  taskwait(seq: number, minutes: number, reason: string): TodoResult {
    if (this.st.state !== 'running') return { ok: false, error: 'no running todolist' };
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return { ok: false, error: 'no current task' };
    if (cur.seq !== seq) return { ok: false, error: `current task is #${cur.seq}, not #${seq}` };
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > WAIT_CAP_MIN)
      return { ok: false, error: `minutes must be an integer in 1..${WAIT_CAP_MIN}` };
    this.st.waitUntil = this.cb.now() + minutes * MIN_MS;
    this.st.waitReason = reason.trim() || undefined;
    this.cb.persist(this.st);
    this.cb.announceWaiting(cur, minutes, reason.trim());
    return { ok: true };
  }
```

`tick` 的 `if (anyBusy)` 行后加等待窗(idleSince 持续推进 = 到期后从到期时刻起算正常节奏):

```ts
    if (this.st.waitUntil !== undefined) {
      if (now < this.st.waitUntil) { this.idleSince = now; return; } // 等待期:不巡查,锚点持续推进
      // 到期:锚点至少从到期时刻起算(等待期内可能没有 tick 推进锚点),再正常计满 nudgeMinutes 才巡查
      this.idleSince = Math.max(this.idleSince ?? this.st.waitUntil, this.st.waitUntil);
      this.st.waitUntil = undefined; this.st.waitReason = undefined; this.cb.persist(this.st); // 过期清除
    }
```

`dispatchNext` 开头(取 task 之前)加——新任务下发清旧等待声明:

```ts
    if (this.st.waitUntil !== undefined) { this.st.waitUntil = undefined; this.st.waitReason = undefined; } // 等待声明随旧任务作废
```

- [ ] **Step 4: 接线 index.ts + i18n + bus 工具**

`src/index.ts` TodoEngine 回调对象 `announceSendFailing` 后加:

```ts
    announceWaiting: (task, minutes, reason) => {
      router.send('falinks', 'boss', t().todoWaitingMsg(task.seq, minutes, reason));
    },
```

`src/i18n/zh.ts` todoSendFailingMsg 旁加:

```ts
  todoWaitingMsg: (seq: number, minutes: number, reason: string) =>
    `【todolist】组长声明等待外部过程${reason ? `:${reason}` : ''},任务 #${seq} 巡查暂停 ${minutes} 分钟。`,
```

toolDesc* 分组加:

```ts
  toolDescTaskwait: '(仅组长)声明当前任务在等待外部过程(长脚本/CI/后台测试),minutes(1-120)分钟内暂停空闲巡查;reason 会展示给 boss。任务实际完成时仍须调 taskdone。',
```

`src/i18n/en.ts` 对应:

```ts
  todoWaitingMsg: (seq: number, minutes: number, reason: string) =>
    `[todolist] lead declared an external wait${reason ? `: ${reason}` : ''}; nudges for task #${seq} paused for ${minutes} min.`,
  toolDescTaskwait: '(lead only) Declare the current task is waiting on an external process (long script/CI/background tests); idle nudges pause for `minutes` (1-120). `reason` is shown to the boss. Still call taskdone when actually finished.',
```

`src/bus/server.ts`:BusDeps.todo 接口(~:51-56)加一行:

```ts
    taskwait(seq: number, minutes: number, reason: string): { ok: boolean; error?: string };
```

`todostart` 注册块后加:

```ts
  server.registerTool('taskwait', {
    description: t().toolDescTaskwait,
    inputSchema: { seq: z.number(), minutes: z.number(), reason: z.string().optional() },
  }, async ({ seq, minutes, reason }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call taskwait' });
    return ok(deps.todo.taskwait(seq, minutes, reason ?? ''));
  });
```

- [ ] **Step 5: 写 bus 失败测试并跑通全链**

新建 `tests/bus/taskwait.test.ts`(harness 仿照 `tests/bus/taskdone.test.ts`——先读它,沿用其 deps.todo 注入与 MCP 调用方式;若它用 HTTP JSON-RPC 直调 MCP 端点,本测试同款)。覆盖:lead 调用成功(参数透传到 deps.todo.taskwait)、非 lead 拒绝、todolist 不可用拒绝。测试中 deps.todo 的 fake 需实现 taskwait(记录参数返回 ok)。

Run: `npx vitest run tests/core tests/bus && npx tsc --noEmit`
Expected: 全 PASS、tsc 零错误(注意旧 tests/core/todo.test.ts 与 tests/bus/todoplan.test.ts 等处的 TodoCallbacks/BusDeps fake 对象需补新成员)

- [ ] **Step 6: Commit**

```bash
git add src/todo-store.ts src/core/todo.ts src/index.ts src/bus/server.ts src/i18n/zh.ts src/i18n/en.ts tests/core/todo-wait.test.ts tests/bus/taskwait.test.ts tests/core/todo.test.ts
git commit -m "feat(todo): taskwait 等待声明——lead 声明等外部过程,巡查暂停 N 分钟(封顶 120)"
```

(若还有其它测试文件因回调接口扩展被动修改,一并 add。)

---

### Task 2: 无果巡查指数退避 + 停滞告警 + 文案升级

**Files:**
- Modify: `src/core/todo.ts`(fruitlessNudges + 退避间隔 + cb.nudge 签名 + announceStalled)
- Modify: `src/index.ts`(nudge 回调拼升级文案 + announceStalled 接线)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(todoNudgeMsg 改签名/文案、todoDispatchMsg 加 taskwait 指引、todoStalledMsg)
- Test: `tests/core/todo-backoff.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `tests/core/todo-backoff.test.ts`(mk() 同 Task 1,nudge 回调记录第 4 参,回调对象加 `announceStalled`;Task 1 的 mk 与旧测试文件同步补这个字段):

```ts
// tests/core/todo-backoff.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';

function mk() {
  let now = 0;
  let nextId = 0;
  const calls = {
    nudge: [] as { seq: number; fruitless: number; nextMinutes: number }[],
    stalled: [] as { seq: number; n: number; intervalMinutes: number }[],
  };
  const e = new TodoEngine({
    now: () => now,
    dispatch: () => `msg${++nextId}`,
    nudge: (t, _pos, _total, info) => { calls.nudge.push({ seq: t.seq, fruitless: info.fruitless, nextMinutes: info.nextMinutes }); return true; },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceSendFailing: () => {},
    announceWaiting: () => {},
    announceStalled: (t, n, intervalMinutes) => { calls.stalled.push({ seq: t.seq, n, intervalMinutes }); },
    removedByBossText: () => 'removed',
    persist: () => {},
  });
  return { e, calls, setNow: (v: number) => { now = v; } };
}
const MIN = 60_000;
/** 跑到 atMin 分钟为止逐分钟 tick(全员空闲)。 */
function idleUntil(e: ReturnType<typeof mk>['e'], setNow: (v: number) => void, fromMin: number, atMin: number) {
  for (let m = fromMin; m <= atMin; m++) { setNow(m * MIN); e.tick(false, true); }
}

test('退避序列:10→20→40→60 封顶,nudge 回调收到 fruitless 与 nextMinutes', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true); // 下发于 0,nudgeMinutes=10
  idleUntil(e, setNow, 1, 200);
  // 期望 nudge 时刻:10(间隔10) → 30(+20) → 70(+40) → 130(+60,封顶) → 190(+60)
  expect(calls.nudge.map((x) => x.fruitless)).toEqual([0, 1, 2, 3, 4]);
  expect(calls.nudge.map((x) => x.nextMinutes)).toEqual([20, 40, 60, 60, 60]);
  expect(calls.nudge.length).toBe(5);
});

test('第 3 次无果边沿告警一次,且只一次', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true);
  idleUntil(e, setNow, 1, 200);
  expect(calls.stalled).toEqual([{ seq: 1, n: 3, intervalMinutes: 60 }]);
});

test('taskdone 清零退避:新任务从原始节奏起算', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.add('b'); e.start(undefined, true);
  idleUntil(e, setNow, 1, 35); // 10、30 两次无果(fruitless 0、1)
  expect(calls.nudge.length).toBe(2);
  setNow(36 * MIN);
  e.taskdone(1, 'done', 'ok'); // 推进 #2,退避清零
  idleUntil(e, setNow, 37, 47); // 下发于 36,46 时空闲满 10
  expect(calls.nudge.length).toBe(3);
  expect(calls.nudge[2]).toEqual({ seq: 2, fruitless: 0, nextMinutes: 20 });
});

test('taskwait 清零退避', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true);
  idleUntil(e, setNow, 1, 35); // 两次无果
  setNow(36 * MIN);
  expect(e.taskwait(1, 10, '等脚本').ok).toBe(true);
  idleUntil(e, setNow, 37, 57); // 46 到期,56 时到期后空闲满 10
  expect(calls.nudge[2].fruitless).toBe(0); // 节奏归位
});

test('anyBusy 重置锚点但不清退避计数(忙过≠有上报)', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true);
  idleUntil(e, setNow, 1, 35); // 两次无果(10、30),当前 fruitless=2,间隔 40
  setNow(40 * MIN); e.tick(true, true);  // 有人忙一下
  idleUntil(e, setNow, 41, 79); // 40+40=80 才该轰
  expect(calls.nudge.length).toBe(2);
  setNow(80 * MIN); e.tick(false, true);
  expect(calls.nudge.length).toBe(3);
  expect(calls.nudge[2].fruitless).toBe(2); // 计数保持
});

test('nudgeMinutes > 60 时封顶取 nudgeMinutes(不缩短 boss 配置)', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(90, true); // 90 分钟巡查
  idleUntil(e, setNow, 1, 400);
  // 90(间隔90)→ 180(+90 封顶,因 cap=max(60,90)=90)→ 270 → 360
  expect(calls.nudge.length).toBe(4);
  expect(calls.nudge.map((x) => x.nextMinutes)).toEqual([90, 90, 90, 90]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/todo-backoff.test.ts`
Expected: FAIL(nudge 第 4 参/announceStalled 不存在)

- [ ] **Step 3: 实现引擎退避**

`src/core/todo.ts`:

常量区加:

```ts
const BACKOFF_CAP_MIN = 60;   // 无果退避封顶(分钟);nudgeMinutes 配得更长时取后者
const STALL_ANNOUNCE_AT = 3;  // 连续无果巡查达此次数 → 边沿告警一次(疑似已完成未关闭/停滞)
```

TodoCallbacks 改 nudge 签名 + 加 announceStalled:

```ts
  /**
   * 巡查询问(模板自包含任务内容,同时就是下发失败的重试);返回是否发送成功。
   * info.fruitless: 本次之前的连续无果次数(≥1 时模板升级措辞);info.nextMinutes: 下次巡查间隔(分钟,模板告知)。
   */
  nudge(task: TodoTask, pos: number, total: number, info: { fruitless: number; nextMinutes: number }): boolean;
  /** 连续 STALL_ANNOUNCE_AT 次无果巡查:疑似任务已完成未关闭或停滞,向 boss 告警(边沿一次)。 */
  announceStalled(task: TodoTask, n: number, intervalMinutes: number): void;
```

私有字段区加:

```ts
  private fruitlessNudges = 0; // 自上次进度信号(taskdone/taskwait/下发)以来的无果巡查次数:驱动指数退避
```

加私有帮助方法:

```ts
  /** 无果 n 次后的巡查间隔(分钟):nudgeMinutes×2^n,封顶 max(60, nudgeMinutes)。 */
  private nudgeIntervalMin(n: number): number {
    return Math.min(this.st.nudgeMinutes * 2 ** n, Math.max(BACKOFF_CAP_MIN, this.st.nudgeMinutes));
  }
```

`tick` 的巡查判定改为(原 `if (now - this.idleSince >= this.st.nudgeMinutes * MIN_MS)` 块整体替换):

```ts
    if (now - this.idleSince >= this.nudgeIntervalMin(this.fruitlessNudges) * MIN_MS) {
      const pos = this.st.tasks.indexOf(cur) + 1; // 显示用位置(1-based);cur 必在列表中
      const info = { fruitless: this.fruitlessNudges, nextMinutes: this.nudgeIntervalMin(this.fruitlessNudges + 1) };
      if (this.cb.nudge(cur, pos, this.st.tasks.length, info)) {
        this.noteSendOk();
        this.fruitlessNudges++;
        if (this.fruitlessNudges === STALL_ANNOUNCE_AT)
          this.cb.announceStalled(cur, this.fruitlessNudges, this.nudgeIntervalMin(this.fruitlessNudges));
        this.idleSince = now; // 发出即重置(下一轮按退避后的间隔)
      } else this.noteSendFail(); // 失败不重置:下一 tick 立刻重试
    }
```

清零点:`taskwait` 成功路径(persist 之前)加 `this.fruitlessNudges = 0;`;`dispatchNext` 开头(等待声明清除行旁)加 `this.fruitlessNudges = 0; // 新一轮下发=进度信号,退避归零`。(taskdone→dispatchNext、start/resume→dispatchNext/redispatch 都经此,无需另设。)

- [ ] **Step 4: index.ts 接线 + i18n 文案**

`src/index.ts` nudge 回调替换:

```ts
    nudge: (task, pos, total, info) => {
      const lead = currentLead();
      if (!lead) return false;
      return !!router.send('boss', lead, t().todoNudgeMsg(task.seq, pos, total, task.body, info.nextMinutes, info.fruitless >= 1));
    },
```

announceWaiting 后加:

```ts
    announceStalled: (task, n, intervalMinutes) => {
      router.send('falinks', 'boss', t().todoStalledMsg(task.seq, n, intervalMinutes));
      try { appendDiag(launchCwd, { kind: 'todo-stalled', seq: task.seq, n, ts: Date.now() }); } catch { /* 诊断落盘失败不致命 */ }
    },
```

`src/i18n/zh.ts` 改/加:

```ts
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `【任务 #${seq}·第 ${pos}/${total} 条】${isResend ? '(重发)' : ''}${body}\n完成后调用 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报,系统才会下发下一条;如需等待长时间脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待,期间暂停巡查。勿用 sendmsg 回复本条,过程中可照常与团队/boss 沟通。`,
  todoNudgeMsg: (seq: number, pos: number, total: number, body: string, nextMinutes: number, escalated: boolean) =>
    `【任务 #${seq}(第 ${pos}/${total} 条)进度巡查】全员空闲已久仍未收到上报。任务内容:${body}\n` +
    (escalated
      ? `若该任务实际已完成,说明 #${seq} 仍未关闭——请立即调 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报;`
      : `已完成请调 taskdone(seq:${seq}, status:"done"|"failed", result:"…");`) +
    `仍在推进则继续即可;如在等待长时间脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待。勿因本提醒向队友发起额外沟通。未上报则 ${nextMinutes} 分钟后再次巡查。`,
  todoStalledMsg: (seq: number, n: number, intervalMinutes: number) =>
    `【todolist 告警】任务 #${seq} 连续 ${n} 次巡查无上报——疑似已完成但未关闭,或已停滞;巡查间隔已退避至 ${intervalMinutes} 分钟。请 /todo list 检查,可提醒组长 taskdone 或 /todo stop。`,
```

`src/i18n/en.ts` 对应翻译(签名一致):

```ts
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `[Task #${seq} · ${pos}/${total}]${isResend ? ' (resend)' : ''} ${body}\nCall taskdone(seq:${seq}, status:"done"|"failed", result:"…") when finished — the next task is only dispatched after that. If you are waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…") to pause nudges. Do not reply to this via sendmsg; normal team/boss communication is fine meanwhile.`,
  todoNudgeMsg: (seq: number, pos: number, total: number, body: string, nextMinutes: number, escalated: boolean) =>
    `[Task #${seq} (${pos}/${total}) progress check] Everyone has been idle for a while with no report. Task: ${body}\n` +
    (escalated
      ? `If this task is actually finished, #${seq} is still open — call taskdone(seq:${seq}, status:"done"|"failed", result:"…") NOW;`
      : `If finished, call taskdone(seq:${seq}, status:"done"|"failed", result:"…");`) +
    ` if still in progress, carry on; if waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…"). Do not message teammates just because of this reminder. Next check in ${nextMinutes} min if unreported.`,
  todoStalledMsg: (seq: number, n: number, intervalMinutes: number) =>
    `[todolist alert] Task #${seq}: ${n} consecutive checks with no report — likely finished-but-unclosed, or stalled; check interval backed off to ${intervalMinutes} min. Review /todo list; remind the lead to taskdone, or /todo stop.`,
```

- [ ] **Step 5: 全量验证**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全 PASS(旧 todo 测试的 mk()/fake 需补 announceStalled 字段与 nudge 新参;若旧测试断言 nudge 调用形参,按新签名更新)

- [ ] **Step 6: Commit**

```bash
git add src/core/todo.ts src/index.ts src/i18n/zh.ts src/i18n/en.ts tests/core/todo-backoff.test.ts tests/core/todo.test.ts tests/core/todo-wait.test.ts
git commit -m "feat(todo): 无果巡查指数退避封顶 60 分钟+第 3 次停滞告警;dispatch/nudge 文案带 taskwait 指引"
```

---

### Task 3: 控制台等待显示 + 文档 + build

**Files:**
- Modify: `src/console/app.tsx`(todo 进度行追加等待段)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(todoWaitSeg)
- Modify: `README.md`、`README.zh-CN.md`(todo 特性条目补 taskwait/退避)
- Modify: `docs/superpowers/specs/2026-06-12-todo-nudge-idle-burn-fix-design.md`(实现后记)
- Run: `npm run build`

- [ ] **Step 1: i18n 进度行等待段**

zh:

```ts
  todoWaitSeg: (reason: string, until: string) => ` ⏳等外部${reason ? `:${reason}` : ''}(至 ${until})`,
```

en:

```ts
  todoWaitSeg: (reason: string, until: string) => ` ⏳ waiting${reason ? `: ${reason}` : ''} (until ${until})`,
```

- [ ] **Step 2: 进度行渲染**

`src/console/app.tsx` todolist 进度常驻行(`todoProgressLine` 调用处)改:running/paused 分支内,在拼 `todoProgressLine(...)` 的 Text 里追加等待段——

```tsx
        {todoState && (todoState.state === 'running' || todoState.state === 'paused') ? (() => {
          const cur = todoState.tasks.find((x: any) => x.status === 'current');
          const k = todoState.tasks.filter((x: any) => x.status === 'done' || x.status === 'failed').length + (cur ? 1 : 0);
          const waiting = typeof todoState.waitUntil === 'number' && todoState.waitUntil > Date.now()
            ? t().todoWaitSeg(todoState.waitReason ?? '', formatTime(todoState.waitUntil)) : '';
          return <Text color="cyan" wrap="truncate-end">{t().todoProgressLine(k, todoState.tasks.length, cur ? String(cur.body).split('\n')[0].slice(0, 60) : '-', todoState.state === 'paused')}{waiting}</Text>;
        })() : /* …原 idle 分支不动… */}
```

`formatTime` 已从 log-format 导入(app.tsx 顶部确认,缺则补)。

- [ ] **Step 3: README**

`README.md` `/todo` 特性条目("unattended task list"段)句末补:

```markdown
 When the team is waiting on a long script/CI, the lead can call `taskwait(seq, minutes, reason)` to pause nudges (cap 120 min, shown on the console status line); fruitless nudges back off exponentially (10→20→40→60 min cap) and the 3rd one raises a feed alert — so an idle-but-open task no longer wakes a huge-context lead every 10 minutes all night.
```

`README.zh-CN.md` 对应条目补(对齐中文措辞):

```markdown
 团队在等长脚本/CI 时,组长可调 `taskwait(seq, minutes, reason)` 声明等待、暂停巡查(上限 120 分钟,控制台进度行可见);无果巡查按 10→20→40→60 分钟指数退避(封顶),第 3 次无果向消息流告警——任务做完没关闭/在等外部时,不再整夜每 10 分钟摇醒大上下文组长。
```

- [ ] **Step 4: spec 实现后记**

spec 末尾加:

```markdown
## 实现后记(2026-06-12)

- waitUntil/waitReason 随 TodoState 落盘但 loadTodo 不恢复——重启后清单必经 paused→resume 重发,旧等待声明随旧会话作废(比"过期戳无害"更干净)。
- 退避清零点收敛为两处:taskwait 成功、dispatchNext(taskdone 推进/start/resume/换 lead 重发都经它);anyBusy 只重置计时锚点不清计数(忙过≠有上报)。
- nudge 模板的"下次间隔"用退避后的 nextMinutes 告知(替代原"每 N 分钟一次"的固定说法)。
```

- [ ] **Step 5: 全量 + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全 PASS、build 成功(交付前必 build)

- [ ] **Step 6: Commit**

```bash
git add src/console/app.tsx src/i18n/zh.ts src/i18n/en.ts README.md README.zh-CN.md docs/superpowers/specs/2026-06-12-todo-nudge-idle-burn-fix-design.md
git commit -m "feat(console): todo 进度行显示等待声明;README 双语+spec 后记"
```

---

## 验收(实机,主会话执行,不在子任务里)

1. /tmp 测试办公室(haiku):`/todo add` + `start 1`(1 分钟巡查加速观察);lead 收任务后引导其调 `taskwait(seq, minutes:3, reason:"等脚本")` → 消息流见「组长声明等待」公告、进度行见 ⏳ 段、3 分钟内无 nudge、到期后约 1 分钟恢复巡查;
2. 不让 lead 上报,观察 nudge 间隔 1→2→4 分钟拉长,第 3 次后见【todolist 告警】;
3. taskdone 后下一条任务节奏回到 1 分钟;
4. 清理测试残档。
