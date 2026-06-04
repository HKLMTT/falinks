import type { SessionStore } from './store.js';
import { claudeSessionExists } from './capture.js';

export interface ClaudeDecision { mode: 'resume' | 'fresh'; sessionId: string; }
export type CodexDecision = { mode: 'resume'; sessionId: string } | { mode: 'fresh' };

/**
 * claude：有存档且对应会话文件还在 → resume 旧 id；否则 fresh 用新生成的 uuid。
 * fresh 永远用新 uuid，绝不把旧 id 拿去传 --session-id（会报「已存在」）。
 */
export function decideClaudeSession(
  store: SessionStore,
  name: string,
  agentCwd: string,
  genUuid: () => string,
  sessionExists: (cwd: string, id: string) => boolean = claudeSessionExists,
): ClaudeDecision {
  const stored = store.agents[name];
  if (stored?.cli === 'claude' && sessionExists(agentCwd, stored.sessionId)) {
    return { mode: 'resume', sessionId: stored.sessionId };
  }
  return { mode: 'fresh', sessionId: genUuid() };
}

/** codex：有存档就 resume 那个 id；否则 fresh（fresh 时由 /status 现场捕获 id）。 */
export function decideCodexSession(store: SessionStore, name: string): CodexDecision {
  const stored = store.agents[name];
  if (stored?.cli === 'codex') return { mode: 'resume', sessionId: stored.sessionId };
  return { mode: 'fresh' };
}
