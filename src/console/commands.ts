export interface CommandDef {
  name: string;
  usage: string;
  hint: string;
}

/** 控制台支持的斜杠命令（用于 / 补全与帮助）。 */
export const COMMANDS: CommandDef[] = [
  { name: 'add', usage: '/add <name> <cli> <cwd>', hint: '加一个员工' },
  { name: 'remove', usage: '/remove <name>', hint: '删一个员工' },
  { name: 'help', usage: '/help', hint: '显示用法' },
];

export interface CommandState {
  active: boolean;
  query: string;
  matches: CommandDef[];
}

/** 判断当前输入是否正在打斜杠命令（行首 / 加非空白且无空格），给出匹配命令。 */
export function commandState(value: string): CommandState {
  const m = value.match(/^\/(\S*)$/);
  if (!m) return { active: false, query: '', matches: [] };
  const query = m[1].toLowerCase();
  const matches = COMMANDS.filter((c) => c.name.startsWith(query));
  return { active: matches.length > 0, query, matches };
}

/** 把输入补全成 `/<name> `（后跟空格，便于继续打参数）。 */
export function applyCommand(name: string): string {
  return `/${name} `;
}
