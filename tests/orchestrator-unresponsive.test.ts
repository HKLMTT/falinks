import { expect, test } from 'vitest';
import { checkRegisterTimeout, judgeAutoIdleSilence } from '../src/orchestrator.js';

// —— A-1 报到超时 ——
test('期限内出现 MCP 调用 → satisfied', () => {
  expect(checkRegisterTimeout({ now: 50_000, by: 90_000, since: 0, lastMcpAt: 30_000 })).toBe('satisfied');
});
test('期限已过且零调用 → timeout', () => {
  expect(checkRegisterTimeout({ now: 90_001, by: 90_000, since: 0, lastMcpAt: undefined })).toBe('timeout');
});
test('未到期且零调用 → waiting', () => {
  expect(checkRegisterTimeout({ now: 50_000, by: 90_000, since: 0, lastMcpAt: undefined })).toBe('waiting');
});
test('expectation 之前的旧调用不算数(since 之前)', () => {
  expect(checkRegisterTimeout({ now: 90_001, by: 90_000, since: 10_000, lastMcpAt: 5_000 })).toBe('timeout');
});

// —— A-2 有活无声 ——
test('投递后零 MCP 调用就自动降闲 → 计一次', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 0, lastMcpAt: undefined });
  expect(v).toEqual({ count: true, reset: false, countedAt: 100 });
});
test('投递后有 MCP 活动 → 不计且清计数(健康)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 0, lastMcpAt: 150 });
  expect(v).toEqual({ count: false, reset: true, countedAt: 100 });
});
test('同一次投递只计一次(observeBusy 再降闲不重复计)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: 100, countedAt: 100, lastMcpAt: undefined });
  expect(v).toEqual({ count: false, reset: false, countedAt: 100 });
});
test('从未投递过 → 不计(前置守卫)', () => {
  const v = judgeAutoIdleSilence({ deliveredAt: undefined, countedAt: 0, lastMcpAt: undefined });
  expect(v).toEqual({ count: false, reset: false, countedAt: 0 });
});
