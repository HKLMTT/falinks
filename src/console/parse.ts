import { t } from '../i18n/index.js';

export type ConsoleAction =
  | { kind: 'say'; to: string; message: string }
  | { kind: 'broadcast'; message: string }
  | { kind: 'reply'; message: string }
  | { kind: 'add'; spec: { name: string; cli: string; cwd: string } }
  | { kind: 'add-start'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'clear'; name?: string }
  | { kind: 'lang-start' }
  | { kind: 'help' }
  | { kind: 'noop' }
  | { kind: 'error'; message: string };

/** 解析控制台输入为一个动作。@all=群发, @x=私聊, /add /remove /help=命令, 纯文本=回复上次对话目标。 */
export function parseConsoleInput(line: string): ConsoleAction {
  const s = line.trim();
  if (!s) return { kind: 'noop' };

  if (s.startsWith('/')) {
    const [cmd, ...args] = s.slice(1).split(/\s+/);
    if (cmd === 'help') return { kind: 'help' };
    if (cmd === 'lang') {
      if (args.length > 0) return { kind: 'error', message: t().usageLang };
      return { kind: 'lang-start' };
    }
    if (cmd === 'remove') {
      if (!args[0]) return { kind: 'error', message: t().usageRemove };
      return { kind: 'remove', name: args[0] };
    }
    if (cmd === 'clear') {
      return { kind: 'clear', name: args[0] ? args[0].replace(/^@/, '') : undefined };
    }
    if (cmd === 'add') {
      if (args.length === 1) return { kind: 'add-start', name: args[0] };
      if (args.length >= 3) return { kind: 'add', spec: { name: args[0], cli: args[1], cwd: args[2] } };
      return { kind: 'error', message: t().usageAdd };
    }
    return { kind: 'error', message: t().unknownCommand(cmd) };
  }

  if (s.startsWith('@')) {
    const m = s.slice(1).match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return { kind: 'error', message: t().usageMention };
    if (m[1] === 'all') return { kind: 'broadcast', message: m[2] };
    return { kind: 'say', to: m[1], message: m[2] };
  }

  // 纯文本不再群发（易误操作）：作为"回复上一次对话目标"，由控制台解析目标。
  return { kind: 'reply', message: s };
}

/**
 * 从消息流推导 boss 的"上一次对话目标"= 最近一条与 self 相关的消息的对方（非 self）。
 * to===self 取 from；from===self 取 to；都不沾则跳过；找不到返回 null。
 */
export function lastReplyTarget(log: { from: string; to: string }[], self = 'boss'): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const m = log[i];
    if (m.to === self && m.from !== self) return m.from;
    if (m.from === self && m.to !== self) return m.to;
  }
  return null;
}
