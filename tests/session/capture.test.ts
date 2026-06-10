import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
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

test('claudeSessionExists 对 symlink cwd 做 realpath 归一化(claude 按真实路径编码项目目录)', () => {
  // 现实事故形态:配置 cwd=/tmp/xxx(symlink),claude 实际把会话写在 -private-tmp-xxx 下,
  // 原实现拿原始 cwd 编码去找 → 永远判 fresh、resume 失效。
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const base = mkdtempSync(join(tmpdir(), 'realbase-'));
  const real = join(base, 'proj');
  mkdirSync(real);
  const link = join(base, 'link-to-proj');
  symlinkSync(real, link);
  // 会话文件放在「真实路径编码」的目录下(模拟 claude 的行为)
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(realpathSync(real)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}');
  // 用 symlink 路径查询也必须命中
  expect(claudeSessionExists(link, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(true);
});

test('claudeSessionExists 兼容按原始路径编码的旧会话目录(双形态都查)', () => {
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  const base = mkdtempSync(join(tmpdir(), 'realbase-'));
  const real = join(base, 'proj');
  mkdirSync(real);
  const link = join(base, 'link-to-proj');
  symlinkSync(real, link);
  // 会话文件在「原始(symlink)路径编码」的目录下也要能命中(防 claude 版本差异)
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(link));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}');
  expect(claudeSessionExists(link, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(true);
});

test('claudeSessionExists 对不存在的 cwd 不抛(realpath 失败回退原路径)', () => {
  const home = mkdtempSync(join(tmpdir(), 'fakehome-'));
  expect(claudeSessionExists('/no/such/dir-xyz', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', home)).toBe(false);
});
