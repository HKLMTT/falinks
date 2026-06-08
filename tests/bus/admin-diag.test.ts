import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let diagData: unknown[];

async function http(path: string) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`);
  return res.json();
}

beforeEach(async () => {
  diagData = [];
  const router = new Router(makeDeliverer(new FakeDriver()), { now: () => 1, genId: () => 'm' });
  bus = await startBus({ router, getSessionId: () => undefined, getDiag: () => diagData }, 0);
});
afterEach(async () => { await bus.close(); });

test('/admin/diag 透传 getDiag(),limit 取尾部', async () => {
  diagData = [
    { kind: 'guard-drop', from: 'a', to: 'b', reason: 'turn-cap', ts: 1 },
    { kind: 'inject-fail', to: 'c', error: 'x', ts: 2 },
    { kind: 'auto-idle', name: 'd', sinceDeliverMs: 5000, ts: 3 },
  ];
  expect((await http('/admin/diag')).diag).toEqual(diagData);
  expect((await http('/admin/diag?limit=1')).diag).toEqual([diagData[2]]);
});

test('/admin/diag 未提供 getDiag → 空数组', async () => {
  const router = new Router(makeDeliverer(new FakeDriver()), { now: () => 1, genId: () => 'm' });
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  const res = await fetch(`http://127.0.0.1:${bus2.port}/admin/diag`);
  const j = await res.json();
  await bus2.close();
  expect(j.diag).toEqual([]);
});
