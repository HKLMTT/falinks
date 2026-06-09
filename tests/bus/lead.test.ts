import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
const calls: string[] = [];

async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

beforeEach(async () => {
  calls.length = 0;
  router = new Router(makeDeliverer(new FakeDriver()), { now: () => 1, genId: () => 'm' });
  router.addAgent('alice'); router.addAgent('bob'); router.addVirtual('boss');
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    onSetLead: async (name) => { calls.push(name); router.setLead(name); return { ok: true }; },
  }, 0);
});
afterEach(async () => { await bus.close(); });

test('POST /admin/lead 透传 name 给 onSetLead', async () => {
  const r = await http('POST', '/admin/lead', { name: 'alice' });
  expect(r).toEqual({ ok: true });
  expect(calls).toEqual(['alice']);
});

test('/admin/roster 暴露 lead 字段,切换后唯一', async () => {
  await http('POST', '/admin/lead', { name: 'alice' });
  let roster = (await http('GET', '/admin/roster')).roster;
  expect(roster.find((a: any) => a.name === 'alice').lead).toBe(true);
  expect(roster.find((a: any) => a.name === 'bob').lead).toBe(false);
  await http('POST', '/admin/lead', { name: 'bob' });
  roster = (await http('GET', '/admin/roster')).roster;
  expect(roster.find((a: any) => a.name === 'bob').lead).toBe(true);
  expect(roster.find((a: any) => a.name === 'alice').lead).toBe(false); // 旧 lead 取消
});

test('未提供 onSetLead 时返回 lead not supported', async () => {
  const r2 = new Router(makeDeliverer(new FakeDriver()), { now: () => 1, genId: () => 'm' });
  const bus2 = await startBus({ router: r2, getSessionId: () => undefined }, 0);
  const r = await (await fetch(`http://127.0.0.1:${bus2.port}/admin/lead`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).json();
  await bus2.close();
  expect(r).toEqual({ ok: false, error: 'lead not supported' });
});
