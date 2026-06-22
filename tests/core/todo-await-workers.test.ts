// tests/core/todo-await-workers.test.ts
// 派发新任务前先 clear 员工、等全员就绪再派给 lead;就绪/超时由 tick 轮询驱动。
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';

function mk(opts?: { ready?: () => boolean }) {
  let now = 0;
  let nextId = 0;
  const order: string[] = [];
  const calls = { dispatch: 0, reset: 0, timeout: 0 };
  let ready = opts?.ready ?? (() => true);
  const e = new TodoEngine({
    now: () => now,
    dispatch: () => { order.push('dispatch'); calls.dispatch++; return `m${++nextId}`; },
    nudge: () => { order.push('nudge'); return true; },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceWorkersTimeout: () => { calls.timeout++; },
    announceSendFailing: () => {},
    announceWaiting: () => {},
    announceStalled: () => {},
    resetWorkers: () => { order.push('reset'); calls.reset++; },
    workersReady: () => ready(),
    resetLead: () => {},
    wipeLeadMemory: () => {},
    leadResetEvery: () => 0,
    removedByBossText: () => 'removed',
    persist: () => {},
  });
  return { e, order, calls, setNow: (v: number) => { now = v; }, setReady: (fn: () => boolean) => { ready = fn; } };
}
const MIN = 60_000;

test('start:员工未就绪时 reset 已触发但 dispatch 推迟,直到 tick 见就绪才派发', () => {
  const { e, order, calls, setReady } = mk({ ready: () => false });
  e.add('a');
  e.start(undefined, true);
  expect(order).toEqual(['reset']);   // 已 clear 员工,但还没派给 lead
  expect(calls.dispatch).toBe(0);

  e.tick(false, true);                // 仍未就绪 → 继续等
  expect(calls.dispatch).toBe(0);

  setReady(() => true);
  e.tick(false, true);                // 全员就绪 → 派发
  expect(order).toEqual(['reset', 'dispatch']);
  expect(calls.dispatch).toBe(1);
  expect(calls.timeout).toBe(0);
});

test('就绪超时(60s)仍未就绪:公告一次后照常派发', () => {
  const { e, calls, setNow } = mk({ ready: () => false });
  e.add('a');
  e.start(undefined, true);           // awaitingSince=0
  expect(calls.dispatch).toBe(0);

  setNow(59 * 1000); e.tick(false, true);
  expect(calls.dispatch).toBe(0);     // 未到 60s

  setNow(60 * 1000); e.tick(false, true);
  expect(calls.dispatch).toBe(1);     // 超时兜底派发
  expect(calls.timeout).toBe(1);      // 公告一次
});

test('员工本就就绪:start 即派发,无需等 tick', () => {
  const { e, order, calls } = mk({ ready: () => true });
  e.add('a');
  e.start(undefined, true);
  expect(order).toEqual(['reset', 'dispatch']);
  expect(calls.dispatch).toBe(1);
});

test('resume/redispatch(isResend)不设就绪门:即使员工未就绪也立即重发', () => {
  const { e, calls, setReady } = mk({ ready: () => true });
  e.add('a');
  e.start(undefined, true);           // 就绪 → dispatch(1)
  e.stop();
  setReady(() => false);              // 员工此刻不就绪
  e.resume(true);                     // redispatch:不等就绪,立即重发
  expect(calls.dispatch).toBe(2);
});

test('每完成一条推进下一条也走就绪门', () => {
  const { e, calls, setReady } = mk({ ready: () => false });
  e.add('a'); e.add('b');
  e.start(undefined, true);
  setReady(() => true); e.tick(false, true);  // 派发 #1
  expect(calls.dispatch).toBe(1);
  setReady(() => false);
  e.taskdone(1, 'done', 'ok');                // 推进 #2:reset 又触发,dispatch 推迟
  expect(calls.dispatch).toBe(1);
  setReady(() => true); e.tick(false, true);  // 派发 #2
  expect(calls.dispatch).toBe(2);
});

test('await 期间 redispatchCurrent(换 lead)为 no-op:就绪门触发时自然派给当时的 lead', () => {
  const { e, calls, setReady } = mk({ ready: () => false });
  e.add('a');
  e.start(undefined, true);   // awaitingWorkers,未派发
  e.redispatchCurrent(true);  // await 期间换 lead:不应强制立即派发(否则绕过就绪门)
  expect(calls.dispatch).toBe(0);
  setReady(() => true);
  e.tick(false, true);        // 就绪门触发,仅派发一次
  expect(calls.dispatch).toBe(1);
});

test('await 期间 lead 短暂掉线再回来:仍尊重就绪门,不在员工没就绪时立刻重发', () => {
  const { e, calls, setReady } = mk({ ready: () => false });
  e.add('a');
  e.start(undefined, true);   // awaitingWorkers,未派发
  expect(calls.dispatch).toBe(0);
  e.tick(false, false);       // lead 掉线 → suspended
  e.tick(false, true);        // lead 回来:仍 awaitingWorkers + 员工未就绪 → 不立刻重发
  expect(calls.dispatch).toBe(0);
  setReady(() => true);
  e.tick(false, true);        // 员工就绪 → 派发(仅一次)
  expect(calls.dispatch).toBe(1);
});
