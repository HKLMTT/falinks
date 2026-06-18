// tests/bus/leadstate.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let lsCalls: string[];

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
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('lead', undefined, true); // lead=true
  router.addAgent('dev');
  lsCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: () => ({ ok: true }),
      taskwait: () => ({ ok: true }),
      op: (op: string, args: { body?: string; seq?: number; n?: number }) => ({ ok: true, op, args }),
      state: () => ({ state: 'running', nudgeMinutes: 10, tasks: [] }),
      plan: () => ({ ok: true }),
      leadstate: (content: string) => { lsCalls.push(content); return { ok: true }; },
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 leadstate 透传内容到钩子', async () => {
  const r = await callTool('lead', 'leadstate', { content: '# 状态\n已完成 A,下一步 B' });
  expect(r.ok).toBe(true);
  expect(lsCalls).toEqual(['# 状态\n已完成 A,下一步 B']);
});

test('非 lead 调 leadstate 拒绝', async () => {
  const r = await callTool('dev', 'leadstate', { content: 'x' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/lead/);
  expect(lsCalls).toEqual([]);
});

test('无 todo 钩子时 leadstate 返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const res: any = await client.callTool({ name: 'leadstate', arguments: { content: 'x' } });
    await client.close();
    expect(JSON.parse(res.content[0].text).ok).toBe(false);
  } finally { await bus2.close(); }
});
