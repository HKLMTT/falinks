/**
 * 把任意文本转义为可安全嵌入 AppleScript 双引号字符串字面量的形式。
 * 顺序很重要：先转义反斜杠，再转义引号，最后把换行变为字面 \n。
 */
export function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}
