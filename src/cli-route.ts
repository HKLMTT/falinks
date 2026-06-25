import { DEFAULT_OFFICE, assertOfficeName } from './core/office.js';

/** falinks 的子命令(switch 分发的 9 个);其余 token 才可能是办公室名简写。 */
export const CLI_SUBCOMMANDS = ['up', 'console', 'init', 'doctor', 'lang', 'say', 'broadcast', 'roster', 'log'] as const;

export type CliAction = 'subcommand' | 'office-shorthand' | 'help';

/** 是否可用作"具名办公室"名:以 assertOfficeName 为单一真源(同时拦保留名 default + 非法字符)。 */
function isUsableOfficeName(name: string): boolean {
  try { assertOfficeName(name); return true; } catch { return false; }
}

/**
 * 纯判定:第一个参数 cmd 该当作子命令、`falinks <名字>` 办公室简写、还是回退 help。无副作用,供单测。
 * - cmd ∈ 子命令 → 'subcommand'(子命令优先;办公室名撞这 9 个词时按子命令处理)。
 * - 否则:未带 --office(office===DEFAULT_OFFICE)、cmd 是可用具名办公室名(assertOfficeName 通过 → 非保留名 default、非非法字符)、且无多余参数(rest 空)→ 'office-shorthand'。
 * - 其余 → 'help'(非法名/保留名 default/带额外参数/已带 --office 等歧义)。
 */
export function resolveCliAction(cmd: string, office: string, rest: string[]): CliAction {
  if ((CLI_SUBCOMMANDS as readonly string[]).includes(cmd)) return 'subcommand';
  if (office === DEFAULT_OFFICE && isUsableOfficeName(cmd) && rest.length === 0) return 'office-shorthand';
  return 'help';
}
