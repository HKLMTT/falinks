# todo lead 周期性重置 + 项目状态记忆 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 todo 模式的 lead 一套受控记忆(lead 亲笔维护的项目状态档)+ 周期性重置(每 K 条任务清会话并重加载文档),把 CLI 不可控的有损 auto-compact 换成高保真续接,支撑长期无人值守。

**Architecture:** lead 经新 MCP 工具 `leadstate(content)` 整篇写入项目状态档(落盘 `~/.falinks/leadstate/<key>.md`);`composeBootstrap` 对 lead 嵌入当前文档,写档时同步刷新 `bootstraps` 条目,于是任何对 lead 的 `clearOneWorker` 重注入都自带最新记忆。`TodoEngine` 数完成条数,每 K 条在下发下一条前(`resetWorkers` 之后)调 `resetLead()`(= `clearOneWorker(lead)`);K/enabled 住 config 文件(唯一真相),引擎经 `leadResetEvery()` getter 现取(关闭返 0)。`/clear` 与 `/todo clear` 删文档(白纸),周期重置留文档(续航)。

**Tech Stack:** TypeScript ESM(`.js` import 后缀)、vitest、zod(MCP schema)、i18n 双词典(`en = typeof zh`)。

依据 spec:`docs/superpowers/specs/2026-06-18-lead-periodic-reset-design.md`。前序分支 `feat/todo-reset-workers` 已实现员工侧「下发即重置」与 `clearOneWorker`,本计划叠加其上。

## Global Constraints

- TypeScript ESM,import 路径带 `.js` 后缀。
- i18n:`src/i18n/en.ts` 为 `typeof zh`,zh/en key 与签名必须一致;`tests/i18n.test.ts` 校验 key 集合相等。
- 配置唯一真相 = `falinks.config.json` 的 `todo.leadReset`;`enabled` 默认 `true`,`everyTasks`(K)默认 `5`。引擎不持久化 K/enabled,只持久化 `completedSinceLeadReset`。
- 记忆语义:周期重置**留**文档;`/clear`(手动)与 `/todo clear` **删**文档;`leadstate` 整篇替换。
- 安全阀:`resetLead` 在无 lead 或文档为空时空操作(文档空时向 boss 发边沿提醒)。
- 复用既有 `clearOneWorker(nm): Promise<boolean>`(前序分支已实现,单员工 `/clear`→重注入 `bootstraps.get(nm)`)。
- lead-only MCP 工具门控模式:`if (!router.get(agentName)?.lead) return ok({ ok:false, error:'...' })`。
- 落盘哈希复用 `runtime.ts` 的 `projectKey`/`runtimeDir`。
- 构建/测试:`npm run build`(`tsc -p tsconfig.build.json`)、`npm test`(`vitest run`)。
- 提交信息以 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 结尾。

---

### Task 1: leadstate 落盘模块

**Files:**
- Create: `src/leadstate-store.ts`
- Test: `tests/leadstate-store.test.ts`

**Interfaces:**
- Produces:
  - `leadStatePath(launchCwd: string, root?: string): string`
  - `loadLeadState(launchCwd: string, root?: string): string`（无文件返回空串 `''`）
  - `saveLeadState(launchCwd: string, content: string, root?: string): void`
  - `clearLeadState(launchCwd: string, root?: string): void`（删除文件;不存在则静默)

- [ ] **Step 1: 写失败测试 `tests/leadstate-store.test.ts`**

```ts
// tests/leadstate-store.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadLeadState, saveLeadState, clearLeadState } from '../src/leadstate-store.js';

const root = () => mkdtempSync(join(tmpdir(), 'falinks-leadstate-'));

test('不存在返回空串', () => {
  expect(loadLeadState('/some/proj', root())).toBe('');
});

test('save/load round-trip', () => {
  const r = root();
  saveLeadState('/some/proj', '# 状态\n已完成 A', r);
  expect(loadLeadState('/some/proj', r)).toBe('# 状态\n已完成 A');
});

test('clear 后回到空串', () => {
  const r = root();
  saveLeadState('/some/proj', 'x', r);
  clearLeadState('/some/proj', r);
  expect(loadLeadState('/some/proj', r)).toBe('');
});

test('clear 不存在的文件不抛错', () => {
  expect(() => clearLeadState('/never/written', root())).not.toThrow();
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/leadstate-store.test.ts`
Expected: FAIL —— 模块不存在 / 导出未定义。

- [ ] **Step 3: 实现 `src/leadstate-store.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir, projectKey } from './runtime.js';

/** 每个项目一份 lead 项目状态档:~/.falinks/leadstate/<projectKey>.md。root 可注入便于测试。 */
export function leadStatePath(launchCwd: string, root = runtimeDir()): string {
  return join(root, 'leadstate', `${projectKey(launchCwd)}.md`);
}

/** 读档;不存在/损坏返回空串。 */
export function loadLeadState(launchCwd: string, root = runtimeDir()): string {
  const p = leadStatePath(launchCwd, root);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export function saveLeadState(launchCwd: string, content: string, root = runtimeDir()): void {
  const p = leadStatePath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** 删档(白纸语义);不存在静默。 */
export function clearLeadState(launchCwd: string, root = runtimeDir()): void {
  try { rmSync(leadStatePath(launchCwd, root)); } catch { /* 不存在/删除失败不致命 */ }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test -- tests/leadstate-store.test.ts`
Expected: PASS（4/4）。

- [ ] **Step 5: 提交**

```bash
git add src/leadstate-store.ts tests/leadstate-store.test.ts
git commit -m "$(cat <<'EOF'
feat(leadstate): lead 项目状态档落盘模块(load/save/clear)

~/.falinks/leadstate/<projectKey>.md,复用 runtime 的 projectKey/runtimeDir。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: config 增 `todo.leadReset`

**Files:**
- Modify: `src/core/config.ts`（`FalinksConfig` 接口 + `parseConfig` 校验 + return）
- Test: `tests/config-leadreset.test.ts`

**Interfaces:**
- Produces: `FalinksConfig.todo?: { leadReset: { enabled: boolean; everyTasks: number } }`,缺省归一化为 `{ leadReset: { enabled: true, everyTasks: 5 } }`。

- [ ] **Step 1: 写失败测试 `tests/config-leadreset.test.ts`**

```ts
// tests/config-leadreset.test.ts
import { expect, test } from 'vitest';
import { parseConfig } from '../src/core/config.js';

const base = { agents: [{ name: 'a', cli: 'claude', cwd: '.', bootstrap: 'x' }] };

test('缺省 leadReset:enabled=true, everyTasks=5', () => {
  const c = parseConfig({ ...base });
  expect(c.todo).toEqual({ leadReset: { enabled: true, everyTasks: 5 } });
});

test('显式覆盖被采纳', () => {
  const c = parseConfig({ ...base, todo: { leadReset: { enabled: false, everyTasks: 3 } } });
  expect(c.todo).toEqual({ leadReset: { enabled: false, everyTasks: 3 } });
});

test('部分覆盖:只给 everyTasks,enabled 仍默认 true', () => {
  const c = parseConfig({ ...base, todo: { leadReset: { everyTasks: 8 } } });
  expect(c.todo).toEqual({ leadReset: { enabled: true, everyTasks: 8 } });
});

test('everyTasks 非正整数报错', () => {
  expect(() => parseConfig({ ...base, todo: { leadReset: { everyTasks: 0 } } }))
    .toThrow(/everyTasks/);
});

test('enabled 非布尔报错', () => {
  expect(() => parseConfig({ ...base, todo: { leadReset: { enabled: 'yes' } } }))
    .toThrow(/enabled/);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/config-leadreset.test.ts`
Expected: FAIL —— `c.todo` 为 undefined / 无校验。

- [ ] **Step 3: 改 `src/core/config.ts`**

在 `FalinksConfig` 接口里 `paneTheme?: boolean;` 之后加:

```ts
  /** todo 模式 lead 周期性重置 + 记忆开关;缺省 { leadReset: { enabled: true, everyTasks: 5 } }。 */
  todo?: { leadReset: { enabled: boolean; everyTasks: number } };
```

在 `parseConfig` 里,`paneTheme` 校验那段之后、`if (!Array.isArray(raw.agents)...` 之前插入校验:

```ts
  const lr = raw.todo?.leadReset ?? {};
  if (lr.enabled !== undefined && typeof lr.enabled !== 'boolean')
    throw new Error('config.todo.leadReset.enabled must be a boolean');
  if (lr.everyTasks !== undefined && (typeof lr.everyTasks !== 'number' || !Number.isInteger(lr.everyTasks) || lr.everyTasks <= 0))
    throw new Error('config.todo.leadReset.everyTasks must be a positive integer');
  const todo = { leadReset: { enabled: lr.enabled ?? true, everyTasks: lr.everyTasks ?? 5 } };
```

把最后的 `return {...}` 改为带上 `todo`:

```ts
  return { busPort: raw.busPort, historyCap: raw.historyCap, paneTheme: raw.paneTheme, todo, agents, routes, guards };
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test -- tests/config-leadreset.test.ts && npm run build`
Expected: PASS（5/5),`tsc` 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/core/config.ts tests/config-leadreset.test.ts
git commit -m "$(cat <<'EOF'
feat(config): todo.leadReset 开关(enabled 默认 true、everyTasks 默认 5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 引擎计数与触发

**Files:**
- Modify: `src/core/todo.ts`（`TodoCallbacks` 接口 + `TodoState` 字段经 todo-store + `taskdone`/`dispatchNext`/`clear`/`plan`）
- Modify: `src/todo-store.ts`（`TodoState` 增 `completedSinceLeadReset`,load 归一化）
- Modify: `tests/core/todo.test.ts`、`tests/core/todo-backoff.test.ts`、`tests/core/todo-wait.test.ts`（stub 补三个新回调,编译前置）
- Modify: `src/index.ts`（TodoEngine 构造处补三个回调的临时 no-op/默认值,使其编译;真实现见 Task 5）
- Test: `tests/core/todo-leadreset.test.ts`

**Interfaces:**
- Consumes: 既有 `TodoCallbacks`（含前序的 `resetWorkers`）。
- Produces:
  - `TodoCallbacks.resetLead(): void`
  - `TodoCallbacks.wipeLeadMemory(): void`
  - `TodoCallbacks.leadResetEvery(): number`（返回 K;0 表示关闭,永不触发)
  - `TodoState.completedSinceLeadReset: number`（默认 0,持久化)

- [ ] **Step 1: `src/todo-store.ts` 加字段**

`TodoState` 接口里 `tasks: TodoTask[];` 之后加:

```ts
  completedSinceLeadReset?: number; // 距上次 lead 重置以来已完成条数;驱动每 K 条周期重置
```

`EMPTY()` 改为:

```ts
const EMPTY = (): TodoState => ({ state: 'idle', nudgeMinutes: 10, tasks: [], completedSinceLeadReset: 0 });
```

`loadTodo` 的 `const st: TodoState = {...}` 里补一行(在 `tasks:` 之后):

```ts
      completedSinceLeadReset: typeof raw.completedSinceLeadReset === 'number' ? raw.completedSinceLeadReset : 0,
```

- [ ] **Step 2: 写失败测试 `tests/core/todo-leadreset.test.ts`**

```ts
// tests/core/todo-leadreset.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';

function mk(everyK: number) {
  let nextId = 0;
  const order: string[] = [];
  const e = new TodoEngine({
    now: () => 0,
    dispatch: () => { order.push('dispatch'); return `m${++nextId}`; },
    nudge: () => { order.push('nudge'); return true; },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceSendFailing: () => {},
    announceWaiting: () => {},
    announceStalled: () => {},
    resetWorkers: () => { order.push('resetWorkers'); },
    resetLead: () => { order.push('resetLead'); },
    wipeLeadMemory: () => { order.push('wipeLeadMemory'); },
    leadResetEvery: () => everyK,
    removedByBossText: () => 'removed',
    persist: () => {},
  });
  return { e, order };
}

test('每完成 K=2 条,在下发下一条前重置 lead,且在 resetWorkers 之后', () => {
  const { e, order } = mk(2);
  e.add('a'); e.add('b'); e.add('c'); e.add('d');
  e.start(undefined, true);          // 下发 #1:resetWorkers,dispatch(计数0,不重置 lead)
  e.taskdone(1, 'done', '');         // 完成1 → 下发 #2:resetWorkers,dispatch(计数1)
  e.taskdone(2, 'done', '');         // 完成2 → 下发 #3:resetWorkers,resetLead,dispatch(计数2≥K→重置并归零)
  e.taskdone(3, 'done', '');         // 完成3 → 下发 #4:resetWorkers,dispatch(计数1)
  expect(order).toEqual([
    'resetWorkers', 'dispatch',
    'resetWorkers', 'dispatch',
    'resetWorkers', 'resetLead', 'dispatch',
    'resetWorkers', 'dispatch',
  ]);
});

test('leadResetEvery 返回 0(关闭)永不重置 lead', () => {
  const { e, order } = mk(0);
  e.add('a'); e.add('b'); e.add('c');
  e.start(undefined, true);
  e.taskdone(1, 'done', ''); e.taskdone(2, 'done', '');
  expect(order.filter((x) => x === 'resetLead')).toEqual([]);
});

test('nudge 与 resume/redispatch 不触发 resetLead', () => {
  const { e, order } = mk(1);
  e.add('a');
  e.start(undefined, true); // 计数0,首条不重置
  e.stop();
  e.resume(true);           // redispatch(true):不重置 lead
  expect(order.filter((x) => x === 'resetLead')).toEqual([]);
});

test('clear 触发 wipeLeadMemory 并归零计数', () => {
  const { e, order } = mk(5);
  e.add('a'); e.add('b'); e.start(undefined, true);
  e.taskdone(1, 'done', '');   // 计数=1
  e.stop();                    // clear 仅 paused/非 running 可用
  e.clear();
  expect(order).toContain('wipeLeadMemory');
  // 归零通过后续行为间接验证:重新建单跑满 K 才触发(此处仅验回调被调)
});
```

- [ ] **Step 3: 运行,确认失败**

Run: `npm test -- tests/core/todo-leadreset.test.ts`
Expected: FAIL —— `resetLead`/`wipeLeadMemory`/`leadResetEvery` 不在 `TodoCallbacks`(类型错误)。

- [ ] **Step 4: 在 `TodoCallbacks` 接口加三个回调**

`src/core/todo.ts` 的 `TodoCallbacks` 里,`resetWorkers(): void;`(前序已加)之后插入:

```ts
  /** todo 模式:每 K 条完成时,推进新任务前重置 lead(实现方 = clearOneWorker(lead),含文档重加载)。 */
  resetLead(): void;
  /** /todo clear 弃单时:删除 lead 项目状态档(白纸)。 */
  wipeLeadMemory(): void;
  /** 当前重置周期 K(实现方现取 config);返回 0 表示关闭,引擎永不触发 resetLead。 */
  leadResetEvery(): number;
```

- [ ] **Step 5: `taskdone` 累加计数 + `dispatchNext` 触发 + `clear` 归零并 wipe + `plan` 归零**

在 `src/core/todo.ts` 的 `taskdone` 里,把当前条标记完结那段(`cur.status = status; cur.result = result; cur.ts = this.cb.now();`)之后、`this.lastDispatchId = undefined;` 之前加:

```ts
    this.st.completedSinceLeadReset = (this.st.completedSinceLeadReset ?? 0) + 1;
```

在 `dispatchNext` 里,前序已加的 `if (!isResend) this.cb.resetWorkers();` 之后、`const id = this.cb.dispatch(...)` 之前加:

```ts
    if (!isResend) {
      const k = this.cb.leadResetEvery();
      if (k > 0 && (this.st.completedSinceLeadReset ?? 0) >= k) {
        this.cb.resetLead();
        this.st.completedSinceLeadReset = 0;
      }
    }
```

在 `clear()` 里(方法体内,设置 `this.st = {...}` 之前)加 wipe + 归零。把 `clear()` 现有的重置语句改为带上 `completedSinceLeadReset: 0`,并在前面调 wipe:

```ts
  clear(): TodoResult {
    if (this.st.state === 'running') return { ok: false, error: 'todolist is running — /todo stop first' };
    this.cb.wipeLeadMemory(); // 弃单 → 删 lead 记忆(白纸)
    this.st = { state: 'idle', nudgeMinutes: this.st.nudgeMinutes, tasks: [], completedSinceLeadReset: 0 };
    if (this.lastDispatchId) this.cb.cancelQueued(this.lastDispatchId);
    this.lastDispatchId = undefined;
    this.cb.persist(this.st);
    return { ok: true };
  }
```

在 `plan()` 里,重建清单(`this.st.tasks = []` 的两处分支之后,或统一在写入新 tasks 后)归零计数:在 `const seqs = tasks.map(...)` 之后、`this.cb.persist(this.st)` 之前加:

```ts
    this.st.completedSinceLeadReset = 0; // 新一摊活:重置 lead 重置计数
```

- [ ] **Step 6: 三个既有 stub + index.ts 构造补回调(编译前置)**

在 `tests/core/todo.test.ts`、`tests/core/todo-backoff.test.ts`、`tests/core/todo-wait.test.ts` 各自 `new TodoEngine({...})` 回调对象里,`resetWorkers: () => {},`(前序已加)之后加:

```ts
    resetLead: () => {},
    wipeLeadMemory: () => {},
    leadResetEvery: () => 0,
```

在 `src/index.ts` 第 100 行起 `new TodoEngine({...})` 里,`resetWorkers: () => {...},`(前序已实现)之后加临时桩(Task 5 替换为真实现):

```ts
    resetLead: () => {}, // TODO(Task 5)
    wipeLeadMemory: () => {}, // TODO(Task 5)
    leadResetEvery: () => 0, // TODO(Task 5):读 cfg
```

- [ ] **Step 7: 运行全套 + 构建,确认通过**

Run: `npm test && npm run build`
Expected: PASS —— `todo-leadreset.test.ts` 全过,其余不回归,`tsc` 无错误。

- [ ] **Step 8: 提交**

```bash
git add src/core/todo.ts src/todo-store.ts src/index.ts tests/core/todo-leadreset.test.ts tests/core/todo.test.ts tests/core/todo-backoff.test.ts tests/core/todo-wait.test.ts
git commit -m "$(cat <<'EOF'
feat(todo): 引擎按 K 条计数触发 resetLead + clear 弃单 wipeLeadMemory

completedSinceLeadReset 持久化;leadResetEvery() getter(0=关);resetLead 在
resetWorkers 之后、下发之前;nudge/redispatch 不触发。index 暂置 no-op。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: i18n 文案(leadstate 工具 / 工作法 / 提醒)

**Files:**
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`
- Test: `tests/i18n-leadstate.test.ts`

**Interfaces:**
- Produces(zh/en 同 key):
  - `toolDescLeadstate: string`
  - `leadResetSkippedNoDoc: string`（无文档跳过重置的 boss 提醒)
  - `leadMemoryOff: string`（enabled=false 时 leadstate 工具返回提示)
  - `coordinatorRules` 末尾追加「维护项目状态档」段(不改 key,仅扩内容)

- [ ] **Step 1: 写失败测试 `tests/i18n-leadstate.test.ts`**

```ts
// tests/i18n-leadstate.test.ts
import { expect, test } from 'vitest';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

test('zh 新增键存在且非空', () => {
  expect(zh.toolDescLeadstate.length).toBeGreaterThan(0);
  expect(zh.leadResetSkippedNoDoc.length).toBeGreaterThan(0);
  expect(zh.leadMemoryOff.length).toBeGreaterThan(0);
});

test('en 新增键存在且非空', () => {
  expect(en.toolDescLeadstate.length).toBeGreaterThan(0);
  expect(en.leadResetSkippedNoDoc.length).toBeGreaterThan(0);
  expect(en.leadMemoryOff.length).toBeGreaterThan(0);
});

test('coordinatorRules 提及项目状态档维护', () => {
  expect(zh.coordinatorRules).toContain('项目状态');
  expect(en.coordinatorRules.toLowerCase()).toContain('project state');
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/i18n-leadstate.test.ts`
Expected: FAIL —— 键不存在(TS 报错)/ coordinatorRules 不含该串。

- [ ] **Step 3: 改 `src/i18n/zh.ts`**

在 `toolDescTaskwait` 那条之后加三个新键:

```ts
  toolDescLeadstate: '【todo 模式·仅组长】整篇写入/更新你的「项目状态档」:leadstate(content)。这是你跨会话的记忆——周期重置或重启后会重新加载它。请随每次 taskdone 顺手刷新,内容精炼策展(目标/范围、关键决策与理由、约定与坑、已完成、下一步),整篇替换而非追加流水。',
  leadResetSkippedNoDoc: '【lead 重置跳过】已到周期但组长尚无项目状态档(leadstate),为防失忆本次不重置。请提示组长用 leadstate 维护项目记忆。',
  leadMemoryOff: 'lead 记忆已关闭(config.todo.leadReset.enabled=false),leadstate 未生效。',
```

`coordinatorRules` 字符串末尾的 `'一句话:对齐需求 → 完整设计(可调度协助) → 方案定稿 → 才拆解、分派、管理。'` 这一行之前,插入一段新内容(作为字符串拼接的一行):

```ts
    '⑤ todo 模式下你有「项目状态档」作为跨会话记忆:每条任务推进时系统可能把你重置为新会话再重加载此档,所以务必随每次 taskdone 用 leadstate(content) 把目标/关键决策/已完成/下一步整篇刷新、保持精炼;这样即使被重置或重启也能无缝续接。' +
```

- [ ] **Step 4: 改 `src/i18n/en.ts` 同三键 + coordinatorRules**

`toolDescTaskwait` 之后:

```ts
  toolDescLeadstate: '[todo mode · lead only] Write/replace your "project state doc": leadstate(content). This is your cross-session memory — it is reloaded after a periodic reset or restart. Refresh it alongside each taskdone; keep it concise and curated (goal/scope, key decisions & rationale, conventions & gotchas, done, next), replacing the whole doc rather than appending a log.',
  leadResetSkippedNoDoc: '[lead reset skipped] Due for a periodic reset but the lead has no project state doc (leadstate) yet — skipping to avoid amnesia. Prompt the lead to maintain its memory via leadstate.',
  leadMemoryOff: 'Lead memory is off (config.todo.leadReset.enabled=false); leadstate had no effect.',
```

`coordinatorRules` 的 `'In short: align requirements → ...'` 之前插入一行:

```ts
    '⑤ In todo mode you have a "project state doc" as cross-session memory: when advancing tasks the system may reset you to a fresh session and reload this doc, so always refresh it via leadstate(content) alongside each taskdone — goal/key decisions/done/next, kept concise — so a reset or restart resumes seamlessly. ' +
```

- [ ] **Step 5: 运行,确认通过**

Run: `npm test -- tests/i18n-leadstate.test.ts tests/i18n.test.ts && npm run build`
Expected: PASS —— 新键测试过,key 集合相等仍过,`tsc` 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/i18n/zh.ts src/i18n/en.ts tests/i18n-leadstate.test.ts
git commit -m "$(cat <<'EOF'
feat(i18n): leadstate 工具描述 + 工作法⑤项目状态档 + 重置跳过/记忆关闭文案

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: index.ts 接线(composeBootstrap 嵌档 / leadstate / resetLead / wipe / getter)

**Files:**
- Modify: `src/index.ts`
- Modify: `src/bus/server.ts`（`TodoDeps.todo` 接口加 `leadstate` + 注册 `leadstate` MCP 工具)

**Interfaces:**
- Consumes: `loadLeadState`/`saveLeadState`/`clearLeadState`（Task 1);`cfg.todo.leadReset`（Task 2);`TodoCallbacks.resetLead/wipeLeadMemory/leadResetEvery`（Task 3);i18n 键(Task 4);既有 `clearOneWorker`、`composeBootstrap`、`currentLead`、`bootstraps`、`cfg.agents`。
- Produces: `TodoDeps.todo.leadstate(content: string): { ok: boolean; error?: string }`。

- [ ] **Step 1: `composeBootstrap` 对 lead 嵌入当前文档**

`src/index.ts` 顶部补 import:

```ts
import { loadLeadState, saveLeadState, clearLeadState } from './leadstate-store.js';
```

把 `composeBootstrap` 改为(lead 且 enabled 且文档非空时追加文档段):

```ts
  const composeBootstrap = (a: { name: string; role?: string; lead?: boolean; bootstrap?: string }): string => {
    let s = `${t().houseRules}\n${t().identityLine(a.name, a.role)}${a.bootstrap ?? ''}`;
    if (a.lead) {
      s += `\n${t().coordinatorRules}`;
      const doc = cfg.todo?.leadReset.enabled ? loadLeadState(launchCwd) : '';
      if (doc) s += `\n【项目状态(续接用,这是你上一段会话沉淀的记忆)】\n${doc}`;
    }
    return s;
  };
```

(若原 `composeBootstrap` 是箭头表达式单行返回,整体替换为以上块体写法。)

- [ ] **Step 2: TodoEngine 构造处把三个 no-op 换成真实现**

把 Task 3 在 `new TodoEngine({...})` 里加的三行临时桩替换为:

```ts
    resetLead: () => {
      const lead = currentLead();
      if (!cfg.todo?.leadReset.enabled || !lead) return;
      if (!loadLeadState(launchCwd)) { // 无文档:重置会致失忆,跳过 + 边沿提醒
        router.send('falinks', 'boss', t().leadResetSkippedNoDoc);
        return;
      }
      void clearOneWorker(lead).catch(() => {}); // 重注入含文档的 bootstrap;下一条任务经 hold 队列在其后落地
    },
    wipeLeadMemory: () => {
      clearLeadState(launchCwd);
      const lead = currentLead();
      if (lead) { const spec = cfg.agents.find((x) => x.name === lead); if (spec) bootstraps.set(lead, composeBootstrap(spec)); }
    },
    leadResetEvery: () => (cfg.todo?.leadReset.enabled ? cfg.todo.leadReset.everyTasks : 0),
```

- [ ] **Step 3: `onClear` 对 lead 先抹文档 + 重算 bootstrap(白纸语义)**

在 `onClear` 里,计算出 `targets` 之后、`await Promise.all(targets.map(...))` 之前,插入:对将被清空的 lead,先删文档并重算其 bootstraps 条目,使随后的 `clearOneWorker` 重注入到的是无文档 bootstrap:

```ts
      const lead = currentLead();
      if (lead && targets.includes(lead)) {
        clearLeadState(launchCwd);
        const spec = cfg.agents.find((x) => x.name === lead);
        if (spec) bootstraps.set(lead, composeBootstrap(spec)); // 此刻文档已删 → 不含文档 = 白纸
      }
```

- [ ] **Step 4: `leadstate` deps 方法(写档 + 刷新 bootstraps)**

在 `src/index.ts` 的 `todo: { ... }` deps 对象里(`state: () => todo.state(),` 之后)加:

```ts
      leadstate: (content: string) => {
        if (!cfg.todo?.leadReset.enabled) return { ok: false, error: t().leadMemoryOff };
        saveLeadState(launchCwd, content);
        const lead = currentLead();
        if (lead) { const spec = cfg.agents.find((x) => x.name === lead); if (spec) bootstraps.set(lead, composeBootstrap(spec)); }
        return { ok: true };
      },
```

- [ ] **Step 5: `src/bus/server.ts` 注册 `leadstate` MCP 工具 + 接口**

`TodoDeps.todo` 接口里(`plan(...)` 之后)加:

```ts
    /** lead 写/换项目状态档(leadstate 工具)。 */
    leadstate(content: string): { ok: boolean; error?: string };
```

在 `taskwait` 工具注册之后加:

```ts
  server.registerTool('leadstate', {
    description: t().toolDescLeadstate,
    inputSchema: { content: z.string() },
  }, async ({ content }) => {
    touch();
    if (!deps.todo) return ok({ ok: false, error: 'todolist not available' });
    if (!router.get(agentName)?.lead) return ok({ ok: false, error: 'only the lead can call leadstate' });
    return ok(deps.todo.leadstate(content));
  });
```

- [ ] **Step 6: 构建 + 全套测试,确认无回归**

Run: `npm run build && npm test`
Expected: PASS —— `tsc` 无错误(回调/接口齐全),既有测试不回归。本任务为 I/O 胶水,无新单测;门槛为编译通过 + Step 7 复查。

- [ ] **Step 7: 复查清单(人工)**

- `composeBootstrap`:仅 lead + enabled + 非空文档才嵌档;非 lead/关闭/空档不嵌。
- `resetLead`:无 enabled/无 lead/空档 三种情况均不调 `clearOneWorker`;空档发一次提醒。
- `wipeLeadMemory` 与 `onClear` 的 lead 分支:都先 `clearLeadState` 再用 `composeBootstrap`(此刻读到空档)重算 `bootstraps`。
- `leadstate` deps:关闭时返回 `leadMemoryOff` 不写盘;开启时写盘 + 刷新 lead 的 bootstraps 条目。
- `leadResetEvery`:enabled 时返 K,否则返 0。

- [ ] **Step 8: 提交**

```bash
git add src/index.ts src/bus/server.ts
git commit -m "$(cat <<'EOF'
feat(todo): lead 记忆接线——bootstrap 嵌档 / leadstate 工具 / resetLead / wipe

composeBootstrap 对 lead 嵌当前文档;leadstate 写档并刷新 bootstraps 条目;
resetLead=clearOneWorker(lead)(无 lead/空档跳过);onClear 与 wipe 对 lead
先删档再重算 bootstrap(白纸);leadResetEvery 读 cfg。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6(可推迟): 运行时 `/todo leadreset on|off|<N>` 控制台命令

> 核心功能(Task 1-5)已完整:经 `falinks.config.json` 配置、重启生效。本任务仅加「运行时即时改并写回 config」的便利,可独立推迟。

**Files:**
- Modify: `src/console/parse.ts`（新增 action kind 解析)
- Modify: `src/console/commands.ts`（usage + 补全)
- Modify: `src/console/app.tsx`（分发到新 admin 路由)
- Modify: `src/bus/server.ts`（`/admin/leadreset` 路由 + `BusDeps` 加回调)
- Modify: `src/index.ts`（实现 `onLeadReset`:改内存 cfg + 写回 config 文件)
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`（`usageLeadReset` + 反馈文案)
- Test: `tests/console/parse-leadreset.test.ts`

**Interfaces:**
- Consumes: `cfg.todo.leadReset`、`configPath`、既有 admin POST 模式。
- Produces: `ParsedAction` 增 `{ kind: 'leadreset'; enabled?: boolean; every?: number }`;`BusDeps.onLeadReset(p: { enabled?: boolean; every?: number }): Promise<{ ok: boolean; error?: string }>`。

- [ ] **Step 1: 写失败测试 `tests/console/parse-leadreset.test.ts`**

```ts
// tests/console/parse-leadreset.test.ts
import { expect, test } from 'vitest';
import { parseInput } from '../../src/console/parse.js';

test('/todo leadreset on', () => {
  expect(parseInput('/todo leadreset on')).toEqual({ kind: 'leadreset', enabled: true });
});
test('/todo leadreset off', () => {
  expect(parseInput('/todo leadreset off')).toEqual({ kind: 'leadreset', enabled: false });
});
test('/todo leadreset 7 → 设周期', () => {
  expect(parseInput('/todo leadreset 7')).toEqual({ kind: 'leadreset', every: 7 });
});
test('/todo leadreset 非法值报错', () => {
  expect(parseInput('/todo leadreset 0').kind).toBe('error');
  expect(parseInput('/todo leadreset xyz').kind).toBe('error');
});
```

> 注:确认 `parse.ts` 导出的解析函数名(此处假定 `parseInput`)。打开文件核对实际导出名,测试与下步按真实名调整。

- [ ] **Step 2: 运行,确认失败**

Run: `npm test -- tests/console/parse-leadreset.test.ts`
Expected: FAIL —— 返回 `{kind:'error'}`(`leadreset` 子命令未识别)。

- [ ] **Step 3: `src/console/parse.ts` 加解析**

`ParsedAction` 联合类型加一支(在 `todo` 那支附近):

```ts
  | { kind: 'leadreset'; enabled?: boolean; every?: number }
```

在 `if (cmd === 'todo') { ... }` 块内,`if (sub === 'start') {...}` 之后加:

```ts
      if (sub === 'leadreset') {
        const arg = rest.trim();
        if (arg === 'on') return { kind: 'leadreset', enabled: true };
        if (arg === 'off') return { kind: 'leadreset', enabled: false };
        const n = Number(arg);
        if (!Number.isInteger(n) || n <= 0) return { kind: 'error', message: t().usageLeadReset };
        return { kind: 'leadreset', every: n };
      }
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm test -- tests/console/parse-leadreset.test.ts`
Expected: PASS（4/4)。

- [ ] **Step 5: `commands.ts` 补全 + usage(zh/en)**

`src/console/commands.ts` 的 `todo` 命令 usage 串改为含 `leadreset`:

```ts
  { name: 'todo', usage: '/todo add|list|rm|clear|start|stop|resume|leadreset', get hint() { return t().cmdHint.todo; } },
```

在 `todoSubState` 的子命令候选数组里加 `'leadreset'`(打开 `commands.ts` 第 46-50 行附近的 matches 列表,追加该项)。

i18n 两词典加 `usageLeadReset`:
- zh:`usageLeadReset: '用法:/todo leadreset on|off|<正整数>(开关 lead 周期重置 / 设周期 K)',`
- en:`usageLeadReset: 'Usage: /todo leadreset on|off|<positive int> (toggle lead periodic reset / set period K)',`

并加反馈文案 `leadResetSet`:
- zh:`leadResetSet: (enabled: boolean, k: number) => \`lead 周期重置:\${enabled ? '开' : '关'},每 \${k} 条\`,`
- en:`leadResetSet: (enabled: boolean, k: number) => \`lead periodic reset: \${enabled ? 'on' : 'off'}, every \${k} tasks\`,`

- [ ] **Step 6: `app.tsx` 分发 + `server.ts` admin 路由 + `index.ts` onLeadReset**

`src/console/app.tsx` 的 action 分发里(`if (a.kind === 'todo') {...}` 附近)加:

```tsx
      if (a.kind === 'leadreset') {
        const r = await admin(port, 'POST', '/admin/leadreset', { enabled: a.enabled, every: a.every });
        setStatus(r.ok ? t().leadResetSet(r.enabled as boolean, r.every as number) : '⚠ ' + (r.error ?? t().unknownError));
        return;
      }
```

`src/bus/server.ts`:`BusDeps` 加 `onLeadReset?(p: { enabled?: boolean; every?: number }): Promise<{ ok: boolean; error?: string; enabled?: boolean; every?: number }>;`,并在 admin 路由(`/admin/todo` 之后)加:

```ts
      if (req.method === 'POST' && url.pathname === '/admin/leadreset') {
        if (!deps.onLeadReset) return sendJson({ ok: false, error: 'not supported' });
        return sendJson(await deps.onLeadReset({ enabled: abody.enabled, every: abody.every }));
      }
```

`src/index.ts` 的 BusDeps 实现里加 `onLeadReset`:

```ts
    onLeadReset: async ({ enabled, every }) => {
      if (!cfg.todo) cfg.todo = { leadReset: { enabled: true, everyTasks: 5 } };
      if (enabled !== undefined) cfg.todo.leadReset.enabled = enabled;
      if (every !== undefined) {
        if (!Number.isInteger(every) || every <= 0) return { ok: false, error: 'everyTasks must be a positive integer' };
        cfg.todo.leadReset.everyTasks = every;
      }
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf8'));
        raw.todo = { leadReset: { ...cfg.todo.leadReset } };
        writeFileSync(configPath, JSON.stringify(raw, null, 2));
      } catch { /* 写回失败不致命,内存已生效 */ }
      return { ok: true, enabled: cfg.todo.leadReset.enabled, every: cfg.todo.leadReset.everyTasks };
    },
```

- [ ] **Step 7: 构建 + 全套测试**

Run: `npm run build && npm test`
Expected: PASS —— parse 测试过,其余不回归,`tsc` 无错误。

- [ ] **Step 8: 提交**

```bash
git add src/console/parse.ts src/console/commands.ts src/console/app.tsx src/bus/server.ts src/index.ts src/i18n/zh.ts src/i18n/en.ts tests/console/parse-leadreset.test.ts
git commit -m "$(cat <<'EOF'
feat(console): /todo leadreset on|off|<N> 运行时改 lead 重置开关并写回 config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 自审

**Spec 覆盖**:
- leadstate 落盘 → Task 1。✓
- config 开关 enabled/K → Task 2。✓
- 引擎计数/触发/getter/wipe/归零 → Task 3。✓
- i18n(工具描述、工作法、跳过/关闭文案)→ Task 4。✓
- composeBootstrap 嵌档、leadstate 写档+刷新 bootstraps、resetLead=clearOneWorker(lead)、安全阀、onClear 删档白纸、leadResetEvery 读 cfg → Task 5。✓
- 记忆清理两语义(周期留 / `/clear`+`/todo clear` 删)→ Task 3(wipe on clear)+ Task 5(onClear 删档)。✓
- 运行时配置开关 → Task 6(可推迟,核心不依赖)。✓
- 安全阀(无文档跳过+提醒)→ Task 5 Step 2。✓

**占位符扫描**:Task 3/Task 5 的 index.ts 临时桩带 `TODO(Task 5)`,是有意的、Task 5 明确替换的桩;Task 6 Step 1 提示「确认 parse 导出函数名」是真实需核对项,已标注。其余步骤均含完整代码。✓

**类型一致**:`resetLead()/wipeLeadMemory()/leadResetEvery(): number`(Task 3 定义)与 index 实现(Task 5)、三 stub(Task 3)一致;`leadstate(content: string)`(Task 5 deps + server.ts 接口)一致;`FalinksConfig.todo.leadReset.{enabled,everyTasks}`(Task 2)被 Task 5 各处读取一致;`loadLeadState/saveLeadState/clearLeadState`(Task 1)签名在 Task 5 调用一致。✓

**潜在核对项**(实现时必看真实代码):Task 6 的 `parse.ts` 导出函数名、`commands.ts` 子命令候选数组位置、`app.tsx` action 分发处与 `setStatus`/`admin` 真实签名——均为既有模式,实现者按文件现状对齐。
