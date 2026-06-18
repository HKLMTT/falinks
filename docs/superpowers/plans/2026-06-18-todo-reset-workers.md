# todo 模式「下发即重置员工」+ 下发消息角色锚点 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** todo 模式下每推进到新任务,先把所有非 lead 员工重置为全新会话,并让每条下发消息自带「你是组长,拆解分派」的角色锚点,以延长长任务的可持续性与质量。

**Architecture:** `TodoEngine`(纯同步逻辑)新增 `resetWorkers()` 回调,在 `dispatchNext` 推进到新任务(`isResend===false`)时、下发之前调用;`index.ts` 实现该回调——复用从 `onClear` 抽出的单员工清空 helper,清掉除 lead/virtual 外的员工,fire-and-forget。下发/巡查/工作法文案改写,使「组长须拆解分派」不依赖 bootstrap 记忆。

**Tech Stack:** TypeScript(ESM,`.js` import 后缀)、vitest、i18n 双词典(`en = typeof zh`)。

设计依据:`docs/superpowers/specs/2026-06-18-todo-reset-workers-design.md`。

## Global Constraints

- 语言:TypeScript ESM,import 路径带 `.js` 后缀(如 `../src/core/todo.js`)。
- i18n:`src/i18n/en.ts` 类型为 `typeof zh`,zh/en 必须 key 与签名一致,否则编译失败;`tests/i18n.test.ts` 已校验 key 集合相等。
- 重置范围:**只清员工,保留 lead**(`currentLead()`);boss 是 virtual,「非 virtual」已含 boss。
- 重置时机:仅 `dispatchNext(isResend=false)`(start / taskdone 推进);`nudge`、`resume`/redispatch(`isResend=true`)不清。
- 完成判定:纯信任 lead 的 `taskdone`,无运行时 busy 护栏。
- `resetWorkers` 在 `currentLead()` 为空时**必须空操作**(否则 `name !== undefined` 恒真会误清所有员工)。
- 构建/测试命令:`npm run build`(= `tsc -p tsconfig.build.json`)、`npm test`(= `vitest run`)。
- 提交信息以 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 结尾。

---

### Task 1: 引擎新增 `resetWorkers` 回调并在新任务推进时调用

**Files:**
- Modify: `src/core/todo.ts`(`TodoCallbacks` 接口 + `dispatchNext`)
- Modify: `src/index.ts`(TodoEngine 构造处加 `resetWorkers` 临时 no-op,使其编译;真实现见 Task 2)
- Modify: `tests/core/todo.test.ts`、`tests/core/todo-backoff.test.ts`、`tests/core/todo-wait.test.ts`(三个 stub 各加 `resetWorkers: () => {}`,编译前置)
- Create/Test: `tests/core/todo-reset.test.ts`

**Interfaces:**
- Produces: `TodoCallbacks.resetWorkers(): void` —— 引擎在推进到新任务、`dispatch` 之前同步调用一次;实现方负责异步清空,引擎不等待。

- [ ] **Step 1: 写失败测试 `tests/core/todo-reset.test.ts`**

```ts
// tests/core/todo-reset.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';

/** 共享一个调用序列,验证 resetWorkers 与 dispatch 的相对顺序与触发时机。 */
function mk() {
  let now = 0;
  let nextId = 0;
  const order: string[] = [];
  const e = new TodoEngine({
    now: () => now,
    dispatch: () => { order.push('dispatch'); return `msg${++nextId}`; },
    nudge: () => { order.push('nudge'); return true; },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceSendFailing: () => {},
    announceWaiting: () => {},
    announceStalled: () => {},
    resetWorkers: () => { order.push('reset'); },
    removedByBossText: () => 'removed',
    persist: () => {},
  });
  return { e, order, setNow: (v: number) => { now = v; } };
}
const MIN = 60_000;

test('start 首次下发:reset 在 dispatch 之前各一次', () => {
  const { e, order } = mk();
  e.add('a'); e.start(undefined, true);
  expect(order).toEqual(['reset', 'dispatch']);
});

test('taskdone 推进下一条:再次 reset+dispatch', () => {
  const { e, order } = mk();
  e.add('a'); e.add('b'); e.start(undefined, true);
  e.taskdone(1, 'done', 'ok');
  expect(order).toEqual(['reset', 'dispatch', 'reset', 'dispatch']);
});

test('nudge(空闲巡查)不触发 reset', () => {
  const { e, order, setNow } = mk();
  e.add('a'); e.start(undefined, true); // 下发于 0,nudgeMinutes=10
  for (let m = 1; m <= 11; m++) { setNow(m * MIN); e.tick(false, true); }
  expect(order).toEqual(['reset', 'dispatch', 'nudge']); // 仅初始一次 reset
});

test('resume/redispatch(isResend=true)不触发 reset', () => {
  const { e, order } = mk();
  e.add('a'); e.start(undefined, true); // reset, dispatch
  e.stop();
  e.resume(true);                       // redispatch(true):仅 dispatch,无 reset
  expect(order).toEqual(['reset', 'dispatch', 'dispatch']);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/core/todo-reset.test.ts`
Expected: FAIL —— TS 编译错误,`resetWorkers` 不在 `TodoCallbacks` 上(对象字面量多出属性 / 类型不匹配)。

- [ ] **Step 3: 在接口加 `resetWorkers`**

在 `src/core/todo.ts` 的 `TodoCallbacks` 接口里,`announceStalled(...)` 之后、`removedByBossText()` 之前插入:

```ts
  /** todo 模式:推进到新任务时同步调用一次,实现方异步把非 lead 员工重置为全新会话(引擎不等待)。 */
  resetWorkers(): void;
```

- [ ] **Step 4: 在 `dispatchNext` 推进到新任务时、下发前调用**

在 `src/core/todo.ts` 的 `dispatchNext` 里,把下发那一行前面加一行。原代码:

```ts
    const id = this.cb.dispatch(task, this.st.tasks.indexOf(task) + 1, this.st.tasks.length, isResend);
```

改为:

```ts
    if (!isResend) this.cb.resetWorkers(); // 仅新任务推进时重置员工(重发=同一 current,员工可能在干,不清)
    const id = this.cb.dispatch(task, this.st.tasks.indexOf(task) + 1, this.st.tasks.length, isResend);
```

- [ ] **Step 5: 让现有三个测试 stub 与 index.ts 编译通过**

在 `tests/core/todo.test.ts`、`tests/core/todo-backoff.test.ts`、`tests/core/todo-wait.test.ts` 各自构造 `new TodoEngine({...})` 的回调对象里,`announceStalled` 行之后加一行:

```ts
    resetWorkers: () => {},
```

在 `src/index.ts` 第 100 行起的 `new TodoEngine({...})` 回调对象里,`announceStalled: (...) => {...},` 之后、`removedByBossText:` 之前加临时 no-op(Task 2 会替换为真实现):

```ts
    resetWorkers: () => {}, // TODO(Task 2):替换为真实重置
```

- [ ] **Step 6: 运行全套测试与构建,确认通过**

Run: `npm test && npm run build`
Expected: PASS —— `todo-reset.test.ts` 4 个用例全过,其余测试不回归,`tsc` 无错误。

- [ ] **Step 7: 提交**

```bash
git add src/core/todo.ts src/index.ts tests/core/todo-reset.test.ts tests/core/todo.test.ts tests/core/todo-backoff.test.ts tests/core/todo-wait.test.ts
git commit -m "$(cat <<'EOF'
feat(todo): 引擎新增 resetWorkers 回调,新任务推进时下发前触发

仅 dispatchNext(isResend=false) 触发(start/taskdone);nudge、redispatch 不触发。
index.ts 暂置 no-op,真实清空逻辑见后续。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: index.ts 实现真实重置(抽 `clearOneWorker` helper + 接线)

**Files:**
- Modify: `src/index.ts`(抽 `clearOneWorker` helper;改 `onClear` 复用之;把 Task 1 的 no-op `resetWorkers` 换成真实现)

**Interfaces:**
- Consumes: `TodoCallbacks.resetWorkers(): void`(Task 1)、`currentLead()`(`src/index.ts:98`)、`router.roster()` 项含 `{ name, virtual, lead, status }`、`clearing`/`restarting`(Set)、`sessions`(Map name→sid)、`bootstraps`(Map name→string)、`armRegisterExpectation(nm)`、`driver.inject`、`router.hold`、`sleep`(`src/index.ts:31`)。
- Produces: `async function clearOneWorker(nm: string): Promise<boolean>` —— 对单个员工执行 `/clear`→等待→重注入 bootstrap,返回是否实际清了(无 sid 返回 false);供 `onClear` 与 `resetWorkers` 共用。

- [ ] **Step 1: 抽出 `clearOneWorker` helper**

在 `src/index.ts` 的 orchestrator 作用域内(`onClear` 附近、与其他 `async function`/`const` 同级)新增一个**函数声明**(声明被提升,可被第 100 行的 `resetWorkers` 回调闭包引用):

```ts
  // 单员工清空序列:/clear → 等待 → 重注入 bootstrap(恢复身份+重新 register)。onClear 与 todo resetWorkers 共用,避免逻辑漂移。
  async function clearOneWorker(nm: string): Promise<boolean> {
    const sid = sessions.get(nm);
    if (!sid) return false;
    clearing.add(nm);   // 清空期间健康轮询别自动 onIdle
    router.hold(nm);    // 标忙→发来的消息排队,不投进正在清空的 pane
    try {
      await driver.inject(sid, '/clear', true);   // claude/codex 同名:清空上下文、开新会话
      await sleep(1500);
      const bs = bootstraps.get(nm);
      if (bs) armRegisterExpectation(nm); // 先布防再注入:重注入失败(拥堵超时)也要 90s 亮 ⚠
      if (bs) await driver.inject(sid, bs, true); // 重注入 bootstrap:恢复身份+重新 register
      return true;
    } finally {
      clearing.delete(nm);
    }
  }
```

- [ ] **Step 2: 改 `onClear` 复用 helper**

把 `src/index.ts` 中 `onClear` 里的 `await Promise.all(targets.map(async (nm) => { ... }))` 整段(从 `const sid = sessions.get(nm);` 到对应 `finally { clearing.delete(nm); }`)替换为:

```ts
      await Promise.all(targets.map(async (nm) => {
        if (await clearOneWorker(nm)) cleared.push(nm);
      }));
```

(其余 `onClear` 逻辑——`targets` 计算、`if (!name) { router.clearLog(); ... }`、`return { ok: true, cleared }`——保持不变。)

- [ ] **Step 3: 把 no-op `resetWorkers` 换成真实现**

把 Task 1 在第 100 行 `new TodoEngine({...})` 里加的 `resetWorkers: () => {}, // TODO(Task 2)...` 替换为:

```ts
    resetWorkers: () => {
      const lead = currentLead();
      if (!lead) return; // 无 lead:不清(否则下面 name!==lead 对 undefined 恒真,会误清所有员工)
      const targets = router.roster()
        .filter((a) => !a.virtual && a.name !== lead && !restarting.has(a.name) && !clearing.has(a.name))
        .map((a) => a.name);
      void Promise.all(targets.map((nm) => clearOneWorker(nm).catch(() => {}))); // fire-and-forget:引擎不等待
    },
```

- [ ] **Step 4: 构建 + 全套测试,确认无回归**

Run: `npm run build && npm test`
Expected: PASS —— `tsc` 无错误(`clearOneWorker` 类型/作用域正确),所有既有测试通过(引擎行为已由 Task 1 覆盖;本任务是 I/O 接线,无新增单测,门槛为编译通过)。

- [ ] **Step 5: 复查清单(I/O 胶水无单测,人工核对)**

逐条确认:
- `resetWorkers` 在 `currentLead()` 为空时直接 return(无误清)。
- `targets` 过滤掉了 lead、virtual(含 boss)、`restarting`、`clearing`。
- `void Promise.all(...)` 不被 `await`(引擎同步、不阻塞)。
- `onClear` 行为不变(单清/全员清、`cleared` 仍正确收集、全员清仍 `clearLog`)。

- [ ] **Step 6: 提交**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
feat(todo): resetWorkers 真实重置非 lead 员工(复用 clearOneWorker)

抽出单员工清空 helper 供 onClear 与 todo 重置共用;无 lead 时空操作,
fire-and-forget 不阻塞引擎,跳过 restarting/clearing 中的员工。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 下发/巡查/工作法文案——角色锚点 + 全新会话交底(zh + en)

**Files:**
- Modify: `src/i18n/zh.ts`(`coordinatorRules` ④、`todoDispatchMsg`、`todoNudgeMsg`)
- Modify: `src/i18n/en.ts`(同三处,`typeof zh` 同步)
- Create/Test: `tests/i18n-todo-dispatch.test.ts`

**Interfaces:**
- Consumes: `zh`/`en` 词典的 `todoDispatchMsg(seq, pos, total, body, isResend)`(签名不变)。
- Produces: 下发文案不变签名,但内容始终含「组长拆解分派」锚点;「全新会话」一句仅 `isResend===false` 出现。

- [ ] **Step 1: 写失败测试 `tests/i18n-todo-dispatch.test.ts`**

```ts
// tests/i18n-todo-dispatch.test.ts
import { expect, test } from 'vitest';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

test('zh 下发:角色锚点始终在,全新会话句仅非重发时出现', () => {
  const fresh = zh.todoDispatchMsg(1, 1, 3, '做X', false);
  const resend = zh.todoDispatchMsg(1, 1, 3, '做X', true);
  expect(fresh).toContain('组长');
  expect(resend).toContain('组长');        // 重发也要带角色锚点(防 lead 上下文膨胀忘角色)
  expect(fresh).toContain('全新会话');
  expect(resend).not.toContain('全新会话'); // 重发时员工没被重新清,不能谎称全新
});

test('en 下发:角色锚点始终在,全新会话句仅非重发时出现', () => {
  const fresh = en.todoDispatchMsg(1, 1, 3, 'do X', false);
  const resend = en.todoDispatchMsg(1, 1, 3, 'do X', true);
  expect(fresh).toContain('lead');
  expect(resend).toContain('lead');
  expect(fresh).toContain('brand-new');
  expect(resend).not.toContain('brand-new');
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/i18n-todo-dispatch.test.ts`
Expected: FAIL —— 现有文案不含「组长」/「全新会话」/`brand-new`,断言不通过。

- [ ] **Step 3: 改 `src/i18n/zh.ts` 的 `todoDispatchMsg`**

把现有 `todoDispatchMsg` 整体替换为:

```ts
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `【任务 #${seq}·第 ${pos}/${total} 条】${isResend ? '(重发)' : ''}${body}\n` +
    `你是本团队的组长(协调者):请把本任务拆解成子任务、用 sendmsg 分派给对应员工(前端/后端/测试…)执行,你只负责协调依赖、跟进进度、汇总结果,不要自己动手包办。` +
    (isResend ? '' : '⚠ 本轮员工均为全新会话、无任何历史记忆,分派时务必把背景、目标、验收标准一次交代清楚。') +
    `完成判定:只有当你分派出去的所有员工都已完成并向你回报后,才调 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报,系统才会下发下一条——否则会中断他们正在进行的工作。如需等待长脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待。勿用 sendmsg 回复本条,过程中可照常与团队/boss 沟通。`,
```

- [ ] **Step 4: 改 `src/i18n/zh.ts` 的 `coordinatorRules` ④ 与 `todoNudgeMsg`**

`coordinatorRules` ④ 那行字符串(以 `'④ 当 boss 明确要求用 todo 模式执行时:` 开头、以 `…用 todoplan(…, replace:true)。' +` 结尾)的句末,在 `replace:true)。` 之后追加:

```
todo 模式下每条任务下发时系统会把其他员工重置为全新会话,你需对他们完整交底,且只有所有分派出去的员工都回报后才调 taskdone。
```

即该行改为以 `…要修订刚建的清单用 todoplan(…, replace:true)。todo 模式下每条任务下发时系统会把其他员工重置为全新会话,你需对他们完整交底,且只有所有分派出去的员工都回报后才调 taskdone。' +` 结尾。

`todoNudgeMsg` 末尾段(`仍在推进则继续即可;` 开头那段)改为在「仍在推进则继续即可;」之后插入分派提示:

```ts
    `仍在推进则继续即可;如仍未分派,请把任务拆解后分派给员工执行;如在等待长时间脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待。勿因本提醒向队友发起额外沟通。未上报则 ${nextMinutes} 分钟后再次巡查。`,
```

- [ ] **Step 5: 改 `src/i18n/en.ts` 同三处**

`todoDispatchMsg` 整体替换为:

```ts
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `[Task #${seq} · ${pos}/${total}]${isResend ? ' (resend)' : ''} ${body}\n` +
    `You are the team lead (coordinator): decompose this task into subtasks and dispatch them via sendmsg to the right workers (frontend/backend/qa…); you only coordinate dependencies, track progress, and aggregate results — do not do the work yourself. ` +
    (isResend ? '' : '⚠ This round all workers are brand-new sessions with no memory — when dispatching, fully brief them on background, goals, and acceptance criteria. ') +
    `Done means: only after every worker you dispatched has finished and reported back do you call taskdone(seq:${seq}, status:"done"|"failed", result:"…"); the next task is dispatched only after that — reporting early would cut off their in-progress work. If waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…"). Do not reply to this via sendmsg; normal team/boss communication is fine meanwhile.`,
```

`coordinatorRules` ④ 那行(以 `'④ When boss explicitly asks for todo-mode execution:` 开头)句末、在 `pass todoplan(…, replace:true). ` 之后追加:

```
In todo mode, each task dispatch resets the other workers to brand-new sessions — brief them fully, and only call taskdone after every dispatched worker has reported back. 
```

`todoNudgeMsg` 末尾段(` if still in progress, carry on;` 那段)改为:

```ts
    ` if still in progress, carry on; if not yet dispatched, decompose and dispatch to workers; if waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…"). Do not message teammates just because of this reminder. Next check in ${nextMinutes} min if unreported.`,
```

- [ ] **Step 6: 运行测试与构建,确认通过**

Run: `npm test && npm run build`
Expected: PASS —— `i18n-todo-dispatch.test.ts` 2 个用例过,`tests/i18n.test.ts` 的 key 集合相等仍过(未增删 key),`tsc` 无错误。

- [ ] **Step 7: 提交**

```bash
git add src/i18n/zh.ts src/i18n/en.ts tests/i18n-todo-dispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(todo): 下发/巡查/工作法文案——组长拆解分派锚点 + 全新会话交底

下发消息始终自带「你是组长,拆解分派,别包办」(不依赖 bootstrap 记忆,
治 lead 上下文膨胀忘角色);「员工全新会话」句仅非重发时出现。zh+en 同步。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 自审

**Spec 覆盖**:
- 重置范围(只清员工保留 lead)→ Task 2 Step 3 `a.name !== lead`。✓
- 总是开启无开关 → Task 1 Step 4 无条件 `if (!isResend)`,无 flag。✓
- 时机(仅新任务,nudge/redispatch 不清)→ Task 1 测试 3、4。✓
- 无 lead 空操作 → Task 2 Step 3 `if (!lead) return`。✓
- 不复用 onClear 目标列表(含 lead),只复用单员工 helper → Task 2 Step 1-3。✓
- 跳过 restarting/clearing → Task 2 Step 3 filter。✓
- 下发始终带角色锚点、全新会话句仅非重发 → Task 3 测试 + Step 3/5。✓
- coordinatorRules ④ 补句、todoNudgeMsg 补分派提示 → Task 3 Step 4/5。✓
- 三个测试 stub 编译前置 → Task 1 Step 5。✓
- 纯信任 lead 无 busy 护栏 → 全程未引入护栏。✓

**占位符扫描**:Task 1 Step 5 的 index.ts no-op 注释含 `TODO(Task 2)`,是**有意的临时桩**,Task 2 Step 3 明确替换——非计划占位符。其余步骤均含完整代码/命令。✓

**类型一致**:`resetWorkers(): void` 接口(Task 1)与 index.ts 实现(Task 2)、三测试 stub 签名一致;`clearOneWorker(nm: string): Promise<boolean>` 在 Task 2 内自洽;`todoDispatchMsg` 签名全程不变。✓
