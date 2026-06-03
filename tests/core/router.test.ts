import { beforeEach, expect, test, vi } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup(routes?: Record<string, string>) {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = {
    deliver: (agent, msg) => delivered.push({ agent, msg }),
  };
  let n = 0;
  const router = new Router(deliverer, {
    now: () => 1000,
    genId: () => `m${++n}`,
    routes,
  });
  router.addAgent('alice');
  router.addAgent('bob', 'dev');
  return { router, delivered };
}

test('register marks agent idle and stores sessionId', () => {
  const { router } = setup();
  router.register('alice', 'SID-A');
  const a = router.get('alice')!;
  expect(a.status).toBe('idle');
  expect(a.sessionId).toBe('SID-A');
});

test('send to an idle agent delivers immediately and marks busy', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  const msg = router.send('alice', 'bob', 'hello');
  expect(msg?.id).toBe('m1');
  expect(delivered).toHaveLength(1);
  expect(delivered[0].msg.body).toBe('hello');
  expect(router.get('bob')!.status).toBe('busy');
  expect(router.get('bob')!.inbox).toHaveLength(0);
});

test('send to a busy agent queues in inbox without delivering', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.send('alice', 'bob', 'first');
  router.send('alice', 'bob', 'second');
  expect(delivered).toHaveLength(1);
  expect(router.get('bob')!.inbox).toHaveLength(1);
});

test('onIdle delivers the next queued message', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.send('alice', 'bob', 'first');
  router.send('alice', 'bob', 'second');
  router.onIdle('bob');
  expect(delivered).toHaveLength(2);
  expect(delivered[1].msg.body).toBe('second');
  expect(router.get('bob')!.status).toBe('busy');
});

test('send to a launching (not yet registered) agent queues until register', () => {
  const { router, delivered } = setup();
  router.send('alice', 'bob', 'early');
  expect(delivered).toHaveLength(0);
  expect(router.get('bob')!.inbox).toHaveLength(1);
  router.register('bob', 'SID-B');
  expect(delivered).toHaveLength(1);
});

test('role name resolves via routes table', () => {
  const { router, delivered } = setup({ manager: 'alice' });
  router.register('alice', 'SID-A');
  const msg = router.send('bob', 'manager', 'hi boss');
  expect(msg?.to).toBe('alice');
  expect(delivered[0].agent.name).toBe('alice');
});

test('send to unknown target returns undefined and delivers nothing', () => {
  const { router, delivered } = setup();
  expect(router.send('alice', 'nobody', 'x')).toBeUndefined();
  expect(delivered).toHaveLength(0);
});

test('send to a dead agent is dropped', () => {
  const { router, delivered } = setup();
  router.register('bob', 'SID-B');
  router.markDead('bob');
  expect(router.send('alice', 'bob', 'x')).toBeUndefined();
  expect(delivered).toHaveLength(0);
});
