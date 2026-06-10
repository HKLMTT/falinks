import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let calls: Array<{ name: string; fresh: boolean }>;

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  calls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onRestartAgent: async (name, fresh) => {
      calls.push({ name, fresh });
      return name === 'alice' ? { ok: true } : { ok: false, error: 'unknown agent' };
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

async function post(body: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}/admin/restart`, { method: 'POST', body: JSON.stringify(body) });
  return res.json() as any;
}

test('转发 name 与 fresh 给 onRestartAgent', async () => {
  const r = await post({ name: 'alice', fresh: true });
  expect(r.ok).toBe(true);
  expect(calls).toEqual([{ name: 'alice', fresh: true }]);
});

test('fresh 缺省为 false', async () => {
  await post({ name: 'alice' });
  expect(calls[0].fresh).toBe(false);
});

test('未知员工把 handler 的错误透传', async () => {
  const r = await post({ name: 'ghost' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/unknown/);
});

test('无 onRestartAgent 时返回 restart not supported', async () => {
  // 独立启动一个不带 onRestartAgent 的 bus
  const driver2 = new FakeDriver();
  let n2 = 0;
  const router2 = new Router(makeDeliverer(driver2), { now: () => 1, genId: () => `m${++n2}`, routes: {} });
  const bus2 = await startBus({ router: router2, getSessionId: () => undefined }, 0);
  try {
    const res = await fetch(`http://127.0.0.1:${bus2.port}/admin/restart`, {
      method: 'POST',
      body: JSON.stringify({ name: 'alice' }),
    });
    const r = await res.json() as any;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/restart not supported/);
  } finally {
    await bus2.close();
  }
});
