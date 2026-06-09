import { t } from '../i18n/index.js';

export interface CommandDef {
  name: string;
  usage: string;
  hint: string;
  noArgs?: boolean; // 无参命令(lang/help):补全时回车/Tab 直接执行,不补成 "/cmd " 让人以为要输参数
}

/** 控制台支持的斜杠命令（用于 / 补全与帮助）。usage 是纯 ASCII 不入词典;hint 随 locale 动态从词典取。 */
export const COMMANDS: CommandDef[] = [
  { name: 'add', usage: '/add <name> <cli> <cwd>', get hint() { return t().cmdHint.add; } },
  { name: 'remove', usage: '/remove <name>', get hint() { return t().cmdHint.remove; } },
  { name: 'clear', usage: '/clear [name]', get hint() { return t().cmdHint.clear; } },
  { name: 'filter', usage: '/filter [from|to] <name>', get hint() { return t().cmdHint.filter; } },
  { name: 'lang', usage: '/lang', noArgs: true, get hint() { return t().cmdHint.lang; } },
  { name: 'mouse', usage: '/mouse', noArgs: true, get hint() { return t().cmdHint.mouse; } },
  { name: 'help', usage: '/help', noArgs: true, get hint() { return t().cmdHint.help; } },
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
