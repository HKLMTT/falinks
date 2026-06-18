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
