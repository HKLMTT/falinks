// tests/console/parse-leadreset.test.ts
import { expect, test } from 'vitest';
import { parseConsoleInput } from '../../src/console/parse.js';

test('/todo leadreset on', () => {
  expect(parseConsoleInput('/todo leadreset on')).toEqual({ kind: 'leadreset', enabled: true });
});
test('/todo leadreset off', () => {
  expect(parseConsoleInput('/todo leadreset off')).toEqual({ kind: 'leadreset', enabled: false });
});
test('/todo leadreset 7 → 设周期', () => {
  expect(parseConsoleInput('/todo leadreset 7')).toEqual({ kind: 'leadreset', every: 7 });
});
test('/todo leadreset 非法值报错', () => {
  expect(parseConsoleInput('/todo leadreset 0').kind).toBe('error');
  expect(parseConsoleInput('/todo leadreset xyz').kind).toBe('error');
});
