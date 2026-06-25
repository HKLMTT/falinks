import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { runtimeDir } from './runtime.js';
import { DEFAULT_OFFICE, officeSuffix } from './core/office.js';

/** 消息流水的滚动上限：内存与磁盘都只保留最近这么多条（可被 config.historyCap 覆盖）。 */
export const MESSAGE_LOG_CAP = 5000;

/** 每个 (项目目录, 办公室) 一份消息流水：~/.falinks/messages/<sha1(cwd)前16位[--office]>.jsonl。root 可注入便于测试。
 *  注:base 沿用历史的 sha1(cwd)(未 realpath),与 keyFor 的 projectKey 基准不同——为默认办公室逐字节兼容而保留;office 后缀规则与全局一致。 */
export function messageLogPath(cwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): string {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16) + officeSuffix(office);
  return join(root, 'messages', `${key}.jsonl`);
}

/** 追加一条消息（O(1) 追加，不重写整文件）。 */
export function appendMessageLog(cwd: string, msg: unknown, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  const p = messageLogPath(cwd, root, office);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(msg) + '\n');
}

/** 读最近 cap 条；坏行跳过；文件超过 2×cap 行时顺手压缩重写（避免无限增长）。 */
export function loadMessageLog(cwd: string, cap = MESSAGE_LOG_CAP, root = runtimeDir(), office: string = DEFAULT_OFFICE): unknown[] {
  const p = messageLogPath(cwd, root, office);
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

/** 清空某 (项目, 办公室) 的消息流水(boss 历史对话):删除持久化文件。不存在为 no-op。 */
export function clearMessageLog(cwd: string, root = runtimeDir(), office: string = DEFAULT_OFFICE): void {
  rmSync(messageLogPath(cwd, root, office), { force: true });
}
