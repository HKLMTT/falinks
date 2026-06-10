import { expect, test } from 'vitest';
import { buildAgentLaunch } from '../../src/agent/mcp-config.js';

const spec = (extra: object = {}) => ({
  name: 'dev', busPort: 1234, mcpConfigPath: '/tmp/m.json',
  bootstrap: 'hi', bootstrapFile: '/tmp/b.txt', ...extra,
});

// 注:实现统一走 shQuote,纯净模型名也会被单引号包裹('o3'),
// 故断言用 toMatch 容忍可选引号,只锁"flag + 模型名"本身。

test('claude fresh:有 model 加 --model,无则不加', () => {
  expect(buildAgentLaunch('claude', spec({ model: 'claude-opus-4-8' })).command).toMatch(/--model '?claude-opus-4-8'?/);
  expect(buildAgentLaunch('claude', spec()).command).not.toContain('--model');
});

test('claude resume 也带 --model(防恢复后漂回全局默认)', () => {
  const c = buildAgentLaunch('claude', spec({ model: 'claude-opus-4-8', resumeId: 'sid-1' })).command;
  expect(c).toContain('--resume sid-1');
  expect(c).toMatch(/--model '?claude-opus-4-8'?/);
});

test('codex fresh 与 resume 都带 -m', () => {
  expect(buildAgentLaunch('codex', spec({ model: 'o3' })).command).toMatch(/-m '?o3'?/);
  const r = buildAgentLaunch('codex', spec({ model: 'o3', resumeId: 'sid-2' })).command;
  expect(r).toContain('resume sid-2');
  expect(r).toMatch(/-m '?o3'?/);
});

test('模型名经 shell 安全处理(含空格等不破坏命令)', () => {
  const c = buildAgentLaunch('claude', spec({ model: 'weird name' })).command;
  expect(c).toContain("--model 'weird name'");
});
