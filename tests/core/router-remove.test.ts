import { expect, test } from 'vitest';
import { Router, type Deliverer } from '../../src/core/router.js';

function mk() {
  const deliverer: Deliverer = { deliver: () => {} };
  let n = 0;
  const r = new Router(deliverer, { now: () => 0, genId: () => `m${++n}` });
  r.addAgent('alice'); r.register('alice', 'SA');
  r.addAgent('bob'); r.register('bob', 'SB');
  return r;
}

test('removeAgent drops the agent from roster and lookups', () => {
  const r = mk();
  r.removeAgent('bob');
  expect(r.get('bob')).toBeUndefined();
  expect(r.roster().map((a) => a.name)).toEqual(['alice']);
});

test('after removeAgent, sending to it returns undefined', () => {
  const r = mk();
  r.removeAgent('bob');
  expect(r.send('alice', 'bob', 'x')).toBeUndefined();
});

test('removeAgent on unknown name is a no-op (no throw)', () => {
  const r = mk();
  expect(() => r.removeAgent('ghost')).not.toThrow();
});
