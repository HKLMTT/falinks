import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function setup() {
  const delivered: { agent: AgentRuntime; msg: Message }[] = [];
  const deliverer: Deliverer = { deliver: (agent, msgs) => { for (const msg of msgs) delivered.push({ agent, msg }); } };
  let n = 0;
  const router = new Router(deliverer, { now: () => 1, genId: () => `m${++n}` });
  router.addAgent('alice');
  router.register('alice', 'SA');
  router.addVirtual('boss');
  return { router, delivered };
}

test('addVirtual registers an idle, window-less member', () => {
  const { router } = setup();
  const b = router.get('boss')!;
  expect(b.status).toBe('idle');
  expect(b.virtual).toBe(true);
  expect(b.sessionId).toBeUndefined();
});

test('sending to a virtual member logs but does NOT deliver/inject', () => {
  const { router, delivered } = setup();
  const msg = router.send('alice', 'boss', 'here is my reply');
  expect(msg).toBeTruthy();
  expect(delivered).toHaveLength(0);
  expect(router.get('boss')!.status).toBe('idle');
  expect(router.messages().some((m) => m.to === 'boss' && m.body === 'here is my reply')).toBe(true);
});

test('messages() records all successful sends in order', () => {
  const { router } = setup();
  router.send('boss', 'alice', 'task one');
  router.send('alice', 'boss', 'done');
  const log = router.messages();
  expect(log.map((m) => `${m.from}->${m.to}:${m.body}`)).toEqual([
    'boss->alice:task one',
    'alice->boss:done',
  ]);
});

test('clearLog 清空消息流水(boss 历史)', () => {
  const { router } = setup();
  router.send('boss', 'alice', 'task one');
  router.send('alice', 'boss', 'done');
  expect(router.messages().length).toBe(2);
  router.clearLog();
  expect(router.messages()).toEqual([]);
});

test('setLead 设一个为 lead、其余清零;再设别人则前者取消(全队唯一)', () => {
  const { router } = setup();
  router.addAgent('bob');
  router.setLead('alice');
  expect(router.get('alice')!.lead).toBe(true);
  expect(router.get('bob')!.lead).toBeFalsy();
  router.setLead('bob');
  expect(router.get('bob')!.lead).toBe(true);
  expect(router.get('alice')!.lead).toBeFalsy(); // 旧 lead 被取消
});

test('sending to a real member still delivers (regression)', () => {
  const { router, delivered } = setup();
  router.send('boss', 'alice', 'hi');
  expect(delivered).toHaveLength(1);
  expect(delivered[0].agent.name).toBe('alice');
});
