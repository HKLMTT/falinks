import type { Deliverer } from './core/router.js';
import type { AgentRuntime, Message } from './core/types.js';
import type { TerminalDriver } from './terminal/driver.js';

/** 把一条消息格式化成注入目标窗口的文本，含"用 sendmsg 回复"约定。 */
export function formatMessage(msg: Message): string {
  return (
    `【来自 ${msg.from}】${msg.body}\n` +
    `(回复请调用 sendmsg(to="${msg.from}", message="..."))`
  );
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
