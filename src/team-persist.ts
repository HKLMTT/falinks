import { readFileSync, writeFileSync } from 'node:fs';
import { bootstrapForRole } from './templates.js';
import { t } from './i18n/index.js';

/** 动态增删员工时写回配置文件用的最小员工形状（与控制台 /add 发出的 spec 一致）。 */
export interface PersistAgent {
  name: string;
  cli: string;
  cwd: string;
  role?: string;
  bootstrap?: string;
  model?: string; // 模型名;缺省不写键,保持配置文件干净
}

/**
 * 把一个动态新增的员工写回 falinks 配置文件（按 name 去重）。
 * 关键：parseConfig 要求每个员工 bootstrap 非空，所以缺省时由 role 派生一条，
 * 否则「继续当前团队」下次启动会在 parseConfig 处崩。
 */
export function addAgentToConfigFile(configPath: string, agent: PersistAgent): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!Array.isArray(raw.agents)) raw.agents = [];
  if (raw.agents.some((a: { name?: string }) => a?.name === agent.name)) return;
  raw.agents.push({
    name: agent.name,
    cli: agent.cli,
    cwd: agent.cwd,
    role: agent.role,
    bootstrap: agent.bootstrap && agent.bootstrap.length ? agent.bootstrap : bootstrapForRole(agent.role ?? t().wizardDefaultRole),
    ...(agent.model ? { model: agent.model } : {}),
  });
  writeFileSync(configPath, JSON.stringify(raw, null, 2));
}

/** 从 falinks 配置文件移除一个员工（按 name）。 */
export function removeAgentFromConfigFile(configPath: string, name: string): void {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!Array.isArray(raw.agents)) return;
  raw.agents = raw.agents.filter((a: { name?: string }) => a?.name !== name);
  writeFileSync(configPath, JSON.stringify(raw, null, 2));
}
