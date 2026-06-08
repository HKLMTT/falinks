import { expect, test } from 'vitest';
import { parseConfig } from '../../src/core/config.js';

const base = { agents: [{ name: 'a', cli: 'claude', cwd: '/p', bootstrap: 'b' }] };

test('historyCap:缺省为 undefined(由调用方回退默认)', () => {
  expect(parseConfig(base).historyCap).toBeUndefined();
});

test('historyCap:合法正整数被保留', () => {
  expect(parseConfig({ ...base, historyCap: 5000 }).historyCap).toBe(5000);
});

test('historyCap:非正数 / 非数字报错', () => {
  expect(() => parseConfig({ ...base, historyCap: 0 })).toThrow();
  expect(() => parseConfig({ ...base, historyCap: -1 })).toThrow();
  expect(() => parseConfig({ ...base, historyCap: 'x' })).toThrow();
});
