// tests/bus/todoplan.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let planCalls: Array<{ tasks: string[]; replace: boolean; from: string }>;
let opCalls: Array<{ op: string; n?: number }>;

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
  router.addAgent('lead', undefined, true);
  router.addAgent('dev');
  planCalls = [];
  opCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: (_seq: number, _status: 'done' | 'failed', _result: string) => ({ ok: true }),
      taskwait: (_seq: number, _minutes: number, _reason: string) => ({ ok: true }),
      op: (op: string, args: { body?: string; seq?: number; n?: number }) => { opCalls.push({ op, n: args.n }); return { ok: true }; },
      state: () => ({ state: 'idle', nudgeMinutes: 10, tasks: [] }),
      plan: (tasks: string[], replace: boolean, from: string) => { planCalls.push({ tasks, replace, from }); return { ok: true, seqs: [1, 2] }; },
      leadstate: (_c: string) => ({ ok: true }),
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 todoplan 透传 tasks/replace/调用者名', async () => {
  const r = await callTool('lead', 'todoplan', { tasks: ['a', 'b'], replace: true });
  expect(r.ok).toBe(true);
  expect(r.seqs).toEqual([1, 2]);
  expect(planCalls).toEqual([{ tasks: ['a', 'b'], replace: true, from: 'lead' }]);
});

test('todoplan replace 缺省为 false', async () => {
  await callTool('lead', 'todoplan', { tasks: ['a'] });
  expect(planCalls[0].replace).toBe(false);
});

test('非 lead 调 todoplan/todostart 拒绝', async () => {
  const p = await callTool('dev', 'todoplan', { tasks: ['a'] });
  expect(p.ok).toBe(false);
  expect(p.error).toMatch(/lead/);
  const s = await callTool('dev', 'todostart', {});
  expect(s.ok).toBe(false);
  expect(planCalls).toEqual([]);
  expect(opCalls).toEqual([]);
});

test('lead 调 todostart 走 op(start),n 透传', async () => {
  const r = await callTool('lead', 'todostart', { nudgeMinutes: 15 });
  expect(r.ok).toBe(true);
  expect(opCalls).toEqual([{ op: 'start', n: 15 }]);
  await callTool('lead', 'todostart', {});
  expect(opCalls[1]).toEqual({ op: 'start', n: undefined });
});

test('无 todo 钩子时两工具都返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const p: any = await client.callTool({ name: 'todoplan', arguments: { tasks: ['a'] } });
    expect(JSON.parse(p.content[0].text).ok).toBe(false);
    const s: any = await client.callTool({ name: 'todostart', arguments: {} });
    expect(JSON.parse(s.content[0].text).ok).toBe(false);
    await client.close();
  } finally { await bus2.close(); }
});
