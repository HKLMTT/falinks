export interface LogMsg { id: string; from: string; to: string; body: string; ts: number; queued?: boolean }

/** 把 log 中 id 未见过的消息按顺序追加到 committed(已提交项引用不变);无新增则返回原数组。 */
export function appendCommitted<T extends { id: string }>(committed: T[], log: T[]): T[] {
  const seen = new Set(committed.map((m) => m.id));
  const fresh = log.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return committed;
  return [...committed, ...fresh];
}

/** 当前仍在对方 inbox 排队(queued)的目标列表,去重保序。 */
export function pendingTargets(log: LogMsg[]): string[] {
  const out: string[] = [];
  for (const m of log) if (m.queued && !out.includes(m.to)) out.push(m.to);
  return out;
}
