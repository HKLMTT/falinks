import { expect, test } from 'vitest';
import { mcpConfigFor, launchCommandFor } from '../../src/agent/mcp-config.js';

test('mcpConfigFor builds an http MCP config pointing at the agent path', () => {
  const cfg = mcpConfigFor('alice', 7878);
  expect(cfg).toEqual({
    mcpServers: { dagent: { type: 'http', url: 'http://127.0.0.1:7878/agent/alice/mcp' } },
  });
});

test('launchCommandFor (claude) includes the mcp config path and skip-permissions', () => {
  const cmd = launchCommandFor('claude', '/tmp/alice-mcp.json');
  expect(cmd).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions');
});

test('launchCommandFor (codex) uses codex flags', () => {
  const cmd = launchCommandFor('codex', '/tmp/alice-mcp.json');
  expect(cmd).toContain('codex');
  expect(cmd).toContain('/tmp/alice-mcp.json');
});
