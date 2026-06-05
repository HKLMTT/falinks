import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 把剪贴板里的图片（若有）存成临时 PNG，返回路径；无图或失败返回 null。仅 macOS。
 * 原理：直接读系统剪贴板（osascript 取 «class PNGf»），不依赖终端粘贴。
 */
export function saveClipboardImage(): Promise<string | null> {
  const out = join(tmpdir(), `falinks-clip-${Date.now()}.png`);
  const script =
    `set f to (open for access (POSIX file "${out}") with write permission)\n` +
    `try\n` +
    `  write (the clipboard as «class PNGf») to f\n` +
    `  close access f\n` +
    `on error\n` +
    `  close access f\n` +
    `  error "no image"\n` +
    `end try`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err) => resolve(err ? null : out));
  });
}

/** 把输入里的 `[图片N]` / `[Image N]` 占位符展开成对应的真实文件路径（发送前用）。 */
export function expandImageTokens(line: string, paths: string[]): string {
  return line.replace(/\[(?:图片|Image\s?)(\d+)\]/g, (m, n) => paths[Number(n) - 1] ?? m);
}
