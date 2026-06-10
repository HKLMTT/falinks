import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runtimeDir, projectKey } from './runtime.js';

export interface TodoTask {
  seq: number;
  body: string;
  status: 'pending' | 'current' | 'done' | 'failed';
  result?: string;
  ts?: number; // 完结时刻
}

export interface TodoState {
  state: 'idle' | 'running' | 'paused' | 'finished';
  nudgeMinutes: number; // 巡查间隔 N(分钟),默认 10
  tasks: TodoTask[];
}

const EMPTY = (): TodoState => ({ state: 'idle', nudgeMinutes: 10, tasks: [] });

/** 每个项目一份:~/.falinks/todos/<projectKey>.json。root 可注入便于测试。 */
export function todoPath(launchCwd: string, root = runtimeDir()): string {
  return join(root, 'todos', `${projectKey(launchCwd)}.json`);
}

/** 读档;不存在/损坏返回空壳。文件说 running 一律降 paused——进程死过,由 boss /todo resume 决定续跑。 */
export function loadTodo(launchCwd: string, root = runtimeDir()): TodoState {
  const p = todoPath(launchCwd, root);
  if (!existsSync(p)) return EMPTY();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const st: TodoState = {
      state: raw.state === 'running' ? 'paused' : (raw.state ?? 'idle'),
      nudgeMinutes: typeof raw.nudgeMinutes === 'number' && raw.nudgeMinutes > 0 ? raw.nudgeMinutes : 10,
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    };
    return st;
  } catch {
    return EMPTY();
  }
}

export function saveTodo(launchCwd: string, st: TodoState, root = runtimeDir()): void {
  const p = todoPath(launchCwd, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(st, null, 2));
}
