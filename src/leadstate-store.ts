import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir, projectKey } from './runtime.js';

/** 每个项目一份 lead 项目状态档:~/.falinks/leadstate/<projectKey>.md。root 可注入便于测试。 */
export function leadStatePath(launchCwd: string, root = runtimeDir()): string {
  return join(root, 'leadstate', `${projectKey(launchCwd)}.md`);
}

/** 读档;不存在/损坏返回空串。 */
export function loadLeadState(launchCwd: string, root = runtimeDir()): string {
  const p = leadStatePath(launchCwd, root);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export function saveLeadState(launchCwd: string, content: string, root = runtimeDir()): void {
  const p = leadStatePath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** 删档(白纸语义);不存在静默。 */
export function clearLeadState(launchCwd: string, root = runtimeDir()): void {
  try { rmSync(leadStatePath(launchCwd, root)); } catch { /* 不存在/删除失败不致命 */ }
}
