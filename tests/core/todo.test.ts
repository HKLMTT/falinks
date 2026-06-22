// tests/core/todo.test.ts
import { expect, test } from 'vitest';
import { TodoEngine } from '../../src/core/todo.js';
import type { TodoState } from '../../src/todo-store.js';

function mk(initial?: TodoState) {
  let now = 0;
  let nextId = 0;
  const calls = {
    dispatch: [] as { seq: number; pos: number; isResend: boolean }[],
    nudge: [] as { seq: number; pos: number }[],
    cancel: [] as string[],
    summary: 0, suspended: 0, sendFailing: 0,
    persist: 0,
  };
  let sendOk = true; // false 模拟守卫丢弃
  const e = new TodoEngine({
    now: () => now,
    dispatch: (t, pos, _total, isResend) => { calls.dispatch.push({ seq: t.seq, pos, isResend }); return sendOk ? `msg${++nextId}` : undefined; },
    nudge: (t, pos) => { calls.nudge.push({ seq: t.seq, pos }); return sendOk; },
    cancelQueued: (id) => { calls.cancel.push(id); },
    announceSummary: () => { calls.summary++; },
    announceSuspended: () => { calls.suspended++; },
    announceSendFailing: () => { calls.sendFailing++; },
    announceWaiting: () => {},
    announceStalled: () => {},
    resetWorkers: () => {},
    workersReady: () => true,
    announceWorkersTimeout: () => {},
    resetLead: () => {},
    wipeLeadMemory: () => {},
    leadResetEvery: () => 0,
    removedByBossText: () => 'removed',
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
  expect(calls.dispatch).toEqual([{ seq: 1, pos: 1, isResend: false }, { seq: 1, pos: 1, isResend: true }]);
});

test('巡查:无人忙满 N 触发 nudge 并重置;有人忙/下发/巡查后计时重置;永不放弃(无果后间隔退避)', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(undefined, true); // N 默认 10 分钟
  setNow(5 * MIN); e.tick(false, true);
  expect(calls.nudge.length).toBe(0); // 未满 N(下发时刻重置过)
  setNow(10 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([{ seq: 1, pos: 1 }]);   // 满 N 巡查
  setNow(15 * MIN); e.tick(true, true);   // 有人忙 → 重置(已 1 次无果,间隔退避为 20)
  setNow(34 * MIN); e.tick(false, true);  // 距重置 19 分钟,未满 20
  expect(calls.nudge.length).toBe(1);
  setNow(35 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([{ seq: 1, pos: 1 }, { seq: 1, pos: 1 }]); // 永不放弃,再问
});

test('start 可指定 N', () => {
  const { e, calls, setNow } = mk();
  e.add('a'); e.start(2, true);
  setNow(2 * MIN + 1); e.tick(false, true);
  expect(calls.nudge).toEqual([{ seq: 1, pos: 1 }]);
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
  expect(calls.dispatch).toEqual([{ seq: 1, pos: 1, isResend: false }, { seq: 1, pos: 1, isResend: true }]);
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

test('重启:载入 running 状态后,首个有 lead 的 tick 重发 current(不必等 nudge);无 lead 不公告', () => {
  const initial: TodoState = { state: 'running', nudgeMinutes: 10, tasks: [{ seq: 1, body: 'a', status: 'current' }] };
  const { e, calls } = mk(initial);
  expect(calls.dispatch.length).toBe(0); // 构造不派发
  e.tick(false, false);                  // 无 lead:不派发,且不公告(构造已置 suspended)
  expect(calls.dispatch.length).toBe(0);
  expect(calls.suspended).toBe(0);
  e.tick(false, true);                   // lead 在场:redispatch current(isResend)
  expect(calls.dispatch).toEqual([{ seq: 1, pos: 1, isResend: true }]);
});

test('redispatchCurrent:running+有 lead 撤旧排队重发 current;非 running/无 lead 为 no-op', () => {
  const { e, calls } = mk();
  e.add('a'); e.start(undefined, true);  // dispatch #1 (isResend=false), lastDispatchId=msg1
  e.redispatchCurrent(true);             // 换 lead:撤 msg1,重发 current(isResend=true)
  expect(calls.cancel).toEqual(['msg1']);
  expect(calls.dispatch).toEqual([{ seq: 1, pos: 1, isResend: false }, { seq: 1, pos: 1, isResend: true }]);
  const before = calls.dispatch.length;
  e.redispatchCurrent(false);            // 无 lead:no-op
  expect(calls.dispatch.length).toBe(before);
});

test('redispatchCurrent:idle(未 start)为 no-op', () => {
  const { e, calls } = mk();
  e.add('a');
  e.redispatchCurrent(true);
  expect(calls.dispatch.length).toBe(0);
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

test('paused 态 rm current 与 clear 都撤掉仍在排队的旧下发', () => {
  const { e, calls } = mk();
  e.add('a'); e.start(undefined, true); e.stop();
  e.rm(1);
  expect(calls.cancel).toEqual(['msg1']);
  e.add('b'); e.start(undefined, true); e.stop();
  e.clear();
  expect(calls.cancel).toEqual(['msg1', 'msg2']);
});

test('paused 态 rm 掉最后的 current → finished+汇总;随后 add 清旧账', () => {
  const { e, calls } = mk();
  e.add('a'); e.add('b'); e.start(undefined, true);
  e.taskdone(1, 'done', 'x');
  e.stop();
  e.rm(2); // 脱困:标 failed,无剩余 → 终结本轮
  expect(e.state().state).toBe('finished');
  expect(calls.summary).toBe(1);
  e.add('c'); // finished+add → 清旧账转 idle
  expect(e.state().tasks.map((t) => t.body)).toEqual(['c']);
});

test('finished+add 清旧账后再 start:dispatch 收到 pos=1(seq 已是更大值)', () => {
  const { e, calls } = mk();
  // 跑完第一批(seq 1)
  e.add('a'); e.start(undefined, true); e.taskdone(1, 'done', 'x');
  expect(e.state().state).toBe('finished');
  // 清旧账加新任务(seq 2),start 后 dispatch 应 pos=1、seq=2
  e.add('new-task');
  e.start(undefined, true);
  const last = calls.dispatch[calls.dispatch.length - 1];
  expect(last.pos).toBe(1);   // 显示用位置:第 1 条(新清单)
  expect(last.seq).toBe(2);   // id 不归零:seq=2
});

test('start 拒绝非法巡查间隔(0/负/NaN/小数)', () => {
  const { e } = mk();
  e.add('a');
  expect(e.start(0, true).ok).toBe(false);
  expect(e.start(-5, true).ok).toBe(false);
  expect(e.start(Number.NaN, true).ok).toBe(false);
  expect(e.start(2.5, true).ok).toBe(false);
  expect(e.start(2, true).ok).toBe(true);
});

// —— plan(批量建单,lead 经 MCP 调用)——
test('plan:空 idle 直接建,seq 连续,一次 persist,返回 seqs', () => {
  const { e, calls } = mk();
  const before = calls.persist;
  const r = e.plan(['a', 'b', 'c'], false);
  expect(r).toEqual({ ok: true, seqs: [1, 2, 3] });
  expect(e.state().tasks.map((t) => t.status)).toEqual(['pending', 'pending', 'pending']);
  expect(calls.persist).toBe(before + 1); // 原子:整批一次落盘
});

test('plan:空数组/空白条目原子拒绝,不部分写入', () => {
  const { e } = mk();
  expect(e.plan([], false).ok).toBe(false);
  expect(e.plan(['a', '   ', 'c'], false).ok).toBe(false);
  expect(e.state().tasks).toEqual([]); // 一条都没进
});

test('plan:running/paused 拒绝', () => {
  const { e } = mk();
  e.add('x'); e.start(undefined, true);
  expect(e.plan(['a'], false).ok).toBe(false);
  e.stop();
  expect(e.plan(['a'], false).ok).toBe(false);
});

test('plan:finished 自动清旧账后建(与 add 语义一致)', () => {
  const { e } = mk();
  e.add('x'); e.start(undefined, true); e.taskdone(1, 'done', 'ok'); // → finished
  const r = e.plan(['a', 'b'], false);
  expect(r.ok).toBe(true);
  expect(e.state().state).toBe('idle');
  expect(e.state().tasks.map((t) => t.body)).toEqual(['a', 'b']); // 旧账清掉
});

test('plan:idle 非空默认拒绝(防覆盖 boss 手动单),replace:true 清空后建', () => {
  const { e } = mk();
  e.add('boss 手动加的');
  const rejected = e.plan(['a'], false);
  expect(rejected.ok).toBe(false);
  expect((rejected as { ok: false; error: string }).error).toMatch(/replace/);
  const r = e.plan(['a', 'b'], true);
  expect(r.ok).toBe(true);
  expect(e.state().tasks.map((t) => t.body)).toEqual(['a', 'b']);
});

test('plan:replace 后 seq 仍单调不复用', () => {
  const { e } = mk();
  e.add('x'); // seq 1
  const r = e.plan(['a'], true);
  expect(r).toEqual({ ok: true, seqs: [2] });
});
