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
 * 从读屏文本判断员工此刻是否"正在生成"。claude 与 codex 生成时都显示「esc to interrupt」。
 * 不忙 = 已回到空闲提示符（生成结束 / 被 Ctrl+C 打断 / 没调 idle 工具）——用于自动检测空闲、把排队消息投出去。
 */
export function isPaneBusy(screen: string): boolean {
  return /esc to interrupt/i.test(screen);
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
