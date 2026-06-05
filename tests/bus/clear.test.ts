import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
const calls: (string | undefined)[] = [];

async function http(path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

beforeEach(async () => {
  calls.length = 0;
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm' });
  router.addVirtual('boss');
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onClear: async (name) => { calls.push(name); return { ok: true, cleared: name ? [name] : ['a', 'b'] }; },
  }, 0);
});
afterEach(async () => { await bus.close(); });

test('/admin/clear 带 name -> 透传给 onClear', async () => {
  const r = await http('/admin/clear', { name: 'lead' });
  expect(calls).toEqual(['lead']);
  expect(r).toEqual({ ok: true, cleared: ['lead'] });
});

test('/admin/clear 不带 name -> onClear 收到 undefined(全员)', async () => {
  const r = await http('/admin/clear', {});
  expect(calls).toEqual([undefined]);
  expect(r.cleared).toEqual(['a', 'b']);
});

test('未提供 onClear 时返回 clear not supported', async () => {
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm' });
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  const r = await (await fetch(`http://127.0.0.1:${bus2.port}/admin/clear`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).json();
  await bus2.close();
  expect(r).toEqual({ ok: false, error: 'clear not supported' });
});
