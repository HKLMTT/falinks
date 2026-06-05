import { afterEach, expect, test } from 'vitest';
import { Router } from '../../src/core/router.js';
import { makeDeliverer } from '../../src/orchestrator.js';
import { FakeDriver } from '../../src/terminal/driver.js';
import { startBus, type Bus } from '../../src/bus/server.js';

let buses: Bus[] = [];
afterEach(async () => { for (const b of buses) await b.close(); buses = []; });

function mkRouter() {
  const driver = new FakeDriver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), { now: () => 1, genId: () => `m${++n}` });
  router.addVirtual('boss');
  return router;
}

async function start(port: number, opts?: Parameters<typeof startBus>[2]) {
  const b = await startBus({ router: mkRouter(), getSessionId: () => undefined }, port, opts);
  buses.push(b);
  return b;
}

test('GET /admin/info 返回身份(cwd/pid/startedAt)', async () => {
  const b = await start(0, { identity: { cwd: '/proj/a', startedAt: 42 } });
  const info = await (await fetch(`http://127.0.0.1:${b.port}/admin/info`)).json();
  expect(info).toEqual({ cwd: '/proj/a', pid: process.pid, startedAt: 42 });
});

test('未传 identity 也有兜底身份', async () => {
  const b = await start(0);
  const info = await (await fetch(`http://127.0.0.1:${b.port}/admin/info`)).json();
  expect(info.pid).toBe(process.pid);
  expect(typeof info.cwd).toBe('string');
});

test('显式端口被占用 → 自动回退系统分配并回调告警,不再 exit', async () => {
  const first = await start(0);
  let fallback: { wanted: number; got: number } | null = null;
  const second = await start(first.port, { onPortFallback: (wanted, got) => { fallback = { wanted, got }; } });
  expect(second.port).not.toBe(first.port);
  expect(fallback).toEqual({ wanted: first.port, got: second.port });
});
