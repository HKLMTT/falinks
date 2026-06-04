import { expect, test } from 'vitest';
import { parseConfig } from '../../src/core/config.js';

const valid = {
  busPort: 7878,
  agents: [
    { name: 'alice', cli: 'claude', cwd: '/tmp/a', role: 'manager', bootstrap: 'hi alice' },
    { name: 'bob', cli: 'claude', cwd: '/tmp/b', bootstrap: 'hi bob' },
  ],
  routes: { manager: 'alice' },
};

test('parseConfig accepts a valid config and defaults routes to empty', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] });
  expect(cfg.busPort).toBe(1);
  expect(cfg.routes).toEqual({});
  expect(cfg.agents[0].role).toBeUndefined();
});

test('parseConfig preserves routes and roles', () => {
  const cfg = parseConfig(valid);
  expect(cfg.routes).toEqual({ manager: 'alice' });
  expect(cfg.agents[0].role).toBe('manager');
});

test('parseConfig rejects duplicate agent names', () => {
  expect(() =>
    parseConfig({ busPort: 1, agents: [
      { name: 'x', cli: 'claude', cwd: '/a', bootstrap: 'b' },
      { name: 'x', cli: 'claude', cwd: '/b', bootstrap: 'b' },
    ] }),
  ).toThrow(/duplicate agent name/);
});

test('parseConfig rejects empty agents', () => {
  expect(() => parseConfig({ busPort: 1, agents: [] })).toThrow(/at least one agent/);
});

test('parseConfig rejects a route pointing to an unknown agent', () => {
  expect(() =>
    parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/a', bootstrap: 'b' }], routes: { m: 'ghost' } }),
  ).toThrow(/route .* unknown agent/);
});

test('parseConfig fills guard defaults when absent', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }] });
  expect(cfg.guards).toEqual({ maxTurnsPerThread: 20, maxInjectionsPerMinute: 30, loopWindow: 3 });
});

test('parseConfig merges partial guard overrides', () => {
  const cfg = parseConfig({ busPort: 1, agents: [{ name: 'a', cli: 'claude', cwd: '/x', bootstrap: 'b' }], guards: { maxTurnsPerThread: 5 } });
  expect(cfg.guards).toEqual({ maxTurnsPerThread: 5, maxInjectionsPerMinute: 30, loopWindow: 3 });
});
