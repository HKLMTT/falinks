import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir } from '../runtime.js';
import { DEFAULT_OFFICE, keyFor } from '../core/office.js';

export interface AgentSession { cli: string; sessionId: string; }
export interface SessionStore { cwd: string; agents: Record<string, AgentSession>; }

/** 每个 (项目目录, 办公室) 一份存档：~/.falinks/sessions/<key>.json。root 可注入便于测试。
 *  key 走 keyFor(realpath + sha1 [+ --office])——与 runtime 实例档案同一规范化,符号链接路径不会对不上。 */
export function sessionStorePath(launchCwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): string {
  return join(root, 'sessions', `${keyFor(launchCwd, office)}.json`);
}

/** 读存档；不存在或损坏都返回空壳。 */
export function loadStore(launchCwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): SessionStore {
  const p = sessionStorePath(launchCwd, root, office);
  if (!existsSync(p)) return { cwd: launchCwd, agents: {} };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return { cwd: launchCwd, agents: data.agents ?? {} };
  } catch {
    return { cwd: launchCwd, agents: {} };
  }
}

/** 写存档（自动建目录）。 */
export function saveStore(launchCwd: string, store: SessionStore, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  const p = sessionStorePath(launchCwd, root, office);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(store, null, 2));
}

/** 把存档裁剪到当前团队名单（换团队后旧员工的会话作废）。 */
export function pruneToAgents(store: SessionStore, names: string[]): void {
  for (const name of Object.keys(store.agents)) {
    if (!names.includes(name)) delete store.agents[name];
  }
}
