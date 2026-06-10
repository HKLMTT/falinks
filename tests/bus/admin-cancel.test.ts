import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;

async function post(path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${bus.port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}
async function get(path: string) {
  return (await fetch(`http://127.0.0.1:${bus.port}${path}`)).json();
}

beforeEach(async () => {
  const driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addVirtual('boss');
  router.addAgent('dev');
  router.register('dev', await driver.launch({ cwd: '/d', command: 'cat' })); // idle
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
});
afterEach(async () => { await bus.close(); });

test('/admin/cancel:撤销排队消息 → log 里 queued 翻 false 且带 canceled', async () => {
  router.send('boss', 'dev', 'first');             // 即时投递 → dev busy
  const q = router.send('boss', 'dev', 'second')!; // 排队
  expect((await get('/admin/log')).log.find((m: any) => m.id === q.id).queued).toBe(true);

  expect(await post('/admin/cancel', { id: q.id })).toEqual({ ok: true, to: 'dev' });
  const after = (await get('/admin/log')).log.find((m: any) => m.id === q.id);
  expect(after.queued).toBe(false);
  expect(after.canceled).toBe(true);
});

test('/admin/cancel:已投出/未知 id → ok:false', async () => {
  const m1 = router.send('boss', 'dev', 'first')!; // 即时投递
  expect((await post('/admin/cancel', { id: m1.id })).ok).toBe(false);
  expect((await post('/admin/cancel', { id: 'nope' })).ok).toBe(false);
});
