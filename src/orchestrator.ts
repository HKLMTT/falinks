import type { Deliverer } from './core/router.js';
import type { AgentRuntime, Message } from './core/types.js';
import type { TerminalDriver } from './terminal/driver.js';
import { t } from './i18n/index.js';

/** 把一条消息格式化成注入目标窗口的文本，含"用 sendmsg 回复"约定。 */
export function formatMessage(msg: Message): string {
  return t().incomingMsg(msg.from, msg.body);
}

/**
 * 合并投递的文本:
 * - 1 条 → 等同 formatMessage(单条),**行为零变化、无任何包装**(单条不加噪声)。
 * - ≥2 条 → 头部提示 inboxBatchHeader(n) + 编号列表,每条保留 from 归属(复用 formatMessage 的 `【来自 X】body`,
 *   去掉每条末尾的逐条"(回复…)"行,避免 N 行回复提示刷屏;回复语义由头部统一承载)。多行 body 安全(只剥最后一行)。
 */
export function formatBatch(msgs: Message[]): string {
  if (msgs.length === 1) return formatMessage(msgs[0]);
  const header = t().inboxBatchHeader(msgs.length);
  const items = msgs.map((m, i) => {
    const full = formatMessage(m);
    const cut = full.lastIndexOf('\n'); // formatMessage 末行恒为单行"(回复…)"提示;剥掉它,保留 `【来自 X】<多行 body>`
    return `[${i + 1}] ${cut >= 0 ? full.slice(0, cut) : full}`;
  });
  return `${header}\n${items.join('\n')}`;
}

/**
 * 用 driver 构造一个 Deliverer：把一批排队消息合并成一次注入并提交（提交的可靠性由 driver 负责）。
 * onFail：注入失败时回调——此时这批消息已被 pump 出 inbox、却没进 pane（消息丢失,发件人却以为发出去了）,
 * 上层据此落盘诊断,让"悄悄丢消息"可见。
 */
export function makeDeliverer(
  driver: TerminalDriver,
  onFail?: (agent: AgentRuntime, msgs: Message[], err: unknown) => void,
): Deliverer {
  return {
    deliver(agent: AgentRuntime, msgs: Message[]): void {
      if (!agent.sessionId) throw new Error(`deliver: agent ${agent.name} has no sessionId`);
      if (msgs.length === 0) return;
      const text = formatBatch(msgs);
      // 注入是异步 I/O；Router 不等待。失败时打日志 + 回调（这批消息此刻已丢失）。
      void driver.inject(agent.sessionId, text, true).catch((e) => {
        console.error(`[deliver] inject to ${agent.name} failed:`, e);
        onFail?.(agent, msgs, e);
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

/**
 * A-1 报到超时判定(纯函数,健康轮询逐轮调用)。
 * since = bootstrap 交付时刻(claude=注入成功、codex=启动序列完成),by = since + 90s。
 * 员工在 since 之后有过任意 MCP 调用 → satisfied(调用方删除 expectation);
 * 过期仍无 → timeout(告警);否则 waiting。
 */
export function checkRegisterTimeout(opts: {
  now: number;
  by: number;
  since: number;
  lastMcpAt?: number;
}): 'satisfied' | 'timeout' | 'waiting' {
  if (opts.lastMcpAt !== undefined && opts.lastMcpAt >= opts.since) return 'satisfied';
  if (opts.now > opts.by) return 'timeout';
  return 'waiting';
}

/**
 * A-2 有活无声判定(纯函数,自动降闲 mark-idle 时调用;员工自己调 idle 工具不会走到这)。
 * 每次投递最多贡献一次嫌疑(countedAt 去重,防 observeBusy 升降反复计同一条);
 * 投递后有 MCP 活动 = 健康 → reset 清哑巴计数;从未投递不计(observeBusy 场景守卫)。
 */
export function judgeAutoIdleSilence(opts: {
  deliveredAt?: number;
  countedAt: number;
  lastMcpAt?: number;
}): { count: boolean; reset: boolean; countedAt: number } {
  const d = opts.deliveredAt ?? 0;
  if (!d || d <= opts.countedAt) return { count: false, reset: false, countedAt: opts.countedAt };
  if ((opts.lastMcpAt ?? 0) >= d) return { count: false, reset: true, countedAt: d };
  return { count: true, reset: false, countedAt: d };
}
