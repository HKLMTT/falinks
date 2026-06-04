import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus; let driver: FakeDriver; let router: Router;
const sessions = new Map<string, string>();

async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addAgent('alice'); router.addAgent('bob');
  router.addVirtual('boss');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  router.register('alice', sessions.get('alice')!);
  router.register('bob', sessions.get('bob')!);
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

test('GET /admin/roster returns all members incl boss', async () => {
  const { status, json } = await http('GET', '/admin/roster');
  expect(status).toBe(200);
  expect(json.roster.map((a: any) => a.name).sort()).toEqual(['alice', 'bob', 'boss']);
});

test('POST /admin/say injects boss message into the target', async () => {
  const { json } = await http('POST', '/admin/say', { to: 'alice', message: 'hello team' });
  expect(json.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('alice') && i.text.includes('hello team'))).toBe(true);
  expect(driver.injections.some((i) => i.text.includes('boss'))).toBe(true);
});

test('POST /admin/say to unknown target returns ok:false', async () => {
  const { json } = await http('POST', '/admin/say', { to: 'ghost', message: 'x' });
  expect(json.ok).toBe(false);
});

test('POST /admin/broadcast sends to all real members, not boss itself', async () => {
  const { json } = await http('POST', '/admin/broadcast', { message: '全体注意' });
  expect(json.sent.sort()).toEqual(['alice', 'bob']);
  expect(driver.injections.filter((i) => i.text.includes('全体注意')).length).toBe(2);
});

test('GET /admin/log returns the message log', async () => {
  await http('POST', '/admin/say', { to: 'alice', message: 'logged-msg' });
  const { json } = await http('GET', '/admin/log');
  expect(json.log.some((m: any) => m.to === 'alice' && m.body === 'logged-msg' && m.from === 'boss')).toBe(true);
});
