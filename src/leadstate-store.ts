import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir } from './runtime.js';
import { DEFAULT_OFFICE, keyFor } from './core/office.js';

/** 每个 (项目, 办公室) 一份 lead 项目状态档:~/.falinks/leadstate/<key>.md。root 可注入便于测试。 */
export function leadStatePath(launchCwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): string {
  return join(root, 'leadstate', `${keyFor(launchCwd, office)}.md`);
}

/** 读档;不存在/损坏返回空串。 */
export function loadLeadState(launchCwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): string {
  const p = leadStatePath(launchCwd, root, office);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export function saveLeadState(launchCwd: string, content: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  const p = leadStatePath(launchCwd, root, office);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** 删档(白纸语义);不存在静默。 */
export function clearLeadState(launchCwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  try { rmSync(leadStatePath(launchCwd, root, office)); } catch { /* 不存在/删除失败不致命 */ }
}
