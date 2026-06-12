import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';
import { Guards } from '../../src/core/guards.js';

function makeRouter(guards?: Guards) {
  const delivered: Message[] = [];
  const deliverer: Deliverer = { deliver: (_a: AgentRuntime, m: Message) => { delivered.push(m); } };
  let n = 0;
  const r = new Router(deliverer, { now: () => 1, genId: () => `m${++n}`, guards });
  r.addVirtual('boss');
  r.addAgent('dev');
  r.register('dev', 's1'); // idle
  return { r, delivered };
}

test('urgent+目标 busy:立即投递,inbox 不变,状态机不动(handling 不被改写)', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');                 // idle → 即时投递,dev busy
  const q = r.send('boss', 'dev', 'queued-1')!;    // 排队
  const handling = r.get('dev')!.handling;
  const handlingFrom = r.get('dev')!.handlingFrom;

  const u = r.send('boss', 'dev', 'cut-in', { urgent: true })!;
  expect(u.urgent).toBe(true);
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in']); // 立即出去,不等空闲
  expect(r.get('dev')!.status).toBe('busy');
  expect(r.get('dev')!.handling).toBe(handling);         // 在办的线程跟踪不被插队改写
  expect(r.get('dev')!.handlingFrom).toBe(handlingFrom);
  expect(r.queuedMessageIds().has(q.id)).toBe(true);     // 旧排队消息原地不动
  expect(r.queuedMessageIds().has(u.id)).toBe(false);    // urgent 从不入队

  r.onIdle('dev'); // 干完 → pump 排队那条
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in', 'queued-1']);
});

test('urgent+目标 idle:等价普通发送(置 busy、设 handling)', () => {
  const { r, delivered } = makeRouter();
  const u = r.send('boss', 'dev', 'hello', { urgent: true })!;
  expect(u.urgent).toBe(true);
  expect(delivered.map((m) => m.body)).toEqual(['hello']);
  const dev = r.get('dev')!;
  expect(dev.status).toBe('busy');
  expect(dev.handlingFrom).toBe('boss');
});

test('urgent+目标 stuck:直送(stuck 视同忙,不动状态)', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');
  r.markStuck('dev');
  r.send('boss', 'dev', 'cut-in', { urgent: true });
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'cut-in']);
  expect(r.get('dev')!.status).toBe('stuck');
});

test('urgent+目标 launching:退化为正常排队,消息不带 urgent 标', () => {
  const { r, delivered } = makeRouter();
  r.addAgent('newbie'); // launching,未 register
  const m = r.send('boss', 'newbie', 'early', { urgent: true })!;
  expect(m.urgent).toBeUndefined();                  // 没直送就别标 ⚡(控制台如实显示 ⏳)
  expect(delivered).toEqual([]);
  expect(r.queuedMessageIds().has(m.id)).toBe(true); // 在队列里,register 后照常 pump
  r.register('newbie', 's2');
  expect(delivered.map((m2) => m2.body)).toEqual(['early']);
});

test('urgent+目标 dead:拒绝(返回 undefined)', () => {
  const { r } = makeRouter();
  r.markDead('dev');
  expect(r.send('boss', 'dev', 'x', { urgent: true })).toBeUndefined();
});

test('urgent 仍受限流护栏约束', () => {
  const { r, delivered } = makeRouter(new Guards({ maxTurnsPerThread: 100, maxInjectionsPerMinute: 1, loopWindow: 3 }, () => 1));
  r.send('boss', 'dev', 'first');                                       // 用掉额度
  expect(r.send('boss', 'dev', 'cut-in', { urgent: true })).toBeUndefined(); // 限流照拦
  expect(delivered.map((m) => m.body)).toEqual(['first']);
});

test('urgent 发给虚拟成员(boss):只记日志不投递,不标 urgent', () => {
  const { r, delivered } = makeRouter();
  const m = r.send('dev', 'boss', 'report', { urgent: true })!;
  expect(m).toBeDefined();
  expect(m.urgent).toBeUndefined();
  expect(delivered).toEqual([]);
});
