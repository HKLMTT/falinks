import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let specs: any[];

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  specs = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onAddAgent: async (spec) => { specs.push(spec); return { ok: true }; },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('/admin/add 透传 model 给 onAddAgent', async () => {
  await fetch(`http://127.0.0.1:${bus.port}/admin/add`, {
    method: 'POST',
    body: JSON.stringify({ name: 'dev', cli: 'claude', cwd: '/x', role: 'r', model: 'claude-opus-4-8' }),
  });
  expect(specs[0].model).toBe('claude-opus-4-8');
});

test('model 缺省为 undefined', async () => {
  await fetch(`http://127.0.0.1:${bus.port}/admin/add`, {
    method: 'POST',
    body: JSON.stringify({ name: 'dev', cli: 'claude', cwd: '/x' }),
  });
  expect(specs[0].model).toBeUndefined();
});
