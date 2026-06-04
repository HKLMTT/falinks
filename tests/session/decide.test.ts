import { expect, test } from 'vitest';
import { decideClaudeSession, decideCodexSession } from '../../src/session/decide.js';
import type { SessionStore } from '../../src/session/store.js';

const gen = () => 'new-uuid-0000';

test('claude: no stored entry -> fresh with a new uuid', () => {
  const store: SessionStore = { cwd: '/p', agents: {} };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => false))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('claude: stored entry + session file exists -> resume with stored id', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: 'old-id' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => true))
    .toEqual({ mode: 'resume', sessionId: 'old-id' });
});

test('claude: stored entry but file missing -> fresh with NEW uuid (never reuse old id for --session-id)', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'claude', sessionId: 'old-id' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => false))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('claude: stored entry is codex (cli changed) -> fresh', () => {
  const store: SessionStore = { cwd: '/p', agents: { alice: { cli: 'codex', sessionId: 'x' } } };
  expect(decideClaudeSession(store, 'alice', '/p', gen, () => true))
    .toEqual({ mode: 'fresh', sessionId: 'new-uuid-0000' });
});

test('codex: stored entry -> resume; otherwise fresh', () => {
  const withId: SessionStore = { cwd: '/p', agents: { bob: { cli: 'codex', sessionId: 'cid' } } };
  expect(decideCodexSession(withId, 'bob')).toEqual({ mode: 'resume', sessionId: 'cid' });
  expect(decideCodexSession({ cwd: '/p', agents: {} }, 'bob')).toEqual({ mode: 'fresh' });
});
