import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { KITTY_PUSH, KITTY_POP } from './keys.js';

/** 在当前进程/终端渲染控制台 TUI。先清屏+清滚动区，盖掉上面的选单/启动日志。 */
export function renderConsole(port: number): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  process.stdout.write(KITTY_PUSH); // 开 kitty 键盘协议：让 Shift+Enter 等修饰键可区分
  const restore = () => { try { process.stdout.write(KITTY_POP); } catch { /* ignore */ } };
  process.on('exit', restore);
  render(<App port={port} />, { exitOnCtrlC: false }); // Ctrl+C 自行处理：先问是否关闭员工窗口
}
