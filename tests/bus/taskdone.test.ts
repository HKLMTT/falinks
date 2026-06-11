// tests/bus/taskdone.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let tdCalls: any[];

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
  tdCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: (seq: number, status: 'done' | 'failed', result: string) => { tdCalls.push([seq, status, result]); return { ok: true }; },
      op: (op: string, args: { body?: string; seq?: number; n?: number }) => ({ ok: true, op, args }),
      state: () => ({ state: 'running', nudgeMinutes: 10, tasks: [] }),
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 taskdone 透传到钩子', async () => {
  const r = await callTool('lead', 'taskdone', { seq: 1, status: 'done', result: 'ok' });
  expect(r.ok).toBe(true);
  expect(tdCalls).toEqual([[1, 'done', 'ok']]);
});

test('非 lead 调 taskdone 拒绝', async () => {
  const r = await callTool('dev', 'taskdone', { seq: 1, status: 'done', result: 'ok' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/lead/);
  expect(tdCalls).toEqual([]);
});

test('无 todo 钩子时 taskdone 返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const res: any = await client.callTool({ name: 'taskdone', arguments: { seq: 1, status: 'done', result: 'x' } });
    await client.close();
    expect(JSON.parse(res.content[0].text).ok).toBe(false);
  } finally { await bus2.close(); }
});

test('GET /admin/todo 返回状态;POST /admin/todo 分发 op', async () => {
  const g = await (await fetch(`http://127.0.0.1:${bus.port}/admin/todo`)).json() as any;
  expect(g.todo.state).toBe('running');
  const p = await (await fetch(`http://127.0.0.1:${bus.port}/admin/todo`, { method: 'POST', body: JSON.stringify({ op: 'add', body: 'x' }) })).json() as any;
  expect(p.op).toBe('add');
});
