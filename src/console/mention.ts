export interface MentionState {
  active: boolean;
  query: string;
  matches: string[];
}

/** 判断当前输入是否正在打 @提及（末尾的 @ 加非空白），并给出匹配的成员名。 */
export function mentionState(value: string, names: string[]): MentionState {
  const m = value.match(/@([^\s@]*)$/);
  if (!m) return { active: false, query: '', matches: [] };
  const query = m[1];
  const matches = names.filter((n) => n.toLowerCase().startsWith(query.toLowerCase()));
  return { active: matches.length > 0, query, matches };
}

/** 把末尾的 @query 替换成选定的 @name（后跟一个空格）。 */
export function applyMention(value: string, name: string): string {
  return value.replace(/@([^\s@]*)$/, `@${name} `);
}
