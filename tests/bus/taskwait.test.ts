// tests/bus/taskwait.test.ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let twCalls: [number, number, string][];

async function callTool(agent: string, name: string, args: Record<string, unknown> = {}) {
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${agent}/mcp`);
  const client = new Client({ name: `c-${agent}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return JSON.parse((res.content as { text: string }[])[0].text);
}

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}`, routes: {} });
  router.addAgent('lead', undefined, true); // lead=true
  router.addAgent('dev');
  twCalls = [];
  bus = await startBus({
    router,
    getSessionId: () => undefined,
    todo: {
      taskdone: (_seq: number, _status: 'done' | 'failed', _result: string) => ({ ok: true }),
      taskwait: (seq: number, minutes: number, reason: string) => { twCalls.push([seq, minutes, reason]); return { ok: true }; },
      op: (op: string, args: { body?: string; seq?: number; n?: number }) => ({ ok: true, op, args }),
      state: () => ({ state: 'running', nudgeMinutes: 10, tasks: [] }),
      plan: (_t: string[], _r: boolean, _f: string) => ({ ok: true }),
      leadstate: (_c: string) => ({ ok: true }),
    },
  }, 0);
});

afterEach(async () => { await bus.close(); });

test('lead 调 taskwait 透传到钩子(reason 缺省补空串)', async () => {
  const r = await callTool('lead', 'taskwait', { seq: 1, minutes: 30, reason: '等 e2e' });
  expect(r.ok).toBe(true);
  const r2 = await callTool('lead', 'taskwait', { seq: 2, minutes: 5 });
  expect(r2.ok).toBe(true);
  expect(twCalls).toEqual([[1, 30, '等 e2e'], [2, 5, '']]);
});

test('非 lead 调 taskwait 拒绝', async () => {
  const r = await callTool('dev', 'taskwait', { seq: 1, minutes: 30, reason: 'x' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/lead/);
  expect(twCalls).toEqual([]);
});

test('无 todo 钩子时 taskwait 返回不可用', async () => {
  const bus2 = await startBus({ router, getSessionId: () => undefined }, 0);
  try {
    const url = new URL(`http://127.0.0.1:${bus2.port}/agent/lead/mcp`);
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(url));
    const res = await client.callTool({ name: 'taskwait', arguments: { seq: 1, minutes: 10, reason: 'x' } });
    await client.close();
    expect(JSON.parse((res.content as { text: string }[])[0].text).ok).toBe(false);
  } finally { await bus2.close(); }
});
