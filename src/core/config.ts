import type { AgentName } from './types.js';

export interface AgentConfig {
  name: AgentName;
  cli: string;   // 例如 "claude"
  cwd: string;
  role?: string;
  bootstrap: string;
}

export interface DagentConfig {
  busPort: number;
  agents: AgentConfig[];
  routes: Record<string, AgentName>;
}

/** 校验并归一化原始配置对象。抛错即配置非法。 */
export function parseConfig(raw: any): DagentConfig {
  if (!raw || typeof raw !== 'object') throw new Error('config must be an object');
  if (typeof raw.busPort !== 'number') throw new Error('config.busPort must be a number');
  if (!Array.isArray(raw.agents) || raw.agents.length === 0)
    throw new Error('config.agents must have at least one agent');

  const names = new Set<string>();
  const agents: AgentConfig[] = raw.agents.map((a: any, i: number) => {
    for (const f of ['name', 'cli', 'cwd', 'bootstrap'] as const) {
      if (typeof a?.[f] !== 'string' || a[f].length === 0)
        throw new Error(`config.agents[${i}].${f} must be a non-empty string`);
    }
    if (names.has(a.name)) throw new Error(`duplicate agent name: ${a.name}`);
    names.add(a.name);
    return { name: a.name, cli: a.cli, cwd: a.cwd, role: a.role, bootstrap: a.bootstrap };
  });

  const routes: Record<string, AgentName> = raw.routes ?? {};
  for (const [alias, target] of Object.entries(routes)) {
    if (!names.has(target as string))
      throw new Error(`route "${alias}" -> unknown agent "${target}"`);
  }

  return { busPort: raw.busPort, agents, routes };
}
