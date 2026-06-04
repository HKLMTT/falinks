import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
const sessions = new Map<string, string>();

beforeEach(async () => {
  const driver = new FakeDriver();
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => 'm1' });
  router.addAgent('小P');
  sessions.set('小P', await driver.launch({ cwd: '/x', command: 'claude' }));
  bus = await startBus({ router, getSessionId: (n) => sessions.get(n) }, 0);
});
afterEach(async () => { await bus.close(); });

test('an agent with a Chinese name (path gets percent-encoded) still registers', async () => {
  // SDK client 会把 URL 路径里的中文百分号编码；总线需 decode 回 "小P" 才能匹配注册名。
  const url = new URL(`http://127.0.0.1:${bus.port}/agent/${encodeURIComponent('小P')}/mcp`);
  const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  const res: any = await client.callTool({ name: 'register', arguments: {} });
  await client.close();
  const json = JSON.parse(res.content[0].text);
  expect(json.ok).toBe(true);
  expect(json.you).toBe('小P');
  expect(router.get('小P')!.status).toBe('idle');
});
