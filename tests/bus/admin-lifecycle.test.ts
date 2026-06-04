import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus; let added: any[]; let removed: string[];

async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm1' });
  added = []; removed = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onAddAgent: async (spec) => { added.push(spec); return { ok: true }; },
    onRemoveAgent: async (name) => { removed.push(name); return { ok: true }; },
  }, 0);
});
afterEach(async () => { await bus.close(); });

test('POST /admin/add invokes onAddAgent with the spec', async () => {
  const { json } = await http('POST', '/admin/add', { name: 'carol', cli: 'claude', cwd: '/tmp/c', role: 'dev' });
  expect(json.ok).toBe(true);
  expect(added).toEqual([{ name: 'carol', cli: 'claude', cwd: '/tmp/c', role: 'dev' }]);
});

test('POST /admin/remove invokes onRemoveAgent with the name', async () => {
  const { json } = await http('POST', '/admin/remove', { name: 'bob' });
  expect(json.ok).toBe(true);
  expect(removed).toEqual(['bob']);
});

test('add without callback returns ok:false', async () => {
  await bus.close();
  const driver = new FakeDriver();
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm1' });
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
  const { json } = await http('POST', '/admin/add', { name: 'x', cli: 'claude', cwd: '/x' });
  expect(json.ok).toBe(false);
});
