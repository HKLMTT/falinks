// tests/core/todo-backoff.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';

function mk(nudgeResult: (callIndex: number) => boolean = () => true) {
  let now = 0;
  let nextId = 0;
  const calls = {
    nudge: [] as { seq: number; fruitless: number; nextMinutes: number }[],
    stalled: [] as { seq: number; n: number; intervalMinutes: number }[],
  };
  const e = new TodoEngine({
    now: () => now,
    dispatch: () => `msg${++nextId}`,
    nudge: (t, _pos, _total, info) => { calls.nudge.push({ seq: t.seq, fruitless: info.fruitless, nextMinutes: info.nextMinutes }); return nudgeResult(calls.nudge.length - 1); },
    cancelQueued: () => {},
    announceSummary: () => {},
    announceSuspended: () => {},
    announceSendFailing: () => {},
    announceWaiting: () => {},
    announceStalled: (t, n, intervalMinutes) => { calls.stalled.push({ seq: t.seq, n, intervalMinutes }); },
    resetWorkers: () => {},
    resetLead: () => {},
    wipeLeadMemory: () => {},
    leadResetEvery: () => 0,
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

test('第 3 次巡查发送失败:失败不计无果,重试成功后边沿仍恰好触发一次', () => {
  const { e, calls, setNow } = mk((i) => i !== 2); // 第 3 次(下标 2)返回 false,其余 true
  e.add('a'); e.start(undefined, true);
  idleUntil(e, setNow, 1, 200);
  // 10(fruitless 0)→ 30(1)→ 70(2,发送失败)→ 71(2,立即重试成功)→ 之后按 +60 推进
  const third = calls.nudge[2], retry = calls.nudge[3];
  expect(third.fruitless).toBe(2);
  expect(retry.fruitless).toBe(2); // 发送失败不 ++:重试携带同一无果计数
  expect(calls.stalled.length).toBe(1); // 重试成功后边沿告警仍只触发一次
  expect(calls.stalled[0]).toEqual({ seq: 1, n: 3, intervalMinutes: 60 });
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
