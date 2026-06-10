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
  router = new Router(makeDeliverer(driver), { now: () => Date.now(), genId: () => `m${++n}`, routes: {} });
  router.addAgent('alice');
  sessions.set('alice', await driver.launch({ cwd: '/a', command: 'cat' }));
  bus = await startBus({ router, getSessionId: (n2) => sessions.get(n2) }, 0);
});

afterEach(async () => { await bus.close(); });

test('任意工具调用都打点 lastMcpAt(以 who 为例,无副作用工具也算活着)', async () => {
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
  await callTool('alice', 'who');
  expect(router.get('alice')!.lastMcpAt).toBeGreaterThan(0);
});

test('MCP HTTP 连接(initialize)即打点 lastMcpHttpAt,早于任何工具调用', async () => {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/alice/mcp`);
  const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url)); // 只 initialize,不调工具
  await client.close();
  expect(router.get('alice')!.lastMcpHttpAt).toBeGreaterThan(0);
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
});

test('服务端代登记(resume 路径直调 router.register)不打点 lastMcpAt', () => {
  router.register('alice', sessions.get('alice')!);
  expect(router.get('alice')!.lastMcpAt).toBeUndefined();
});

test('未知名调用不炸总线', async () => {
  const r = await callTool('ghost', 'who');
  expect(r.roster).toBeDefined();
});

test('/admin/roster 透出 unresponsive 与 mcpSeen', async () => {
  router.markUnresponsive('alice');
  const res = await fetch(`http://127.0.0.1:${bus.port}/admin/roster`);
  const { roster } = await res.json() as any;
  const a = roster.find((x: any) => x.name === 'alice');
  expect(a.unresponsive).toBe(true);
  expect(a.mcpSeen).toBe(false);
});
