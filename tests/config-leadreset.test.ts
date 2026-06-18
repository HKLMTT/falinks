// tests/config-leadreset.test.ts
import { expect, test } from 'vitest';
import { parseConfig } from '../src/core/config.js';

const base = { agents: [{ name: 'a', cli: 'claude', cwd: '.', bootstrap: 'x' }] };

test('缺省 leadReset:enabled=true, everyTasks=5', () => {
  const c = parseConfig({ ...base });
  expect(c.todo).toEqual({ leadReset: { enabled: true, everyTasks: 5 } });
});

test('显式覆盖被采纳', () => {
  const c = parseConfig({ ...base, todo: { leadReset: { enabled: false, everyTasks: 3 } } });
  expect(c.todo).toEqual({ leadReset: { enabled: false, everyTasks: 3 } });
});

test('部分覆盖:只给 everyTasks,enabled 仍默认 true', () => {
  const c = parseConfig({ ...base, todo: { leadReset: { everyTasks: 8 } } });
  expect(c.todo).toEqual({ leadReset: { enabled: true, everyTasks: 8 } });
});

test('everyTasks 非正整数报错', () => {
  expect(() => parseConfig({ ...base, todo: { leadReset: { everyTasks: 0 } } }))
    .toThrow(/everyTasks/);
});

test('enabled 非布尔报错', () => {
  expect(() => parseConfig({ ...base, todo: { leadReset: { enabled: 'yes' } } }))
    .toThrow(/enabled/);
});
