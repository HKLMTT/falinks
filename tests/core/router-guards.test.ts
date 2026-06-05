import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import { Guards } from '../../src/core/guards.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup(guardCfg = { maxTurnsPerThread: 3, maxInjectionsPerMinute: 100, loopWindow: 3 }, now: () => number = () => 0) {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = { deliver: (agent, msg) => delivered.push({ agent, msg }) };
  let n = 0;
  const guards = new Guards(guardCfg, now);
  const router = new Router(deliverer, { now: () => 0, genId: () => `m${++n}`, guards });
  router.addAgent('alice');
  router.addAgent('bob');
  router.register('alice', 'SA');
  router.register('bob', 'SB');
  return { router, delivered, guards };
}

test('a delivered message sets the recipient handling-thread', () => {
  const { router, delivered } = setup();
  router.send('system', 'alice', 'seed');
  const t = delivered[0].msg.thread!;
  expect(t).toBeTruthy();
  expect(router.get('alice')!.handling).toBe(t);
});

test('同一对 A↔B 来回用同一 thread', () => {
  const { router } = setup();
  const seed = router.send('bob', 'alice', 'seed');
  const reply = router.send('alice', 'bob', 'hi bob');
  expect(reply!.thread).toBe(seed!.thread);
});

test('扇出给不同对象各自独立 thread（cap=1 也都成功，不被静默丢弃）', () => {
  const { router } = setup({ maxTurnsPerThread: 1, maxInjectionsPerMinute: 100, loopWindow: 99 });
  router.addAgent('carol'); router.register('carol', 'SC');
  router.addAgent('dave'); router.register('dave', 'SD');
  const a = router.send('alice', 'carol', 'task1');
  const b = router.send('alice', 'dave', 'task2');
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a!.thread).not.toBe(b!.thread);
});

test('boss(虚拟)连发多条不会撞回合上限（每次都是新线程，人发起的长对话不被丢）', () => {
  const { router } = setup({ maxTurnsPerThread: 1, maxInjectionsPerMinute: 100, loopWindow: 99 });
  router.addVirtual('boss');
  expect(router.send('boss', 'alice', '需求1')).toBeTruthy();
  expect(router.send('boss', 'alice', '需求2')).toBeTruthy();
  expect(router.send('boss', 'alice', '需求3')).toBeTruthy();
});

test('turn-cap 在同一对上累计：超过上限后丢弃（循环保护仍在）', () => {
  const { router } = setup({ maxTurnsPerThread: 2, maxInjectionsPerMinute: 100, loopWindow: 99 });
  expect(router.send('alice', 'bob', 'm1')).toBeTruthy();    // pair(alice,bob) 第1回合
  expect(router.send('bob', 'alice', 'm2')).toBeTruthy();    // 同一对 第2回合
  expect(router.send('alice', 'bob', 'm3')).toBeUndefined(); // 同一对 第3回合 > 2
});

test('rate limit breaks send when exceeded', () => {
  const { router } = setup({ maxTurnsPerThread: 99, maxInjectionsPerMinute: 1, loopWindow: 99 });
  expect(router.send('system', 'alice', 'a')).toBeTruthy();
  expect(router.send('system', 'bob', 'b')).toBeUndefined();
});

test('onIdle clears handling thread', () => {
  const { router } = setup();
  router.send('system', 'alice', 'seed');
  expect(router.get('alice')!.handling).toBeTruthy();
  router.onIdle('alice');
  expect(router.get('alice')!.handling).toBeUndefined();
});
