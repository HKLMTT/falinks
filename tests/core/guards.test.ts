import { expect, test } from 'vitest';
import { Guards } from '../../src/core/guards.js';

const cfg = { maxTurnsPerThread: 3, maxInjectionsPerMinute: 2, loopWindow: 3 };
function mk(now: () => number = () => 0) { return new Guards(cfg, now); }

test('newThread returns unique ids', () => {
  const g = mk();
  expect(g.newThread()).not.toBe(g.newThread());
});

test('checkMessage allows up to maxTurnsPerThread then breaks with turn-cap', () => {
  const g = mk();
  expect(g.checkMessage('t1', 'a').ok).toBe(true);
  expect(g.checkMessage('t1', 'b').ok).toBe(true);
  expect(g.checkMessage('t1', 'c').ok).toBe(true);
  const d = g.checkMessage('t1', 'd');
  expect(d.ok).toBe(false);
  expect(d.reason).toBe('turn-cap');
});

test('checkMessage breaks with loop on loopWindow identical bodies', () => {
  const g = mk();
  expect(g.checkMessage('t1', 'same').ok).toBe(true);
  expect(g.checkMessage('t1', ' same ').ok).toBe(true);
  const d = g.checkMessage('t1', 'same');
  expect(d.ok).toBe(false);
  expect(d.reason).toBe('loop');
});

test('checkMessage breaks with loop on consecutive empty bodies', () => {
  const g = mk();
  g.checkMessage('t1', '');
  g.checkMessage('t1', '   ');
  expect(g.checkMessage('t1', '').reason).toBe('loop');
});

test('different bodies in a thread do not trigger loop (bounded only by turn-cap)', () => {
  const g = new Guards({ maxTurnsPerThread: 100, maxInjectionsPerMinute: 100, loopWindow: 3 }, () => 0);
  expect(g.checkMessage('t1', 'x').ok).toBe(true);
  expect(g.checkMessage('t1', 'y').ok).toBe(true);
  expect(g.checkMessage('t1', 'x').ok).toBe(true);
});

test('allowInjection enforces rolling per-minute cap', () => {
  let t = 0;
  const g = mk(() => t);
  expect(g.allowInjection()).toBe(true);
  expect(g.allowInjection()).toBe(true);
  expect(g.allowInjection()).toBe(false);
  t = 61_000;
  expect(g.allowInjection()).toBe(true);
});
