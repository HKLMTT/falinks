/**
 * 把一条消息正文整理成可读的多行：保留换行、去首尾空行、逐行去尾部空白，按 maxLines 截断。
 * 宽度折行交给 Ink（<Text wrap="wrap">），不在此处理。
 */
export function formatBody(body: string, maxLines: number): { lines: string[]; truncated: number } {
  let lines = String(body).split('\n').map((l) => l.replace(/\s+$/, ''));
  // 去首尾空行
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length <= maxLines) return { lines, truncated: 0 };
  return { lines: lines.slice(0, maxLines), truncated: lines.length - maxLines };
}

/** 给消息流水里的发言人配色：不同名字稳定地分到不同颜色（Ink 颜色名）。 */
const NAME_COLORS = [
  'cyan', 'green', 'yellow', 'blue', 'magenta', 'red',
  'cyanBright', 'greenBright', 'yellowBright', 'blueBright', 'magentaBright', 'redBright',
];
export function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/** epoch 毫秒 → 本地 HH:MM:SS。 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
