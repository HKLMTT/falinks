import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';
import type { AgentRuntime, Message } from '../../src/core/types.js';

function makeRouter() {
  const delivered: Message[] = [];
  const deliverer: Deliverer = { deliver: (_a: AgentRuntime, msgs: Message[]) => { delivered.push(...msgs); } };
  let n = 0;
  const r = new Router(deliverer, { now: () => 1, genId: () => `m${++n}` });
  r.addVirtual('boss');
  r.addAgent('dev');
  r.register('dev', 's1'); // idle
  return { r, delivered };
}

test('cancelQueued:撤销排队中的消息,流水保留并标 canceled,永不投递', () => {
  const { r, delivered } = makeRouter();
  r.send('boss', 'dev', 'first');             // idle → 即时投递,dev busy
  const q1 = r.send('boss', 'dev', 'second')!; // 排队
  const q2 = r.send('boss', 'dev', 'third')!;  // 排队
  expect(r.queuedMessageIds().has(q1.id)).toBe(true);

  const res = r.cancelQueued(q1.id);
  expect(res).toEqual({ ok: true, to: 'dev' });
  expect(r.queuedMessageIds().has(q1.id)).toBe(false);   // 不再排队
  expect(r.queuedMessageIds().has(q2.id)).toBe(true);    // 其余不受影响
  expect(r.messages().find((m) => m.id === q1.id)?.canceled).toBe(true); // 流水保留+标记

  r.onIdle('dev'); // dev 干完 → pump 下一条
  r.onIdle('dev');
  expect(delivered.map((m) => m.body)).toEqual(['first', 'third']); // second 永不投递
});

test('cancelQueued:已投出/不存在的 id → ok:false', () => {
  const { r } = makeRouter();
  const m1 = r.send('boss', 'dev', 'first')!; // 即时投递,不在队列
  expect(r.cancelQueued(m1.id)).toEqual({ ok: false });
  expect(r.cancelQueued('nope')).toEqual({ ok: false });
  expect(r.messages().find((m) => m.id === m1.id)?.canceled).toBeUndefined(); // 已投出的不标
});
