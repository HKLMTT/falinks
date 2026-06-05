import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { runtimeDir } from './runtime.js';

/** 消息流水的滚动上限：内存与磁盘都只保留最近这么多条。 */
export const MESSAGE_LOG_CAP = 300;

/** 每个项目目录一份消息流水：~/.falinks/messages/<cwd 的 sha1 前16位>.jsonl。root 可注入便于测试。 */
export function messageLogPath(cwd: string, root = runtimeDir()): string {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  return join(root, 'messages', `${key}.jsonl`);
}

/** 追加一条消息（O(1) 追加，不重写整文件）。 */
export function appendMessageLog(cwd: string, msg: unknown, root = runtimeDir()): void {
  const p = messageLogPath(cwd, root);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(msg) + '\n');
}

/** 读最近 cap 条；坏行跳过；文件超过 2×cap 行时顺手压缩重写（避免无限增长）。 */
export function loadMessageLog(cwd: string, cap = MESSAGE_LOG_CAP, root = runtimeDir()): unknown[] {
  const p = messageLogPath(cwd, root);
  if (!existsSync(p)) return [];
  let lines: string[];
  try {
    lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
  const msgs = lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m): m is unknown => m !== null);
  const tail = msgs.slice(-cap);
  if (msgs.length > cap * 2) {
    try { writeFileSync(p, tail.map((m) => JSON.stringify(m)).join('\n') + '\n'); } catch { /* 压缩失败无所谓 */ }
  }
  return tail;
}
