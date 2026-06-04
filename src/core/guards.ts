import type { GuardConfig } from './config.js';

export type BreakReason = 'turn-cap' | 'loop';
export interface GuardDecision {
  ok: boolean;
  reason?: BreakReason;
}

/** 服务端权威的防失控状态机：thread 回合上限、退化循环检测、全局发送节流。纯逻辑，时钟注入。 */
export class Guards {
  private threadTurns = new Map<string, number>();
  private threadRecent = new Map<string, string[]>();
  private sendTimes: number[] = [];
  private seq = 0;

  constructor(private cfg: GuardConfig, private now: () => number) {}

  newThread(): string {
    return `th${++this.seq}`;
  }

  checkMessage(thread: string, body: string): GuardDecision {
    const turns = (this.threadTurns.get(thread) ?? 0) + 1;
    this.threadTurns.set(thread, turns);
    if (turns > this.cfg.maxTurnsPerThread) return { ok: false, reason: 'turn-cap' };

    const norm = body.trim().replace(/\s+/g, ' ');
    const recent = this.threadRecent.get(thread) ?? [];
    recent.push(norm);
    while (recent.length > this.cfg.loopWindow) recent.shift();
    this.threadRecent.set(thread, recent);
    if (recent.length >= this.cfg.loopWindow && recent.every((b) => b === recent[0])) {
      return { ok: false, reason: 'loop' };
    }
    return { ok: true };
  }

  allowInjection(): boolean {
    const t = this.now();
    const cutoff = t - 60_000;
    this.sendTimes = this.sendTimes.filter((x) => x > cutoff);
    if (this.sendTimes.length >= this.cfg.maxInjectionsPerMinute) return false;
    this.sendTimes.push(t);
    return true;
  }
}
