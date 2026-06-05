import { expect, test } from 'vitest';
import { mcpConfigFor, busUrl, buildAgentLaunch } from '../../src/agent/mcp-config.js';

const spec = { name: 'alice', busPort: 7878, mcpConfigPath: '/tmp/alice-mcp.json', bootstrap: '你是 alice。调 register。' };

test('busUrl points at the agent path', () => {
  expect(busUrl('alice', 7878)).toBe('http://127.0.0.1:7878/agent/alice/mcp');
});

test('mcpConfigFor builds an http MCP config pointing at the agent path', () => {
  expect(mcpConfigFor('alice', 7878)).toEqual({
    mcpServers: { falinks: { type: 'http', url: 'http://127.0.0.1:7878/agent/alice/mcp' } },
  });
});

test('claude launch: --mcp-config + skip-permissions, needs bootstrap inject', () => {
  const r = buildAgentLaunch('claude', spec);
  expect(r.command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions');
  expect(r.needsBootstrapInject).toBe(true);
});

test('codex launch: no-alt-screen + bypass + inline MCP url + bootstrap as prompt, no inject', () => {
  const r = buildAgentLaunch('codex', spec);
  expect(r.command).toContain('codex');
  expect(r.command).toContain('--no-alt-screen');
  expect(r.command).toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(r.command).toContain('mcp_servers.falinks.transport="streamable_http"');
  expect(r.command).toContain('mcp_servers.falinks.url="http://127.0.0.1:7878/agent/alice/mcp"');
  expect(r.command).toContain("'你是 alice。调 register。'");
  expect(r.needsBootstrapInject).toBe(false);
});

test('unknown cli throws', () => {
  expect(() => buildAgentLaunch('whatever', spec)).toThrow(/unsupported cli/);
});

test('claude fresh: includes --session-id when sessionId given', () => {
  const r = buildAgentLaunch('claude', { ...spec, sessionId: 'uuid-fresh' });
  expect(r.command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions --session-id uuid-fresh');
});

test('claude resume: includes --resume and NOT --session-id', () => {
  const r = buildAgentLaunch('claude', { ...spec, resumeId: 'uuid-resume' });
  expect(r.command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions --resume uuid-resume');
});

test('codex resume: uses resume <id> with no prompt (恢复静默,不重放任务)', () => {
  const r = buildAgentLaunch('codex', { ...spec, resumeId: 'cid-1', bootstrap: '不应出现' });
  expect(r.command).toContain('resume cid-1');
  expect(r.command).not.toContain('不应出现');
  expect(r.command.trimEnd().endsWith('resume cid-1')).toBe(true);
  expect(r.command).toContain('--no-alt-screen');
  expect(r.needsBootstrapInject).toBe(false);
});
