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

/** 用 driver 构造一个 Deliverer：注入格式化文本并提交。 */
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

/** 从读屏文本判断 CLI 启动阶段（用于决定注入信任选择 / bootstrap）。 */
export function detectScreenState(screen: string): ScreenState {
  if (/trust this folder|you trust\?/i.test(screen)) return 'trust-dialog';
  if (/❯/.test(screen)) return 'ready';
  return 'starting';
}
