# todolist 无人值守 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** boss 建任务清单后无人值守跑完:taskdone 工具驱动线性下发 + 空闲巡查兜底,失败不中断,落盘可 resume,跑完出汇总。

**Architecture:** 纯引擎 `TodoEngine`(src/core/todo.ts,回调注入,全逻辑可单测)持有状态机;index.ts 提供回调(router.send 下发/巡查/汇总、落盘)并在健康轮询里驱动 `tick`;总线加 `taskdone` 工具与 `/admin/todo` 端点(经 `BusDeps.todo` 钩子触达引擎);控制台加 `/todo` 子命令、进度常驻行、列表浮层。前置依赖:功能 1 计划(per-agent-model)已合入(本计划不依赖 model 字段,但依赖其修复的 onAddAgent push cfg.agents 不冲突)。

**Tech Stack:** TypeScript ESM(NodeNext)、vitest、Ink。`npm test` / `npm run build`(交付前必须 build)。

**Spec:** `docs/superpowers/specs/2026-06-10-per-agent-model-and-todolist-design.md`(功能 2 部分,含 18 项审查修正)

**关键既有事实**(实现者必读):
- `router.send(from,to,body)` 不校验 from、只解析 to;被守卫丢弃/目标 dead 返回 `undefined`;返回 `Message` 含 `.id`(src/core/router.ts:70-107)。
- `router.cancelQueued(id)` 撤排队消息(router.ts:213-224)。
- boss 是 virtual 成员,`router.send('falinks','boss',…)` 纯入消息流不投递。
- 健康轮询在 index.ts `setInterval(…,1500)`;`router.roster()` 给全员状态。
- 控制台与总线分进程,一切走 /admin HTTP;控制台轮询模式见 app.tsx:111-141(dedupe setState)。
- 浮层模式参考 langPick(app.tsx:597-603 渲染、354-364 按键、295 menuActive)。
- 持久化模式仿 src/session/store.ts(root 可注入测试)。

---

### Task 1: todo-store(类型 + 落盘)

**Files:**
- Create: `src/todo-store.ts`
- Test: `tests/todo-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/todo-store.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadTodo, saveTodo, type TodoState } from '../src/todo-store.js';

const root = () => mkdtempSync(join(tmpdir(), 'falinks-todo-'));

test('不存在/损坏返回空壳', () => {
  const r = root();
  expect(loadTodo('/some/proj', r)).toEqual({ state: 'idle', nudgeMinutes: 10, tasks: [] });
});

test('round-trip', () => {
  const r = root();
  const st: TodoState = { state: 'paused', nudgeMinutes: 5, tasks: [{ seq: 1, body: 'x', status: 'done', result: 'ok', ts: 9 }] };
  saveTodo('/some/proj', st, r);
  expect(loadTodo('/some/proj', r)).toEqual(st);
});

test('载入时 running 一律降 paused(进程死过,文件说 running 不可信)', () => {
  const r = root();
  saveTodo('/p', { state: 'running', nudgeMinutes: 10, tasks: [{ seq: 1, body: 'x', status: 'current' }] }, r);
  expect(loadTodo('/p', r).state).toBe('paused');
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/todo-store.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现 `src/todo-store.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir, projectKey } from './runtime.js';

export interface TodoTask {
  seq: number;
  body: string;
  status: 'pending' | 'current' | 'done' | 'failed';
  result?: string;
  ts?: number; // 完结时刻
}

export interface TodoState {
  state: 'idle' | 'running' | 'paused' | 'finished';
  nudgeMinutes: number; // 巡查间隔 N(分钟),默认 10
  tasks: TodoTask[];
}

const EMPTY = (): TodoState => ({ state: 'idle', nudgeMinutes: 10, tasks: [] });

/** 每个项目一份:~/.falinks/todos/<projectKey>.json。root 可注入便于测试。 */
export function todoPath(launchCwd: string, root = runtimeDir()): string {
  return join(root, 'todos', `${projectKey(launchCwd)}.json`);
}

/** 读档;不存在/损坏返回空壳。文件说 running 一律降 paused——进程死过,由 boss /todo resume 决定续跑。 */
export function loadTodo(launchCwd: string, root = runtimeDir()): TodoState {
  const p = todoPath(launchCwd, root);
  if (!existsSync(p)) return EMPTY();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const st: TodoState = {
      state: raw.state === 'running' ? 'paused' : (raw.state ?? 'idle'),
      nudgeMinutes: typeof raw.nudgeMinutes === 'number' && raw.nudgeMinutes > 0 ? raw.nudgeMinutes : 10,
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    };
    return st;
  } catch {
    return EMPTY();
  }
}

export function saveTodo(launchCwd: string, st: TodoState, root = runtimeDir()): void {
  const p = todoPath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(st, null, 2));
}
```

- [ ] **Step 4: 确认通过**:`npx vitest run tests/todo-store.test.ts` → 3 passed。

- [ ] **Step 5: Commit**

```bash
git add src/todo-store.ts tests/todo-store.test.ts
git commit -m "feat(todo): 清单落盘 todo-store(载入 running 降 paused)"
```

---

### Task 2: TodoEngine 纯引擎

**Files:**
- Create: `src/core/todo.ts`
- Test: `tests/core/todo.test.ts`

- [ ] **Step 1: 写失败测试**(行为全覆盖;harness 用可控时钟+回调记录)

```ts
// tests/core/todo.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';
import type { TodoState } from '../../src/todo-store.js';

function mk(initial?: TodoState) {
  let now = 0;
  let nextId = 0;
  const calls = {
    dispatch: [] as { seq: number; isResend: boolean }[],
    nudge: [] as number[],
    cancel: [] as string[],
    summary: 0, suspended: 0, sendFailing: 0,
    persist: 0,
  };
  let sendOk = true; // false 模拟守卫丢弃
  const e = new TodoEngine({
    now: () => now,
    dispatch: (t, _total, isResend) => { calls.dispatch.push({ seq: t.seq, isResend }); return sendOk ? `msg${++nextId}` : undefined; },
    nudge: (t) => { calls.nudge.push(t.seq); return sendOk; },
    cancelQueued: (id) => { calls.cancel.push(id); },
    announceSummary: () => { calls.summary++; },
    announceSuspended: () => { calls.suspended++; },
    announceSendFailing: () => { calls.sendFailing++; },
    persist: () => { calls.persist++; },
  }, initial);
  return { e, calls, setNow: (v: number) => { now = v; }, setSendOk: (v: boolean) => { sendOk = v; } };
}
const MIN = 60_000;

test('start 下发第一条;taskdone 推进;failed 也继续;最后一条→finished+汇总', () => {
  const { e, calls } = mk();
  e.add('a'); e.add('b'); e.add('c');
  expect(e.start(undefined, true).ok).toBe(true);
  expect(calls.dispatch.map((d) => d.seq)).toEqual([1]);
  expect(e.taskdone(1, 'done', 'ok').ok).toBe(true);
  expect(calls.dispatch.map((d) => d.seq)).toEqual([1, 2]);
  expect(e.taskdone(2, 'failed', 'broke').ok).toBe(true); // 失败不中断
  expect(calls.dispatch.map((d) => d.seq)).toEqual([1, 2, 3]);
  expect(e.taskdone(3, 'done', 'ok').ok).toBe(true);
  expect(e.state().state).toBe('finished');
  expect(calls.summary).toBe(1);
});

test('taskdone seq 错位/重复拒绝;无活动清单拒绝', () => {
  const { e } = mk();
  expect(e.taskdone(1, 'done', 'x').ok).toBe(false); // idle 无清单
  e.add('a'); e.add('b'); e.start(undefined, true);
  expect(e.taskdone(2, 'done', 'x').ok).toBe(false); // 错位:current 是 1
  expect(e.taskdone(1, 'done', 'x').ok).toBe(true);
  expect(e.taskdone(1, 'done', 'x').ok).toBe(false); // 重复:current 已是 2
});

test('start 校验:空单/已 running/finished/无 lead', () => {
  const { e } = mk();
  expect(e.start(undefined, true).ok).toBe(false); // 空单
  e.add('a');
  expect(e.start(undefined, false).ok).toBe(false); // 无 lead
  expect(e.start(undefined, true).ok).toBe(true);
  expect(e.start(undefined, true).ok).toBe(false); // 已 running
});

test('stop 后迟到的 taskdone 只记录不下发;resume 校验 lead 并重发 current(先撤旧排队)', () => {
  const { e, calls } = mk();
  e.add('a'); e.add('b'); e.start(undefined, true);
  e.stop();
  expect(e.taskdone(1, 'done', 'late').ok).toBe(true);
  expect(calls.dispatch.length).toBe(1); // 没下发第二条
  expect(e.resume(false).ok).toBe(false); // 无 lead 拒绝
  expect(e.resume(true).ok).toBe(true);   // current 已完结 → 下发下一条 pending
  expect(calls.dispatch.map((d) => d.seq)).toEqual([1, 2]);
});

test('stop→resume 时 current 未完结:撤旧排队再重发(防叠两份)', () => {
  const { e, calls } = mk();
  e.add('a'); e.start(undefined, true);
  e.stop();
  e.resume(true);
  expect(calls.cancel).toEqual(['msg1']);
  expect(calls.dispatch).toEqual([{ seq: 1, isResend: false }, { seq: 1, isResend: true }]);
});

test('巡查:无人忙满 N 触发 nudge 并重置;有人忙/下发/巡查后计时重置;永不放弃', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true); // N 默认 10 分钟
  setNow(5 * MIN); e.tick(false, true);
  expect(calls.nudge.length).toBe(0); // 未满 N(下发时刻重置过)
  setNow(10 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([1]);   // 满 N 巡查
  setNow(15 * MIN); e.tick(true, true);   // 有人忙 → 重置
  setNow(24 * MIN); e.tick(false, true);  // 距重置 9 分钟,未满
  expect(calls.nudge.length).toBe(1);
  setNow(25 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([1, 1]); // 永不放弃,再问
});

test('start 可指定 N', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(2, true);
  setNow(2 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([1]);
});

test('send 失败:下发失败靠巡查兜底;巡查失败不重置计时下一 tick 重试;连续失败≥3 边沿公告一次', () => {
  const { e, calls, setNow, setSendOk } = mk();
  e.add('a');
  setSendOk(false);
  e.start(undefined, true); // 下发被丢(fail 1)
  setNow(10 * MIN + 1);
  e.tick(false, true); // 巡查被丢(fail 2),计时不重置
  e.tick(false, true); // 立刻重试(fail 3)→ 公告
  expect(calls.sendFailing).toBe(1);
  e.tick(false, true); // fail 4,不重复公告
  expect(calls.sendFailing).toBe(1);
  setSendOk(true);
  e.tick(false, true); // 巡查成功(自包含,即重试下发)
  expect(calls.nudge.length).toBe(4);
});

test('lead 缺失挂起(边沿公告一次),恢复后撤旧排队重发 current', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true);
  e.tick(false, false); e.tick(false, false);
  expect(calls.suspended).toBe(1); // 边沿一次
  setNow(60 * MIN); e.tick(false, false);
  expect(calls.nudge.length).toBe(0); // 挂起期间不巡查
  e.tick(false, true); // lead 回归
  expect(calls.cancel).toEqual(['msg1']);
  expect(calls.dispatch).toEqual([{ seq: 1, isResend: false }, { seq: 1, isResend: true }]);
});

test('add:running 追加队尾;finished 后 add 自动转 idle 清旧账', () => {
  const { e } = mk();
  e.add('a'); e.start(undefined, true);
  e.add('b'); // running 追加
  expect(e.state().tasks.length).toBe(2);
  e.taskdone(1, 'done', 'x'); e.taskdone(2, 'done', 'x');
  expect(e.state().state).toBe('finished');
  e.add('tomorrow');
  expect(e.state().state).toBe('idle');
  expect(e.state().tasks.map((t) => t.body)).toEqual(['tomorrow']); // 旧账清掉
});

test('rm:pending 可删;paused 态可删 current(标 failed 脱困);running 态 current 拒绝;clear 仅非 running', () => {
  const { e } = mk();
  e.add('a'); e.add('b');
  expect(e.rm(2).ok).toBe(true); // pending
  e.start(undefined, true);
  expect(e.rm(1).ok).toBe(false); // running 的 current
  expect(e.clear().ok).toBe(false); // running 拒绝 clear
  e.stop();
  expect(e.rm(1).ok).toBe(true);  // paused 脱困
  expect(e.state().tasks.find((t) => t.seq === 1)!.status).toBe('failed');
  expect(e.clear().ok).toBe(true);
  expect(e.state().tasks).toEqual([]);
  expect(e.state().state).toBe('idle');
});

test('resume 时已无 current 且无 pending → 直接 finished+汇总', () => {
  const { e, calls } = mk();
  e.add('a'); e.start(undefined, true); e.stop();
  e.taskdone(1, 'done', 'x'); // paused 完结最后一条
  e.resume(true);
  expect(e.state().state).toBe('finished');
  expect(calls.summary).toBe(1);
});

test('seq 单调递增不复用(rm 后再 add 不撞号)', () => {
  const { e } = mk();
  e.add('a'); e.add('b'); e.rm(2); e.add('c');
  expect(e.state().tasks.map((t) => t.seq)).toEqual([1, 3]);
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/core/todo.test.ts` → FAIL。

- [ ] **Step 3: 实现 `src/core/todo.ts`**

```ts
import type { TodoState, TodoTask } from '../todo-store.js';

/** 引擎对外副作用全部经回调注入(index.ts 拼模板/落盘),引擎本体纯逻辑可单测。 */
export interface TodoCallbacks {
  now(): number;
  /** 把任务下发给当前 lead;返回消息 id,被守卫丢弃/无法送达时 undefined(引擎靠巡查兜底重试)。 */
  dispatch(task: TodoTask, total: number, isResend: boolean): string | undefined;
  /** 巡查询问(模板自包含任务内容,同时就是下发失败的重试);返回是否发送成功。 */
  nudge(task: TodoTask, total: number): boolean;
  /** 撤掉仍在 inbox 排队的旧下发(重发防叠两份)。 */
  cancelQueued(msgId: string): void;
  announceSummary(tasks: TodoTask[]): void;
  announceSuspended(): void;
  announceSendFailing(): void;
  persist(st: TodoState): void;
}

export type TodoResult = { ok: boolean; error?: string };

const MIN_MS = 60_000;
const FAIL_ANNOUNCE_AT = 3; // 连续发送失败这么多次 → 边沿公告一次

export class TodoEngine {
  private st: TodoState;
  private seqCounter: number;
  private lastDispatchId?: string; // 最近一次下发的消息 id(撤排队用;运行时瞬态,不落盘——重启后 inbox 本就清空)
  private idleSince?: number;      // 全员空闲起点;undefined=有人忙/刚发生过重置事件
  private suspended = false;       // 运行时瞬态:无 lead 挂起
  private failStreak = 0;
  private failAnnounced = false;

  constructor(private cb: TodoCallbacks, initial?: TodoState) {
    this.st = initial ?? { state: 'idle', nudgeMinutes: 10, tasks: [] };
    this.seqCounter = this.st.tasks.reduce((m, t) => Math.max(m, t.seq), 0);
  }

  /** 只读快照(GET /admin/todo / 控制台进度行)。 */
  state(): TodoState { return this.st; }

  add(body: string): { ok: true; seq: number } {
    if (this.st.state === 'finished') { // 跑完直接续单:清旧账转 idle(汇总已入消息流不丢信息)
      this.st.tasks = [];
      this.st.state = 'idle';
    }
    const task: TodoTask = { seq: ++this.seqCounter, body, status: 'pending' };
    this.st.tasks.push(task);
    this.cb.persist(this.st);
    return { ok: true, seq: task.seq };
  }

  rm(seq: number): TodoResult {
    const t = this.st.tasks.find((x) => x.seq === seq);
    if (!t) return { ok: false, error: `no task #${seq}` };
    if (t.status === 'pending') {
      this.st.tasks = this.st.tasks.filter((x) => x.seq !== seq);
      this.cb.persist(this.st);
      return { ok: true };
    }
    if (t.status === 'current' && this.st.state === 'paused') { // 脱困:跳过卡死的当前条
      t.status = 'failed';
      t.result = 'removed by boss';
      t.ts = this.cb.now();
      this.lastDispatchId = undefined;
      this.cb.persist(this.st);
      return { ok: true };
    }
    return { ok: false, error: 'only pending tasks (or the current one while paused) can be removed' };
  }

  clear(): TodoResult {
    if (this.st.state === 'running') return { ok: false, error: 'todolist is running — /todo stop first' };
    this.st = { state: 'idle', nudgeMinutes: this.st.nudgeMinutes, tasks: [] };
    this.lastDispatchId = undefined;
    this.cb.persist(this.st);
    return { ok: true };
  }

  start(nMinutes: number | undefined, hasLead: boolean): TodoResult {
    if (this.st.state === 'running') return { ok: false, error: 'already running' };
    if (this.st.state === 'paused') return { ok: false, error: 'paused — use /todo resume' };
    if (this.st.state === 'finished') return { ok: false, error: 'finished — /todo add new tasks or /todo clear' };
    if (!this.st.tasks.some((t) => t.status === 'pending')) return { ok: false, error: 'todolist is empty' };
    if (!hasLead) return { ok: false, error: 'no lead — set one with /lead first' };
    if (nMinutes !== undefined) this.st.nudgeMinutes = nMinutes;
    this.st.state = 'running';
    this.suspended = false;
    this.dispatchNext(false);
    return { ok: true };
  }

  stop(): TodoResult {
    if (this.st.state !== 'running') return { ok: false, error: 'not running' };
    this.st.state = 'paused';
    this.cb.persist(this.st);
    return { ok: true };
  }

  resume(hasLead: boolean): TodoResult {
    if (this.st.state !== 'paused') return { ok: false, error: 'nothing paused' };
    if (!hasLead) return { ok: false, error: 'no lead — set one with /lead first' };
    this.st.state = 'running';
    this.suspended = false;
    this.redispatch();
    return { ok: true };
  }

  taskdone(seq: number, status: 'done' | 'failed', result: string): TodoResult {
    if (this.st.state !== 'running' && this.st.state !== 'paused') return { ok: false, error: 'no active todolist' };
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return { ok: false, error: 'no current task' };
    if (cur.seq !== seq) return { ok: false, error: `current task is #${cur.seq}, not #${seq}` };
    cur.status = status;
    cur.result = result;
    cur.ts = this.cb.now();
    this.lastDispatchId = undefined;
    if (this.st.state === 'running') this.dispatchNext(false); // 内含 persist
    else this.cb.persist(this.st);                             // paused:只记录,resume 再推进
    return { ok: true };
  }

  /** 健康轮询(≈1.5s)驱动:lead 缺失挂起/恢复、空闲巡查。仅 running 生效。 */
  tick(anyBusy: boolean, hasLead: boolean): void {
    if (this.st.state !== 'running') return;
    if (!hasLead) {
      if (!this.suspended) { this.suspended = true; this.cb.announceSuspended(); } // 边沿一次
      return;
    }
    if (this.suspended) { // lead 回归:重发 current(新 lead 没上下文)
      this.suspended = false;
      this.redispatch();
      return;
    }
    const cur = this.st.tasks.find((t) => t.status === 'current');
    if (!cur) return;
    if (anyBusy) { this.idleSince = undefined; return; } // 有人在干活,计时重置
    const now = this.cb.now();
    if (this.idleSince === undefined) { this.idleSince = now; return; }
    if (now - this.idleSince >= this.st.nudgeMinutes * MIN_MS) {
      if (this.cb.nudge(cur, this.st.tasks.length)) { this.noteSendOk(); this.idleSince = undefined; } // 发出即重置(每满 N 一问)
      else this.noteSendFail(); // 失败不重置:下一 tick 立刻重试
    }
  }

  /** 推进:current 完结后取下一条 pending 下发;没有了 → finished+汇总。 */
  private dispatchNext(isResend: boolean): void {
    let task = this.st.tasks.find((t) => t.status === 'current');
    if (!task) {
      task = this.st.tasks.find((t) => t.status === 'pending');
      if (!task) {
        this.st.state = 'finished';
        this.cb.persist(this.st);
        this.cb.announceSummary(this.st.tasks);
        return;
      }
      task.status = 'current';
    }
    const id = this.cb.dispatch(task, this.st.tasks.length, isResend);
    if (id) { this.lastDispatchId = id; this.noteSendOk(); }
    else this.noteSendFail(); // 下发被丢:不标已派发,巡查模板自包含,满 N 自然兜底重试
    this.idleSince = undefined; // 下发(含尝试)即重置巡查计时
    this.cb.persist(this.st);
  }

  /** resume/换 lead 后的重发:先撤可能仍在排队的旧下发,防 lead 顺序收到两份。 */
  private redispatch(): void {
    if (this.lastDispatchId) { this.cb.cancelQueued(this.lastDispatchId); this.lastDispatchId = undefined; }
    this.dispatchNext(true);
  }

  private noteSendOk(): void { this.failStreak = 0; this.failAnnounced = false; }
  private noteSendFail(): void {
    this.failStreak++;
    if (this.failStreak >= FAIL_ANNOUNCE_AT && !this.failAnnounced) { this.failAnnounced = true; this.cb.announceSendFailing(); }
  }
}
```

注意一个测试推演:`resume 时已无 current 且无 pending` 用例里 `dispatchNext(true)` 走 finished 分支——`isResend` 没用上,正确。`stop→resume current 未完结`用例:redispatch 撤 msg1 后 dispatchNext 发现 current 仍在 → 直接重发它(isResend=true)。

- [ ] **Step 4: 确认通过**:`npx vitest run tests/core/todo.test.ts` → 13 passed;`npx tsc -p tsconfig.build.json --noEmit` → 0 错。

- [ ] **Step 5: Commit**

```bash
git add src/core/todo.ts tests/core/todo.test.ts
git commit -m "feat(todo): TodoEngine 纯引擎——线性下发/taskdone 推进/巡查兜底/挂起恢复/重发防叠"
```

---

### Task 3: 总线 taskdone 工具 + /admin/todo + BusDeps.todo 钩子

**Files:**
- Modify: `src/bus/server.ts`
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`(工具描述 `toolDescTaskdone`)
- Test: `tests/bus/taskdone.test.ts`(新建)

- [ ] **Step 1: 写失败测试**(harness 仿 tests/bus/touch.test.ts 的 callTool)

```ts
// tests/bus/taskdone.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let tdCalls: any[];

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
  router.addAgent('lead', undefined, true); // lead=true
  router.addAgent('dev');
  tdCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: (seq, status, result) => { tdCalls.push([seq, status, result]); return { ok: true }; },
      op: (op, args) => ({ ok: true, op, args }),
      state: () => ({ state: 'running', nudgeMinutes: 10, tasks: [] }),
    },
  } as any, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 taskdone 透传到钩子', async () => {
  const r = await callTool('lead', 'taskdone', { seq: 1, status: 'done', result: 'ok' });
  expect(r.ok).toBe(true);
  expect(tdCalls).toEqual([[1, 'done', 'ok']]);
});

test('非 lead 调 taskdone 拒绝', async () => {
  const r = await callTool('dev', 'taskdone', { seq: 1, status: 'done', result: 'ok' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/lead/);
  expect(tdCalls).toEqual([]);
});

test('无 todo 钩子时 taskdone 返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const res: any = await client.callTool({ name: 'taskdone', arguments: { seq: 1, status: 'done', result: 'x' } });
    await client.close();
    expect(JSON.parse(res.content[0].text).ok).toBe(false);
  } finally { await bus2.close(); }
});

test('GET /admin/todo 返回状态;POST /admin/todo 分发 op', async () => {
  const g = await (await fetch(`http://127.0.0.1:${bus.port}/admin/todo`)).json() as any;
  expect(g.todo.state).toBe('running');
  const p = await (await fetch(`http://127.0.0.1:${bus.port}/admin/todo`, { method: 'POST', body: JSON.stringify({ op: 'add', body: 'x' }) })).json() as any;
  expect(p.op).toBe('add');
});
```

- [ ] **Step 2: 确认失败**:`npx vitest run tests/bus/taskdone.test.ts` → FAIL。

- [ ] **Step 3: 实现**

① `BusDeps` 加钩子(`onRestartAgent` 之后):

```ts
  /** todolist 引擎入口(index.ts 注入):taskdone 上报、op 命令分发、state 只读快照。 */
  todo?: {
    taskdone(seq: number, status: 'done' | 'failed', result: string): { ok: boolean; error?: string };
    op(op: string, args: { body?: string; seq?: number; n?: number }): { ok: boolean; error?: string; [k: string]: unknown };
    state(): unknown;
  };
```

② `serverForAgent` 注册 taskdone 工具(who 之后;`touch()` 第一行——这也是 lead 活着的铁证):

```ts
  server.registerTool('taskdone', {
    description: t().toolDescTaskdone,
    inputSchema: { seq: z.number(), status: z.enum(['done', 'failed']), result: z.string() },
  }, async ({ seq, status, result }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call taskdone' });
    return ok(deps.todo.taskdone(seq, status, result));
  });
```

③ admin 路由(`/admin/restart` 块后):

```ts
      if (req.method === 'GET' && url.pathname === '/admin/todo') {
        return sendJson({ todo: deps.todo ? deps.todo.state() : null });
      }
      if (req.method === 'POST' && url.pathname === '/admin/todo') {
        if (!deps.todo) return sendJson({ ok: false, error: 'todo not supported' });
        try {
          return sendJson(deps.todo.op(String(abody.op), { body: abody.body, seq: abody.seq, n: abody.n }));
        } catch (e: any) {
          return sendJson({ ok: false, error: String(e?.message ?? e) });
        }
      }
```

④ i18n 工具描述(zh 在 `toolDescWho` 旁,en 同步):

```ts
  toolDescTaskdone: '【todolist 专用·仅组长】上报当前任务完结:taskdone(seq, status:"done"|"failed", result)。系统记录后才会下发下一条;失败也要报,不会中断清单。',
```

```ts
  toolDescTaskdone: '[todolist only · lead only] report the current task finished: taskdone(seq, status:"done"|"failed", result). The system records it and dispatches the next task; report failures too — the list never stops.',
```

- [ ] **Step 4: 确认通过**:`npx vitest run tests/bus/ tests/i18n.test.ts` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/bus/server.ts src/i18n/zh.ts src/i18n/en.ts tests/bus/taskdone.test.ts
git commit -m "feat(bus): taskdone 工具(仅 lead)+ /admin/todo GET/POST + BusDeps.todo 钩子"
```

---

### Task 4: i18n 全套 todolist 文案

**Files:**
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

- [ ] **Step 1: zh.ts 加词条**(cmdHint 内 + usage 区 + 消息模板区;en.ts 同键同步,英文措辞对应翻译,此处只列 zh,en 由实现者对照翻译——`en: typeof zh` 编译强制同构)

```ts
    todo: '任务清单:add/list/rm/clear/start/stop/resume,无人值守按序执行',
```

```ts
  usageTodo: '用法: /todo add <内容> | list | rm <序号> | clear | start [巡查分钟] | stop | resume',
  usageTodoAdd: '用法: /todo add <任务内容>(可多行)',
  usageTodoRm: '用法: /todo rm <序号>',
  usageTodoStart: '用法: /todo start [巡查间隔分钟,正整数,默认10]',
```

```ts
  // —— todolist 消息模板(下发/巡查以 boss 名义、自包含;汇总以 falinks 名义入流水)——
  todoDispatchMsg: (seq: number, total: number, body: string, isResend: boolean) =>
    `【任务 ${seq}/${total}】${isResend ? '(重发)' : ''}${body}\n完成后调用 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报,系统才会下发下一条;勿用 sendmsg 回复本条,过程中可照常与团队/boss 沟通。`,
  todoNudgeMsg: (seq: number, total: number, body: string, n: number) =>
    `【任务 ${seq}/${total} 进度巡查】全员已空闲 ${n} 分钟仍未收到上报。任务内容:${body}\n已完成请调 taskdone(seq:${seq}, status:"done"|"failed", result:"…");仍在推进则继续即可,本提醒每 ${n} 分钟一次。`,
  todoSummaryTitle: (done: number, failed: number, total: number) => `【todolist 跑完】共 ${total} 条:✅ ${done} 成 · ❌ ${failed} 败`,
  todoSummaryLine: (seq: number, ok: boolean, body: string, result: string) => `${ok ? '✅' : '❌'} #${seq} ${body} — ${result}`,
  todoSuspendedMsg: '【todolist 挂起】当前没有组长,任务暂停下发;/lead 指定组长后自动继续。',
  todoSendFailingMsg: '【todolist 告警】连续多次消息发送失败(守卫拦截或组长不可达),清单可能停滞,请检查。',
  todoProgressLine: (k: number, total: number, body: string, paused: boolean) =>
    `📋 ${k}/${total} 当前:${body}${paused ? ' [⏸ 已暂停]' : ''}`,
  todoResumeHint: (left: number, total: number) => `检测到未完成的 todolist(剩 ${left}/${total} 条),/todo resume 继续`,
  todoListTitle: '任务清单(Esc 关闭)',
  todoListEmpty: '(空)— /todo add <内容> 添加',
  todoOpOk: (op: string) => `todo ${op} 完成`,
  todoAddOk: (seq: number) => `已加入任务 #${seq}`,
```

- [ ] **Step 2: 验证**:`npx vitest run tests/i18n.test.ts && npx tsc -p tsconfig.build.json --noEmit` → 全绿(en 缺键会编译失败)。

- [ ] **Step 3: Commit**

```bash
git add src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(i18n): todolist 全套文案(命令/模板/汇总/巡查/进度行,中英)"
```

---

### Task 5: index.ts 接线(引擎实例化、回调、tick、todo 钩子、保留名)

**Files:**
- Modify: `src/index.ts`

无独立单测(同失联检测接线先例:纯逻辑已在 Task 1/2 全测,集成靠 Task 7 实机验收)。每步保持 `npx tsc --noEmit -p tsconfig.build.json` 干净。

- [ ] **Step 1: 导入与实例化**(在 `const store: SessionStore = loadStore(launchCwd);` 附近)

```ts
import { TodoEngine } from './core/todo.js';
import { loadTodo, saveTodo } from './todo-store.js';
import type { TodoTask } from './todo-store.js';
```

```ts
  // todolist 引擎:回调全在此拼装(模板/落盘),引擎纯逻辑。下发/巡查以 boss 名义(lead 回 boss 无害);
  // 汇总/告警以 'falinks' 裸名入流水(send 不校验发件人;不注册虚拟成员,免污染花名册)。
  const currentLead = () => router.roster().find((x) => x.lead && x.status !== 'dead')?.name;
  const todo = new TodoEngine({
    now: () => Date.now(),
    dispatch: (task, total, isResend) => {
      const lead = currentLead();
      if (!lead) return undefined;
      return router.send('boss', lead, t().todoDispatchMsg(task.seq, total, task.body, isResend))?.id;
    },
    nudge: (task, total) => {
      const lead = currentLead();
      if (!lead) return false;
      return !!router.send('boss', lead, t().todoNudgeMsg(task.seq, total, task.body, todo.state().nudgeMinutes));
    },
    cancelQueued: (id) => { router.cancelQueued(id); },
    announceSummary: (tasks: TodoTask[]) => {
      const done = tasks.filter((x) => x.status === 'done').length;
      const failed = tasks.filter((x) => x.status === 'failed').length;
      const lines = tasks.filter((x) => x.status === 'done' || x.status === 'failed')
        .map((x) => t().todoSummaryLine(x.seq, x.status === 'done', x.body, x.result ?? ''));
      router.send('falinks', 'boss', `${t().todoSummaryTitle(done, failed, tasks.length)}\n${lines.join('\n')}`);
    },
    announceSuspended: () => { router.send('falinks', 'boss', t().todoSuspendedMsg); },
    announceSendFailing: () => {
      router.send('falinks', 'boss', t().todoSendFailingMsg);
      try { appendDiag(launchCwd, { kind: 'todo-send-failing', ts: Date.now() }); } catch { /* 诊断落盘失败不致命 */ }
    },
    persist: (st) => { try { saveTodo(launchCwd, st); } catch { /* 落盘失败不致命,内存继续 */ } },
  }, loadTodo(launchCwd));
```

`src/diag.ts` 的 DiagEvent 联合加 `| { kind: 'todo-send-failing'; ts: number }`。

注意:`todo` 在自身回调里引用 `todo.state()`(nudge 的 N)——回调在运行期才执行,声明顺序安全。

- [ ] **Step 2: startBus deps 加 todo 钩子**(`onRestartAgent` 之后)

```ts
    todo: {
      taskdone: (seq, status, result) => todo.taskdone(seq, status, result),
      op: (op, args) => {
        switch (op) {
          case 'add': {
            const body = String(args.body ?? '').trim() ? String(args.body) : '';
            if (!body) return { ok: false, error: 'empty task body' };
            return todo.add(body);
          }
          case 'rm': return todo.rm(Number(args.seq));
          case 'clear': return todo.clear();
          case 'start': return todo.start(args.n === undefined ? undefined : Number(args.n), !!currentLead());
          case 'stop': return todo.stop();
          case 'resume': return todo.resume(!!currentLead());
          default: return { ok: false, error: `unknown op: ${op}` };
        }
      },
      state: () => todo.state(),
    },
```

注意:taskdone 的 **lead 校验在 bus 工具 handler 里**(Task 3 已做,按调用者身份判),这里不重复。

- [ ] **Step 3: tick 进健康轮询**(setInterval 的 async 体内、per-agent for 循环**之后**)

```ts
      // todolist 巡查驱动:全员(非虚拟)无人 busy 视为空闲;lead 存活与否决定挂起/恢复。
      const rs = router.roster();
      todo.tick(rs.some((x) => !x.virtual && x.status === 'busy'), rs.some((x) => x.lead && x.status !== 'dead'));
```

- [ ] **Step 4: /add 拒绝保留名 falinks**(onAddAgent 处理器开头,name exists 检查旁)

```ts
      if (spec.name === 'falinks') return { ok: false, error: 'reserved name' }; // 汇总消息的系统发件人名
```

- [ ] **Step 5: 编译+全量测试 → Commit**

`npx tsc -p tsconfig.build.json --noEmit && npm test` 全绿后:

```bash
git add src/index.ts src/diag.ts
git commit -m "feat(core): todolist 引擎接线——boss 名义下发/巡查、falinks 名义汇总、tick 进轮询、/admin/todo 钩子"
```

---

### Task 6: 控制台(/todo 解析+补全、动作、进度行、列表浮层、恢复提示)

**Files:**
- Modify: `src/console/parse.ts`、`src/console/commands.ts`、`src/console/app.tsx`
- Test: `tests/console/parse.test.ts`、`tests/console/commands.test.ts`(追加)

- [ ] **Step 1: 写失败测试**

`tests/console/parse.test.ts` 追加:

```ts
test('/todo add 取原始余文(多行与空格保留)', () => {
  expect(parseConsoleInput('/todo add 跑全量回归\n再出报告')).toEqual({ kind: 'todo', op: 'add', body: '跑全量回归\n再出报告' });
});
test('/todo 各子命令', () => {
  expect(parseConsoleInput('/todo list')).toEqual({ kind: 'todo', op: 'list' });
  expect(parseConsoleInput('/todo rm 3')).toEqual({ kind: 'todo', op: 'rm', seq: 3 });
  expect(parseConsoleInput('/todo clear')).toEqual({ kind: 'todo', op: 'clear' });
  expect(parseConsoleInput('/todo start')).toEqual({ kind: 'todo', op: 'start' });
  expect(parseConsoleInput('/todo start 5')).toEqual({ kind: 'todo', op: 'start', n: 5 });
  expect(parseConsoleInput('/todo stop')).toEqual({ kind: 'todo', op: 'stop' });
  expect(parseConsoleInput('/todo resume')).toEqual({ kind: 'todo', op: 'resume' });
});
test('/todo 参数校验错误', () => {
  expect(parseConsoleInput('/todo')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo add')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo add   ')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo rm x')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo start 0')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo start 2.5')).toMatchObject({ kind: 'error' });
  expect(parseConsoleInput('/todo bogus')).toMatchObject({ kind: 'error' });
});
```

`tests/console/commands.test.ts` 追加:

```ts
test('/tod completes to todo', () => {
  const s = commandState('/tod');
  expect(s.matches.map((c) => c.name)).toContain('todo');
});
test('todoSubState 在 "/todo " 之后给子命令补全', () => {
  const s = todoSubState('/todo st');
  expect(s.active).toBe(true);
  expect(s.matches).toEqual(['start', 'stop']);
  expect(todoSubState('/todo ').matches.length).toBe(7);
  expect(todoSubState('/clear x').active).toBe(false);
});
```

(import 行补 `todoSubState`。)

- [ ] **Step 2: 确认失败**:`npx vitest run tests/console/parse.test.ts tests/console/commands.test.ts` → 新用例 FAIL。

- [ ] **Step 3: 实现 parse.ts**

ConsoleAction 联合加:

```ts
  | { kind: 'todo'; op: 'add' | 'list' | 'rm' | 'clear' | 'start' | 'stop' | 'resume'; body?: string; seq?: number; n?: number }
```

`/restart` 块后加(**注意 add 不能走 split 拆词,取原始余文**):

```ts
    if (cmd === 'todo') {
      // add 的内容必须保留原文(多行/空格),用正则取子命令后的余文,不走 split 拆词。
      const m2 = s.match(/^\/todo\s+(\S+)([\s\S]*)$/);
      if (!m2) return { kind: 'error', message: t().usageTodo };
      const sub = m2[1];
      const rest = m2[2].replace(/^[ \t]/, ''); // 去掉子命令后的一个分隔空白,其余原样保留
      if (sub === 'add') {
        if (!rest.trim()) return { kind: 'error', message: t().usageTodoAdd };
        return { kind: 'todo', op: 'add', body: rest };
      }
      if (sub === 'rm') {
        const seq = Number(rest.trim());
        if (!Number.isInteger(seq) || seq <= 0) return { kind: 'error', message: t().usageTodoRm };
        return { kind: 'todo', op: 'rm', seq };
      }
      if (sub === 'start') {
        const arg = rest.trim();
        if (!arg) return { kind: 'todo', op: 'start' };
        const n = Number(arg);
        if (!Number.isInteger(n) || n <= 0) return { kind: 'error', message: t().usageTodoStart };
        return { kind: 'todo', op: 'start', n };
      }
      if (sub === 'list' || sub === 'clear' || sub === 'stop' || sub === 'resume') {
        if (rest.trim()) return { kind: 'error', message: t().usageTodo };
        return { kind: 'todo', op: sub };
      }
      return { kind: 'error', message: t().usageTodo };
    }
```

注意 `parseConsoleInput` 开头的 `s = line.trim()`:`/todo add 多行内容` 的换行在 body **中部**会保留;首尾被 trim 属可接受归一化。

- [ ] **Step 4: 实现 commands.ts**

COMMANDS 数组 `restart` 后加:

```ts
  { name: 'todo', usage: '/todo add|list|rm|clear|start|stop|resume', get hint() { return t().cmdHint.todo; } },
```

文件末尾加子命令补全(独立小函数,app.tsx 的补全分支用):

```ts
export const TODO_SUBS = ['add', 'list', 'rm', 'clear', 'start', 'stop', 'resume'] as const;

export interface TodoSubState { active: boolean; query: string; matches: string[]; }

/** "/todo <部分子命令>" 的补全状态(commandState 的正则在出现空格后失活,这里单独接)。 */
export function todoSubState(value: string): TodoSubState {
  const m = value.match(/^\/todo\s+(\S*)$/);
  if (!m) return { active: false, query: '', matches: [] };
  const query = m[1].toLowerCase();
  const matches = TODO_SUBS.filter((s) => s.startsWith(query));
  return { active: matches.length > 0, query, matches };
}
```

- [ ] **Step 5: 实现 app.tsx(五处)**

(a) 新 state(langPick 旁):

```ts
  const [todoState, setTodoState] = useState<any>(null); // GET /admin/todo 轮询结果(进度行+列表浮层共用)
  const [todoView, setTodoView] = useState(false);        // /todo list 浮层开关
```

(b) 轮询(app.tsx:111-141 的轮询体里加第 5 个请求,dedupe 同款;`lastSeen` ref 加 `todo: ''` 字段):

```ts
        const td = await admin(port, 'GET', '/admin/todo');
        const ts = JSON.stringify(td.todo ?? null);
        if (ts !== lastSeen.current.todo) { lastSeen.current.todo = ts; setTodoState(td.todo ?? null); }
```

(c) 动作分发(`a.kind === 'restart'` 行后):

```ts
      if (a.kind === 'todo') {
        if (a.op === 'list') { setTodoView(true); return; }
        const r = await admin(port, 'POST', '/admin/todo', { op: a.op, body: a.body, seq: a.seq, n: a.n });
        setStatus(r.ok ? (a.op === 'add' && typeof r.seq === 'number' ? t().todoAddOk(r.seq) : t().todoOpOk(a.op)) : '⚠ ' + (r.error ?? t().unknownError));
        return;
      }
```

(d) 按键:todoView 浮层 Esc 关闭——`menuActive` 链(app.tsx:295)加 `|| todoView`;`handleKey` 在 wizard 分支前加:

```ts
    if (todoView) {
      if (ev.type === 'esc' || ev.type === 'enter') { setTodoView(false); return; }
      return;
    }
```

(e) 渲染:
- 进度行(失联警告行旁,roster 行之后):

```tsx
        {todoState && (todoState.state === 'running' || todoState.state === 'paused') ? (() => {
          const cur = todoState.tasks.find((x: any) => x.status === 'current');
          const k = todoState.tasks.filter((x: any) => x.status === 'done' || x.status === 'failed').length + (cur ? 1 : 0);
          return <Text color="cyan">{t().todoProgressLine(k, todoState.tasks.length, cur ? String(cur.body).split('\n')[0].slice(0, 60) : '-', todoState.state === 'paused')}</Text>;
        })() : null}
```

- 列表浮层(langPick 浮层同级,条件分支链里加 `todoView ? (…)`):

```tsx
        ) : todoView ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">{t().todoListTitle}</Text>
            {!todoState || todoState.tasks.length === 0 ? (
              <Text dimColor>  {t().todoListEmpty}</Text>
            ) : todoState.tasks.map((x: any) => (
              <Text key={x.seq}>  {x.status === 'done' ? '✅' : x.status === 'failed' ? '❌' : x.status === 'current' ? '▶' : '·'} #{x.seq} {String(x.body).split('\n')[0].slice(0, 70)}{x.result ? ` — ${String(x.result).slice(0, 40)}` : ''}</Text>
            ))}
          </Box>
```

- 恢复提示(组件挂载后一次性:在轮询首次拿到 todoState 时判断;用 ref 防重复):

```ts
  const todoHinted = useRef(false);
  // 放在 (b) 的 setTodoState 之后:
  if (!todoHinted.current && td.todo && td.todo.state === 'paused') {
    const left = td.todo.tasks.filter((x: any) => x.status === 'pending' || x.status === 'current').length;
    if (left > 0) { todoHinted.current = true; setStatus(t().todoResumeHint(left, td.todo.tasks.length)); }
  }
```

- 子命令补全:找到现有 commandState 的使用处(输入变化推导补全列表 + Tab 接受),并联接入 `todoSubState`:active 时下拉显示 matches、Tab/Enter 补成 `/todo <sub> `。实现紧贴现有命令补全的渲染与按键结构(同一个下拉组件,把 `string[]` 适配成同形状)。

- [ ] **Step 6: 验证 + Commit**

`npx vitest run tests/console/ && npx tsc -p tsconfig.build.json --noEmit && npm test` → 全绿。

```bash
git add src/console/parse.ts src/console/commands.ts src/console/app.tsx tests/console/parse.test.ts tests/console/commands.test.ts
git commit -m "feat(console): /todo 全套命令+子命令补全+进度常驻行+列表浮层+恢复提示"
```

---

### Task 7: 全量验证 + 构建 + 实机验收

- [ ] **Step 1**: `npm test && npm run build` — 全绿、0 错。**必须 build,用户跑 dist/。**

- [ ] **Step 2: 实机验收**(`/tmp/falinks-todo-verify`,1 lead + 1 dev 双员工团队,真 claude;参照 spec 验收标准)

1. `/todo add` 三条(其中一条多行);`/todo list` 浮层正确显示;
2. `/todo start 1`(N=1 分钟便于验证)→ lead 收到【任务 1/3】;lead 正常 taskdone → 自动下发第 2 条;进度行 `📋 2/3`;
3. 第 2 条故意让 lead 不上报 → ~1 分钟后 lead 收到巡查消息(每分钟重复,验证两轮);lead 补报 taskdone → 第 3 条下发;
4. 让 lead 把第 3 条报 failed → state finished,消息流出现 falinks 汇总(2 成 1 败);
5. `/todo add` 新任务(验证 finished 转 idle)→ `/todo start` → `/todo stop` → `/todo resume`(观察重发标注);
6. 重启 falinks(Ctrl-C 关办公室再起)→ 控制台出现 resume 提示;`/todo resume` 后 current 重发;
7. 验收完 shutdown + 清理目录与 `~/.falinks/todos/` 测试残档。

- [ ] **Step 3**: 修正项(若有)提交;最终 `npm run build` 再跑一次确保交付物最新。

---

## Self-Review 结果

- **Spec 覆盖**:实体/落盘+running 降 paused(T1)、引擎全状态机+巡查+挂起+重发防叠+send 失败语义+脱困 rm(T2,13 用例对照 spec 测试要点逐条)、taskdone 权限/seq/无任务+admin 端点+BusDeps 钩子(T3)、模板自包含/boss 名义/falinks 裸名汇总/保留名(T4/T5)、tick 无人-busy 判定+lead 存活(T5)、/todo 命令+原文余文+子命令补全+进度行+浮层+恢复提示(T6)、实机验收对照需求原文(T7)。「不阻断投递」「不循环」无需代码自然满足。
- **占位扫描**:子命令补全的 app.tsx 接入是"紧贴现有结构"的锚点式指引(完整 todoSubState 逻辑代码已给,UI 接入点需读现场代码),其余全代码;无 TBD。
- **类型一致**:`TodoState/TodoTask`(T1 定义,T2/T3/T5/T6 使用);`TodoCallbacks` 八回调(T2 定义,T5 注入,名称一致);`BusDeps.todo` 三口(T3 定义,T5 实现);i18n 键(T4 定义,T5/T6 使用:todoDispatchMsg/todoNudgeMsg/todoSummaryTitle/todoSummaryLine/todoSuspendedMsg/todoSendFailingMsg/todoProgressLine/todoResumeHint/todoListTitle/todoListEmpty/todoOpOk/todoAddOk/usageTodo*/cmdHint.todo)。一致。
- 与失联检测的衔接:taskdone 走 bus handler `touch()`(T3 代码含),lead ⚠ 自愈成立。
