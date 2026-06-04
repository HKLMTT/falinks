import React from 'react';
import { render } from 'ink';
import { SetupApp } from './app.js';

/**
 * 渲染启动选择向导。
 * current：当前目录已有配置的简述（员工名），有则提供"继续当前团队"默认项。
 * 返回 null 表示沿用现有配置；否则返回新的 falinks 配置对象。
 */
export function runSetup(cwd: string, current: string | null): Promise<unknown> {
  return new Promise((resolve) => {
    const app = render(<SetupApp cwd={cwd} current={current} onDone={(cfg) => { app.unmount(); resolve(cfg); }} />);
  });
}
