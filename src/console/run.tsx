import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

/** 在当前进程/终端渲染控制台 TUI。 */
export function renderConsole(port: number): void {
  render(<App port={port} />);
}
