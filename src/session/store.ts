import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir } from '../runtime.js';

export interface AgentSession { cli: string; sessionId: string; }
export interface SessionStore { cwd: string; agents: Record<string, AgentSession>; }

/** 每个项目目录一份存档：~/.falinks/sessions/<cwd 的 sha1 前16位>.json。root 可注入便于测试。 */
export function sessionStorePath(launchCwd: string, root = runtimeDir()): string {
  const key = createHash('sha1').update(launchCwd).digest('hex').slice(0, 16);
  return join(root, 'sessions', `${key}.json`);
}

/** 读存档；不存在或损坏都返回空壳。 */
export function loadStore(launchCwd: string, root = runtimeDir()): SessionStore {
  const p = sessionStorePath(launchCwd, root);
  if (!existsSync(p)) return { cwd: launchCwd, agents: {} };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return { cwd: launchCwd, agents: data.agents ?? {} };
  } catch {
    return { cwd: launchCwd, agents: {} };
  }
}

/** 写存档（自动建目录）。 */
export function saveStore(launchCwd: string, store: SessionStore, root = runtimeDir()): void {
  const p = sessionStorePath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(store, null, 2));
}

/** 把存档裁剪到当前团队名单（换团队后旧员工的会话作废）。 */
export function pruneToAgents(store: SessionStore, names: string[]): void {
  for (const name of Object.keys(store.agents)) {
    if (!names.includes(name)) delete store.agents[name];
  }
}
