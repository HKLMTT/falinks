import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function makeRouter() {
  const delivered: Message[] = [];
  const deliverer: Deliverer = { deliver: (_a: AgentRuntime, m: Message) => { delivered.push(m); } };
  let n = 0;
  const r = new Router(deliverer, { now: () => 1, genId: () => `m${++n}` });
  r.addVirtual('boss');
  r.addAgent('dev');
  r.register('dev', 's1'); // idle
  return { r, delivered };
}

test('promoteQueued:排队中 → 出队+立即直送+流水标 urgent,目标状态不动', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');                // dev busy
  const q1 = r.send('boss', 'dev', 'queued-1')!;
  const q2 = r.send('boss', 'dev', 'queued-2')!;

  expect(r.promoteQueued(q2.id)).toEqual({ ok: true, to: 'dev' });
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-2']); // 立即出去
  expect(r.get('dev')!.status).toBe('busy');
  expect(r.queuedMessageIds().has(q2.id)).toBe(false);
  expect(r.queuedMessageIds().has(q1.id)).toBe(true);                   // 其余不动
  expect(r.messages().find((m) => m.id === q2.id)?.urgent).toBe(true);  // 流水补标(⚡ 渲染依据)
  expect(r.messages().find((m) => m.id === q2.id)?.canceled).toBeUndefined();

  r.onIdle('dev');
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-2', 'queued-1']);
});

test('promoteQueued:目标空闲时(理论不该有排队,防御路径)等价 pump 置 busy', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'task-1');
  const q = r.send('boss', 'dev', 'queued-1')!;
  r.get('dev')!.status = 'idle'; // 直接造"空闲但还有排队"的瞬时态(轮询竞态下可能出现)
  expect(r.promoteQueued(q.id)).toEqual({ ok: true, to: 'dev' });
  expect(r.get('dev')!.status).toBe('busy');
  expect(delivered.map((m) => m.body)).toEqual(['task-1', 'queued-1']);
});

test('promoteQueued:已投出/不存在 → ok:false', () => {
  const { r } = makeRouter();
  const m1 = r.send('boss', 'dev', 'first')!; // 即时投递,不在队列
  expect(r.promoteQueued(m1.id)).toEqual({ ok: false });
  expect(r.promoteQueued('nope')).toEqual({ ok: false });
  expect(r.messages().find((m) => m.id === m1.id)?.urgent).toBeUndefined();
});

test('promoteQueued:目标 launching → ok:false,消息留在队列', () => {
  const { r, delivered } = makeRouter();
  r.addAgent('newbie'); // launching
  const m = r.send('boss', 'newbie', 'early')!;
  expect(r.promoteQueued(m.id)).toEqual({ ok: false });
  expect(r.queuedMessageIds().has(m.id)).toBe(true); // 没被吞,register 后照常投
  expect(delivered).toEqual([]);
});
