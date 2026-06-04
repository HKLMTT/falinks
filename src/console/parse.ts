export type ConsoleAction =
  | { kind: 'say'; to: string; message: string }
  | { kind: 'broadcast'; message: string }
  | { kind: 'add'; spec: { name: string; cli: string; cwd: string } }
  | { kind: 'remove'; name: string }
  | { kind: 'help' }
  | { kind: 'noop' }
  | { kind: 'error'; message: string };

/** 解析控制台输入行为一个动作。@x=私聊, /add /remove /help=命令, 其余=群发。 */
export function parseConsoleInput(line: string): ConsoleAction {
  const s = line.trim();
  if (!s) return { kind: 'noop' };

  if (s.startsWith('/')) {
    const [cmd, ...args] = s.slice(1).split(/\s+/);
    if (cmd === 'help') return { kind: 'help' };
    if (cmd === 'remove') {
      if (!args[0]) return { kind: 'error', message: '用法: /remove <name>' };
      return { kind: 'remove', name: args[0] };
    }
    if (cmd === 'add') {
      if (args.length < 3) return { kind: 'error', message: '用法: /add <name> <cli> <cwd>' };
      return { kind: 'add', spec: { name: args[0], cli: args[1], cwd: args[2] } };
    }
    return { kind: 'error', message: `未知命令: /${cmd}` };
  }

  if (s.startsWith('@')) {
    const m = s.slice(1).match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return { kind: 'error', message: '用法: @<name> <message>' };
    return { kind: 'say', to: m[1], message: m[2] };
  }

  return { kind: 'broadcast', message: s };
}
