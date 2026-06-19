// tests/session/capture-loop.test.ts
import { expect, test, vi } from 'vitest';
import { captureSessionIdViaStatus } from '../../src/session/capture.js';

const UUID = '12345678-1234-1234-1234-123456789abc';
const noSleep = () => Promise.resolve();

test('claude:从 /status 屏抓 Session ID', async () => {
  const inject = vi.fn(() => Promise.resolve());
  const id = await captureSessionIdViaStatus('claude', inject, () => Promise.resolve(`foo\nSession ID: ${UUID}\nbar`), noSleep);
  expect(id).toBe(UUID);
  expect(inject).toHaveBeenCalledTimes(1); // 首次即中
});

test('codex:从 /status 屏抓 Session', async () => {
  const id = await captureSessionIdViaStatus('codex', () => Promise.resolve(), () => Promise.resolve(`Session: ${UUID}`), noSleep);
  expect(id).toBe(UUID);
});

test('屏上一直没有 id → 重试到上限后返回 null', async () => {
  const inject = vi.fn(() => Promise.resolve());
  const id = await captureSessionIdViaStatus('claude', inject, () => Promise.resolve('no session here'), noSleep, 3, 0);
  expect(id).toBeNull();
  expect(inject).toHaveBeenCalledTimes(3); // 重试 3 次
});

test('第 3 次才出现 id → 在第 3 次返回', async () => {
  let n = 0;
  const inject = vi.fn(() => Promise.resolve());
  const id = await captureSessionIdViaStatus('claude', inject, () => { n++; return Promise.resolve(n >= 3 ? `Session ID: ${UUID}` : 'loading'); }, noSleep, 8, 0);
  expect(id).toBe(UUID);
  expect(inject).toHaveBeenCalledTimes(3);
});

test('readScreen 抛错被吞,继续重试', async () => {
  let n = 0;
  const id = await captureSessionIdViaStatus('claude', () => Promise.resolve(), () => { n++; if (n === 1) return Promise.reject(new Error('iterm busy')); return Promise.resolve(`Session ID: ${UUID}`); }, noSleep, 8, 0);
  expect(id).toBe(UUID);
});
