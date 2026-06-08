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
 * ⚠️ 只看屏幕**底部活区**(最后几行非空),不扫全屏:scrollback 里会残留旧的 spinner 帧
 * (如 `Wibbling… (1m 17s …)`,长任务滚屏时被冻在历史里),全屏匹配会把已空闲的 pane 误判成忙、卡住不降。
 * 生成时 spinner 恒在最底行;空闲时最底是输入框 + 状态栏。判据:
 * - 底部状态栏出现 `shift+tab to cycle` / `bypass permissions on` = 已回到空闲提示符 → 不忙(压过任何残留)。
 * - 否则底部活区里有生成标志才算忙:`esc to interrupt` / claude `<动词>… (16s|5m 28s)` / codex `Working (3s)`。
 *   计时器单位用**小写** s/m(大小写敏感),避开自定义 statusLine 里的 `(1M context)` 之类。
 */
export function isPaneBusy(screen: string): boolean {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l);
  const tail = lines.slice(-6).join('\n');   // 活区:判忙只看这里
  const bottom = lines.slice(-2).join('\n'); // 最底:输入框状态栏出现在这里才算回到空闲
  if (/shift\+tab to cycle|bypass permissions on/i.test(bottom)) return false;
  return /esc to interrupt/i.test(tail)
      || /…\s*\(\d+\s*[ms]\b/.test(tail)
      || /\bworking\b\s*\(\d+\s*s\b/i.test(tail);
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
