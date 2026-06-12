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
