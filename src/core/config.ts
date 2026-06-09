import type { AgentName } from './types.js';

export interface AgentConfig {
  name: AgentName;
  cli: string;   // 例如 "claude"
  cwd: string;
  role?: string;
  lead?: boolean; // 组长/协调者:注入"协调者工作法"(先对齐需求→完整设计→定稿→才拆解分派)
  bootstrap: string;
}

export interface GuardConfig {
  maxTurnsPerThread: number;
  maxInjectionsPerMinute: number;
  loopWindow: number;
}

export interface FalinksConfig {
  busPort?: number; // 缺省 = 启动时自动分配(listen 0)
  historyCap?: number; // 消息流水保留上限(内存+磁盘),缺省由调用方回退默认(MESSAGE_LOG_CAP)
  paneTheme?: boolean; // 给每个员工 pane 按角色染背景色 + 加徽章;缺省视为开,设 false 整体关闭(尊重自定义配色)
  agents: AgentConfig[];
  routes: Record<string, AgentName>;
  guards: GuardConfig;
}

/** 校验并归一化原始配置对象。抛错即配置非法。 */
export function parseConfig(raw: any): FalinksConfig {
  if (!raw || typeof raw !== 'object') throw new Error('config must be an object');
  if (raw.busPort !== undefined && typeof raw.busPort !== 'number')
    throw new Error('config.busPort must be a number');
  if (raw.historyCap !== undefined && (typeof raw.historyCap !== 'number' || !Number.isInteger(raw.historyCap) || raw.historyCap <= 0))
    throw new Error('config.historyCap must be a positive integer');
  if (raw.paneTheme !== undefined && typeof raw.paneTheme !== 'boolean')
    throw new Error('config.paneTheme must be a boolean');
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
    return { name: a.name, cli: a.cli, cwd: a.cwd, role: a.role, lead: a.lead === true, bootstrap: a.bootstrap };
  });

  const routes: Record<string, AgentName> = raw.routes ?? {};
  for (const [alias, target] of Object.entries(routes)) {
    if (!names.has(target as string))
      throw new Error(`route "${alias}" -> unknown agent "${target}"`);
  }

  const gd = raw.guards ?? {};
  const guards: GuardConfig = {
    maxTurnsPerThread: typeof gd.maxTurnsPerThread === 'number' ? gd.maxTurnsPerThread : 20,
    maxInjectionsPerMinute: typeof gd.maxInjectionsPerMinute === 'number' ? gd.maxInjectionsPerMinute : 30,
    loopWindow: typeof gd.loopWindow === 'number' ? gd.loopWindow : 3,
  };

  return { busPort: raw.busPort, historyCap: raw.historyCap, paneTheme: raw.paneTheme, agents, routes, guards };
}
