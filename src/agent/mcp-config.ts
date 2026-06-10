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
  bootstrap: string;     // 首启=完整 bootstrap；恢复时此字段被忽略（claude 不注入、codex 不传 prompt）
  bootstrapFile?: string; // codex 用:把 bootstrap 写进此文件,命令里用 "$(cat 文件)" 读,避免长命令被 write-text 截断
  sessionId?: string;    // claude 首启：--session-id（确定性 id）
  resumeId?: string;     // 恢复：claude --resume / codex resume <id>
  badge?: string;        // iTerm2 徽章文本（如 "lead·组长"）；设置时给命令加 printf OSC 前缀
}

export interface AgentLaunch {
  command: string;
  /** claude: true（启动就绪后由 falinks 注入 bootstrap）；codex: false（bootstrap 已作为初始 prompt 传入命令）。 */
  needsBootstrapInject: boolean;
}

/**
 * 给命令加 iTerm2 徽章前缀:shell 在 CLI 接管前 printf 一段 OSC `SetBadgeFormat`(base64),
 * 设上"名·角色"大水印,sticky 且 CLI 改不掉。八进制 \033/\007 经 escapeAppleScript 两层转义后由 shell printf 解析。
 */
function withBadge(command: string, badge?: string): string {
  if (!badge) return command;
  const b64 = Buffer.from(badge).toString('base64');
  return `printf '\\033]1337;SetBadgeFormat=${b64}\\007'; ${command}`;
}

/** 按 CLI 构造启动命令 + 是否需要在就绪后注入 bootstrap。 */
export function buildAgentLaunch(cli: string, spec: LaunchSpec): AgentLaunch {
  switch (cli) {
    case 'claude': {
      const tail = spec.resumeId
        ? ` --resume ${spec.resumeId}`
        : spec.sessionId
          ? ` --session-id ${spec.sessionId}`
          : '';
      return {
        command: withBadge(`claude --mcp-config ${spec.mcpConfigPath} --dangerously-skip-permissions${tail}`, spec.badge),
        needsBootstrapInject: true,
      };
    }
    case 'codex': {
      // 经 spike 验证：--no-alt-screen 利于读屏/注入；bypass 免审批；-c 内联配 streamable_http MCP；
      // bootstrap 作为位置参数传入，codex 自启即处理，无需注入。
      const url = busUrl(spec.name, spec.busPort);
      const base =
        `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox` +
        ` -c 'mcp_servers.falinks.transport="streamable_http"'` +
        ` -c 'mcp_servers.falinks.url="${url}"'`;
      // codex 的 prompt 优先用临时文件 "$(cat 文件)" 读取:codex 命令本就长(内联 -c 配置),
      // 再把 ~500 字 bootstrap 内联会超过 iTerm write-text 的长度上限被截断(单引号没闭合→卡 shell)。
      // 走文件让命令恒短;无文件时回退内联(兼容)。
      const prompt = spec.bootstrapFile ? `"$(cat ${shQuote(spec.bootstrapFile)})"` : shQuote(spec.bootstrap);
      const command = spec.resumeId
        ? `${base} resume ${spec.resumeId}`
        : `${base} ${prompt}`;
      return { command: withBadge(command, spec.badge), needsBootstrapInject: false };
    }
    default:
      throw new Error(`unsupported cli: ${cli}`);
  }
}
