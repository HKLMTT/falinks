export interface McpConfigFile {
  mcpServers: { dagent: { type: 'http'; url: string } };
}

export function mcpConfigFor(agentName: string, busPort: number): McpConfigFile {
  return {
    mcpServers: {
      dagent: { type: 'http', url: `http://127.0.0.1:${busPort}/agent/${agentName}/mcp` },
    },
  };
}

/** 拼出在终端里启动该 CLI 并连上 dagent 总线的命令。 */
export function launchCommandFor(cli: string, mcpConfigPath: string): string {
  switch (cli) {
    case 'claude':
      return `claude --mcp-config ${mcpConfigPath} --dangerously-skip-permissions`;
    case 'codex':
      // Codex 用 --config 指向含 mcp_servers 的配置；此处为可工作的近似，
      // 真实 Codex 接入在 1B 里程碑(Task 7)按其当前 flag 校准。
      return `codex --config ${mcpConfigPath}`;
    default:
      throw new Error(`unsupported cli: ${cli}`);
  }
}
