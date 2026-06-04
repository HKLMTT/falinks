import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

/** 在当前进程/终端渲染控制台 TUI。先清屏+清滚动区，盖掉上面的选单/启动日志。 */
export function renderConsole(port: number): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  render(<App port={port} />);
}
