import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/core/config.js';
import { addAgentToConfigFile, removeAgentFromConfigFile } from '../src/team-persist.js';

function tmpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'falinks-cfg-'));
  const p = join(dir, 'falinks.config.json');
  writeFileSync(
    p,
    JSON.stringify(
      { busPort: 7878, agents: [{ name: 'alice', cli: 'claude', cwd: '/p', role: '通用助手', bootstrap: '你是 alice。' }], routes: {} },
      null,
      2,
    ),
  );
  return p;
}

test('addAgentToConfigFile appends with synthesized bootstrap; result still parses', () => {
  const p = tmpConfig();
  addAgentToConfigFile(p, { name: '小P', cli: 'codex', cwd: '/p', role: '调研' });
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  expect(raw.agents.map((a: { name: string }) => a.name)).toEqual(['alice', '小P']);
  const codex = raw.agents.find((a: { name: string }) => a.name === '小P');
  expect(codex.cli).toBe('codex');
  expect(typeof codex.bootstrap).toBe('string');
  expect(codex.bootstrap.length).toBeGreaterThan(0);
  // 关键：写回后仍能被 parseConfig 接受（bootstrap 非空）。
  expect(() => parseConfig(raw)).not.toThrow();
});

test('addAgentToConfigFile is idempotent by name', () => {
  const p = tmpConfig();
  addAgentToConfigFile(p, { name: 'alice', cli: 'claude', cwd: '/p', role: 'x' });
  expect(JSON.parse(readFileSync(p, 'utf8')).agents.length).toBe(1);
});

test('addAgentToConfigFile keeps explicit bootstrap when provided', () => {
  const p = tmpConfig();
  addAgentToConfigFile(p, { name: 'bob', cli: 'claude', cwd: '/p', role: 'r', bootstrap: '自定义' });
  const bob = JSON.parse(readFileSync(p, 'utf8')).agents.find((a: { name: string }) => a.name === 'bob');
  expect(bob.bootstrap).toBe('自定义');
});

test('removeAgentFromConfigFile drops by name', () => {
  const p = tmpConfig();
  addAgentToConfigFile(p, { name: 'bob', cli: 'claude', cwd: '/p', role: 'r' });
  removeAgentFromConfigFile(p, 'alice');
  expect(JSON.parse(readFileSync(p, 'utf8')).agents.map((a: { name: string }) => a.name)).toEqual(['bob']);
});
