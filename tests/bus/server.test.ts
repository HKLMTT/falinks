import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let driver: FakeDriver;
let router: Router;
const sessions = new Map<string, string>();

async function callTool(agent: string, name: string, args: Record<string, unknown> = {}) {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
  const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res: any = await client.callTool({ name, arguments: args });
  await client.close();
  return JSON.parse(res.content[0].text);
}

beforeEach(async () => {
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  router.addAgent('bob');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  bus = await startBus({ router, getSessionId: (n) => sessions.get(n) }, 0);
});

afterEach(async () => { await bus.close(); });

test('register flips the calling agent to idle (identity from path)', async () => {
  const r = await callTool('alice', 'register');
  expect(r.ok).toBe(true);
  expect(r.you).toBe('alice');
  expect(router.get('alice')!.status).toBe('idle');
});

test('sendmsg routes from the path-identified sender to the target and injects', async () => {
  await callTool('alice', 'register');
  await callTool('bob', 'register');
  const r = await callTool('alice', 'sendmsg', { to: 'bob', message: 'ping' });
  expect(r.ok).toBe(true);
  expect(driver.injections.some((i) => i.sessionId === sessions.get('bob') && i.text.includes('ping'))).toBe(true);
  expect(driver.injections.some((i) => i.text.includes('alice'))).toBe(true);
});

test('idle pumps the next queued message', async () => {
  await callTool('alice', 'register');
  await callTool('bob', 'register');
  await callTool('alice', 'sendmsg', { to: 'bob', message: 'first' });
  await callTool('alice', 'sendmsg', { to: 'bob', message: 'second' });
  const before = driver.injections.length;
  await callTool('bob', 'idle');
  expect(driver.injections.length).toBe(before + 1);
});

test('sendmsg to unknown target returns ok:false', async () => {
  await callTool('alice', 'register');
  const r = await callTool('alice', 'sendmsg', { to: 'ghost', message: 'x' });
  expect(r.ok).toBe(false);
});

test('who returns the roster with statuses', async () => {
  await callTool('alice', 'register');
  const r = await callTool('bob', 'who');
  const names = r.roster.map((a: any) => a.name).sort();
  expect(names).toEqual(['alice', 'bob']);
});
