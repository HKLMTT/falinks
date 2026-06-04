import React from 'react';
import { render } from 'ink';
import { SetupApp } from './app.js';

/** 渲染启动选择向导，返回用户选定/自定义的 falinks 配置对象。 */
export function runSetup(cwd: string): Promise<unknown> {
  return new Promise((resolve) => {
    const app = render(<SetupApp cwd={cwd} onDone={(cfg) => { app.unmount(); resolve(cfg); }} />);
  });
}
