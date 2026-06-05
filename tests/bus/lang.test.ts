import { expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus } from '../../src/bus/server.js';

function mkRouter(): Router {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addVirtual('boss');
  return router;
}

test('POST /admin/lang → 调用 onLang 并返回生效 locale', async () => {
  let got: string | null = null;
  const bus = await startBus({ router: mkRouter(), getSessionId: () => undefined,
    onLang: async (l: string) => { got = l; return 'en'; } }, 0);
  const r = await (await fetch(`http://127.0.0.1:${bus.port}/admin/lang`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'auto' }) })).json();
  expect(got).toBe('auto');
  expect(r).toEqual({ ok: true, locale: 'en' });
  await bus.close();
});

test('POST /admin/lang 非法 locale → ok:false', async () => {
  const bus = await startBus({ router: mkRouter(), getSessionId: () => undefined, onLang: async () => 'zh' }, 0);
  const r = await (await fetch(`http://127.0.0.1:${bus.port}/admin/lang`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'fr' }) })).json();
  expect(r.ok).toBe(false);
  await bus.close();
});

test('onLang 未提供 → ok:false(not supported)', async () => {
  const bus = await startBus({ router: mkRouter(), getSessionId: () => undefined }, 0);
  const r = await (await fetch(`http://127.0.0.1:${bus.port}/admin/lang`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'zh' }) })).json();
  expect(r.ok).toBe(false);
  await bus.close();
});
