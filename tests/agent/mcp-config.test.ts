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

test('codex bootstrapFile: 用 "$(cat 文件)" 读取,命令不内联长 bootstrap(防 write-text 截断)', () => {
  const longBootstrap = '协作规则'.repeat(200); // 长 bootstrap
  const r = buildAgentLaunch('codex', { ...spec, bootstrap: longBootstrap, bootstrapFile: '/tmp/falinks-x/alice-bootstrap.txt' });
  expect(r.command).toContain(`"$(cat '/tmp/falinks-x/alice-bootstrap.txt')"`);
  expect(r.command).not.toContain(longBootstrap); // 长文本不进命令行
  expect(r.command.length).toBeLessThan(400);     // 命令保持短
  expect(r.needsBootstrapInject).toBe(false);
});

// 徽章:启动命令前缀 printf OSC SetBadgeFormat(base64),CLI 接管前由 shell 打到终端输出。
const b64 = (s: string) => Buffer.from(s).toString('base64');

test('badge: claude 命令加 printf SetBadgeFormat 前缀(base64),原命令保留在其后', () => {
  const r = buildAgentLaunch('claude', { ...spec, badge: 'lead·组长' });
  expect(r.command).toContain(`SetBadgeFormat=${b64('lead·组长')}`);
  expect(r.command.startsWith('printf ')).toBe(true);
  expect(r.command).toContain('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions');
  expect(r.needsBootstrapInject).toBe(true);
});

test('badge: codex 命令同样加前缀,且不影响 MCP/bootstrap', () => {
  const r = buildAgentLaunch('codex', { ...spec, badge: 'qa·测试' });
  expect(r.command).toContain(`SetBadgeFormat=${b64('qa·测试')}`);
  expect(r.command).toContain('codex');
  expect(r.command).toContain('mcp_servers.falinks.url="http://127.0.0.1:7878/agent/alice/mcp"');
  expect(r.needsBootstrapInject).toBe(false);
});

test('badge: 含 OSC 转义字节(\\033 / \\007),供 shell printf 解析', () => {
  const r = buildAgentLaunch('claude', { ...spec, badge: 'lead' });
  expect(r.command).toContain('\\033]1337;SetBadgeFormat=');
  expect(r.command).toContain('\\007');
});

test('badge: 不传 badge 时命令逐字不变(回归,关开关/无需求零影响)', () => {
  expect(buildAgentLaunch('claude', spec).command).toBe('claude --mcp-config /tmp/alice-mcp.json --dangerously-skip-permissions');
});
