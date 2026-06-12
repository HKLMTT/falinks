import { afterEach, beforeEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let bus: Bus;
let router: Router;
let driver: FakeDriver;

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
  driver = new FakeDriver();
  let n = 0;
  router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addVirtual('boss');
  router.addAgent('dev');
  router.register('dev', await driver.launch({ cwd: '/d', command: 'cat' })); // idle
  bus = await startBus({ router, getSessionId: () => undefined }, 0);
});
afterEach(async () => { await bus.close(); });

test('/admin/say urgent:true:目标忙也立即注入,log 带 urgent 且 queued:false', async () => {
  router.send('boss', 'dev', 'first'); // dev busy
  const before = driver.injections.length;
  const r = await post('/admin/say', { to: 'dev', message: 'cut-in', urgent: true });
  expect(r.ok).toBe(true);
  expect(driver.injections.length).toBeGreaterThan(before); // 直接注入,没等空闲
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === r.id);
  expect(rec.urgent).toBe(true);
  expect(rec.queued).toBe(false);
});

test('/admin/say 不带 urgent:行为不变(忙时排队)', async () => {
  router.send('boss', 'dev', 'first');
  const r = await post('/admin/say', { to: 'dev', message: 'normal' });
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === r.id);
  expect(rec.queued).toBe(true);
  expect(rec.urgent).toBeUndefined();
});

test('/admin/broadcast urgent:true:忙员工也直送', async () => {
  router.send('boss', 'dev', 'first'); // dev busy
  const before = driver.injections.length;
  const r = await post('/admin/broadcast', { message: 'all-hands', urgent: true });
  expect(r.sent).toEqual(['dev']);
  expect(driver.injections.length).toBeGreaterThan(before);
});

test('/admin/broadcast urgent:多员工——忙者直送、闲者送达、dead 不在 sent 里', async () => {
  // 组员工:dev(下面置忙)+ idler(空闲)+ ghost(dead)
  router.addAgent('idler');
  const idlerSid = await driver.launch({ cwd: '/i', command: 'cat' });
  router.register('idler', idlerSid);
  router.addAgent('ghost');
  router.register('ghost', await driver.launch({ cwd: '/g', command: 'cat' }));
  router.markDead('ghost');

  router.send('boss', 'dev', 'first'); // dev busy
  const before = driver.injections.length;
  const r = await post('/admin/broadcast', { message: 'all-stop', urgent: true });
  expect([...r.sent].sort()).toEqual(['dev', 'idler']); // dead 不在 sent 里
  const after = driver.injections.slice(before);
  expect(after.some((i) => i.text.includes('all-stop') && i.sessionId !== idlerSid)).toBe(true); // 忙者 dev 直送(没等空闲)
  expect(after.some((i) => i.text.includes('all-stop') && i.sessionId === idlerSid)).toBe(true); // 闲者送达
});

test('/admin/promote:排队消息提升直送,log 翻 urgent+queued:false;不存在 → error:gone', async () => {
  router.send('boss', 'dev', 'first');               // dev busy
  const q = router.send('boss', 'dev', 'second')!;   // 排队
  const before = driver.injections.length;
  expect(await post('/admin/promote', { id: q.id })).toEqual({ ok: true, to: 'dev' });
  expect(driver.injections.length).toBeGreaterThan(before);
  const rec = (await get('/admin/log')).log.find((m: any) => m.id === q.id);
  expect(rec.urgent).toBe(true);
  expect(rec.queued).toBe(false);
  expect(await post('/admin/promote', { id: 'nope' })).toEqual({ ok: false, error: 'gone' });
});
