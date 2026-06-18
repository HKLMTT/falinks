// tests/i18n-leadstate.test.ts
import { expect, test } from 'vitest';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

test('zh 新增键存在且非空', () => {
  expect(zh.toolDescLeadstate.length).toBeGreaterThan(0);
  expect(zh.leadResetSkippedNoDoc.length).toBeGreaterThan(0);
  expect(zh.leadMemoryOff.length).toBeGreaterThan(0);
});

test('en 新增键存在且非空', () => {
  expect(en.toolDescLeadstate.length).toBeGreaterThan(0);
  expect(en.leadResetSkippedNoDoc.length).toBeGreaterThan(0);
  expect(en.leadMemoryOff.length).toBeGreaterThan(0);
});

test('coordinatorRules 提及项目状态档维护', () => {
  expect(zh.coordinatorRules).toContain('项目状态');
  expect(en.coordinatorRules.toLowerCase()).toContain('project state');
});
