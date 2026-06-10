import { expect, test } from 'vitest';
import { parseConfig } from '../../src/core/config.js';

const base = (extra: object = {}) => ({
  agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b', ...extra }],
  routes: {},
});

test('model 可选:缺省为 undefined', () => {
  const cfg = parseConfig(base());
  expect(cfg.agents[0].model).toBeUndefined();
});

test('model 字符串透传', () => {
  const cfg = parseConfig(base({ model: 'claude-opus-4-8' }));
  expect(cfg.agents[0].model).toBe('claude-opus-4-8');
});

test('model 非字符串报错', () => {
  expect(() => parseConfig(base({ model: 42 }))).toThrow(/model/);
});

test('model 空字符串视为未设置(归一化为 undefined)', () => {
  const cfg = parseConfig(base({ model: '' }));
  expect(cfg.agents[0].model).toBeUndefined();
});
