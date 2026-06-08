import type { Deliverer } from './core/router.js';
import type { AgentRuntime, Message } from './core/types.js';
import type { TerminalDriver } from './terminal/driver.js';
import { t } from './i18n/index.js';

/** 把一条消息格式化成注入目标窗口的文本，含"用 sendmsg 回复"约定。 */
export function formatMessage(msg: Message): string {
  return t().incomingMsg(msg.from, msg.body);
}

/** 用 driver 构造一个 Deliverer：注入格式化文本并提交（提交的可靠性由 driver 负责）。 */
export function makeDeliverer(driver: TerminalDriver): Deliverer {
  return {
    deliver(agent: AgentRuntime, msg: Message): void {
      if (!agent.sessionId) throw new Error(`deliver: agent ${agent.name} has no sessionId`);
      const text = formatMessage(msg);
      // 注入是异步 I/O；Router 不等待。失败时打日志（Plan 1B 接 markDead）。
      void driver.inject(agent.sessionId, text, true).catch((e) => {
        console.error(`[deliver] inject to ${agent.name} failed:`, e);
      });
    },
  };
}

export type ScreenState = 'trust-dialog' | 'ready' | 'starting';

/** 从读屏文本判断 CLI 启动阶段（用于决定注入信任选择 / bootstrap）。兼容 Claude 与 Codex 的信任对话。 */
export function detectScreenState(screen: string): ScreenState {
  if (/trust this folder|you trust\?|trust the contents of this directory/i.test(screen)) return 'trust-dialog';
  if (/❯/.test(screen)) return 'ready';
  return 'starting';
}

/**
 * 从读屏文本判断员工此刻是否"正在生成"（仅作兜底；权威「闲」信号是员工调 idle 工具、「忙」是消息投递）。
 * 不忙 = 已回到空闲提示符（生成结束 / 被 Ctrl+C 打断 / 没调 idle 工具）——用于自动检测空闲、把排队消息投出去。
 *
 * ⚠️ 只认 Claude/Codex 的**生成 spinner 结构**,绝不依赖、也绝不被 statusLine 误触（statusLine 用户可自定义,
 * 每个人都不一样）。「esc to interrupt」是状态行最右段,窄分屏里被 pane 宽度裁掉,iTerm `text of s` 抓不到,
 * 所以再认裁不掉的 spinner 计时器:
 * - claude 生成中：`<动词>… (<计时器>)`,如 `Hashing… (5m 28s · ↓ 5.7k tokens)`。计时器单位用**小写** s/m 匹配,
 *   大小写敏感以避开自定义 statusLine 里的 `(1M context)` 之类。
 * - codex 生成中：`Working (<Ns> …)`。
 * 完成态 `Brewed for 58s`（有 for、无 `…(`、无括号计时器）与各种自定义 statusLine 均不命中。
 */
export function isPaneBusy(screen: string): boolean {
  return /esc to interrupt/i.test(screen)         // 通用、未裁切（两种 CLI）
      || /…\s*\(\d+\s*[ms]\b/.test(screen)        // claude spinner: <动词>… (16s / 5m 28s …)
      || /\bworking\b\s*\(\d+\s*s\b/i.test(screen); // codex: Working (3s …)
}

export type PaneStatusAction = 'mark-busy' | 'mark-idle' | 'none';

/**
 * 按 pane 实况校准花名册状态（双向，非对称去抖）。让状态以 pane 为准，而非只靠消息记账。
 * - 路由以为 idle、pane 在生成 → mark-busy（即时；反映真实，且偏向"忙"避免往生成中的 pane 投消息）。
 * - 路由以为 busy、pane 已空闲、过了投递宽限、且连续 idleStreak 次都不忙 → mark-idle
 *   （去抖：长任务里工具调用间隙 / 跑 bash / 滚屏会让「esc to interrupt」短暂离开视口，单次采样不算数）。
 * - launching / dead / stuck 不动。
 */
export function reconcilePaneStatus(opts: {
  status: string;
  paneBusy: boolean;
  gracePassed: boolean;
  idleStreak: number;   // 连续采到"不忙"的次数（含本次）
  idleThreshold: number;
}): PaneStatusAction {
  const { status, paneBusy, gracePassed, idleStreak, idleThreshold } = opts;
  if (status === 'idle') return paneBusy ? 'mark-busy' : 'none';
  if (status === 'busy') {
    if (!paneBusy && gracePassed && idleStreak >= idleThreshold) return 'mark-idle';
    return 'none';
  }
  return 'none';
}
