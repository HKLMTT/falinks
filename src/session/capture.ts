import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** 从一屏 /status 文本里抠 session id。codex 行首是 `Session:`，claude 是 `Session ID:`。读不到返回 null。 */
export function parseStatusSessionId(screen: string, cli: 'claude' | 'codex'): string | null {
  const label = cli === 'codex' ? 'Session' : 'Session ID';
  const m = screen.match(new RegExp(`${label}:\\s*(${UUID})`));
  return m ? m[1].toLowerCase() : null;
}

/** claude 把每个项目的会话存在 ~/.claude/projects/<编码 cwd>/ 下，编码=把非字母数字全替成 '-'。 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 该 cwd 下是否已存在某 session id 的 jsonl（决定 claude 用 --resume 还是 --session-id，避免 resume 报错）。 */
export function claudeSessionExists(cwd: string, sessionId: string, home = homedir()): boolean {
  return existsSync(join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`));
}
