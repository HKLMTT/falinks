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
    workersReady: () => true,
    announceWorkersTimeout: () => {},
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
  // K=2, 3 tasks: taskdone #1 → counter=1 (no reset), stop, resume → redispatch must NOT fire resetLead
  const { e, order } = mk(2);
  e.add('a'); e.add('b'); e.add('c');
  e.start(undefined, true); // counter=0, dispatch a
  e.taskdone(1, 'done', ''); // counter=1, dispatch b (counter<K=2, no resetLead)
  e.stop();
  // Clear recorded order so far, then resume and verify no resetLead added
  const orderBeforeResume = order.length;
  e.resume(true); // redispatch(isResend=true): must NOT trigger resetLead
  expect(order.slice(orderBeforeResume).filter((x) => x === 'resetLead')).toEqual([]);

  // Variant: push counter to exactly K via second taskdone while paused, then resume — still no resetLead from resume itself
  const { e: e2, order: order2 } = mk(2);
  e2.add('x'); e2.add('y'); e2.add('z');
  e2.start(undefined, true);         // counter=0, dispatch x
  e2.taskdone(1, 'done', '');        // counter=1, dispatch y (no reset)
  e2.taskdone(2, 'done', '');        // counter=2 → resetLead fires here (dispatchNext isResend=false)
  e2.stop();                          // now counter=0 (was zeroed after reset), paused
  // Accumulate one more completion while paused to bring counter back up, but we can't taskdone while paused without running
  // Instead: confirm the stop→resume path (redispatch=isResend=true) never emits resetLead
  const beforeResume2 = order2.length;
  e2.resume(true);
  expect(order2.slice(beforeResume2).filter((x) => x === 'resetLead')).toEqual([]);
});

test('clear 触发 wipeLeadMemory 并归零计数', () => {
  const { e, order } = mk(5);
  e.add('a'); e.add('b'); e.start(undefined, true);
  e.taskdone(1, 'done', '');   // 计数=1
  e.stop();                    // clear 仅 paused/非 running 可用
  e.clear();
  expect(order).toContain('wipeLeadMemory');
  // 直接断言计数已归零
  expect(e.state().completedSinceLeadReset).toBe(0);
});

test('add 续单(finished→idle)归零 lead 重置计数:新批次须满 K 才触发', () => {
  // Run 1-task list to completion (state→finished, counter=1)
  // Then add a new task + start; with K=2 the resetLead must NOT fire until 2 NEW completions
  const { e, order } = mk(2);
  e.add('first');
  e.start(undefined, true);       // counter=0, dispatch first
  e.taskdone(1, 'done', '');      // counter=1 → finished (only 1 task, no more pending)
  // Verify state is finished and counter is non-zero before add
  expect(e.state().state).toBe('finished');
  expect((e.state().completedSinceLeadReset ?? 0)).toBeGreaterThan(0);

  // add() should clear stale count
  e.add('second');                // finished→idle, must zero completedSinceLeadReset
  e.start(undefined, true);       // dispatch second (counter=0 after zeroing, no resetLead yet)

  const orderBeforeNew = order.length;
  e.taskdone(2, 'done', '');      // counter becomes 1 → finished (only 1 task in new batch)
  // Only 1 completion in new batch (K=2): resetLead must NOT have fired
  expect(order.slice(orderBeforeNew).filter((x) => x === 'resetLead')).toEqual([]);

  // Now do a fresh batch with 2 tasks to confirm the counter truly starts from 0
  const { e: e2, order: order2 } = mk(2);
  e2.add('t1');
  e2.start(undefined, true);
  e2.taskdone(1, 'done', '');     // counter=1, state→finished
  e2.add('t2'); e2.add('t3');    // finished→idle, counter zeroed; add 2 more
  e2.start(undefined, true);     // dispatch t2 (counter=0)
  e2.taskdone(2, 'done', '');    // counter=1, dispatch t3 (no reset, 1 < K=2)
  const beforeReset = order2.length;
  e2.taskdone(3, 'done', '');    // counter=2 ≥ K → resetLead fires BEFORE dispatch of next (but there's no next → finished)
  // Actually at this point state→finished (no more pending). The reset fires inside dispatchNext when counter>=K
  // counter=2>=K=2 but there's no next task after t3 → dispatchNext finds no pending → finished branch runs before reset check
  // Let's add a 4th task to ensure a dispatchNext with isResend=false is reached
  const { e: e3, order: order3 } = mk(2);
  e3.add('a1');
  e3.start(undefined, true);
  e3.taskdone(1, 'done', '');    // finished, counter=1
  // add 3 tasks after finished: counter should be zeroed by add()
  e3.add('b1'); e3.add('b2'); e3.add('b3');
  e3.start(undefined, true);     // dispatch b1, counter=0
  e3.taskdone(2, 'done', '');   // counter=1, dispatch b2
  const snap = order3.filter((x) => x === 'resetLead');
  expect(snap).toEqual([]);      // K=2, only 1 new completion so far → no reset yet
  e3.taskdone(3, 'done', '');   // counter=2 ≥ K → resetLead, then dispatch b3
  expect(order3.filter((x) => x === 'resetLead')).toEqual(['resetLead']); // exactly one reset, from new batch
});
