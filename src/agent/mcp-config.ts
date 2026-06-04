import { shQuote } from '../terminal/iterm.js';

export interface McpConfigFile {
  mcpServers: { falinks: { type: 'http'; url: string } };
}

/** falinks 总线上某 agent 的 MCP URL。 */
export function busUrl(agentName: string, busPort: number): string {
  return `http://127.0.0.1:${busPort}/agent/${agentName}/mcp`;
}

/** Claude Code 的 --mcp-config 文件内容。 */
export function mcpConfigFor(agentName: string, busPort: number): McpConfigFile {
  return { mcpServers: { falinks: { type: 'http', url: busUrl(agentName, busPort) } } };
}

export interface LaunchSpec {
  name: string;
  busPort: number;
  mcpConfigPath: string; // claude 用
  bootstrap: string;
}

export interface AgentLaunch {
  command: string;
  /** claude: true（启动就绪后由 falinks 注入 bootstrap）；codex: false（bootstrap 已作为初始 prompt 传入命令）。 */
  needsBootstrapInject: boolean;
}

/** 按 CLI 构造启动命令 + 是否需要在就绪后注入 bootstrap。 */
export function buildAgentLaunch(cli: string, spec: LaunchSpec): AgentLaunch {
  switch (cli) {
    case 'claude':
      return {
        command: `claude --mcp-config ${spec.mcpConfigPath} --dangerously-skip-permissions`,
        needsBootstrapInject: true,
      };
    case 'codex': {
      // 经 spike 验证：--no-alt-screen 利于读屏/注入；bypass 免审批；-c 内联配 streamable_http MCP；
      // bootstrap 作为位置参数传入，codex 自启即处理，无需注入。
      const url = busUrl(spec.name, spec.busPort);
      const command =
        `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox` +
        ` -c 'mcp_servers.falinks.transport="streamable_http"'` +
        ` -c 'mcp_servers.falinks.url="${url}"'` +
        ` ${shQuote(spec.bootstrap)}`;
      return { command, needsBootstrapInject: false };
    }
    default:
      throw new Error(`unsupported cli: ${cli}`);
  }
}
