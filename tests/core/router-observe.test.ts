import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';

function setup() {
  const deliverer: Deliverer = { deliver: () => {} };
  let n = 0;
  const router = new Router(deliverer, { now: () => 1000, genId: () => `m${++n}` });
  router.addAgent('alice');
  return router;
}

test('observeBusy:idle 升 busy(干活却显示空闲时校准)', () => {
  const router = setup();
  router.register('alice', 'SID'); // → idle
  router.observeBusy('alice');
  expect(router.get('alice')!.status).toBe('busy');
});

test('observeBusy:非 idle(launching/busy/dead)不动', () => {
  const router = setup();
  expect(router.get('alice')!.status).toBe('launching');
  router.observeBusy('alice'); // launching 不动
  expect(router.get('alice')!.status).toBe('launching');

  router.register('alice', 'SID');
  router.markDead('alice');
  router.observeBusy('alice'); // dead 不动
  expect(router.get('alice')!.status).toBe('dead');
});

test('observeBusy:未知员工无操作', () => {
  const router = setup();
  expect(() => router.observeBusy('ghost')).not.toThrow();
});
