import { expect, test } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, saveStore, pruneToAgents, sessionStorePath } from '../../src/session/store.js';

test('sessionStorePath is stable for the same cwd and under sessions/', () => {
  const root = '/x/.falinks';
  const a = sessionStorePath('/proj/foo', root);
  const b = sessionStorePath('/proj/foo', root);
  expect(a).toBe(b);
  expect(a.startsWith(join(root, 'sessions'))).toBe(true);
  expect(a.endsWith('.json')).toBe(true);
  expect(sessionStorePath('/proj/bar', root)).not.toBe(a);
});

test('load on missing file returns empty store; save then load round-trips', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-root-'));
  const cwd = '/proj/foo';
  expect(loadStore(cwd, root)).toEqual({ cwd, agents: {} });

  const store = { cwd, agents: { alice: { cli: 'claude', sessionId: 'id-1' } } };
  saveStore(cwd, store, root);
  expect(existsSync(sessionStorePath(cwd, root))).toBe(true);
  expect(loadStore(cwd, root)).toEqual(store);
});

test('load tolerates corrupt json -> empty store', () => {
  const root = mkdtempSync(join(tmpdir(), 'falinks-root-'));
  const cwd = '/proj/foo';
  saveStore(cwd, { cwd, agents: { a: { cli: 'codex', sessionId: 'x' } } }, root);
  // 覆写成坏 json
  writeFileSync(sessionStorePath(cwd, root), '{ broken');
  expect(loadStore(cwd, root)).toEqual({ cwd, agents: {} });
});

test('pruneToAgents drops entries whose name is not in the current team', () => {
  const store = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: '1' }, bob: { cli: 'codex', sessionId: '2' } } };
  pruneToAgents(store, ['alice']);
  expect(store.agents).toEqual({ alice: { cli: 'claude', sessionId: '1' } });
});
