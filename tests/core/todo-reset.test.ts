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
    resetLead: () => {},
    wipeLeadMemory: () => {},
    leadResetEvery: () => 0,
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
