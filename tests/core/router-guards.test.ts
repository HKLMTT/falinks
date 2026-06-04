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

test('reply from a handling agent inherits the same thread', () => {
  const { router } = setup();
  router.send('system', 'alice', 'seed');
  const t = router.get('alice')!.handling!;
  const msg = router.send('alice', 'bob', 'hi bob');
  expect(msg!.thread).toBe(t);
});

test('turn-cap breaks the thread: send returns undefined after the cap', () => {
  const { router } = setup({ maxTurnsPerThread: 2, maxInjectionsPerMinute: 100, loopWindow: 99 });
  router.send('system', 'alice', 'm1');
  expect(router.send('alice', 'bob', 'm2')).toBeTruthy();
  expect(router.send('alice', 'bob', 'm3')).toBeUndefined();
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
