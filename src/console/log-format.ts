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
