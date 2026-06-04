import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStatusSessionId, encodeClaudeProjectDir, claudeSessionExists } from '../../src/session/capture.js';

const CODEX_STATUS = `>_ OpenAI Codex (v0.137.0)
  Directory:      ~/工作/dagent
  Session:        019e92f3-c07b-7711-b509-fdf38f98ae14
  Token usage:    0 total`;

const CLAUDE_STATUS = `Settings  Status  Config
  Version:     2.1.162
  Session ID:  5bce55fd-00c9-4348-a876-ab07332b3229
  cwd:         /Users/liujia/工作/porygon`;

test('parses codex /status session id', () => {
  expect(parseStatusSessionId(CODEX_STATUS, 'codex')).toBe('019e92f3-c07b-7711-b509-fdf38f98ae14');
});

test('parses claude /status session id', () => {
  expect(parseStatusSessionId(CLAUDE_STATUS, 'claude')).toBe('5bce55fd-00c9-4348-a876-ab07332b3229');
});

test('codex matcher does not pick up claude "Session ID:" line', () => {
  expect(parseStatusSessionId(CLAUDE_STATUS, 'codex')).toBeNull();
});

test('returns null when no id present', () => {
  expect(parseStatusSessionId('nothing here', 'codex')).toBeNull();
});

test('encodeClaudeProjectDir replaces every non-alnum with dash (known samples)', () => {
  expect(encodeClaudeProjectDir('/private/tmp/falinks-try8')).toBe('-private-tmp-falinks-try8');
  expect(encodeClaudeProjectDir('/Users/liujia/工作/dagent')).toBe('-Users-liujia----dagent');
});

test('claudeSessionExists true only when <id>.jsonl is under the encoded project dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const cwd = '/private/tmp/proj-x';
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}');
  expect(claudeSessionExists(cwd, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(true);
  expect(claudeSessionExists(cwd, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(false);
});
