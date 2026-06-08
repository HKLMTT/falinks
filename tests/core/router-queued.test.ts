import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';

function setup() {
  const deliverer: Deliverer = { deliver: () => {} };
  let n = 0;
  const router = new Router(deliverer, { now: () => 1000, genId: () => `m${++n}` });
  router.addAgent('alice');
  router.register('alice', 'SID'); // → idle
  return router;
}

test('queuedMessageIds:投给空闲员工的消息即时投递,不进队列', () => {
  const router = setup();
  router.send('boss', 'alice', 'first'); // alice idle → 即时投递 → busy,inbox 空
  expect(router.queuedMessageIds().size).toBe(0);
});

test('queuedMessageIds:投给忙碌员工的消息留在 inbox,id 进队列;投出后清空', () => {
  const router = setup();
  const m1 = router.send('boss', 'alice', 'first')!;  // 即时投递 → alice busy
  const m2 = router.send('boss', 'alice', 'second')!; // alice busy → 入队
  expect(router.queuedMessageIds().has(m1.id)).toBe(false); // 已投递
  expect(router.queuedMessageIds().has(m2.id)).toBe(true);  // 排队中

  router.onIdle('alice'); // 干完 → pump 投出 m2
  expect(router.queuedMessageIds().size).toBe(0);
});

test('queuedMessageIds:无队列时返回空集合', () => {
  const router = setup();
  expect(router.queuedMessageIds().size).toBe(0);
});
