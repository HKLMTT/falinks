import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup() {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = { deliver: (agent, msg) => delivered.push({ agent, msg }) };
  let n = 0;
  const router = new Router(deliverer, { now: () => 1000, genId: () => `m${++n}` });
  router.addVirtual('boss');
  router.addAgent('alice');
  router.addAgent('bob', 'dev');
  router.register('alice', 'SID-A'); // → idle
  return { router, delivered };
}

test('boss 消息插到普通排队消息之前：忙碌员工干完手头这条后先取 boss 的', () => {
  const { router, delivered } = setup();
  router.send('boss', 'alice', 'kickoff'); // alice idle → 即时投递 → busy
  router.send('bob', 'alice', 'agent-msg'); // alice busy → 入队(普通)
  router.send('boss', 'alice', 'urgent');   // alice busy → 插队到队首

  expect(router.get('alice')!.inbox.map((m) => m.body)).toEqual(['urgent', 'agent-msg']);

  router.onIdle('alice'); // 干完 kickoff → pump 取出队首
  expect(delivered.at(-1)!.msg.body).toBe('urgent'); // boss 的先投
});

test('多条 boss 消息保持彼此的 FIFO 顺序，都排在普通消息之前', () => {
  const { router } = setup();
  router.send('boss', 'alice', 'kickoff'); // 即时投递 → busy
  router.send('bob', 'alice', 'agent-msg'); // 普通入队
  router.send('boss', 'alice', 'boss-1');   // 插队
  router.send('boss', 'alice', 'boss-2');   // 插到 boss-1 之后、普通之前

  expect(router.get('alice')!.inbox.map((m) => m.body)).toEqual(['boss-1', 'boss-2', 'agent-msg']);
});

test('boss 消息发给空闲员工仍即时投递（行为不变）', () => {
  const { router, delivered } = setup();
  const msg = router.send('boss', 'alice', 'hi');
  expect(delivered).toHaveLength(1);
  expect(delivered[0].msg.body).toBe('hi');
  expect(router.get('alice')!.inbox).toHaveLength(0);
  expect(msg!.priority).toBe(true);
});

test('普通 agent→agent 消息不插队，排到队尾（行为不变）', () => {
  const { router } = setup();
  router.send('bob', 'alice', 'first');  // 即时投递 → busy
  router.send('bob', 'alice', 'second'); // 普通入队
  router.send('bob', 'alice', 'third');  // 普通入队 → 队尾

  const inbox = router.get('alice')!.inbox;
  expect(inbox.map((m) => m.body)).toEqual(['second', 'third']);
  expect(inbox.every((m) => !m.priority)).toBe(true);
});
