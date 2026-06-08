import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { Guards } from '../../src/core/guards.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus; let router: Router;
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
  const driver = new FakeDriver();
  let n = 0;
  // 回合上限设 1:同一对第 2 条就被守卫拦,用来验证"被守卫拦"与"目标不存在/已死"区分开。
  const guards = new Guards({ maxTurnsPerThread: 1, maxInjectionsPerMinute: 100, loopWindow: 99 }, () => 1);
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, guards });
  router.addAgent('alice'); router.addAgent('bob');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  sessions.set('bob', await driver.launch({ cwd: '/b', command: 'cat' }));
  router.register('alice', sessions.get('alice')!);
  router.register('bob', sessions.get('bob')!);
  bus = await startBus({ router, getSessionId: (nm) => sessions.get(nm) }, 0);
});
afterEach(async () => { await bus.close(); });

test('sendmsg 到不存在的目标 → 报 unknown target(不再混淆成 dead)', async () => {
  const r = await callTool('alice', 'sendmsg', { to: 'ghost', message: 'hi' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/unknown target/);
});

test('sendmsg 到已死目标 → 报 target dead', async () => {
  router.markDead('bob');
  const r = await callTool('alice', 'sendmsg', { to: 'bob', message: 'hi' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/dead/);
});

test('sendmsg 被守卫拦下 → 报 guardrail(而非 unknown/dead),且明示未送达', async () => {
  expect((await callTool('alice', 'sendmsg', { to: 'bob', message: 'm1' })).ok).toBe(true); // 第1回合 OK
  const r = await callTool('bob', 'sendmsg', { to: 'alice', message: 'm2' });               // 同一对第2回合 > cap1 被拦
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/guardrail/);
  expect(r.error).toMatch(/NOT delivered/);
});
